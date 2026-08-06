const { simpleParser } = require("mailparser");
const db = require("../db/database");
const { createSharedMailClient } = require("../services/userMailService");

const mailboxOwner = (mailboxKey = "primary") => {
    if (mailboxKey === "primary") return null;
    const match = /^shared-(\d+)$/.exec(String(mailboxKey));
    if (!match) throw new Error("올바르지 않은 메일 계정입니다.");
    return -Number(match[1]);
};

const addMailboxCondition = (conditions, params, owner, alias = "m") => {
    if (owner === null) conditions.push(`${alias}.owner_user_id IS NULL`);
    else { conditions.push(`${alias}.owner_user_id = ?`); params.push(owner); }
};

const selectMails = async (options = {}) => {
    const conditions = ["m.is_draft = FALSE"];
    const params = [];
    addMailboxCondition(conditions, params, options.mailboxOwner ?? null);
    if (options.search) { conditions.push("(m.subject LIKE ? OR m.sender LIKE ?)"); const keyword = `%${options.search}%`; params.push(keyword, keyword); }
    if (options.folderId === "none") conditions.push("m.folder_id IS NULL");
    else if (Number(options.folderId) > 0) { conditions.push("m.folder_id = ?"); params.push(Number(options.folderId)); }
    if (options.startDate) { conditions.push("m.mail_date >= ?"); params.push(`${options.startDate} 00:00:00`); }
    if (options.endDate) { conditions.push("m.mail_date <= ?"); params.push(`${options.endDate} 23:59:59`); }
    const paginated = Boolean(options.page);
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
    const [mails] = await db.query(`
SELECT
    m.id,
    m.gmail_uid,
    CASE WHEN m.owner_user_id IS NULL THEN 'primary' ELSE CONCAT('shared-', -m.owner_user_id) END AS mailboxKey,
    COALESCE(mailbox_account.label, '기본 메일') AS mailboxLabel,
    mailbox_account.username AS mailboxUsername,
    mailbox_account.host AS mailboxHost,
    m.folder_id AS folderId,
    m.subject,
    m.sender AS \`from\`,
    m.mail_date AS date,
    m.body AS text,
    m.body_html AS html,
    linked_document.id AS linkedDocumentId,
    CASE
        WHEN linked_document.status = '승인'
             AND linked_document.amount IS NOT NULL
             AND linked_document.amount > 0
            THEN linked_document.payment_status
        WHEN linked_document.id IS NOT NULL THEN linked_document.status
        WHEN m.processing_status = '기안' THEN '결재 대기'
        ELSE m.processing_status
    END AS status,
    f.name AS folder
FROM mail m
LEFT JOIN shared_mail_accounts mailbox_account
ON mailbox_account.id = CASE
    WHEN m.owner_user_id IS NULL THEN (
        SELECT primary_account.id
        FROM shared_mail_accounts primary_account
        WHERE primary_account.is_primary = TRUE
        ORDER BY primary_account.id
        LIMIT 1
    )
    ELSE -m.owner_user_id
END
LEFT JOIN folder f
ON m.folder_id = f.id
LEFT JOIN documents linked_document
ON linked_document.id = (
    SELECT d.id
    FROM documents d
    WHERE d.source_mail_uid = m.gmail_uid
      AND (m.owner_user_id IS NULL OR d.source_mail_owner_user_id = m.owner_user_id)
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1
)
WHERE ${conditions.join(" AND ")}
ORDER BY m.mail_date DESC
${paginated ? "LIMIT ? OFFSET ?" : ""}
    `, paginated ? [...params, limit, (page - 1) * limit] : params);

    if (!paginated) return mails;
    const [counts] = await db.query(`SELECT COUNT(*) AS total FROM mail m WHERE ${conditions.join(" AND ")}`, params);
    return { items: mails, total: Number(counts[0].total), page, limit, totalPages: Math.ceil(Number(counts[0].total) / limit) };
};

exports.getMails = async (req, res) => {
    try {
        res.json(await selectMails({ ...req.query, mailboxOwner: mailboxOwner(req.query.mailboxKey) }));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "메일 조회 실패" });
    }
};

exports.syncMails = async (req, res) => {

    const requestedDays = Number(req.body?.days);
    const syncDays = Number.isInteger(requestedDays) && requestedDays >= 1
        ? Math.min(requestedDays, 3650)
        : 30;
    const since = new Date();
    since.setDate(since.getDate() - syncDays);

    const selectedMailboxKey = String(req.body?.mailboxKey || "primary");
    const owner = mailboxOwner(selectedMailboxKey);
    const client = await createSharedMailClient(selectedMailboxKey);

    try {

        await client.connect();


        await client.mailboxOpen("INBOX");

        const [storedRows] = await db.query(
            `SELECT gmail_uid FROM mail WHERE ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"} AND mail_date >= ?`,
            owner === null ? [since] : [owner, since]
        );
        const storedUids = new Set(storedRows.map((mail) => String(mail.gmail_uid)));

        const newUids = await client.search({
            since
        }, { uid: true }) || [];
        const missingUids = newUids.filter((uid) => !storedUids.has(String(uid)));

        for (let offset = 0; offset < missingUids.length; offset += 200) {
            const uidSet = missingUids.slice(offset, offset + 200).join(",");

            for await (const message of client.fetch(uidSet, {
                uid: true,
                envelope: true,
                source: true
            }, { uid: true })) {

                const parsed = await simpleParser(message.source);
                const html = typeof parsed.html === "string" ? parsed.html : "";

                await db.query(
                    `INSERT INTO mail
            (owner_user_id, gmail_uid, subject, sender, mail_date, body, body_html)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                subject = VALUES(subject), sender = VALUES(sender),
                mail_date = VALUES(mail_date), body = VALUES(body),
                body_html = VALUES(body_html)`,
                    [
                        owner,
                        message.uid,
                        parsed.subject || "(제목 없음)",
                        parsed.from?.text || "",
                        parsed.date || new Date(),
                        parsed.text || "",
                        html
                    ]
                );
            }
        }

        const [legacyMails] = await db.query(
            `SELECT gmail_uid
             FROM mail
             WHERE ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}
               AND body_html IS NULL
               AND (body IS NULL OR body = '')
               AND mail_date >= ?
             ORDER BY gmail_uid DESC`,
            owner === null ? [since] : [owner, since]
        );

        for (let offset = 0; offset < legacyMails.length; offset += 200) {
            const uidSet = legacyMails
                .slice(offset, offset + 200)
                .map((mail) => mail.gmail_uid)
                .join(",");

            for await (const message of client.fetch(uidSet, {
                uid: true,
                source: true
            }, { uid: true })) {
                const parsed = await simpleParser(message.source);
                const html = typeof parsed.html === "string" ? parsed.html : "";

                await db.query(
                    `UPDATE mail SET body = ?, body_html = ? WHERE ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"} AND gmail_uid = ?`,
                    owner === null ? [parsed.text || "", html, message.uid] : [parsed.text || "", html, owner, message.uid]
                );
            }
        }

        await client.logout();

        if (owner !== null) await db.query("UPDATE shared_mail_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_sync_status = 'success', last_sync_error = NULL WHERE id = ?", [-owner]);

        res.json(await selectMails({ mailboxOwner: owner }));

    } catch (error) {

        console.error(error);

        try {
            await client.logout();
        } catch { }

        if (owner !== null) await db.query("UPDATE shared_mail_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_sync_status = 'error', last_sync_error = ? WHERE id = ?", [String(error.message || error).slice(0, 1000), -owner]).catch(() => {});

        res.status(500).json({
            message: "메일 조회 실패"
        });
    }
};

exports.moveMail = async (req, res) => {

    try {

        const { indexes, folderId } = req.body;
        const owner = mailboxOwner(req.body?.mailboxKey);
        const targetFolderId = folderId === "unclassified" ? null : folderId;

        for (const id of indexes) {

            await db.query(
                `
UPDATE mail
SET folder_id=?
WHERE gmail_uid=? AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}
                `,
                owner === null ? [targetFolderId, id] : [targetFolderId, id, owner]
            );

        }

        res.json({ success: true });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: "분류 실패"
        });

    }

};

exports.movefolder = async (req, res) => {
    try {

        const { mailIds, folderId } = req.body;
        const owner = mailboxOwner(req.body?.mailboxKey);
        const targetFolderId = folderId === "unclassified" ? null : folderId;

        if (!mailIds.length) {
            return res.json({ success: true });
        }

        await db.query(
            `
            UPDATE mail
            SET folder_id = ?
            WHERE gmail_uid IN (?) AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}
            `,
            owner === null ? [targetFolderId, mailIds] : [targetFolderId, mailIds, owner]
        );

        res.json({ success: true });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: "이동 실패"
        });

    }

}

exports.updateMailStatus = async (req, res) => {
    const allowedStatuses = ["미처리", "검토 중", "승인", "완료", "반려"];
    const status = String(req.body?.status || "").trim();

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "올바르지 않은 처리 상태입니다." });
    }

    try {
        const owner = mailboxOwner(req.body?.mailboxKey);
        const [result] = await db.query(
            `UPDATE mail SET processing_status = ? WHERE gmail_uid = ? AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}`,
            owner === null ? [status, req.params.uid] : [status, req.params.uid, owner]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ message: "메일을 찾을 수 없습니다." });
        }

        res.json({ success: true, status });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "처리 상태 저장 실패" });
    }
};

exports.getMailAttachments = async (req, res) => {
    const selectedMailboxKey = String(req.query.mailboxKey || "primary");
    const owner = mailboxOwner(selectedMailboxKey);
    const client = await createSharedMailClient(selectedMailboxKey);

    try {
        const [mails] = await db.query(
            `SELECT m.gmail_uid, m.subject, m.mail_date, m.folder_id,
                    f.name AS folder_name,
                    f.attachment_name_template AS attachment_name_template,
                    f.attachment_categories AS attachment_categories,
                    m.attachment_classifications AS attachment_classifications
             FROM mail m
             LEFT JOIN folder f ON f.id = m.folder_id
             WHERE m.gmail_uid = ? AND ${owner === null ? "m.owner_user_id IS NULL" : "m.owner_user_id = ?"}`,
            owner === null ? [req.params.uid] : [req.params.uid, owner]
        );

        if (!mails.length) {
            return res.status(404).json({ message: "메일을 찾을 수 없습니다." });
        }

        await client.connect();
        await client.mailboxOpen("INBOX");
        const message = await client.fetchOne(
            req.params.uid,
            { uid: true, source: true },
            { uid: true }
        );

        if (!message) {
            await client.logout();
            return res.status(404).json({ message: "메일 원본을 찾을 수 없습니다." });
        }

        const parsed = await simpleParser(message.source);
        await client.logout();

        const mail = mails[0];
        let attachmentCategories = [];
        try { attachmentCategories = mail.attachment_categories ? JSON.parse(mail.attachment_categories) : []; } catch { }
        let attachmentClassifications = {};
        try { attachmentClassifications = mail.attachment_classifications ? JSON.parse(mail.attachment_classifications) : {}; } catch { }
        res.json({
            sourceMailUid: String(mail.gmail_uid),
            folderId: mail.folder_id,
            folderName: mail.folder_name || "",
            mailSubject: mail.subject || "",
            mailDate: mail.mail_date,
            attachmentNameTemplate: mail.attachment_name_template || "{{원본파일명}}",
            attachmentCategories,
            attachments: parsed.attachments.map((attachment, index) => ({
                index,
                originalName: attachment.filename || `attachment-${index + 1}`,
                contentType: attachment.contentType || "application/octet-stream",
                size: attachment.size || attachment.content?.length || 0,
                category: attachmentClassifications[index] || ""
            }))
        });
    } catch (error) {
        console.error(error);
        try { await client.logout(); } catch { }
        res.status(500).json({ message: "메일 첨부파일 조회 실패" });
    }
};

exports.updateAttachmentCategory = async (req, res) => {
    const attachmentIndex = Number(req.params.index);
    const category = String(req.body?.category || "").trim();
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
        return res.status(400).json({ message: "올바르지 않은 첨부파일 번호입니다." });
    }

    try {
        const owner = mailboxOwner(req.body?.mailboxKey);
        const [rows] = await db.query(`SELECT attachment_classifications FROM mail WHERE gmail_uid = ? AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}`, owner === null ? [req.params.uid] : [req.params.uid, owner]);
        if (!rows.length) return res.status(404).json({ message: "메일을 찾을 수 없습니다." });
        let classifications = {};
        try { classifications = rows[0].attachment_classifications ? JSON.parse(rows[0].attachment_classifications) : {}; } catch { }
        if (category) classifications[attachmentIndex] = category;
        else delete classifications[attachmentIndex];
        await db.query(`UPDATE mail SET attachment_classifications = ? WHERE gmail_uid = ? AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}`, owner === null ? [JSON.stringify(classifications), req.params.uid] : [JSON.stringify(classifications), req.params.uid, owner]);
        res.json({ success: true, category });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 저장 실패" });
    }
};

exports.previewMailAttachment = async (req, res) => {
    const attachmentIndex = Number(req.params.index);
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
        return res.status(400).json({ message: "올바르지 않은 첨부파일 번호입니다." });
    }

    const selectedMailboxKey = String(req.query.mailboxKey || "primary");
    const owner = mailboxOwner(selectedMailboxKey);
    const client = await createSharedMailClient(selectedMailboxKey);

    try {
        const [mails] = await db.query(
            `SELECT gmail_uid FROM mail WHERE gmail_uid = ? AND ${owner === null ? "owner_user_id IS NULL" : "owner_user_id = ?"}`,
            owner === null ? [req.params.uid] : [req.params.uid, owner]
        );
        if (!mails.length) {
            return res.status(404).json({ message: "메일을 찾을 수 없습니다." });
        }

        await client.connect();
        await client.mailboxOpen("INBOX");
        const message = await client.fetchOne(
            req.params.uid,
            { uid: true, source: true },
            { uid: true }
        );

        if (!message) {
            await client.logout();
            return res.status(404).json({ message: "메일 원본을 찾을 수 없습니다." });
        }

        const parsed = await simpleParser(message.source);
        await client.logout();
        const attachment = parsed.attachments[attachmentIndex];

        if (!attachment) {
            return res.status(404).json({ message: "첨부파일을 찾을 수 없습니다." });
        }

        const fileName = pathSafeHeaderFileName(
            attachment.filename || `attachment-${attachmentIndex + 1}`
        );
        res.setHeader("Content-Type", attachment.contentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(attachment.content);
    } catch (error) {
        console.error(error);
        try { await client.logout(); } catch { }
        res.status(500).json({ message: "첨부파일 미리보기 실패" });
    }
};

function pathSafeHeaderFileName(fileName) {
    return String(fileName).replace(/[\r\n]/g, "_");
}
