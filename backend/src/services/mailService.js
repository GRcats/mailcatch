const { ImapFlow } = require("imapflow");

async function connectMail() {
    if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) return false;
    const client = new ImapFlow({
        host: process.env.IMAP_HOST,
        port: 993,
        secure: true,

        logger: false,

        auth: {
            user: process.env.IMAP_USER,
            pass: process.env.IMAP_PASS
        },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000
    });
    client.on("error", () => {});
    try {
        await client.connect();
        await client.logout();
        return true;
    } catch (error) {
        console.error("메일 서버 연결 확인 실패:", error.message);
        return false;
    }
}
 
module.exports = { connectMail };
