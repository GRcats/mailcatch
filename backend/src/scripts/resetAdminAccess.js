const db = require("../db/database");

async function main() {
    const username = String(process.argv[2] || "").trim();
    if (!username) throw new Error("사용법: npm run reset-admin-access -- <관리자아이디>");
    await db.ready;
    const [result] = await db.query(
        "UPDATE users SET admin_allowed_ip = NULL, admin_device_hash = NULL WHERE username = ? AND role = 'admin' AND is_active = TRUE",
        [username]
    );
    if (!result.affectedRows) throw new Error("활성 관리자 계정을 찾을 수 없습니다.");
    console.log("관리자 PC 인증을 초기화했습니다. 관리자 PC에서 다시 로그인하세요.");
}

main().then(() => db.end()).catch(async (error) => {
    console.error(error.message);
    await db.end().catch(() => {});
    process.exitCode = 1;
});
