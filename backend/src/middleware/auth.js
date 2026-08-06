const jwt = require("jsonwebtoken");
const db = require("../db/database");
const crypto = require("crypto");
const { normalizeClientIp } = require("../domain/clientIp");

const deviceHash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

async function authenticate(req, res, next) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ message: "로그인이 필요합니다." });
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await db.query("SELECT id, username, name, department, position, role, admin_allowed_ip AS adminAllowedIp, admin_device_hash AS adminDeviceHash FROM users WHERE id = ? AND is_active = TRUE", [payload.id]);
        if (!rows.length) return res.status(401).json({ message: "사용자 정보를 찾을 수 없습니다." });
        if (rows[0].role === "admin") {
            const clientIp = normalizeClientIp(req.ip || req.socket?.remoteAddress);
            const requestDeviceHash = deviceHash(req.headers["x-admin-device-token"]);
            if (!rows[0].adminAllowedIp || !rows[0].adminDeviceHash || normalizeClientIp(rows[0].adminAllowedIp) !== clientIp || rows[0].adminDeviceHash !== requestDeviceHash) {
                return res.status(403).json({ message: "관리자 계정은 등록된 관리자 PC에서만 사용할 수 있습니다." });
            }
        }
        req.user = rows[0];
        next();
    } catch {
        res.status(401).json({ message: "로그인이 만료되었습니다." });
    }
}

const allowRoles = (...roles) => (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ message: "이 작업을 수행할 권한이 없습니다." });

module.exports = { authenticate, allowRoles };
