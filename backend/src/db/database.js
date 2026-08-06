require("dotenv").config();
const mysql = require("mysql2/promise");
const { runMigrations } = require("./migrations");

for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`${key} 환경변수가 필요합니다.`);
}

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDatabase() {

    try {

        await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            version INT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
        const [existingMigrations] = await db.query("SELECT version FROM schema_migrations LIMIT 1");
        if (existingMigrations.length) {
            await runMigrations(db);
            console.log("DB 마이그레이션 확인 완료");
            return;
        }

        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(50) NOT NULL,
                department VARCHAR(100),
                position VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("users 테이블 확인 완료");


        await db.query(`
            CREATE TABLE IF NOT EXISTS mail (
                id INT AUTO_INCREMENT PRIMARY KEY,
                gmail_uid BIGINT UNIQUE,
                subject TEXT,
                sender TEXT,
                mail_date DATETIME,
                body LONGTEXT,
                body_html LONGTEXT,
                folder_id INT DEFAULT NULL,
                is_draft BOOLEAN NOT NULL DEFAULT FALSE,
                processing_status VARCHAR(30) NOT NULL DEFAULT '미처리',
                attachment_classifications LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("mail 테이블 확인 완료");

        try {
            await db.query("ALTER TABLE mail ADD COLUMN body_html LONGTEXT AFTER body");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query(
                "ALTER TABLE mail ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT FALSE AFTER folder_id"
            );
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query(
                "ALTER TABLE mail ADD COLUMN processing_status VARCHAR(30) NOT NULL DEFAULT '미처리' AFTER is_draft"
            );
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query("ALTER TABLE mail ADD COLUMN attachment_classifications LONGTEXT AFTER processing_status");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        await db.query(`
CREATE TABLE IF NOT EXISTS folder (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    attachment_path TEXT,
    auto_save_attachments BOOLEAN NOT NULL DEFAULT FALSE,
    attachment_name_template VARCHAR(500) NOT NULL DEFAULT '{{원본파일명}}',
    attachment_categories LONGTEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

        try {
            await db.query("ALTER TABLE folder ADD COLUMN attachment_path TEXT AFTER name");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query(
                "ALTER TABLE folder ADD COLUMN auto_save_attachments BOOLEAN NOT NULL DEFAULT FALSE AFTER attachment_path"
            );
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query(
                "ALTER TABLE folder ADD COLUMN attachment_name_template VARCHAR(500) NOT NULL DEFAULT '{{원본파일명}}' AFTER auto_save_attachments"
            );
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") {
                throw error;
            }
        }

        try {
            await db.query("ALTER TABLE folder ADD COLUMN attachment_categories LONGTEXT AFTER attachment_name_template");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        console.log("folder 테이블 확인 완료");

        await db.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title TEXT NOT NULL,
                content LONGTEXT NOT NULL,
                author VARCHAR(255) DEFAULT '',
                requester_user_id INT DEFAULT NULL,
                requester_position VARCHAR(100) DEFAULT '',
                document_type VARCHAR(50) NOT NULL DEFAULT '일반 문서',
                amount DECIMAL(15, 2) DEFAULT NULL,
                source_mail_uid BIGINT DEFAULT NULL,
                attachments LONGTEXT,
                attachment_categories LONGTEXT,
                approval_steps LONGTEXT,
                status VARCHAR(30) NOT NULL DEFAULT '결재 대기',
                payment_status VARCHAR(30) NOT NULL DEFAULT '지급 대기',
                paid_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        try {
            await db.query("ALTER TABLE documents ADD COLUMN requester_position VARCHAR(100) DEFAULT '' AFTER author");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        try {
            await db.query("ALTER TABLE documents ADD COLUMN requester_user_id INT DEFAULT NULL AFTER author");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        await db.query(`
            UPDATE documents d
            JOIN (
                SELECT MIN(id) AS id
                FROM users
                HAVING COUNT(*) = 1
            ) single_user
            SET d.requester_user_id = single_user.id
            WHERE d.requester_user_id IS NULL
        `);

        try {
            await db.query("ALTER TABLE documents ADD COLUMN approval_steps LONGTEXT AFTER attachments");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        try {
            await db.query("ALTER TABLE documents ADD COLUMN attachment_categories LONGTEXT AFTER attachments");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        try {
            await db.query("ALTER TABLE documents ADD COLUMN payment_status VARCHAR(30) NOT NULL DEFAULT '지급 대기' AFTER status");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        try {
            await db.query("ALTER TABLE documents ADD COLUMN paid_at DATETIME DEFAULT NULL AFTER payment_status");
        } catch (error) {
            if (error.code !== "ER_DUP_FIELDNAME") throw error;
        }

        await db.query("ALTER TABLE documents ALTER COLUMN document_type SET DEFAULT '일반 문서'");
        await db.query("UPDATE documents SET document_type = '일반 문서' WHERE document_type = '일반 기안'");
        await db.query("UPDATE documents SET document_type = '지출 문서' WHERE document_type = '결제 기안'");

        await db.query("UPDATE documents SET status = '승인' WHERE status = '승인 완료'");
        await db.query("UPDATE documents SET status = '결재 대기' WHERE status IN ('결재 요청', '결제 요청')");
        await db.query("UPDATE documents SET status = '결재 대기' WHERE status = '회수'");
        await db.query(
            "UPDATE documents SET approval_steps = REPLACE(approval_steps, '\"승인 완료\"', '\"승인\"') WHERE approval_steps LIKE '%승인 완료%'"
        );

        await runMigrations(db);
        await db.query(
            "UPDATE documents SET approval_steps = REPLACE(approval_steps, '\"회수\"', '\"결재 대기\"') WHERE approval_steps LIKE '%회수%'"
        );
        await db.query(`
            UPDATE documents d
            JOIN mail draft
              ON draft.gmail_uid = -d.id
             AND draft.is_draft = TRUE
            JOIN mail original
              ON original.folder_id = draft.folder_id
             AND original.is_draft = FALSE
             AND original.subject = d.title
             AND original.body = d.content
            SET d.source_mail_uid = original.gmail_uid
            WHERE d.source_mail_uid IS NULL
              AND (
                  SELECT COUNT(*)
                  FROM mail candidate
                  WHERE candidate.folder_id = draft.folder_id
                    AND candidate.is_draft = FALSE
                    AND candidate.subject = d.title
                    AND candidate.body = d.content
              ) = 1
        `);
        await db.query(`
            DELETE m
            FROM mail m
            JOIN documents d ON m.gmail_uid = -d.id
            WHERE m.is_draft = TRUE
              AND d.source_mail_uid IS NOT NULL
        `);

        console.log("documents 테이블 확인 완료");

        await db.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value LONGTEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        await db.query(
            `INSERT IGNORE INTO app_settings (setting_key, setting_value)
             VALUES ('approval_workflow', ?)` ,
            [JSON.stringify(["팀장", "부서장", "임원", "대표"])]
        );

        await runMigrations(db);

    } catch (err) {

        console.error("DB 초기화 실패");
        console.error(err);

    }

}

db.ready = initDatabase();

module.exports = db;
