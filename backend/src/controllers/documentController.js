const db = require("../db/database");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { simpleParser } = require("mailparser");
const { createSharedMailClient, createUserMailClient } = require("../services/userMailService");
const { defaultApprovalWorkflow, buildApprovalSteps, parseApprovalSteps, roleMatches } = require("../domain/workflow");

const uploadDirectory = path.resolve(__dirname, "../../uploads");

function documentDraftNumber(document) {
    if (document.type !== "지출 문서") return null;
    if (document.draftNumber || document.draft_number) return document.draftNumber || document.draft_number;
    const date = new Date(document.createdAt || document.created_at || Date.now());
    const datePart = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    return `EXP-${datePart}-${String(document.id).padStart(4, "0")}`;
}

async function addDocumentHistory(queryable, { documentId, action, previousStatus = null, nextStatus = null, processedUserId = null, processedBy = "", processedPosition = "", processedIp = "", comment = "" }) {
    await queryable.query(
        `INSERT INTO document_history
         (document_id, action, previous_status, next_status, processed_user_id, processed_by, processed_position, processed_ip, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [documentId, action, previousStatus, nextStatus, processedUserId, processedBy, processedPosition, processedIp, comment]
    );
}

async function loadGlobalAttachmentCategories() {
    const [settings] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'attachment_categories'");
    if (settings.length) {
        try {
            const categories = JSON.parse(settings[0].setting_value);
            if (Array.isArray(categories)) return categories;
        } catch { }
    }

    const [rows] = await db.query(
        `SELECT attachment_categories AS categories FROM documents WHERE attachment_categories IS NOT NULL
         UNION ALL
         SELECT attachment_categories AS categories FROM folder WHERE attachment_categories IS NOT NULL`
    );
    const categories = [...new Set(rows.flatMap((row) => {
        try {
            const parsed = JSON.parse(row.categories);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }).map((category) => String(category).trim()).filter(Boolean))];
    await saveGlobalAttachmentCategories(categories);
    return categories;
}

async function saveGlobalAttachmentCategories(categories) {
    await db.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ('attachment_categories', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [JSON.stringify(categories)]
    );
}

exports.getGlobalAttachmentCategories = async (req, res) => {
    try {
        res.json({ categories: await loadGlobalAttachmentCategories() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 설정 조회 실패" });
    }
};

exports.updateGlobalAttachmentCategories = async (req, res) => {
    const categories = [...new Set((Array.isArray(req.body?.categories) ? req.body.categories : [])
        .map((category) => String(category).trim()).filter(Boolean))];
    try {
        await saveGlobalAttachmentCategories(categories);
        res.json({ success: true, categories });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 설정 저장 실패" });
    }
};

exports.getDocuments = async (req, res) => {
    try {
        const mineOnly = req.query.scope === "mine" || Number(req.query.requesterUserId) === Number(req.user.id);
        const conditions = [];
        const params = [];
        if (mineOnly) { conditions.push("requester_user_id = ?"); params.push(req.user.id); }
        if (req.query.search) { conditions.push("(title LIKE ? OR author LIKE ? OR draft_number LIKE ?)"); const keyword = `%${String(req.query.search).trim()}%`; params.push(keyword, keyword, keyword); }
        if (req.query.folderId === "none") conditions.push("folder_id IS NULL");
        else if (Number(req.query.folderId) > 0) { conditions.push("folder_id = ?"); params.push(Number(req.query.folderId)); }
        if (req.query.startDate) { conditions.push("created_at >= ?"); params.push(`${req.query.startDate} 00:00:00`); }
        if (req.query.endDate) { conditions.push("created_at <= ?"); params.push(`${req.query.endDate} 23:59:59`); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const page = Math.max(1, Number(req.query.page) || 0);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const paginated = Boolean(req.query.page);
        const sortColumns = { newest: "created_at DESC, id DESC", oldest: "created_at ASC, id ASC", title: "title ASC, id DESC" };
        const orderBy = sortColumns[req.query.sort] || sortColumns.newest;
        const [rows] = await db.query(`
            SELECT id, title, content, author,
                   requester_user_id AS requesterUserId,
                   requester_position AS requesterPosition,
                   document_type AS type, draft_number AS draftNumber, amount,
                   payment_status AS paymentStatus,
                   source_mail_uid AS sourceMailUid,
                   attachments, approval_steps AS approvalSteps,
                   status, created_at AS createdAt
            FROM documents
            ${where}
            ORDER BY ${orderBy}
            ${paginated ? "LIMIT ? OFFSET ?" : ""}
        `, paginated ? [...params, limit, (page - 1) * limit] : params);

        const items = rows.map((document) => ({
            ...document,
            draftNumber: documentDraftNumber(document),
            attachments: document.attachments
                ? JSON.parse(document.attachments)
                : [],
            approvalSteps: parseApprovalSteps(
                document.approvalSteps,
                document.requesterPosition
            )
        }));
        if (!paginated) return res.json(items);
        const [counts] = await db.query(`SELECT COUNT(*) AS total FROM documents ${where}`, params);
        res.json({ items, total: Number(counts[0].total), page, limit, totalPages: Math.ceil(Number(counts[0].total) / limit) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "문서 조회 실패" });
    }
};

exports.createDocument = async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const content = String(req.body?.content || "").trim();
    let connection;

    if (!title || !content) {
        return res.status(400).json({ message: "제목과 내용을 입력해 주세요." });
    }

    try {
        const attachments = Array.isArray(req.body.attachments)
            ? req.body.attachments
            : [];
        const attachmentCategories = [...new Set((Array.isArray(req.body.attachmentCategories) ? req.body.attachmentCategories : [])
            .map((category) => String(category).trim()).filter(Boolean))];
        const requesterPosition = String(req.user.position || "").trim();
        const requesterUserId = Number(req.user.id);
        const folderId = Number(req.body.folderId) || null;
        const approvalWorkflow = await loadApprovalWorkflow();
        const approvalSteps = buildApprovalSteps(requesterPosition, approvalWorkflow);
        const initialStatus = approvalSteps.length ? "결재 대기" : "승인";
        const documentType = String(req.body.type || "일반 문서");
        const sourceMailboxKey = String(req.body.sourceMailboxKey || "primary");
        const sharedMailboxMatch = /^shared-(\d+)$/.exec(sourceMailboxKey);
        const sourceMailOwnerId = req.body.sourceMailUid
            ? (sourceMailboxKey === "primary" ? null : sharedMailboxMatch ? -Number(sharedMailboxMatch[1]) : req.user.id)
            : null;

        if (folderId) {
            const [folders] = await db.query("SELECT id FROM folder WHERE id = ?", [folderId]);
            if (!folders.length) {
                return res.status(404).json({ message: "문서를 저장할 분류 폴더를 찾을 수 없습니다." });
            }
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO documents
             (title, content, author, requester_user_id, requester_position, document_type, amount,
              source_mail_uid, source_mail_owner_user_id, folder_id, attachments, attachment_categories, approval_steps, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                title,
                content,
                String(req.user.name || ""),
                requesterUserId,
                requesterPosition,
                documentType,
                req.body.amount ?? null,
                req.body.sourceMailUid || null,
                sourceMailOwnerId,
                folderId,
                JSON.stringify(attachments),
                JSON.stringify(attachmentCategories),
                JSON.stringify(approvalSteps),
                initialStatus
            ]
        );

        let draftNumber = null;
        if (documentType === "지출 문서") {
            await connection.query(
                `INSERT INTO document_number_counters (number_date, last_sequence)
                 VALUES (CURRENT_DATE, LAST_INSERT_ID(1))
                 ON DUPLICATE KEY UPDATE last_sequence = LAST_INSERT_ID(last_sequence + 1)`
            );
            const [sequenceRows] = await connection.query("SELECT LAST_INSERT_ID() AS sequence, DATE_FORMAT(CURRENT_TIMESTAMP, '%Y%m%d') AS datePart");
            draftNumber = `EXP-${sequenceRows[0].datePart}-${String(sequenceRows[0].sequence).padStart(4, "0")}`;
            await connection.query("UPDATE documents SET draft_number = ? WHERE id = ?", [draftNumber, result.insertId]);
        }

        const uploadedAttachments = attachments.filter((attachment) => attachment.source === "upload" && attachment.storedName);
        if (uploadedAttachments.length) {
            await connection.query(
                `UPDATE attachment_uploads SET status = 'attached', document_id = ?, attached_at = CURRENT_TIMESTAMP
                 WHERE stored_name IN (?)`,
                [result.insertId, uploadedAttachments.map((attachment) => path.basename(attachment.storedName))]
            );
        }
        await addDocumentHistory(connection, {
            documentId: result.insertId,
            action: "created",
            nextStatus: initialStatus,
            processedUserId: req.user.id,
            processedBy: String(req.user.name || ""),
            processedPosition: requesterPosition,
            processedIp: req.ip
        });

        if (folderId && !req.body.sourceMailUid) {
            await connection.query(
                `INSERT INTO mail
                 (owner_user_id, gmail_uid, subject, sender, mail_date, body, folder_id, is_draft, processing_status)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, TRUE, ?)`,
                [req.user.id, -result.insertId, title, String(req.user.name || ""), content, folderId, initialStatus]
            );
        }

        await connection.commit();

        const document = {
            id: result.insertId,
            title,
            content,
            author: String(req.user.name || ""),
            requesterUserId,
            requesterPosition,
            type: documentType,
            draftNumber,
            amount: req.body.amount ?? null,
            sourceMailUid: req.body.sourceMailUid || null,
            folderId,
            attachments,
            attachmentCategories,
            approvalSteps,
            status: initialStatus,
            createdAt: new Date()
        };

        res.status(201).json({ success: true, document });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "결재 요청 저장 실패" });
    } finally {
        if (connection) connection.release();
    }
};

exports.getDocument = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, title, content, author,
                    requester_user_id AS requesterUserId,
                    requester_position AS requesterPosition,
                    document_type AS type, draft_number AS draftNumber, amount,
                    source_mail_uid AS sourceMailUid, source_mail_owner_user_id AS sourceMailOwnerUserId, folder_id AS folderId,
                    attachments, attachment_categories AS attachmentCategories,
                    (SELECT f.attachment_categories
                     FROM mail linked_mail
                     JOIN folder f ON f.id = linked_mail.folder_id
                     WHERE f.id = documents.folder_id
                        OR linked_mail.gmail_uid IN (documents.source_mail_uid, -documents.id)
                     LIMIT 1) AS folderAttachmentCategories,
                    approval_steps AS approvalSteps,
                    status, created_at AS createdAt
             FROM documents WHERE id = ?`,
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
        }

        const document = rows[0];
        const documentApprovalSteps = parseApprovalSteps(document.approvalSteps, document.requesterPosition);
        const globalAttachmentCategories = await loadGlobalAttachmentCategories();
        const [history] = await db.query(
            `SELECT action, previous_status AS previousStatus, next_status AS nextStatus,
                    processed_user_id AS processedUserId, processed_by AS processedBy, processed_position AS processedPosition,
                    processed_ip AS processedIp,
                    comment, processed_at AS processedAt
             FROM document_history WHERE document_id = ? ORDER BY processed_at, id`,
            [req.params.id]
        );
        res.json({
            ...document,
            draftNumber: documentDraftNumber(document),
            attachments: document.attachments ? JSON.parse(document.attachments) : [],
            attachmentCategories: globalAttachmentCategories,
            history,
            approvalSteps: documentApprovalSteps
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "문서 조회 실패" });
    }
};

exports.getPendingApprovals = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, title, content, author,
                   requester_user_id AS requesterUserId,
                   requester_position AS requesterPosition,
                   document_type AS type, draft_number AS draftNumber, amount,
                   source_mail_uid AS sourceMailUid,
                   attachments, approval_steps AS approvalSteps,
                   status, created_at AS createdAt
            FROM documents
            WHERE status = '결재 대기'
            ORDER BY created_at ASC, id ASC
        `);

        const normalized = rows.map(normalizeDocument);
        if (["admin", "finance"].includes(req.user.role)) return res.json(normalized);
        res.json(normalized.filter((document) => {
            const currentStep = document.approvalSteps.find((step) => step.status === "결재 대기");
            return currentStep && roleMatches(currentStep.approver, req.user.position);
        }));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "결재 대기 문서 조회 실패" });
    }
};

exports.uploadDocumentAttachment = async (req, res) => {
    const originalName = decodeURIComponent(String(req.headers["x-file-name"] || "attachment"));
    let uploadedFilePath;
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: "첨부할 파일을 선택해 주세요." });
    }
    const blockedExtensions = new Set([".exe", ".com", ".bat", ".cmd", ".ps1", ".msi", ".dll", ".scr", ".js", ".vbs", ".jar"]);
    const extension = path.extname(originalName).toLowerCase().slice(0, 20);
    const contentType = String(req.headers["x-file-content-type"] || "application/octet-stream").toLowerCase();
    if (blockedExtensions.has(extension) || ["application/x-msdownload", "application/x-msdos-program", "text/javascript", "application/javascript"].includes(contentType)) return res.status(400).json({ message: "보안을 위해 실행 가능한 파일은 첨부할 수 없습니다." });
    const sha256 = crypto.createHash("sha256").update(req.body).digest("hex");

    try {
        await fs.mkdir(uploadDirectory, { recursive: true });
        const [duplicates] = await db.query(
            "SELECT stored_name AS storedName FROM attachment_uploads WHERE sha256 = ? AND status = 'temporary' ORDER BY created_at DESC LIMIT 1",
            [sha256]
        );
        const duplicateOf = duplicates[0]?.storedName || null;
        const uploadId = crypto.randomUUID();
        const storedName = `${uploadId}${extension}`;
        uploadedFilePath = path.join(uploadDirectory, storedName);
        await fs.writeFile(uploadedFilePath, req.body, { flag: "wx" });
        await db.query(
            `INSERT INTO attachment_uploads
             (id, stored_name, original_name, content_type, size, sha256)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                uploadId,
                storedName,
                path.basename(originalName),
                String(req.headers["x-file-content-type"] || "application/octet-stream"),
                req.body.length,
                sha256
            ]
        );
        res.status(201).json({
            source: "upload",
            originalName: path.basename(originalName),
            fileName: path.basename(originalName),
            storedName,
            contentType: String(req.headers["x-file-content-type"] || "application/octet-stream"),
            size: req.body.length,
            sha256,
            duplicateOf
        });
    } catch (error) {
        if (uploadedFilePath) await fs.unlink(uploadedFilePath).catch(() => {});
        console.error(error);
        res.status(500).json({ message: "첨부파일 업로드에 실패했습니다." });
    }
};

exports.openDocumentAttachment = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT attachments, source_mail_uid AS sourceMailUid,
                    source_mail_owner_user_id AS sourceMailOwnerUserId,
                    requester_user_id AS requesterUserId,
                    requester_position AS requesterPosition, approval_steps AS approvalSteps
             FROM documents WHERE id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
        const attachments = rows[0].attachments ? JSON.parse(rows[0].attachments) : [];
        const attachment = attachments[Number(req.params.index)];
        if (!attachment) {
            return res.status(404).json({ message: "첨부파일을 찾을 수 없습니다." });
        }

        let content;
        if (attachment.source === "upload" && attachment.storedName) {
            const safeStoredName = path.basename(attachment.storedName);
            content = await fs.readFile(path.join(uploadDirectory, safeStoredName));
        } else {
            const sourceIndex = Number(attachment.sourceIndex);
            if (!rows[0].sourceMailUid || !Number.isInteger(sourceIndex) || sourceIndex < 0) {
                return res.status(404).json({ message: "원본 메일 첨부파일을 찾을 수 없습니다." });
            }

            const ownerId = rows[0].sourceMailOwnerUserId;
            const client = ownerId == null
                ? await createSharedMailClient("primary")
                : Number(ownerId) < 0
                    ? await createSharedMailClient(`shared-${-Number(ownerId)}`)
                    : await createUserMailClient(Number(ownerId));
            try {
                await client.connect();
                await client.mailboxOpen("INBOX");
                const message = await client.fetchOne(rows[0].sourceMailUid, { uid: true, source: true }, { uid: true });
                if (!message) return res.status(404).json({ message: "원본 메일을 찾을 수 없습니다." });
                const parsed = await simpleParser(message.source);
                const mailAttachment = parsed.attachments[sourceIndex];
                if (!mailAttachment) return res.status(404).json({ message: "원본 메일 첨부파일을 찾을 수 없습니다." });
                content = mailAttachment.content;
            } finally {
                try { await client.logout(); } catch { }
            }
        }

        res.setHeader("Content-Type", attachment.contentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName || attachment.originalName)}`);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(content);
    } catch (error) {
        if (error.code === "ENOENT") return res.status(404).json({ message: "첨부파일을 찾을 수 없습니다." });
        console.error(error);
        res.status(500).json({ message: "첨부파일 조회에 실패했습니다." });
    }
};

exports.updateDocumentAttachmentCategory = async (req, res) => {
    const attachmentIndex = Number(req.params.index);
    const category = String(req.body?.category || "").trim();
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
        return res.status(400).json({ message: "올바르지 않은 첨부파일 번호입니다." });
    }
    try {
        const [rows] = await db.query("SELECT attachments FROM documents WHERE id = ?", [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
        const attachments = rows[0].attachments ? JSON.parse(rows[0].attachments) : [];
        if (!attachments[attachmentIndex]) return res.status(404).json({ message: "첨부파일을 찾을 수 없습니다." });
        attachments[attachmentIndex].category = category;
        await db.query("UPDATE documents SET attachments = ? WHERE id = ?", [JSON.stringify(attachments), req.params.id]);
        res.json({ success: true, category });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 저장 실패" });
    }
};

exports.updateDocumentAttachmentCategories = async (req, res) => {
    const categories = [...new Set((Array.isArray(req.body?.categories) ? req.body.categories : [])
        .map((category) => String(category).trim()).filter(Boolean))];
    try {
        const serializedCategories = JSON.stringify(categories);
        await saveGlobalAttachmentCategories(categories);
        const [result] = await db.query("UPDATE documents SET attachment_categories = ? WHERE id = ?", [serializedCategories, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ message: "문서를 찾을 수 없습니다." });

        await db.query(
            `UPDATE folder f
             JOIN documents d ON d.id = ?
             SET f.attachment_categories = ?
             WHERE f.id = d.folder_id`,
            [req.params.id, serializedCategories]
        );
        res.json({ success: true, categories });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 설정 저장 실패" });
    }
};

exports.getPayments = async (req, res) => {
    try {
        const conditions = ["status = '승인'", "amount IS NOT NULL", "amount > 0"];
        const params = [];
        if (["지급 대기", "지급 완료"].includes(req.query.paymentStatus)) { conditions.push("payment_status = ?"); params.push(req.query.paymentStatus); }
        if (req.query.search) { conditions.push("(title LIKE ? OR author LIKE ? OR draft_number LIKE ?)"); const keyword = `%${String(req.query.search).trim()}%`; params.push(keyword, keyword, keyword); }
        if (req.query.folderId === "none") conditions.push("folder_id IS NULL");
        else if (Number(req.query.folderId) > 0) { conditions.push("folder_id = ?"); params.push(Number(req.query.folderId)); }
        if (req.query.startDate) { conditions.push("COALESCE(paid_at, created_at) >= ?"); params.push(`${req.query.startDate} 00:00:00`); }
        if (req.query.endDate) { conditions.push("COALESCE(paid_at, created_at) <= ?"); params.push(`${req.query.endDate} 23:59:59`); }
        const paginated = Boolean(req.query.page);
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const sorts = { newest: "COALESCE(paid_at, created_at) DESC", oldest: "COALESCE(paid_at, created_at) ASC", amountHigh: "amount DESC", amountLow: "amount ASC" };
        const [rows] = await db.query(`
            SELECT id, title, author, requester_position AS requesterPosition,
                   document_type AS type, draft_number AS draftNumber, amount, payment_status AS paymentStatus,
                   paid_at AS paidAt, created_at AS createdAt,
                   COALESCE(
                       documents.folder_id,
                       (SELECT linked_mail.folder_id
                        FROM mail linked_mail
                        WHERE linked_mail.gmail_uid IN (documents.source_mail_uid, -documents.id)
                        LIMIT 1),
                       NULL
                   ) AS folderId,
                   COALESCE(
                       (SELECT direct_folder.name FROM folder direct_folder WHERE direct_folder.id = documents.folder_id),
                       (SELECT f.name
                        FROM mail linked_mail
                        JOIN folder f ON f.id = linked_mail.folder_id
                        WHERE linked_mail.gmail_uid IN (documents.source_mail_uid, -documents.id)
                        LIMIT 1),
                       '미분류'
                   ) AS folderName
            FROM documents
            WHERE ${conditions.join(" AND ")}
            ORDER BY ${sorts[req.query.sort] || "payment_status = '지급 완료', created_at ASC, id ASC"}
            ${paginated ? "LIMIT ? OFFSET ?" : ""}
        `, paginated ? [...params, limit, (page - 1) * limit] : params);
        const items = rows.map((document) => ({ ...document, draftNumber: documentDraftNumber(document) }));
        if (!paginated) return res.json(items);
        const [counts] = await db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS totalAmount FROM documents WHERE ${conditions.join(" AND ")}`, params);
        res.json({ items, total: Number(counts[0].total), totalAmount: Number(counts[0].totalAmount), page, limit, totalPages: Math.ceil(Number(counts[0].total) / limit) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "지출 문서 조회에 실패했습니다." });
    }
};

function paymentCsvValue(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

async function writeUniqueCsv(directory, baseName, content) {
    for (let suffix = 0; suffix < 1000; suffix += 1) {
        const fileName = suffix ? `${baseName} (${suffix + 1}).csv` : `${baseName}.csv`;
        try {
            await fs.writeFile(path.join(directory, fileName), content, { encoding: "utf8", flag: "wx" });
            return fileName;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
    }
    throw new Error("같은 이름의 지급 내역 파일이 너무 많습니다.");
}

function safeExportFileName(value, fallback = "attachment") {
    const name = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim();
    return (name || fallback).slice(0, 200);
}

function paymentAttachmentFileName(prefix, attachment, fallback) {
    const category = String(attachment.category || "")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim();
    const originalName = safeExportFileName(attachment.fileName || attachment.originalName || fallback);
    return [prefix, category, originalName].filter(Boolean).join("_");
}

async function writeUniqueExportFile(directory, fileName, content) {
    const safeName = safeExportFileName(fileName);
    const extension = path.extname(safeName);
    const baseName = path.basename(safeName, extension);
    for (let suffix = 0; suffix < 1000; suffix += 1) {
        const candidate = suffix ? `${baseName} (${suffix + 1})${extension}` : safeName;
        try {
            await fs.writeFile(path.join(directory, candidate), content, { flag: "wx" });
            return candidate;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
    }
    throw new Error("같은 이름의 첨부파일이 너무 많습니다.");
}

exports.savePaymentHistoryCsv = async (req, res) => {
    const documentIds = [...new Set((Array.isArray(req.body?.documentIds) ? req.body.documentIds : [])
        .map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const basePath = path.resolve(String(req.body?.basePath || ""));
    if (!documentIds.length) return res.status(400).json({ message: "저장할 지급 내역이 없습니다." });
    if (!req.body?.basePath || !path.isAbsolute(String(req.body.basePath)) || path.parse(basePath).root === basePath) {
        return res.status(400).json({ message: "지급 자료를 저장할 폴더를 선택하세요." });
    }
    try {
        const [rows] = await db.query(
            `SELECT d.id, d.title, d.author, d.document_type AS type, d.draft_number AS draftNumber, d.amount,
                    d.payment_status AS paymentStatus, d.paid_at AS paidAt, d.created_at AS createdAt,
                    d.source_mail_uid AS sourceMailUid,
                    d.source_mail_owner_user_id AS sourceMailOwnerUserId,
                    d.attachments
             FROM documents d
             WHERE d.id IN (?) AND d.status = '승인' AND d.payment_status = '지급 완료'
             ORDER BY d.paid_at, d.id`,
            [documentIds]
        );
        const startDate = String(req.body?.startDate || "전체").replace(/[^0-9-]/g, "") || "전체";
        const endDate = String(req.body?.endDate || "전체").replace(/[^0-9-]/g, "") || "전체";
        const isSingleDate = startDate !== "전체" && startDate === endDate;
        const singleDateLabel = startDate.replaceAll("-", ".");
        const exportBaseName = isSingleDate ? `지급내역_${singleDateLabel}` : null;
        const targetPath = path.join(basePath, safeExportFileName(exportBaseName || `${startDate}~${endDate}`, "지급내역"));
        await fs.mkdir(targetPath, { recursive: true });
        const csvRows = [
            ["기안번호", "문서명", "작성자", "문서 종류", "지급 금액", "지급일", "상태"],
            ...rows.map((document) => [
                documentDraftNumber(document) || "", document.title, document.author || "", document.type || "",
                Number(document.amount), document.paidAt ? new Date(document.paidAt).toLocaleString("ko-KR") : "", document.paymentStatus
            ])
        ];
        const csv = `\uFEFF${csvRows.map((row) => row.map(paymentCsvValue).join(",")).join("\r\n")}`;
        const csvFileName = await writeUniqueCsv(targetPath, exportBaseName || `지급내역_${startDate}_${endDate}`, csv);

        let attachmentCount = 0;
        for (const document of rows) {
            let attachments = [];
            try { attachments = JSON.parse(document.attachments || "[]"); } catch { }
            const prefix = documentDraftNumber(document) || `DOC-${String(document.id).padStart(6, "0")}`;
            for (const attachment of attachments.filter((item) => item.source === "upload" && item.storedName)) {
                const content = await fs.readFile(path.join(uploadDirectory, path.basename(attachment.storedName))).catch((error) => {
                    if (error.code === "ENOENT") return null;
                    throw error;
                });
                if (!content) continue;
                await writeUniqueExportFile(
                    targetPath,
                    paymentAttachmentFileName(prefix, attachment, attachment.storedName),
                    content
                );
                attachmentCount += 1;
            }

            const mailAttachments = attachments.filter((item) => item.source !== "upload");
            if (!mailAttachments.length || !document.sourceMailUid) continue;
            const mailboxKey = document.sourceMailOwnerUserId == null ? "primary" : `shared-${-Number(document.sourceMailOwnerUserId)}`;
            const client = await createSharedMailClient(mailboxKey);
            try {
                await client.connect();
                await client.mailboxOpen("INBOX");
                const message = await client.fetchOne(document.sourceMailUid, { uid: true, source: true }, { uid: true });
                if (!message) continue;
                const parsed = await simpleParser(message.source);
                for (const metadata of mailAttachments) {
                    const index = Number(metadata.sourceIndex);
                    const attachment = parsed.attachments[Number.isInteger(index) ? index : -1];
                    if (!attachment) continue;
                    await writeUniqueExportFile(
                        targetPath,
                        paymentAttachmentFileName(prefix, metadata, attachment.filename || `attachment-${index + 1}`),
                        attachment.content
                    );
                    attachmentCount += 1;
                }
            } finally {
                try { await client.logout(); } catch { }
            }
        }
        res.json({ success: true, targetPath, csvFileName, documentCount: rows.length, attachmentCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "지급 내역 CSV를 폴더에 저장하지 못했습니다." });
    }
};

exports.completePayment = async (req, res) => {
    try {
        const [result] = await db.query(`
            UPDATE documents
            SET payment_status = '지급 완료', paid_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = '승인'
              AND amount IS NOT NULL AND amount > 0
              AND payment_status = '지급 대기'
        `, [req.params.id]);

        if (!result.affectedRows) {
            return res.status(409).json({ message: "지급할 수 없거나 이미 지급 완료된 문서입니다." });
        }
        await addDocumentHistory(db, {
            documentId: Number(req.params.id),
            action: "payment_completed",
            previousStatus: "지급 대기",
            nextStatus: "지급 완료",
            processedUserId: req.user.id,
            processedBy: req.user.name,
            processedPosition: req.user.position,
            processedIp: req.ip
        });
        res.json({ success: true, paymentStatus: "지급 완료" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "지급 완료 처리에 실패했습니다." });
    }
};

exports.decideDocument = async (req, res) => {
    const approverPosition = String(req.user.position || "").trim();
    const approverName = String(req.user.name || "").trim();
    const decision = String(req.body?.decision || "").trim();
    const decisionComment = String(req.body?.comment || "").trim();

    if (!approverPosition || !["approve", "reject"].includes(decision)) {
        return res.status(400).json({ message: "올바른 결재 정보가 필요합니다." });
    }
    if (decision === "reject" && !decisionComment) return res.status(400).json({ message: "반려 사유를 입력하세요." });

    try {
        const [rows] = await db.query(
            "SELECT approval_steps AS approvalSteps, requester_user_id AS requesterUserId, requester_position AS requesterPosition, status FROM documents WHERE id = ?",
            [req.params.id]
        );
        if (!rows.length) {
            return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
        }
        if (rows[0].status !== "결재 대기") {
            return res.status(409).json({ message: "이미 처리가 완료된 문서입니다." });
        }
        const approvalSteps = parseApprovalSteps(rows[0].approvalSteps, rows[0].requesterPosition);
        const currentIndex = approvalSteps.findIndex((step) => step.status === "결재 대기");
        const currentStep = approvalSteps[currentIndex];

        if (!currentStep || !roleMatches(currentStep.approver, approverPosition)) {
            return res.status(403).json({ message: "현재 결재 순서에 해당하지 않습니다." });
        }

        let status;
        currentStep.processedAt = new Date().toISOString();
        if (decision === "reject") {
            currentStep.status = "반려";
            status = "반려";
        } else {
            currentStep.status = "승인";
            if (approvalSteps[currentIndex + 1]) {
                approvalSteps[currentIndex + 1].status = "결재 대기";
                status = "결재 대기";
            } else {
                status = "승인";
            }
        }

        await db.query(
            "UPDATE documents SET approval_steps = ?, status = ? WHERE id = ?",
            [JSON.stringify(approvalSteps), status, req.params.id]
        );
        await addDocumentHistory(db, {
            documentId: Number(req.params.id),
            action: decision === "reject" ? "rejected" : "approved",
            previousStatus: rows[0].status,
            nextStatus: status,
            processedUserId: req.user.id,
            processedBy: approverName,
            processedPosition: approverPosition,
            processedIp: req.ip,
            comment: decisionComment
        });

        res.json({ success: true, status, approvalSteps });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "결재 처리 실패" });
    }
};

exports.recallDocument = async (req, res) => {
    const requesterUserId = Number(req.user.id);
    let connection;
    if (!Number.isInteger(requesterUserId) || requesterUserId <= 0) {
        return res.status(400).json({ message: "작성자 정보가 필요합니다." });
    }

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query(
            `SELECT title, content, author, requester_user_id AS requesterUserId,
                    requester_position AS requesterPosition, document_type AS type, draft_number AS draftNumber, amount,
                    source_mail_uid AS sourceMailUid, source_mail_owner_user_id AS sourceMailOwnerUserId, attachments,
                    COALESCE(
                        (SELECT folder_id FROM mail WHERE gmail_uid = -documents.id LIMIT 1),
                        (SELECT folder_id FROM mail
                         WHERE gmail_uid = documents.source_mail_uid
                           AND owner_user_id <=> documents.source_mail_owner_user_id
                         LIMIT 1)
                    ) AS folderId,
                    approval_steps AS approvalSteps, status
             FROM documents WHERE id = ? FOR UPDATE`,
            [req.params.id]
        );
        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ message: "문서를 찾을 수 없습니다." });
        }

        const document = rows[0];
        if (Number(document.requesterUserId) !== requesterUserId) {
            await connection.rollback();
            return res.status(403).json({ message: "본인이 작성한 문서만 회수할 수 있습니다." });
        }

        const approvalSteps = parseApprovalSteps(document.approvalSteps, "");
        const firstStep = approvalSteps[0];
        if (document.status !== "결재 대기" || !firstStep || firstStep.status !== "결재 대기") {
            await connection.rollback();
            return res.status(409).json({ message: "1차 승인이 시작된 문서는 회수할 수 없습니다." });
        }

        await connection.query("DELETE FROM mail WHERE is_draft = TRUE AND gmail_uid = ?", [-Number(req.params.id)]);
        if (document.sourceMailUid) {
            await connection.query(
                "UPDATE mail SET processing_status = '검토 중' WHERE gmail_uid = ? AND owner_user_id <=> ?",
                [document.sourceMailUid, document.sourceMailOwnerUserId]
            );
        }
        await addDocumentHistory(connection, {
            documentId: Number(req.params.id),
            action: "recalled",
            previousStatus: document.status,
            nextStatus: "작성 전",
            processedUserId: req.user.id,
            processedBy: document.author,
            processedPosition: document.requesterPosition,
            processedIp: req.ip
        });
        const recalledAttachments = document.attachments ? JSON.parse(document.attachments) : [];
        const recalledStoredNames = recalledAttachments.filter((attachment) => attachment.source === "upload" && attachment.storedName).map((attachment) => path.basename(attachment.storedName));
        if (recalledStoredNames.length) {
            await connection.query(
                `UPDATE attachment_uploads SET status = 'temporary', document_id = NULL, attached_at = NULL, created_at = CURRENT_TIMESTAMP
                 WHERE stored_name IN (?)`,
                [recalledStoredNames]
            );
        }
        await connection.query("DELETE FROM documents WHERE id = ?", [req.params.id]);
        await connection.commit();

        res.json({
            success: true,
            document: {
                title: document.title,
                content: document.content,
                author: document.author,
                type: document.type,
                amount: document.amount,
                folderId: document.folderId,
                sourceMailUid: document.sourceMailUid,
                sourceMailboxKey: document.sourceMailOwnerUserId == null ? "primary" : `shared-${-Number(document.sourceMailOwnerUserId)}`,
                attachments: document.attachments ? JSON.parse(document.attachments) : []
            }
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "문서 회수에 실패했습니다." });
    } finally {
        if (connection) connection.release();
    }
};

async function loadApprovalWorkflow() {
    try {
        const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'approval_workflow'");
        if (rows.length) {
            const positions = JSON.parse(rows[0].setting_value);
            if (Array.isArray(positions) && positions.length) return positions;
        }
    } catch (error) {
        console.error("결재선 설정 조회 실패, 기본 결재선을 사용합니다.", error);
    }
    return defaultApprovalWorkflow;
}

function normalizeDocument(document) {
    return {
        ...document,
        draftNumber: documentDraftNumber(document),
        attachments: document.attachments ? JSON.parse(document.attachments) : [],
        approvalSteps: parseApprovalSteps(document.approvalSteps, document.requesterPosition)
    };
}
