const db = require("../db/database");
const { encryptPassword, createUserMailClient, createSharedMailClient } = require("../services/userMailService");

async function importLegacyPrimaryAccount() {
    const [primary] = await db.query("SELECT id FROM shared_mail_accounts WHERE is_primary = TRUE LIMIT 1");
    if (primary.length || !process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) return;
    await db.query(
        `INSERT INTO shared_mail_accounts (label, host, port, secure, username, encrypted_password, is_primary)
         VALUES ('대표 메일', ?, ?, TRUE, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE is_primary = TRUE`,
        [process.env.IMAP_HOST, Number(process.env.IMAP_PORT || 993), process.env.IMAP_USER, encryptPassword(process.env.IMAP_PASS)]
    );
}

exports.getSharedMailAccounts = async (_req, res) => {
    try {
        await importLegacyPrimaryAccount();
        const [rows] = await db.query("SELECT id, label, host, port, secure, username, is_primary AS isPrimary, last_sync_at AS lastSyncAt, last_sync_status AS lastSyncStatus FROM shared_mail_accounts ORDER BY is_primary DESC, id");
        res.json(rows.map((row) => ({ ...row, key: row.isPrimary ? "primary" : `shared-${row.id}`, primary: Boolean(row.isPrimary) })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "메일 계정 목록을 불러오지 못했습니다." });
    }
};

exports.saveSharedMailAccount = async (req, res) => {
    const label = String(req.body?.label || "").trim();
    const host = String(req.body?.host || "").trim();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const port = Number(req.body?.port || 993);
    if (!label || !host || !username || !password || !Number.isInteger(port)) return res.status(400).json({ message: "메일 계정 정보를 모두 입력하세요." });
    try {
        await importLegacyPrimaryAccount();
        const [primary] = await db.query("SELECT id FROM shared_mail_accounts WHERE is_primary = TRUE LIMIT 1");
        const isPrimary = !primary.length;
        const [result] = await db.query("INSERT INTO shared_mail_accounts (label, host, port, secure, username, encrypted_password, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)", [label, host, port, req.body?.secure !== false, username, encryptPassword(password), isPrimary]);
        res.json({ id: result.insertId, key: isPrimary ? "primary" : `shared-${result.insertId}`, label, username, primary: isPrimary });
    } catch (error) {
        console.error(error);
        res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({ message: error.code === "ER_DUP_ENTRY" ? "같은 서버에 이미 등록된 메일 계정입니다." : "메일 계정을 저장하지 못했습니다." });
    }
};

exports.deleteSharedMailAccount = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "올바르지 않은 메일 계정입니다." });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [accounts] = await connection.query("SELECT id, is_primary AS isPrimary FROM shared_mail_accounts WHERE id = ? FOR UPDATE", [id]);
        if (!accounts.length) { await connection.rollback(); return res.status(404).json({ message: "메일 계정을 찾을 수 없습니다." }); }
        if (accounts[0].isPrimary) {
            const [replacement] = await connection.query("SELECT id FROM shared_mail_accounts WHERE id <> ? ORDER BY id LIMIT 1 FOR UPDATE", [id]);
            let archiveOwner = -1000000000 - id;
            while (true) {
                const [used] = await connection.query("SELECT id FROM mail WHERE owner_user_id = ? LIMIT 1", [archiveOwner]);
                if (!used.length) break;
                archiveOwner -= 1;
            }
            // 환경변수 대표메일을 기존 DB 계정으로 이전한 경우 같은 UID가
            // NULL과 -계정ID 양쪽에 남아 있을 수 있다. 현재 대표메일 행을 우선한다.
            // MySQL UNIQUE 인덱스는 NULL끼리의 중복을 허용하므로 대표메일 내부에도
            // 같은 UID가 여러 행 있을 수 있다. 가장 오래된 한 행만 유지한다.
            await connection.query(
                `DELETE duplicate_mail FROM mail duplicate_mail
                 JOIN mail keeper_mail ON keeper_mail.owner_user_id IS NULL
                                      AND duplicate_mail.owner_user_id IS NULL
                                      AND keeper_mail.gmail_uid = duplicate_mail.gmail_uid
                                      AND keeper_mail.id < duplicate_mail.id`
            );
            await connection.query(
                `DELETE duplicate_mail FROM mail duplicate_mail
                 JOIN mail primary_mail ON primary_mail.owner_user_id IS NULL
                                       AND primary_mail.gmail_uid = duplicate_mail.gmail_uid
                 WHERE duplicate_mail.owner_user_id = ?`,
                [-id]
            );
            await connection.query("UPDATE mail SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = ?", [archiveOwner, -id]);
            await connection.query("UPDATE documents SET source_mail_owner_user_id = ? WHERE source_mail_uid IS NOT NULL AND (source_mail_owner_user_id IS NULL OR source_mail_owner_user_id = ?)", [archiveOwner, -id]);
            if (replacement.length) {
                await connection.query("UPDATE mail SET owner_user_id = NULL WHERE owner_user_id = ?", [-replacement[0].id]);
                await connection.query("UPDATE documents SET source_mail_owner_user_id = NULL WHERE source_mail_owner_user_id = ?", [-replacement[0].id]);
                await connection.query("UPDATE shared_mail_accounts SET is_primary = TRUE WHERE id = ?", [replacement[0].id]);
            }
        }
        await connection.query("DELETE FROM shared_mail_accounts WHERE id = ?", [id]);
        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error(error);
        res.status(500).json({ message: "메일 계정을 삭제하지 못했습니다." });
    } finally { connection?.release(); }
};

exports.setPrimarySharedMailAccount = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "올바르지 않은 메일 계정입니다." });
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [target] = await connection.query("SELECT id, is_primary AS isPrimary FROM shared_mail_accounts WHERE id = ? FOR UPDATE", [id]);
        if (!target.length) { await connection.rollback(); return res.status(404).json({ message: "메일 계정을 찾을 수 없습니다." }); }
        if (!target[0].isPrimary) {
            const [current] = await connection.query("SELECT id FROM shared_mail_accounts WHERE is_primary = TRUE LIMIT 1 FOR UPDATE");
            const temporaryOwner = 2147483647;
            await connection.query("UPDATE mail SET owner_user_id = ? WHERE owner_user_id IS NULL", [temporaryOwner]);
            await connection.query("UPDATE documents SET source_mail_owner_user_id = ? WHERE source_mail_owner_user_id IS NULL AND source_mail_uid IS NOT NULL", [temporaryOwner]);
            await connection.query("UPDATE mail SET owner_user_id = NULL WHERE owner_user_id = ?", [-id]);
            await connection.query("UPDATE documents SET source_mail_owner_user_id = NULL WHERE source_mail_owner_user_id = ?", [-id]);
            if (current.length) {
                await connection.query(
                    `DELETE archived_mail FROM mail archived_mail
                     JOIN mail current_mail ON current_mail.owner_user_id = ?
                                           AND current_mail.gmail_uid = archived_mail.gmail_uid
                     WHERE archived_mail.owner_user_id = ?`,
                    [temporaryOwner, -current[0].id]
                );
                await connection.query("UPDATE mail SET owner_user_id = ? WHERE owner_user_id = ?", [-current[0].id, temporaryOwner]);
                await connection.query("UPDATE documents SET source_mail_owner_user_id = ? WHERE source_mail_owner_user_id = ?", [-current[0].id, temporaryOwner]);
            }
            await connection.query("UPDATE shared_mail_accounts SET is_primary = (id = ?)", [id]);
        }
        await connection.commit();
        res.json({ success: true });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        console.error(error);
        res.status(500).json({ message: "기본 메일 계정을 변경하지 못했습니다." });
    } finally { connection?.release(); }
};

exports.testSharedMailAccount = async (req, res) => {
    let client;
    try { client = await createSharedMailClient(`shared-${req.params.id}`); await client.connect(); await client.logout(); res.json({ success: true }); }
    catch (error) { if (client?.usable) await client.logout().catch(() => {}); res.status(400).json({ message: `메일 연결 실패: ${error.message}` }); }
};

exports.getMailAccount = async (req, res) => {
    const [rows] = await db.query(`SELECT host, port, secure, username, last_sync_at AS lastSyncAt, last_sync_status AS lastSyncStatus, last_sync_error AS lastSyncError FROM user_mail_accounts WHERE user_id = ?`, [req.user.id]);
    res.json({ account: rows[0] || null, usingSharedAccount: !rows.length && Boolean(process.env.IMAP_HOST) });
};

exports.saveMailAccount = async (req, res) => {
    const host = String(req.body?.host || "").trim();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const port = Number(req.body?.port || 993);
    if (!host || !username || !Number.isInteger(port)) return res.status(400).json({ message: "메일 서버 정보를 모두 입력하세요." });
    const [existing] = await db.query("SELECT encrypted_password AS encryptedPassword FROM user_mail_accounts WHERE user_id = ?", [req.user.id]);
    if (!password && !existing.length) return res.status(400).json({ message: "메일 앱 비밀번호를 입력하세요." });
    const encryptedPassword = password ? encryptPassword(password) : existing[0].encryptedPassword;
    await db.query(`INSERT INTO user_mail_accounts (user_id, host, port, secure, username, encrypted_password) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE host=VALUES(host), port=VALUES(port), secure=VALUES(secure), username=VALUES(username), encrypted_password=VALUES(encrypted_password)`, [req.user.id, host, port, req.body?.secure !== false, username, encryptedPassword]);
    res.json({ success: true });
};

exports.testMailAccount = async (req, res) => {
    let client;
    try { client = await createUserMailClient(req.user.id); await client.connect(); await client.logout(); res.json({ success: true }); }
    catch (error) { if (client?.usable) await client.logout().catch(() => {}); res.status(400).json({ message: `메일 연결 실패: ${error.message}` }); }
};

exports.deleteMailAccount = async (req, res) => {
    await db.query("DELETE FROM user_mail_accounts WHERE user_id = ?", [req.user.id]);
    res.json({ success: true });
};
