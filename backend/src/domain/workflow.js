const defaultApprovalWorkflow = ["팀장", "부서장", "임원", "대표"];

function buildApprovalSteps(_position, workflow = defaultApprovalWorkflow) {
    return workflow.map((approver, index) => ({ order: index + 1, approver, status: index === 0 ? "결재 대기" : "대기" }));
}

function parseApprovalSteps(value, requesterPosition) {
    if (value) {
        try {
            const steps = typeof value === "string" ? JSON.parse(value) : value;
            if (Array.isArray(steps) && steps.length) return steps;
        } catch { }
    }
    return buildApprovalSteps(requesterPosition || "");
}

function roleMatches(requiredRole, position) {
    const groups = { "팀장": ["팀장", "과장", "차장"], "부서장": ["부서장", "부장"], "임원": ["임원", "이사", "상무", "전무"], "대표": ["대표", "대표이사"] };
    return requiredRole === position || groups[requiredRole]?.includes(position) || false;
}

module.exports = { defaultApprovalWorkflow, buildApprovalSteps, parseApprovalSteps, roleMatches };
