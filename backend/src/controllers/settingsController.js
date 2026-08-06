const db = require("../db/database");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { createUserMailClient } = require("../services/userMailService");

const allowedPositions = [
    "사원", "주임", "대리", "과장", "차장", "팀장", "부장",
    "부서장", "이사", "상무", "전무", "임원", "대표이사", "대표"
];
const uploadDirectory = path.resolve(__dirname, "../../uploads");
const defaultBackupDirectory = process.env.BACKUP_PATH && path.isAbsolute(process.env.BACKUP_PATH)
    ? path.resolve(process.env.BACKUP_PATH)
    : path.resolve(__dirname, "../../backups");
const backupTables = ["users", "folder", "mail", "documents", "document_history", "attachment_uploads", "user_mail_accounts", "shared_mail_accounts", "document_number_counters", "app_settings"];
const allowedBackupIntervalHours = [0, 6, 12, 24, 72, 168];

async function getBackupIntervalHours() {
    const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'backup_interval_hours'");
    const value = Number(rows[0]?.setting_value ?? 24);
    return allowedBackupIntervalHours.includes(value) ? value : 24;
}

async function getBackupDirectory() {
    const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'backup_path'");
    const configured = String(rows[0]?.setting_value || "").trim();
    return configured && path.isAbsolute(configured) ? path.resolve(configured) : defaultBackupDirectory;
}

async function validateBackupDirectory(candidate) {
    const value = String(candidate || "").trim();
    if (!value || !path.isAbsolute(value)) throw new Error("드라이브 문자를 포함한 절대 경로를 입력하세요.");
    const resolved = path.resolve(value);
    if (path.parse(resolved).root === resolved) throw new Error("드라이브 최상위 경로는 사용할 수 없습니다. 백업 폴더를 지정하세요.");
    await fs.mkdir(resolved, { recursive: true });
    const testFile = path.join(resolved, `.mailcatch-write-test-${crypto.randomUUID()}`);
    try {
        await fs.writeFile(testFile, "mailcatch", { flag: "wx" });
    } finally {
        await fs.rm(testFile, { force: true }).catch(() => {});
    }
    return resolved;
}

exports.getApprovalWorkflow = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'approval_workflow'");
        let positions = allowedPositions;
        try { positions = rows.length ? JSON.parse(rows[0].setting_value) : allowedPositions; } catch { }
        res.json({ positions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "결재선 설정 조회 실패" });
    }
};

exports.updateApprovalWorkflow = async (req, res) => {
    const requested = Array.isArray(req.body?.positions) ? req.body.positions : [];
    const positions = allowedPositions.filter((position) => requested.includes(position));
    if (!positions.length) return res.status(400).json({ message: "결재 직급을 하나 이상 선택하세요." });

    try {
        await db.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('approval_workflow', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [JSON.stringify(positions)]
        );
        res.json({ success: true, positions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "결재선 설정 저장 실패" });
    }
};

async function directorySize(directory) {
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const sizes = await Promise.all(entries.map(async (entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) return directorySize(entryPath);
            if (entry.isFile()) return (await fs.stat(entryPath)).size;
            return 0;
        }));
        return sizes.reduce((sum, size) => sum + size, 0);
    } catch (error) {
        if (error.code === "ENOENT") return 0;
        throw error;
    }
}

async function existingPath(targetPath) {
    let current = path.resolve(targetPath);
    while (true) {
        try {
            await fs.access(current);
            return current;
        } catch {
            const parent = path.dirname(current);
            if (parent === current) throw new Error(`저장 경로를 확인할 수 없습니다: ${targetPath}`);
            current = parent;
        }
    }
}

async function diskStats(targetPath) {
    const checkedPath = await existingPath(targetPath);
    // Windows에서는 MySQL 데이터 폴더 자체에 statfs 권한이 없을 수 있으므로
    // 실제 용량은 해당 드라이브 루트에서 조회한다.
    const statsPath = process.platform === "win32"
        ? path.parse(checkedPath).root
        : checkedPath;
    const stats = await fs.statfs(statsPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
        path: checkedPath,
        drive: path.parse(checkedPath).root,
        totalBytes,
        freeBytes,
        usedBytes: Math.max(0, totalBytes - freeBytes),
        usedPercent: totalBytes ? Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1)) : 0
    };
}

exports.getStorageStats = async (req, res) => {
    try {
        const [[databaseSize], [mailCount], [documentCount], [userCount], [dataDirectory], uploadBytes] = await Promise.all([
            db.query(`SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
                      FROM information_schema.TABLES WHERE table_schema = DATABASE()`),
            db.query("SELECT COUNT(*) AS count FROM mail"),
            db.query("SELECT COUNT(*) AS count FROM documents"),
            db.query("SELECT COUNT(*) AS count FROM users"),
            db.query("SELECT @@datadir AS path"),
            directorySize(uploadDirectory)
        ]);
        const databasePath = dataDirectory[0]?.path || process.cwd();
        const [databaseDisk, uploadDisk] = await Promise.all([
            diskStats(databasePath),
            diskStats(uploadDirectory)
        ]);
        let mailConnected = false;
        let mailConfigured = true;
        try {
            const mailClient = await createUserMailClient(req.user.id);
            await mailClient.connect();
            await mailClient.logout();
            mailConnected = true;
        } catch (error) {
            if (error.message.includes("설정이 필요")) mailConfigured = false;
        }
        res.json({
            databaseBytes: Number(databaseSize[0]?.bytes || 0),
            uploadBytes,
            mailCount: Number(mailCount[0]?.count || 0),
            documentCount: Number(documentCount[0]?.count || 0),
            userCount: Number(userCount[0]?.count || 0),
            databaseDisk,
            uploadDisk
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "저장 공간 정보를 불러오지 못했습니다." });
    }
};

function normalizeRetentionDays(value) {
    const days = Number(value);
    return Number.isInteger(days) && days >= 30 && days <= 3650 ? days : null;
}

function normalizeCleanupScope(value) {
    return ["unclassified", "all"].includes(value) ? value : null;
}

async function getCleanupCandidates(days, scope) {
    const folderCondition = scope === "unclassified" ? "AND m.folder_id IS NULL" : "";
    const documentCondition = scope === "unclassified" ? "AND d.id IS NULL" : "";
    const [rows] = await db.query(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(OCTET_LENGTH(COALESCE(m.subject, '')) +
                             OCTET_LENGTH(COALESCE(m.sender, '')) +
                             OCTET_LENGTH(COALESCE(m.body, '')) +
                             OCTET_LENGTH(COALESCE(m.body_html, ''))), 0) AS bytes
         FROM mail m
         LEFT JOIN documents d ON d.source_mail_uid = m.gmail_uid
         WHERE m.is_draft = FALSE
           ${documentCondition}
           ${folderCondition}
           AND m.mail_date < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
        [days]
    );
    return { count: Number(rows[0].count || 0), estimatedBytes: Number(rows[0].bytes || 0) };
}

exports.previewMailCleanup = async (req, res) => {
    const days = normalizeRetentionDays(req.query.days);
    const scope = normalizeCleanupScope(req.query.scope);
    if (!days) return res.status(400).json({ message: "보관 기간은 30~3650일 사이로 설정하세요." });
    if (!scope) return res.status(400).json({ message: "삭제 범위를 선택하세요." });
    try {
        res.json({ days, scope, ...(await getCleanupCandidates(days, scope)) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "삭제 대상 확인에 실패했습니다." });
    }
};

exports.cleanupOldMails = async (req, res) => {
    const days = normalizeRetentionDays(req.body?.days);
    const scope = normalizeCleanupScope(req.body?.scope);
    if (!days || !scope || req.body?.confirmation !== "DELETE") {
        return res.status(400).json({ message: "올바른 보관 기간과 삭제 확인이 필요합니다." });
    }
    try {
        const candidates = await getCleanupCandidates(days, scope);
        const folderCondition = scope === "unclassified" ? "AND m.folder_id IS NULL" : "";
        const documentCondition = scope === "unclassified" ? "AND d.id IS NULL" : "";
        const [result] = await db.query(
            `DELETE m FROM mail m
             LEFT JOIN documents d ON d.source_mail_uid = m.gmail_uid
             WHERE m.is_draft = FALSE
               ${documentCondition}
               ${folderCondition}
               AND m.mail_date < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)`,
            [days]
        );
        res.json({ success: true, deletedCount: result.affectedRows, estimatedBytes: candidates.estimatedBytes });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "오래된 메일 삭제에 실패했습니다." });
    }
};

async function createBackup(label = "manual") {
    const backupDirectory = await getBackupDirectory();
    await fs.mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = `${stamp}_${label.replace(/[^a-z0-9_-]/gi, "_")}`;
    const target = path.join(backupDirectory, id);
    await fs.mkdir(target, { recursive: true });

    const tables = {};
    for (const table of backupTables) {
        const [rows] = await db.query(`SELECT * FROM \`${table}\``);
        tables[table] = rows;
    }
    const encryptionKey = crypto.createHash("sha256").update(process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 2, createdAt: new Date().toISOString(), tables })), cipher.final()]);
    await fs.writeFile(path.join(target, "database.enc"), encrypted);
    await fs.writeFile(path.join(target, "encryption.json"), JSON.stringify({ algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") }));
    await fs.cp(uploadDirectory, path.join(target, "uploads"), { recursive: true, force: false }).catch((error) => {
        if (error.code !== "ENOENT") throw error;
    });
    const integrity = await backupIntegrity(target, ["integrity.json"]);
    await fs.writeFile(path.join(target, "integrity.json"), JSON.stringify({ algorithm: "sha256", files: integrity }, null, 2));
    await db.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ('last_backup_at', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [new Date().toISOString()]
    );
    return { id, createdAt: new Date().toISOString(), path: target };
}

async function backupIntegrity(root, ignored = []) {
    const result = {};
    async function walk(current) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const absolute = path.join(current, entry.name);
            const relative = path.relative(root, absolute).replaceAll("\\", "/");
            if (ignored.includes(relative)) continue;
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile()) result[relative] = crypto.createHash("sha256").update(await fs.readFile(absolute)).digest("hex");
        }
    }
    await walk(root);
    return result;
}

async function verifyBackup(source) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(source, "integrity.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const current = await backupIntegrity(source, ["integrity.json"]);
    return Object.keys(manifest.files || {}).length === Object.keys(current).length
        && Object.entries(manifest.files || {}).every(([file, hash]) => current[file] === hash);
}

async function readBackupDatabase(source) {
    try {
        const metadata = JSON.parse(await fs.readFile(path.join(source, "encryption.json"), "utf8"));
        const encryptionKey = crypto.createHash("sha256").update(process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET).digest();
        const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(metadata.iv, "base64"));
        decipher.setAuthTag(Buffer.from(metadata.tag, "base64"));
        const decrypted = Buffer.concat([decipher.update(await fs.readFile(path.join(source, "database.enc"))), decipher.final()]);
        return JSON.parse(decrypted.toString("utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return JSON.parse(await fs.readFile(path.join(source, "database.json"), "utf8"));
        throw error;
    }
}

async function loadBackupForPreview(backupId) {
    const safeId = path.basename(String(backupId || ""));
    if (!safeId || safeId !== String(backupId || "")) {
        const error = new Error("올바르지 않은 백업 번호입니다.");
        error.status = 400;
        throw error;
    }
    const backupDirectory = await getBackupDirectory();
    const source = path.resolve(backupDirectory, safeId);
    if (path.dirname(source) !== path.resolve(backupDirectory)) {
        const error = new Error("올바르지 않은 백업 경로입니다.");
        error.status = 400;
        throw error;
    }
    const verification = await verifyBackup(source);
    if (verification === false) {
        const error = new Error("백업 무결성 검사에 실패했습니다.");
        error.status = 409;
        throw error;
    }
    return { payload: await readBackupDatabase(source), verified: verification === true };
}

function previewText(value, length = 240) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length)}…` : text;
}

exports.previewBackup = async (req, res) => {
    try {
        const { payload, verified } = await loadBackupForPreview(req.params.id);
        const tables = payload.tables || {};
        const type = req.query.type === "documents" ? "documents" : "mail";
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const search = String(req.query.search || "").trim().toLocaleLowerCase("ko-KR");
        const sourceRows = Array.isArray(tables[type]) ? tables[type] : [];
        const searchableFields = type === "mail"
            ? ["subject", "sender", "body"]
            : ["title", "author", "content", "document_type", "status"];
        const filtered = search
            ? sourceRows.filter((row) => searchableFields.some((field) => String(row[field] || "").toLocaleLowerCase("ko-KR").includes(search)))
            : sourceRows;
        const sorted = [...filtered].sort((left, right) => {
            const leftDate = new Date(left.mail_date || left.created_at || 0).getTime() || 0;
            const rightDate = new Date(right.mail_date || right.created_at || 0).getTime() || 0;
            return rightDate - leftDate;
        });
        const start = (page - 1) * limit;
        const rows = sorted.slice(start, start + limit).map((row) => type === "mail" ? {
            id: row.id,
            uid: String(row.gmail_uid || ""),
            subject: row.subject || "(제목 없음)",
            sender: row.sender || "",
            mailDate: row.mail_date,
            body: row.body || "",
            bodyPreview: previewText(row.body),
            folderId: row.folder_id,
            processingStatus: row.processing_status || ""
        } : {
            id: row.id,
            draftNumber: row.document_type === "지출 문서" ? (row.draft_number || (() => { const date = new Date(row.created_at || Date.now()); return `EXP-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(row.id).padStart(4, "0")}`; })()) : null,
            title: row.title || "(제목 없음)",
            author: row.author || "",
            documentType: row.document_type || "",
            amount: row.amount,
            content: row.content || "",
            contentPreview: previewText(row.content),
            status: row.status || "",
            paymentStatus: row.payment_status || "",
            createdAt: row.created_at,
            attachments: (() => { try { return JSON.parse(row.attachments || "[]"); } catch { return []; } })()
        });
        res.json({
            backup: { id: req.params.id, createdAt: payload.createdAt || null, version: payload.version || 1, verified },
            counts: {
                mail: Array.isArray(tables.mail) ? tables.mail.length : 0,
                documents: Array.isArray(tables.documents) ? tables.documents.length : 0,
                users: Array.isArray(tables.users) ? tables.users.length : 0,
                folders: Array.isArray(tables.folder) ? tables.folder.length : 0
            },
            type, page, limit, total: filtered.length, rows
        });
    } catch (error) {
        console.error(error);
        res.status(error.status || (error.code === "ENOENT" ? 404 : 500)).json({
            message: error.code === "ENOENT" ? "백업을 찾을 수 없습니다." : (error.message || "백업 내용을 불러오지 못했습니다.")
        });
    }
};

exports.downloadBackupAttachment = async (req, res) => {
    try {
        const { payload } = await loadBackupForPreview(req.params.id);
        const storedName = path.basename(String(req.params.storedName || ""));
        if (!storedName || storedName !== String(req.params.storedName || "")) {
            return res.status(400).json({ message: "올바르지 않은 첨부파일 이름입니다." });
        }
        const uploads = Array.isArray(payload.tables?.attachment_uploads) ? payload.tables.attachment_uploads : [];
        const upload = uploads.find((item) => path.basename(String(item.stored_name || "")) === storedName);
        if (!upload) return res.status(404).json({ message: "백업에서 첨부파일 기록을 찾을 수 없습니다." });

        const backupDirectory = await getBackupDirectory();
        const filePath = path.join(backupDirectory, path.basename(req.params.id), "uploads", storedName);
        await fs.access(filePath);
        res.setHeader("Content-Type", upload.content_type || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(upload.original_name || storedName)}`);
        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(error.status || (error.code === "ENOENT" ? 404 : 500)).json({
            message: error.code === "ENOENT" ? "백업 첨부파일을 찾을 수 없습니다." : (error.message || "백업 첨부파일을 열지 못했습니다.")
        });
    }
};

async function pruneBackups(keep = 10) {
    const backupDirectory = await getBackupDirectory();
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
    for (const name of directories.slice(keep)) {
        const target = path.resolve(backupDirectory, name);
        if (path.dirname(target) !== backupDirectory) continue;
        await fs.rm(target, { recursive: true, force: true });
    }
}

exports.runScheduledBackup = async () => {
    try {
        const intervalHours = await getBackupIntervalHours();
        if (intervalHours === 0) return;
        const [settings] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'last_backup_at'");
        const lastBackup = settings.length ? new Date(settings[0].setting_value) : null;
        if (lastBackup && Date.now() - lastBackup.getTime() < intervalHours * 60 * 60 * 1000) return;
        await createBackup("automatic");
        await pruneBackups(10);
    } catch (error) {
        console.error("자동 백업 실패:", error);
    }
};

exports.getHealth = async (req, res) => {
    const startedAt = Date.now();
    try {
        await db.query("SELECT 1");
        const [migrations] = await db.query("SELECT MAX(version) AS version FROM schema_migrations");
        const backupDirectory = await getBackupDirectory();
        const backupIntervalHours = await getBackupIntervalHours();
        res.json({
            server: "connected",
            database: "connected",
            mailConfigured,
            mailConnected,
            migrationVersion: Number(migrations[0]?.version || 0),
            responseMs: Date.now() - startedAt,
            serverTime: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            backupPath: backupDirectory,
            backupIntervalHours
        });
    } catch (error) {
        res.status(503).json({ server: "connected", database: "disconnected", message: error.message });
    }
};

exports.updateBackupSchedule = async (req, res) => {
    const backupIntervalHours = Number(req.body?.intervalHours);
    if (!allowedBackupIntervalHours.includes(backupIntervalHours)) {
        return res.status(400).json({ message: "지원하지 않는 백업 주기입니다." });
    }
    try {
        await db.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('backup_interval_hours', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [String(backupIntervalHours)]
        );
        res.json({ success: true, backupIntervalHours });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "백업 주기를 저장할 수 없습니다." });
    }
};

exports.listBackups = async (req, res) => {
    try {
        const backupDirectory = await getBackupDirectory();
        await fs.mkdir(backupDirectory, { recursive: true });
        const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
        const backups = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
            const backupPath = path.join(backupDirectory, entry.name);
            const databaseFile = await fs.stat(path.join(backupPath, "database.enc")).catch(() => fs.stat(path.join(backupPath, "database.json")));
            const verification = await verifyBackup(backupPath).catch(() => false);
            return { id: entry.name, createdAt: databaseFile.mtime.toISOString(), verified: verification === true, legacy: verification === null };
        }));
        res.json({ backups: backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "백업 목록을 불러오지 못했습니다." });
    }
};

exports.testBackupPath = async (req, res) => {
    try {
        const backupPath = await validateBackupDirectory(req.body?.path);
        res.json({ success: true, backupPath, message: "백업 폴더에 파일을 저장할 수 있습니다." });
    } catch (error) {
        res.status(400).json({ message: error.message || "백업 경로를 사용할 수 없습니다." });
    }
};

exports.updateBackupPath = async (req, res) => {
    try {
        const backupPath = await validateBackupDirectory(req.body?.path);
        await db.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('backup_path', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [backupPath]
        );
        res.json({ success: true, backupPath, message: "백업 저장 경로를 변경했습니다." });
    } catch (error) {
        res.status(400).json({ message: error.message || "백업 경로를 저장할 수 없습니다." });
    }
};

exports.createBackup = async (req, res) => {
    try {
        res.status(201).json({ success: true, backup: await createBackup("manual") });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "전체 백업 생성에 실패했습니다." });
    }
};

exports.restoreBackup = async (req, res) => {
    const backupId = path.basename(String(req.params.id || ""));
    if (!backupId || req.body?.confirmation !== "RESTORE") return res.status(400).json({ message: "복구 확인이 필요합니다." });
    let connection;
    try {
        const backupDirectory = await getBackupDirectory();
        const source = path.join(backupDirectory, backupId);
        if (await verifyBackup(source) === false) return res.status(409).json({ message: "백업 무결성 검사에 실패했습니다." });
        const payload = await readBackupDatabase(source);
        await createBackup("before_restore");
        connection = await db.getConnection();
        await connection.beginTransaction();
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const table of [...backupTables].reverse()) await connection.query(`DELETE FROM \`${table}\``);
        for (const table of backupTables) {
            for (const row of payload.tables?.[table] || []) {
                const columns = Object.keys(row);
                if (!columns.length) continue;
                await connection.query(
                    `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
                    columns.map((column) => column.endsWith("_at") && typeof row[column] === "string" ? new Date(row[column]) : row[column])
                );
            }
        }
        await connection.query(
            `INSERT INTO document_number_counters (number_date, last_sequence)
             SELECT DATE(created_at), MAX(CAST(SUBSTRING_INDEX(draft_number, '-', -1) AS UNSIGNED))
             FROM documents
             WHERE document_type = '지출 문서' AND draft_number IS NOT NULL
             GROUP BY DATE(created_at)
             ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`
        );
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        await connection.commit();
        await fs.cp(path.join(source, "uploads"), uploadDirectory, { recursive: true, force: true }).catch((error) => {
            if (error.code !== "ENOENT") throw error;
        });
        res.json({ success: true });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error(error);
        res.status(500).json({ message: "백업 복구에 실패했습니다." });
    } finally {
        if (connection) {
            await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
            connection.release();
        }
    }
};

async function temporaryUploadCandidates(hours = 24) {
    const [rows] = await db.query(
        `SELECT id, stored_name AS storedName, size, created_at AS createdAt
         FROM attachment_uploads
         WHERE status = 'temporary' AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR)`,
        [hours]
    );
    return rows;
}

exports.previewTemporaryUploadCleanup = async (req, res) => {
    try {
        const rows = await temporaryUploadCandidates();
        res.json({ count: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.size), 0) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "임시 파일 정리 대상을 확인하지 못했습니다." });
    }
};

exports.cleanupTemporaryUploads = async (req, res) => {
    if (req.body?.confirmation !== "DELETE") return res.status(400).json({ message: "삭제 확인이 필요합니다." });
    try {
        const rows = await temporaryUploadCandidates();
        for (const row of rows) await fs.unlink(path.join(uploadDirectory, path.basename(row.storedName))).catch((error) => {
            if (error.code !== "ENOENT") throw error;
        });
        if (rows.length) await db.query("DELETE FROM attachment_uploads WHERE id IN (?)", [rows.map((row) => row.id)]);
        res.json({ success: true, deletedCount: rows.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "임시 파일 정리에 실패했습니다." });
    }
};
