const migrations = [
    {
        version: 1,
        name: "document-folder-history-and-upload-integrity",
        async up(db) {
            const [documentColumns] = await db.query("SHOW COLUMNS FROM documents LIKE 'folder_id'");
            if (!documentColumns.length) {
                await db.query("ALTER TABLE documents ADD COLUMN folder_id INT DEFAULT NULL AFTER source_mail_uid");
            }

            await db.query(`
                UPDATE documents d
                LEFT JOIN mail original ON original.gmail_uid = d.source_mail_uid
                LEFT JOIN mail draft ON draft.gmail_uid = -d.id AND draft.is_draft = TRUE
                SET d.folder_id = COALESCE(original.folder_id, draft.folder_id)
                WHERE d.folder_id IS NULL
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS document_history (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    document_id INT NOT NULL,
                    action VARCHAR(50) NOT NULL,
                    previous_status VARCHAR(30),
                    next_status VARCHAR(30),
                    processed_by VARCHAR(100),
                    processed_position VARCHAR(100),
                    comment TEXT,
                    processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_document_history_document (document_id, processed_at)
                )
            `);

            await db.query(`
                CREATE TABLE IF NOT EXISTS attachment_uploads (
                    id CHAR(36) PRIMARY KEY,
                    stored_name VARCHAR(255) NOT NULL UNIQUE,
                    original_name TEXT NOT NULL,
                    content_type VARCHAR(255),
                    size BIGINT NOT NULL DEFAULT 0,
                    status ENUM('temporary', 'attached') NOT NULL DEFAULT 'temporary',
                    document_id INT DEFAULT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    attached_at DATETIME DEFAULT NULL,
                    INDEX idx_attachment_upload_status (status, created_at),
                    INDEX idx_attachment_upload_document (document_id)
                )
            `);
        }
    },
    {
        version: 2,
        name: "index-existing-document-uploads",
        async up(db) {
            const [documents] = await db.query("SELECT id, attachments FROM documents WHERE attachments IS NOT NULL");
            for (const document of documents) {
                let attachments = [];
                try { attachments = JSON.parse(document.attachments); } catch { }
                for (const attachment of Array.isArray(attachments) ? attachments : []) {
                    if (attachment.source !== "upload" || !attachment.storedName) continue;
                    await db.query(
                        `INSERT IGNORE INTO attachment_uploads
                         (id, stored_name, original_name, content_type, size, status, document_id, attached_at)
                         VALUES (UUID(), ?, ?, ?, ?, 'attached', ?, CURRENT_TIMESTAMP)`,
                        [attachment.storedName, attachment.originalName || attachment.fileName || attachment.storedName, attachment.contentType || "application/octet-stream", Number(attachment.size || 0), document.id]
                    );
                }
            }
        }
    },
    {
        version: 3,
        name: "user-roles-mail-accounts-and-history-context",
        async up(db) {
            const [roleColumns] = await db.query("SHOW COLUMNS FROM users LIKE 'role'");
            if (!roleColumns.length) await db.query("ALTER TABLE users ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'employee' AFTER position");
            await db.query("UPDATE users SET role = 'admin' WHERE position IN ('대표', '대표이사')");
            await db.query("UPDATE users SET role = 'finance' WHERE role = 'employee' AND position IN ('임원', '이사', '상무', '전무')");
            await db.query("UPDATE users SET role = 'approver' WHERE role = 'employee' AND position IN ('팀장', '과장', '차장', '부서장', '부장')");

            const [historyUserColumns] = await db.query("SHOW COLUMNS FROM document_history LIKE 'processed_user_id'");
            if (!historyUserColumns.length) await db.query("ALTER TABLE document_history ADD COLUMN processed_user_id INT DEFAULT NULL AFTER next_status");
            const [historyIpColumns] = await db.query("SHOW COLUMNS FROM document_history LIKE 'processed_ip'");
            if (!historyIpColumns.length) await db.query("ALTER TABLE document_history ADD COLUMN processed_ip VARCHAR(64) DEFAULT NULL AFTER processed_position");

            await db.query(`
                CREATE TABLE IF NOT EXISTS user_mail_accounts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL UNIQUE,
                    host VARCHAR(255) NOT NULL,
                    port INT NOT NULL DEFAULT 993,
                    secure BOOLEAN NOT NULL DEFAULT TRUE,
                    username VARCHAR(255) NOT NULL,
                    encrypted_password LONGTEXT NOT NULL,
                    last_sync_at DATETIME DEFAULT NULL,
                    last_sync_status VARCHAR(30) DEFAULT NULL,
                    last_sync_error TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_mail_account_user (user_id)
                )
            `);
        }
    },
    {
        version: 4,
        name: "attachment-hashes",
        async up(db) {
            const [columns] = await db.query("SHOW COLUMNS FROM attachment_uploads LIKE 'sha256'");
            if (!columns.length) await db.query("ALTER TABLE attachment_uploads ADD COLUMN sha256 CHAR(64) DEFAULT NULL AFTER size");
            const [indexes] = await db.query("SHOW INDEX FROM attachment_uploads WHERE Key_name = 'idx_attachment_upload_sha256'");
            if (!indexes.length) await db.query("CREATE INDEX idx_attachment_upload_sha256 ON attachment_uploads (sha256, status)");
        }
    },
    {
        version: 5,
        name: "mail-ownership-and-composite-uids",
        async up(db) {
            const [ownerColumns] = await db.query("SHOW COLUMNS FROM mail LIKE 'owner_user_id'");
            if (!ownerColumns.length) await db.query("ALTER TABLE mail ADD COLUMN owner_user_id INT DEFAULT NULL AFTER id");
            const [uniqueIndexes] = await db.query("SHOW INDEX FROM mail WHERE Column_name = 'gmail_uid' AND Non_unique = 0");
            for (const index of uniqueIndexes) if (index.Key_name !== "PRIMARY" && index.Key_name !== "uq_mail_owner_uid") await db.query(`ALTER TABLE mail DROP INDEX \`${index.Key_name}\``);
            const [composite] = await db.query("SHOW INDEX FROM mail WHERE Key_name = 'uq_mail_owner_uid'");
            if (!composite.length) await db.query("CREATE UNIQUE INDEX uq_mail_owner_uid ON mail (owner_user_id, gmail_uid)");
            const [documentOwnerColumns] = await db.query("SHOW COLUMNS FROM documents LIKE 'source_mail_owner_user_id'");
            if (!documentOwnerColumns.length) await db.query("ALTER TABLE documents ADD COLUMN source_mail_owner_user_id INT DEFAULT NULL AFTER source_mail_uid");
            await db.query("UPDATE documents SET source_mail_owner_user_id = requester_user_id WHERE source_mail_uid IS NOT NULL AND source_mail_owner_user_id IS NULL");
        }
    },
    {
        version: 6,
        name: "backfill-document-created-history",
        async up(db) {
            await db.query(`
                INSERT INTO document_history
                (document_id, action, next_status, processed_user_id, processed_by, processed_position, processed_at)
                SELECT d.id, 'created', d.status, d.requester_user_id, d.author, d.requester_position, d.created_at
                FROM documents d
                WHERE NOT EXISTS (SELECT 1 FROM document_history h WHERE h.document_id = d.id)
            `);
        }
    },
    {
        version: 7,
        name: "ensure-at-least-one-admin",
        async up(db) {
            const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            if (!admins.length) {
                await db.query("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM (SELECT MIN(id) AS id FROM users) first_user)");
            }
        }
    },
    {
        version: 8,
        name: "list-filter-indexes",
        async up(db) {
            const indexes = [
                ["documents", "idx_documents_requester_created", "requester_user_id, created_at"],
                ["documents", "idx_documents_folder_created", "folder_id, created_at"],
                ["documents", "idx_documents_status_payment", "status, payment_status, created_at"],
                ["mail", "idx_mail_owner_date", "owner_user_id, mail_date"],
                ["mail", "idx_mail_folder_date", "folder_id, mail_date"]
            ];
            for (const [table, name, columns] of indexes) {
                const [existing] = await db.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [name]);
                if (!existing.length) await db.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${columns})`);
            }
        }
    },
    {
        version: 9,
        name: "shared-mail-accounts",
        async up(db) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS shared_mail_accounts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    label VARCHAR(100) NOT NULL,
                    host VARCHAR(255) NOT NULL,
                    port INT NOT NULL DEFAULT 993,
                    secure BOOLEAN NOT NULL DEFAULT TRUE,
                    username VARCHAR(255) NOT NULL UNIQUE,
                    encrypted_password LONGTEXT NOT NULL,
                    last_sync_at DATETIME DEFAULT NULL,
                    last_sync_status VARCHAR(30) DEFAULT NULL,
                    last_sync_error TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
        }
    },
    {
        version: 10,
        name: "shared-mail-default-account",
        async up(db) {
            const [columns] = await db.query("SHOW COLUMNS FROM shared_mail_accounts LIKE 'is_primary'");
            if (!columns.length) await db.query("ALTER TABLE shared_mail_accounts ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE AFTER encrypted_password");
        }
    },
    {
        version: 11,
        name: "shared-mail-host-username-identity",
        async up(db) {
            const [usernameIndexes] = await db.query("SHOW INDEX FROM shared_mail_accounts WHERE Column_name = 'username' AND Non_unique = 0");
            for (const index of usernameIndexes) {
                if (index.Key_name !== "PRIMARY" && index.Key_name !== "uq_shared_mail_host_username") {
                    await db.query(`ALTER TABLE shared_mail_accounts DROP INDEX \`${index.Key_name}\``);
                }
            }
            const [composite] = await db.query("SHOW INDEX FROM shared_mail_accounts WHERE Key_name = 'uq_shared_mail_host_username'");
            if (!composite.length) await db.query("CREATE UNIQUE INDEX uq_shared_mail_host_username ON shared_mail_accounts (host, username)");
        }
    },
    {
        version: 12,
        name: "daily-expense-draft-numbers",
        async up(db) {
            const [columns] = await db.query("SHOW COLUMNS FROM documents LIKE 'draft_number'");
            if (!columns.length) await db.query("ALTER TABLE documents ADD COLUMN draft_number VARCHAR(32) DEFAULT NULL AFTER document_type");
            await db.query(`
                CREATE TABLE IF NOT EXISTS document_number_counters (
                    number_date DATE PRIMARY KEY,
                    last_sequence INT NOT NULL DEFAULT 0,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
            const [documents] = await db.query(
                `SELECT id, DATE_FORMAT(created_at, '%Y%m%d') AS datePart,
                        DATE(created_at) AS numberDate
                 FROM documents
                 WHERE document_type = '지출 문서'
                 ORDER BY created_at, id`
            );
            const counters = new Map();
            for (const document of documents) {
                const sequence = (counters.get(document.datePart) || 0) + 1;
                counters.set(document.datePart, sequence);
                await db.query("UPDATE documents SET draft_number = ? WHERE id = ?", [`EXP-${document.datePart}-${String(sequence).padStart(4, "0")}`, document.id]);
                await db.query(
                    `INSERT INTO document_number_counters (number_date, last_sequence) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`,
                    [document.numberDate, sequence]
                );
            }
            const [indexes] = await db.query("SHOW INDEX FROM documents WHERE Key_name = 'uq_documents_draft_number'");
            if (!indexes.length) await db.query("CREATE UNIQUE INDEX uq_documents_draft_number ON documents (draft_number)");
        }
    },
    {
        version: 13,
        name: "admin-login-ip-restriction",
        async up(db) {
            const [columns] = await db.query("SHOW COLUMNS FROM users LIKE 'admin_allowed_ip'");
            if (!columns.length) await db.query("ALTER TABLE users ADD COLUMN admin_allowed_ip VARCHAR(64) DEFAULT NULL AFTER role");
        }
    }
];

async function runMigrations(db) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    const [appliedRows] = await db.query("SELECT version FROM schema_migrations");
    const applied = new Set(appliedRows.map((row) => Number(row.version)));

    for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        await migration.up(db);
        await db.query(
            "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
            [migration.version, migration.name]
        );
        console.log(`DB migration ${migration.version} applied: ${migration.name}`);
    }
}

module.exports = { runMigrations };
