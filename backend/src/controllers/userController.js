const db = require("../db/database");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { normalizeClientIp } = require("../domain/clientIp");

exports.createUser = async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    const department = String(req.body?.department || "").trim();
    const position = String(req.body?.position || "").trim();
    const role = String(req.body?.role || "employee");

    if (!username || !password || !name) return res.status(400).json({ message: "아이디, 비밀번호, 이름을 입력하세요." });
    if (password.length < 8) return res.status(400).json({ message: "비밀번호는 8자 이상이어야 합니다." });
    if (!["employee", "approver", "finance"].includes(role)) return res.status(400).json({ message: "추가 계정에는 관리자 권한을 지정할 수 없습니다." });

    try {
        const [duplicates] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
        if (duplicates.length) return res.status(409).json({ message: "이미 사용 중인 아이디입니다." });
        const [result] = await db.query(
            "INSERT INTO users (username, password, name, department, position, role) VALUES (?, ?, ?, ?, ?, ?)",
            [username, await bcrypt.hash(password, 10), name, department, position, role]
        );
        res.status(201).json({
            success: true,
            user: { id: result.insertId, username, name, department, position, role }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "계정을 추가할 수 없습니다." });
    }
};

exports.getUsers = async (req, res) => {
    const [users] = await db.query("SELECT id, username, name, department, position, role, created_at AS createdAt FROM users WHERE is_active = TRUE ORDER BY department, name");
    res.json({ users });
};

exports.updateUserRole = async (req, res) => {
    const role = String(req.body?.role || "");
    if (!["employee", "approver", "finance", "admin"].includes(role)) return res.status(400).json({ message: "올바른 역할을 선택하세요." });
    if (Number(req.params.id) === Number(req.user.id) && role !== "admin") return res.status(409).json({ message: "자신의 관리자 권한은 해제할 수 없습니다." });
    if (role === "admin") {
        const [administrators] = await db.query("SELECT id FROM users WHERE role = 'admin' AND id <> ? LIMIT 1", [req.params.id]);
        if (administrators.length) return res.status(409).json({ message: "관리자 계정은 하나만 지정할 수 있습니다." });
    }
    const [result] = await db.query("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
    res.json({ success: true, role });
};

exports.deleteUser = async (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: "올바른 사용자를 선택하세요." });
    if (userId === Number(req.user.id)) return res.status(409).json({ message: "현재 로그인한 관리자 계정은 삭제할 수 없습니다." });

    try {
        const [users] = await db.query("SELECT role FROM users WHERE id = ?", [userId]);
        if (!users.length) return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
        if (users[0].role === "admin") return res.status(409).json({ message: "관리자 계정은 삭제할 수 없습니다." });
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query("DELETE FROM user_mail_accounts WHERE user_id = ?", [userId]);
            await connection.query(
                "UPDATE users SET is_active = FALSE, deactivated_at = CURRENT_TIMESTAMP, deactivated_by = ? WHERE id = ?",
                [req.user.id, userId]
            );
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "계정을 삭제할 수 없습니다." });
    }
};

exports.getAdminAccess = async (req, res) => {
    const [rows] = await db.query("SELECT admin_allowed_ip AS allowedIp FROM users WHERE id = ?", [req.user.id]);
    res.json({ allowedIp: rows[0]?.allowedIp || null, currentIp: normalizeClientIp(req.ip || req.socket?.remoteAddress) });
};

exports.rebindAdminAccess = async (req, res) => {
    const currentIp = normalizeClientIp(req.ip || req.socket?.remoteAddress);
    const deviceToken = String(req.headers["x-admin-device-token"] || "");
    if (!currentIp || !deviceToken) return res.status(400).json({ message: "현재 관리자 PC 정보를 확인할 수 없습니다." });
    const adminDeviceHash = crypto.createHash("sha256").update(deviceToken).digest("hex");
    await db.query("UPDATE users SET admin_allowed_ip = ?, admin_device_hash = ? WHERE id = ?", [currentIp, adminDeviceHash, req.user.id]);
    res.json({ success: true, allowedIp: currentIp, currentIp });
};
