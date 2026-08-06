const crypto = require("crypto");
const { ImapFlow } = require("imapflow");
const db = require("../db/database");

const key = () => crypto.createHash("sha256").update(process.env.MAIL_CREDENTIAL_KEY || process.env.JWT_SECRET).digest();

function createImapClient(config) {
    const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        logger: false,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 7000,
        greetingTimeout: 7000,
        socketTimeout: 15000
    });
    // ImapFlow는 connect()의 Promise를 reject하는 것과 별도로 error 이벤트도
    // 발생시킨다. 리스너가 없으면 일시적인 연결 실패가 Node 프로세스를 종료한다.
    client.on("error", () => {});
    return client;
}

function encryptPassword(password) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
    const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}

function decryptPassword(payload) {
    const value = JSON.parse(payload);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
}

async function getUserMailConfig(userId) {
    const [rows] = await db.query("SELECT host, port, secure, username, encrypted_password AS encryptedPassword FROM user_mail_accounts WHERE user_id = ?", [userId]);
    if (rows.length) return { host: rows[0].host, port: rows[0].port, secure: Boolean(rows[0].secure), user: rows[0].username, pass: decryptPassword(rows[0].encryptedPassword) };
    if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) throw new Error("메일 계정 설정이 필요합니다.");
    return { host: process.env.IMAP_HOST, port: Number(process.env.IMAP_PORT || 993), secure: true, user: process.env.IMAP_USER, pass: process.env.IMAP_PASS };
}

async function createUserMailClient(userId) {
    const config = await getUserMailConfig(userId);
    return createImapClient(config);
}

async function getSharedMailConfig(mailboxKey = "primary") {
    if (mailboxKey === "primary") {
        const [rows] = await db.query("SELECT host, port, secure, username, encrypted_password AS encryptedPassword FROM shared_mail_accounts WHERE is_primary = TRUE ORDER BY id LIMIT 1");
        if (rows.length) return { host: rows[0].host, port: rows[0].port, secure: Boolean(rows[0].secure), user: rows[0].username, pass: decryptPassword(rows[0].encryptedPassword) };
        if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) throw new Error("대표 메일 계정 설정이 필요합니다.");
        return { host: process.env.IMAP_HOST, port: Number(process.env.IMAP_PORT || 993), secure: true, user: process.env.IMAP_USER, pass: process.env.IMAP_PASS };
    }
    const match = /^shared-(\d+)$/.exec(String(mailboxKey));
    if (!match) throw new Error("올바르지 않은 메일 계정입니다.");
    const [rows] = await db.query("SELECT host, port, secure, username, encrypted_password AS encryptedPassword FROM shared_mail_accounts WHERE id = ?", [match[1]]);
    if (!rows.length) throw new Error("메일 계정을 찾을 수 없습니다.");
    return { host: rows[0].host, port: rows[0].port, secure: Boolean(rows[0].secure), user: rows[0].username, pass: decryptPassword(rows[0].encryptedPassword) };
}

async function createSharedMailClient(mailboxKey) {
    const config = await getSharedMailConfig(mailboxKey);
    return createImapClient(config);
}

module.exports = { encryptPassword, getUserMailConfig, createUserMailClient, getSharedMailConfig, createSharedMailClient };
