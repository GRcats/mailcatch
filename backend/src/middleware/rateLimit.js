const db = require("../db/database");
const { normalizeClientIp } = require("../domain/clientIp");

async function authRateLimit(req, res, next) {
    const ip = normalizeClientIp(req.ip || req.socket?.remoteAddress) || "unknown";
    try {
        await db.query("DELETE FROM login_attempts WHERE attempted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)");
        const [rows] = await db.query(
            "SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = ? AND attempted_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)",
            [ip]
        );
        if (Number(rows[0].count) >= 20) return res.status(429).json({ message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요." });
        await db.query("INSERT INTO login_attempts (ip_address) VALUES (?)", [ip]);
        next();
    } catch (error) {
        console.error("로그인 시도 제한 확인 실패:", error);
        res.status(503).json({ message: "로그인 보안 상태를 확인할 수 없습니다." });
    }
}

module.exports = { authRateLimit };
