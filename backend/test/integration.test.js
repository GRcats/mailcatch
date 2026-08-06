const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET ||= "integration-jwt-secret-32-characters-minimum";
process.env.BACKUP_ENCRYPTION_KEY ||= "integration-backup-secret-32-characters-minimum";
process.env.MAIL_CREDENTIAL_KEY ||= "integration-mail-secret-32-characters-minimum";

let queryHandler = async () => [[]];
let connectionHandler = null;
const queries = [];
const fakeDb = {
    ready: Promise.resolve(),
    async query(sql, params = []) {
        queries.push({ sql: String(sql), params });
        return queryHandler(String(sql), params);
    },
    async getConnection() {
        if (connectionHandler) return connectionHandler();
        throw new Error("Unexpected connection request");
    }
};

const databasePath = require.resolve("../src/db/database");
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: fakeDb };

const authController = require("../src/cloud/controllers/authController");
const documentController = require("../src/controllers/documentController");
const settingsController = require("../src/controllers/settingsController");
const userController = require("../src/controllers/userController");
const { authenticate, allowRoles } = require("../src/middleware/auth");

function responseRecorder() {
    return {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        send(value) { this.body = value; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
    };
}

function resetFakeDb(handler) {
    queries.length = 0;
    connectionHandler = null;
    queryHandler = handler;
}

test("관리자 IP와 기기를 최초 등록하고 다른 IP 로그인을 차단한다", async () => {
    const password = "integration-password";
    const user = { id: 1, username: "admin", password: await bcrypt.hash(password, 4), name: "관리자", role: "admin", admin_allowed_ip: null, admin_device_hash: null };
    resetFakeDb(async (sql, params) => {
        if (sql.includes("FROM users WHERE username")) return [[{ ...user }]];
        if (sql.startsWith("UPDATE users SET admin_allowed_ip")) {
            user.admin_allowed_ip = params[0]; user.admin_device_hash = params[1]; return [{ affectedRows: 1 }];
        }
        if (sql.includes("SELECT admin_allowed_ip AS adminAllowedIp")) return [[{ adminAllowedIp: user.admin_allowed_ip, adminDeviceHash: user.admin_device_hash }]];
        if (sql.startsWith("DELETE FROM login_attempts")) return [{ affectedRows: 1 }];
        return [[]];
    });

    const first = responseRecorder();
    await authController.login({ body: { username: "admin", password }, headers: { "x-admin-device-token": "device-a" }, ip: "::ffff:192.168.0.10" }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(user.admin_allowed_ip, "192.168.0.10");

    const otherIp = responseRecorder();
    await authController.login({ body: { username: "admin", password }, headers: { "x-admin-device-token": "device-a" }, ip: "192.168.0.11" }, otherIp);
    assert.equal(otherIp.statusCode, 403);
});

test("관리자만 계정을 추가하고 비활성화할 수 있다", async () => {
    let insertedUser;
    let deactivated = false;
    resetFakeDb(async (sql, params) => {
        if (sql.includes("SELECT id FROM users WHERE username")) return [[]];
        if (sql.startsWith("INSERT INTO users")) { insertedUser = params; return [{ insertId: 9 }]; }
        if (sql.includes("SELECT role FROM users")) return [[{ role: "employee" }]];
        return [[]];
    });
    connectionHandler = () => ({
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
        async query(sql) { if (sql.startsWith("UPDATE users SET is_active")) deactivated = true; return [{ affectedRows: 1 }]; }
    });

    const denied = responseRecorder();
    let called = false;
    allowRoles("admin")({ user: { role: "employee" } }, denied, () => { called = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(called, false);

    const allowedReq = { user: { id: 1, role: "admin" }, body: { username: "member", password: "password1", name: "회원", role: "employee" } };
    const allowed = responseRecorder();
    allowRoles("admin")(allowedReq, allowed, () => { called = true; });
    assert.equal(called, true);
    await userController.createUser(allowedReq, allowed);
    assert.equal(allowed.statusCode, 201);
    assert.equal(insertedUser[0], "member");

    const removed = responseRecorder();
    await userController.deleteUser({ params: { id: "9" }, user: { id: 1 } }, removed);
    assert.equal(removed.statusCode, 200);
    assert.equal(deactivated, true);
});

test("일반 문서함 조회는 부서와 작성자 조건 없이 모든 문서를 반환한다", async () => {
    resetFakeDb(async (sql) => {
        if (sql.includes("FROM documents")) return [[
            { id: 1, title: "A", requesterUserId: 1, attachments: null, approvalSteps: null },
            { id: 2, title: "B", requesterUserId: 2, attachments: null, approvalSteps: null }
        ]];
        return [[]];
    });
    const res = responseRecorder();
    await documentController.getDocuments({ query: {}, user: { id: 3, role: "employee", department: "다른 부서" } }, res);
    assert.deepEqual(res.body.map((item) => item.id), [1, 2]);
    const select = queries.find((entry) => entry.sql.includes("FROM documents"));
    assert.doesNotMatch(select.sql, /requester_user_id\s*=|department\s*=/i);
});

test("첨부파일은 인증 후에만 열 수 있다", async () => {
    const uploads = path.resolve(__dirname, "../uploads");
    const storedName = `integration-${crypto.randomUUID()}.txt`;
    await fs.mkdir(uploads, { recursive: true });
    await fs.writeFile(path.join(uploads, storedName), "attachment-content");
    try {
        const noAuth = responseRecorder();
        await authenticate({ headers: {} }, noAuth, () => {});
        assert.equal(noAuth.statusCode, 401);

        resetFakeDb(async (sql) => {
            if (sql.includes("FROM users WHERE id")) return [[{ id: 2, username: "member", role: "employee" }]];
            if (sql.includes("FROM documents WHERE id")) return [[{ attachments: JSON.stringify([{ source: "upload", storedName, fileName: "proof.txt", contentType: "text/plain" }]) }]];
            return [[]];
        });
        const token = jwt.sign({ id: 2 }, process.env.JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` }, params: { id: "1", index: "0" }, socket: { remoteAddress: "192.168.0.20" } };
        const authenticated = responseRecorder();
        await new Promise((resolve) => authenticate(req, authenticated, resolve));
        await documentController.openDocumentAttachment(req, authenticated);
        assert.equal(authenticated.statusCode, 200);
        assert.equal(authenticated.body.toString(), "attachment-content");
        assert.match(authenticated.headers["content-disposition"], /^inline;/);
    } finally {
        await fs.unlink(path.join(uploads, storedName)).catch(() => {});
    }
});

test("현재 결재 직급만 문서를 승인할 수 있다", async () => {
    const steps = [{ order: 1, approver: "팀장", status: "결재 대기" }];
    resetFakeDb(async (sql) => {
        if (sql.startsWith("SELECT approval_steps")) return [[{ approvalSteps: JSON.stringify(steps), requesterUserId: 2, requesterPosition: "사원", status: "결재 대기" }]];
        return [{ affectedRows: 1 }];
    });
    const denied = responseRecorder();
    await documentController.decideDocument({ user: { position: "사원", name: "일반" }, body: { decision: "approve" }, params: { id: "1" } }, denied);
    assert.equal(denied.statusCode, 403);

    const approved = responseRecorder();
    await documentController.decideDocument({ user: { id: 3, position: "팀장", name: "팀장" }, body: { decision: "approve" }, params: { id: "1" }, ip: "192.168.0.3" }, approved);
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.body.success, true);
});

test("지급 내역 첨부파일명에 분류명을 포함한다", () => {
    assert.equal(
        documentController.__test.paymentAttachmentFileName("EXP-20260807-0001", { category: "영수증", fileName: "카드.pdf" }, "attachment"),
        "EXP-20260807-0001_영수증_카드.pdf"
    );
});

test("지급 내역 CSV를 조회 날짜 폴더에 생성한다", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mailcatch-payment-"));
    resetFakeDb(async (sql) => {
        if (sql.includes("FROM documents d") && sql.includes("d.payment_status")) return [[{
            id: 7,
            title: "8월 지급",
            author: "담당자",
            type: "지출 문서",
            draftNumber: "EXP-20260807-0001",
            amount: 12000,
            paymentStatus: "지급 완료",
            paidAt: new Date("2026-08-07T00:00:00Z"),
            createdAt: new Date("2026-08-07T00:00:00Z"),
            attachments: "[]"
        }]];
        return [[]];
    });
    const res = responseRecorder();
    await documentController.savePaymentHistoryCsv({
        body: { documentIds: [7], basePath: root, startDate: "2026-08-07", endDate: "2026-08-07" }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(path.basename(res.body.targetPath), "지급내역_2026.08.07");
    assert.equal(res.body.csvFileName, "지급내역_2026.08.07.csv");
    const csv = await fs.readFile(path.join(res.body.targetPath, res.body.csvFileName), "utf8");
    assert.match(csv, /8월 지급/);
    assert.match(csv, /12000/);
    await fs.rm(root, { recursive: true, force: true });
});

test("자동 백업 사용 안 함 설정에서는 백업을 시작하지 않는다", async () => {
    resetFakeDb(async (sql) => sql.includes("backup_interval_hours") ? [[{ setting_value: "0" }]] : (() => { throw new Error("백업이 실행되면 안 됩니다."); })());
    await settingsController.runScheduledBackup();
    assert.equal(queries.filter((entry) => entry.sql.includes("last_backup_at")).length, 0);
});

test("설정한 자동 백업 주기가 지나면 자동 백업을 생성한다", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mailcatch-schedule-"));
    resetFakeDb(async (sql) => {
        if (sql.includes("backup_interval_hours")) return [[{ setting_value: "6" }]];
        if (sql.includes("last_backup_at") && sql.startsWith("SELECT")) return [[{ setting_value: "2020-01-01T00:00:00.000Z" }]];
        if (sql.includes("backup_path")) return [[{ setting_value: root }]];
        if (/^\s*SELECT \* FROM/.test(sql)) return [[]];
        return [{ affectedRows: 1 }];
    });
    await settingsController.runScheduledBackup();
    const entries = await fs.readdir(root);
    assert.equal(entries.some((name) => name.endsWith("_automatic")), true);
    await fs.rm(root, { recursive: true, force: true });
});

test("백업 무결성을 검증하고 변조된 백업 복원을 거부한다", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mailcatch-integrity-"));
    const backupId = "2026-08-07_test";
    const source = path.join(root, backupId);
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "database.json"), JSON.stringify({ version: 1, tables: {} }));
    const files = await settingsController.__test.backupIntegrity(source, ["integrity.json"]);
    await fs.writeFile(path.join(source, "integrity.json"), JSON.stringify({ algorithm: "sha256", files }));
    assert.equal(await settingsController.__test.verifyBackup(source), true);
    await fs.writeFile(path.join(source, "database.json"), "tampered");
    assert.equal(await settingsController.__test.verifyBackup(source), false);

    resetFakeDb(async (sql) => sql.includes("backup_path") ? [[{ setting_value: root }]] : [[]]);
    const res = responseRecorder();
    await settingsController.restoreBackup({ params: { id: backupId }, body: { confirmation: "RESTORE" } }, res);
    assert.equal(res.statusCode, 409);
    await fs.rm(root, { recursive: true, force: true });
});

test("무결한 백업은 트랜잭션으로 복원한다", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mailcatch-restore-"));
    const backupId = "2026-08-07_valid";
    const source = path.join(root, backupId);
    await fs.mkdir(source, { recursive: true });
    const payload = { version: 1, createdAt: new Date().toISOString(), tables: { users: [{ id: 1, username: "admin" }] } };
    await fs.writeFile(path.join(source, "database.json"), JSON.stringify(payload));
    const files = await settingsController.__test.backupIntegrity(source, ["integrity.json"]);
    await fs.writeFile(path.join(source, "integrity.json"), JSON.stringify({ algorithm: "sha256", files }));

    let committed = false;
    let insertedUser = false;
    resetFakeDb(async (sql) => {
        if (sql.includes("backup_path")) return [[{ setting_value: root }]];
        if (/^\s*SELECT \* FROM/.test(sql)) return [[]];
        return [{ affectedRows: 1 }];
    });
    connectionHandler = () => ({
        beginTransaction: async () => {},
        commit: async () => { committed = true; },
        rollback: async () => {},
        release() {},
        async query(sql) {
            if (sql.startsWith("INSERT INTO `users`")) insertedUser = true;
            return [{ affectedRows: 1 }];
        }
    });
    const res = responseRecorder();
    await settingsController.restoreBackup({ params: { id: backupId }, body: { confirmation: "RESTORE" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(committed, true);
    assert.equal(insertedUser, true);
    await fs.rm(root, { recursive: true, force: true });
});
