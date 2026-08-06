const jwt = require("jsonwebtoken");
const db = require("../../db/database");
const bcrypt = require("bcrypt");
const { normalizeClientIp } = require("../../domain/clientIp");

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [username]);

        if (!rows.length) {
            return res.status(401).json({ success: false, message: "아이디가 없습니다." });
        }

        const user = rows[0];
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ success: false, message: "비밀번호가 틀립니다." });
        }

        if (user.role === "admin") {
            const clientIp = normalizeClientIp(req.ip || req.socket?.remoteAddress);
            if (!clientIp) return res.status(403).json({ success: false, message: "접속 IP를 확인할 수 없습니다." });
            if (!user.admin_allowed_ip) {
                await db.query("UPDATE users SET admin_allowed_ip = ? WHERE id = ? AND admin_allowed_ip IS NULL", [clientIp, user.id]);
                const [updated] = await db.query("SELECT admin_allowed_ip AS adminAllowedIp FROM users WHERE id = ?", [user.id]);
                user.admin_allowed_ip = updated[0]?.adminAllowedIp;
            }
            if (normalizeClientIp(user.admin_allowed_ip) !== clientIp) {
                return res.status(403).json({ success: false, message: "관리자 계정은 등록된 관리자 PC에서만 로그인할 수 있습니다." });
            }
        }

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
