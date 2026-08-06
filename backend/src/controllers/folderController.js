const db = require("../db/database");
const { simpleParser } = require("mailparser");
const fs = require("fs/promises");
const path = require("path");
const { createSharedMailClient } = require("../services/userMailService");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function formatFileDate(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function renderAttachmentFileName(template, values) {
    const originalName = path.basename(values.originalName || "attachment");
    const originalExtension = path.extname(originalName);
    const replacements = {
        "{{폴더이름}}": values.folderName || "",
        "{{메일제목}}": values.mailSubject || "",
        "{{문서제목}}": values.documentTitle || values.mailSubject || "",
        "{{기안번호}}": values.draftNumber || "",
        "{{날짜}}": formatFileDate(values.mailDate),
        "{{원본파일명}}": originalName,
        "{{순번}}": String(values.index || 1)
    };
    let rendered = String(template || "{{원본파일명}}");
    for (const [variable, replacement] of Object.entries(replacements)) rendered = rendered.split(variable).join(replacement);
    rendered = rendered.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim();
    if (!rendered) rendered = originalName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    if (originalExtension && !path.extname(rendered)) rendered += originalExtension;
    if (rendered.length > 180) {
        const extension = path.extname(rendered);
        rendered = `${path.basename(rendered, extension).slice(0, 180 - extension.length)}${extension}`;
    }
    return rendered;
}

async function writeUniqueFile(directory, fileName, content) {
    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    for (let suffix = 0; suffix < 10000; suffix += 1) {
        const candidate = suffix ? `${baseName} (${suffix + 1})${extension}` : fileName;
        try {
            await fs.writeFile(path.join(directory, candidate), content, { flag: "wx" });
            return { fileName: candidate, created: true };
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            const existing = await fs.readFile(path.join(directory, candidate));
            if (existing.equals(content)) return { fileName: candidate, created: false };
        }
    }
    throw new Error("같은 이름의 첨부파일이 너무 많습니다.");
}

exports.createFolder = async (req, res) => {
    try {
        const { name } = req.body;

        const [result] = await db.query(
            "INSERT INTO folder(name) VALUES(?)",
            [name]
        );

        res.json({
            id: result.insertId,
            name,
            count: 0
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "폴더 생성 실패"
        });
    }
};

exports.getFolders = async (req, res) => {
    try {
        const [folders] = await db.query(`
            SELECT
                f.id,
                f.name,
                COUNT(m.id) AS count
            FROM folder f
            LEFT JOIN mail m
                ON f.id = m.folder_id
               AND (
                    m.is_draft = TRUE
                    OR m.owner_user_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM shared_mail_accounts account
                        WHERE account.id = -m.owner_user_id
                    )
               )
            GROUP BY f.id
            ORDER BY f.id
        `);

        res.json(folders);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "폴더 조회 실패"
        });
    }
};

exports.getFolderMails = async (req, res) => {
    try {
        const [mails] = await db.query(
            `
            SELECT
                gmail_uid,
                m.folder_id AS folderId,
                subject,
                sender AS \`from\`,
                mail_date AS date,
                body AS text,
                body_html AS html,
                is_draft AS isDraft,
                CASE
                    WHEN m.owner_user_id IS NULL THEN 'primary'
                    WHEN m.owner_user_id < 0 THEN CONCAT('shared-', -m.owner_user_id)
                    ELSE 'primary'
                END AS mailboxKey,
                CASE WHEN m.is_draft = TRUE THEN '작성 문서' ELSE COALESCE((
                    SELECT account.label
                    FROM shared_mail_accounts account
                    WHERE (m.owner_user_id IS NULL AND account.is_primary = TRUE)
                       OR account.id = -m.owner_user_id
                    ORDER BY account.is_primary DESC, account.id
                    LIMIT 1
                ), '기본 메일') END AS mailboxLabel,
                CASE WHEN m.is_draft = TRUE THEN NULL ELSE (
                    SELECT account.username
                    FROM shared_mail_accounts account
                    WHERE (m.owner_user_id IS NULL AND account.is_primary = TRUE)
                       OR account.id = -m.owner_user_id
                    ORDER BY account.is_primary DESC, account.id
                    LIMIT 1
                ) END AS mailboxUsername,
                CASE WHEN m.is_draft = TRUE THEN NULL ELSE (
                    SELECT account.host
                    FROM shared_mail_accounts account
                    WHERE (m.owner_user_id IS NULL AND account.is_primary = TRUE)
                       OR account.id = -m.owner_user_id
                    ORDER BY account.is_primary DESC, account.id
                    LIMIT 1
                ) END AS mailboxHost,
                CASE WHEN is_draft = TRUE THEN -gmail_uid ELSE NULL END AS documentId,
                linked_document.id AS linkedDocumentId,
                CASE
                    WHEN linked_document.status = '승인'
                         AND linked_document.amount IS NOT NULL
                         AND linked_document.amount > 0
                        THEN linked_document.payment_status
                    WHEN linked_document.id IS NOT NULL THEN linked_document.status
                    WHEN m.processing_status = '기안' THEN '결재 대기'
                    ELSE m.processing_status
                END AS status
            FROM mail m
            LEFT JOIN documents linked_document
                ON linked_document.id = CASE
                    WHEN m.is_draft = TRUE THEN -m.gmail_uid
                    ELSE (
                        SELECT d.id
                        FROM documents d
                        WHERE d.source_mail_uid = m.gmail_uid
                          AND d.source_mail_owner_user_id <=> m.owner_user_id
                        ORDER BY d.created_at DESC, d.id DESC
                        LIMIT 1
                    )
                END
            WHERE m.folder_id=?
              AND (
                    m.is_draft = TRUE
                    OR m.owner_user_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM shared_mail_accounts account
                        WHERE account.id = -m.owner_user_id
                    )
              )
            ORDER BY mail_date DESC
            `,
            [req.params.id]
        );

        res.json(mails);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "폴더 메일 조회 실패"
        });
    }
};

exports.browseLocalFolder = async (req, res) => {
    if (process.platform !== "win32") {
        return res.status(501).json({ message: "폴더 찾아보기는 Windows에서만 지원합니다." });
    }

    const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = '첨부파일을 저장할 폴더를 선택하세요.'
        $dialog.ShowNewFolderButton = $true
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            [Console]::Write($dialog.SelectedPath)
        }
    `;

    try {
        const { stdout } = await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-STA", "-Command", script],
            { encoding: "utf8", windowsHide: true }
        );

        res.json({ path: stdout.trim() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "폴더 선택 창을 열지 못했습니다." });
    }
};

exports.getFolderSettings = async (req, res) => {
    try {
        const [folders] = await db.query(
            `SELECT id, name, attachment_path AS attachmentPath,
                    attachment_name_template AS attachmentNameTemplate
             FROM folder WHERE id = ?`,
            [req.params.id]
        );

        if (!folders.length) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        res.json(folders[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "폴더 설정 조회 실패" });
    }
};

exports.updateFolderSettings = async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();

        if (!name) {
            return res.status(400).json({ message: "폴더 이름을 입력해 주세요." });
        }

        const [duplicates] = await db.query(
            "SELECT id FROM folder WHERE name = ? AND id <> ? LIMIT 1",
            [name, req.params.id]
        );
        if (duplicates.length) {
            return res.status(409).json({ message: "이미 같은 이름의 폴더가 있습니다." });
        }

        const [result] = await db.query(
            "UPDATE folder SET name = ? WHERE id = ?",
            [name, req.params.id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        res.json({ success: true, name });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "폴더 설정 저장 실패" });
    }
};

exports.getAttachmentCategories = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT attachment_categories AS categories FROM folder WHERE id = ?", [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        let categories = [];
        try { categories = rows[0].categories ? JSON.parse(rows[0].categories) : []; } catch { }
        res.json({ categories: Array.isArray(categories) ? categories : [] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 설정 조회 실패" });
    }
};

exports.updateAttachmentCategories = async (req, res) => {
    const categories = [...new Set((Array.isArray(req.body?.categories) ? req.body.categories : [])
        .map((category) => String(category).trim()).filter(Boolean))];
    try {
        const [result] = await db.query("UPDATE folder SET attachment_categories = ? WHERE id = ?", [JSON.stringify(categories), req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        res.json({ success: true, categories });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 분류 설정 저장 실패" });
    }
};

exports.saveFolderAttachments = async (req, res) => {
    try {
        const [folders] = await db.query(
            `SELECT name, attachment_path AS attachmentPath,
                    attachment_name_template AS attachmentNameTemplate
             FROM folder WHERE id = ?`,
            [req.params.id]
        );

        if (!folders.length) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        const targetPath = folders[0].attachmentPath;
        if (!targetPath || !path.isAbsolute(targetPath)) {
            return res.status(400).json({ message: "먼저 올바른 첨부파일 저장 경로를 설정해 주세요." });
        }

        const [mails] = await db.query(
            `SELECT m.gmail_uid, m.subject, m.mail_date AS mailDate,
                    CASE WHEN m.owner_user_id IS NULL THEN 'primary'
                         ELSE CONCAT('shared-', -m.owner_user_id) END AS mailboxKey,
                    (SELECT d.title FROM documents d
                     WHERE d.source_mail_uid = m.gmail_uid
                       AND d.source_mail_owner_user_id <=> m.owner_user_id
                     ORDER BY d.id DESC LIMIT 1) AS documentTitle,
                    (SELECT d.draft_number
                     FROM documents d
                     WHERE d.source_mail_uid = m.gmail_uid
                       AND d.source_mail_owner_user_id <=> m.owner_user_id
                     ORDER BY d.id DESC LIMIT 1) AS draftNumber
             FROM mail m
             WHERE m.folder_id = ? AND m.is_draft = FALSE
               AND (
                    m.owner_user_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM shared_mail_accounts account
                        WHERE account.id = -m.owner_user_id
                    )
               )
             ORDER BY m.owner_user_id, m.gmail_uid`,
            [req.params.id]
        );

        await fs.mkdir(targetPath, { recursive: true });

        if (!mails.length) {
            return res.json({ success: true, savedCount: 0, mailCount: 0 });
        }

        let savedCount = 0;
        const mailsByAccount = new Map();
        for (const mail of mails) {
            if (!mailsByAccount.has(mail.mailboxKey)) mailsByAccount.set(mail.mailboxKey, []);
            mailsByAccount.get(mail.mailboxKey).push(mail);
        }
        for (const [mailboxKey, accountMails] of mailsByAccount) {
            const client = await createSharedMailClient(mailboxKey);
            try {
                await client.connect();
                await client.mailboxOpen("INBOX");
                for (let offset = 0; offset < accountMails.length; offset += 100) {
                    const uidSet = accountMails
                        .slice(offset, offset + 100)
                        .map((mail) => mail.gmail_uid)
                        .join(",");

                    for await (const message of client.fetch(uidSet, { uid: true, source: true }, { uid: true })) {
                        const parsed = await simpleParser(message.source);

                        for (let index = 0; index < parsed.attachments.length; index += 1) {
                            const attachment = parsed.attachments[index];
                            const originalName = path.basename(attachment.filename || `attachment-${index + 1}`);
                            const mail = accountMails.find((item) => Number(item.gmail_uid) === Number(message.uid));
                            const fileName = renderAttachmentFileName(folders[0].attachmentNameTemplate, {
                                folderName: folders[0].name,
                                mailSubject: mail?.subject,
                                documentTitle: mail?.documentTitle,
                                draftNumber: mail?.draftNumber,
                                mailDate: mail?.mailDate,
                                originalName,
                                index: index + 1
                            });
                            const saved = await writeUniqueFile(targetPath, fileName, attachment.content);
                            if (saved.created) savedCount += 1;
                        }
                    }
                }
            } finally {
                try { await client.logout(); } catch { }
            }
        }

        res.json({ success: true, savedCount, mailCount: mails.length, accountCount: mailsByAccount.size });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "첨부파일 저장 실패" });
    }
};
