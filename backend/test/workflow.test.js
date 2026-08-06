const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApprovalSteps, parseApprovalSteps, roleMatches } = require("../src/domain/workflow");

test("작은 회사 결재선은 팀장 다음 대표로 이어진다", () => {
    assert.deepEqual(buildApprovalSteps("팀원", ["팀장", "대표"]), [
        { order: 1, approver: "팀장", status: "결재 대기" },
        { order: 2, approver: "대표", status: "대기" }
    ]);
});

test("작성자 직급과 관계없이 저장된 결재선을 그대로 유지한다", () => {
    assert.deepEqual(buildApprovalSteps("부서장", ["팀장", "대표"]), [
        { order: 1, approver: "팀장", status: "결재 대기" },
        { order: 2, approver: "대표", status: "대기" }
    ]);
});

test("직급 별칭을 올바른 권한으로 인정한다", () => {
    assert.equal(roleMatches("팀장", "과장"), true);
    assert.equal(roleMatches("대표", "대표이사"), true);
    assert.equal(roleMatches("대표", "팀장"), false);
});

test("저장된 처리 날짜를 포함한 결재 단계 JSON을 복원한다", () => {
    const steps = [{ order: 1, approver: "대표", status: "승인", processedAt: "2026-08-03T00:00:00.000Z" }];
    assert.deepEqual(parseApprovalSteps(JSON.stringify(steps), "팀원"), steps);
});
