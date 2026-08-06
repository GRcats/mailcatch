const jwt = require("jsonwebtoken");
const db = require("../../db/database");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { normalizeClientIp } = require("../../domain/clientIp");

const deviceHash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await db.query("SELECT * FROM users WHERE username = ? AND is_active = TRUE", [username]);

        if (!rows.length) {
            return res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
        }

        const user = rows[0];
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
        }

        if (user.role === "admin") {
            const clientIp = normalizeClientIp(req.ip || req.socket?.remoteAddress);
            const deviceToken = String(req.headers["x-admin-device-token"] || "");
            if (!clientIp) return res.status(403).json({ success: false, message: "접속 IP를 확인할 수 없습니다." });
            if (!deviceToken) return res.status(403).json({ success: false, message: "관리자 PC 인증 정보를 확인할 수 없습니다." });
            if (!user.admin_allowed_ip || !user.admin_device_hash) {
                await db.query(
                    "UPDATE users SET admin_allowed_ip = ?, admin_device_hash = ? WHERE id = ? AND (admin_allowed_ip IS NULL OR admin_device_hash IS NULL)",
                    [clientIp, deviceHash(deviceToken), user.id]
                );
                const [updated] = await db.query("SELECT admin_allowed_ip AS adminAllowedIp, admin_device_hash AS adminDeviceHash FROM users WHERE id = ?", [user.id]);
                user.admin_allowed_ip = updated[0]?.adminAllowedIp;
                user.admin_device_hash = updated[0]?.adminDeviceHash;
            }
            if (normalizeClientIp(user.admin_allowed_ip) !== clientIp || user.admin_device_hash !== deviceHash(deviceToken)) {
                return res.status(403).json({ success: false, message: "관리자 계정은 등록된 관리자 PC에서만 로그인할 수 있습니다." });
            }
        }

        await db.query("DELETE FROM login_attempts WHERE ip_address = ?", [normalizeClientIp(req.ip || req.socket?.remoteAddress)]);

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                name: user.name,
                department: user.department,
                position: user.position,
                role: user.role || "employee"
            },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
        res.json({ success: true, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};
