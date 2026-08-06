import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../shared/api";
import { jwtDecode } from "jwt-decode";
import Sidebar from "../components/Sidebar";

const availableApprovalPositions = [
  "사원", "주임", "대리", "과장", "차장", "팀장", "부장",
  "부서장", "이사", "상무", "전무", "임원", "대표이사", "대표"
];

function Approval() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [showWorkflowSettings, setShowWorkflowSettings] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [activePosition, setActivePosition] = useState("전체");
  const [approvalPositions, setApprovalPositions] = useState(["팀장", "부서장", "임원", "대표"]);
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });
  const canManageWorkflow = user?.role === "admin" || ["대표", "대표이사"].includes(user?.position);

  const saveApprovalWorkflow = async () => {
    if (!approvalPositions.length) return alert("결재 직급을 하나 이상 선택하세요.");
    setWorkflowSaving(true);
    try {
      const response = await api.put("/api/settings/approval-workflow", { positions: approvalPositions });
      setApprovalPositions(response.data.positions || approvalPositions);
      setShowWorkflowSettings(false);
      alert("회사 결재선을 저장했습니다. 새로 작성하는 문서부터 적용됩니다.");
    } catch (error) {
      alert(error.response?.data?.message || "결재선 설정 저장에 실패했습니다.");
    } finally {
      setWorkflowSaving(false);
    }
  };

  const currentApprover = (document) =>
    document.approvalSteps.find((step) => step.status === "결재 대기")?.approver || "직급 미설정";
  const additionalPositions = [...new Set(documents.map(currentApprover)
    .filter((position) => !approvalPositions.includes(position)))]
    .sort((left, right) => left.localeCompare(right, "ko"));
  const positionTabs = ["전체", ...approvalPositions, ...additionalPositions];
  const positionCount = (position) => position === "전체"
    ? documents.length
    : documents.filter((document) => currentApprover(document) === position).length;
  const filteredDocuments = activePosition === "전체"
    ? documents
    : documents.filter((document) => currentApprover(document) === activePosition);

  const loadDocuments = async () => {
    try {
      const res = await api.get("/api/documents/approval/pending");
      setDocuments(res.data);
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "결재 대기 문서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(loadDocuments);
    api.get("/api/settings/approval-workflow")
      .then((res) => setApprovalPositions(res.data.positions || []))
      .catch((error) => console.error(error));
  }, []);

  const decide = async (id, decision) => {
    let comment = "";
    if (decision === "reject") {
      comment = prompt("반려 사유를 입력하세요.")?.trim() || "";
      if (!comment) return alert("반려 사유가 필요합니다.");
    }

    setProcessingId(id);
    try {
      await api.patch(`/api/documents/${id}/decision`, {
        approverPosition: user.position,
        approverName: user.name,
        decision,
        comment
      });
      setDocuments((current) => current.filter((document) => document.id !== id));
      alert(decision === "approve" ? "승인했습니다." : "반려했습니다.");
    } catch (error) {
      alert(error.response?.data?.message || "결재 처리에 실패했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar />
      <main className="ml-64 min-w-0 p-5 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-3xl font-bold tracking-tight text-zinc-900">
            결재 대기함
          </h2><p className="mt-2 text-sm text-zinc-500">내 결재 순서에 도착한 문서를 확인하고 처리합니다.</p></div>
          {canManageWorkflow && <button type="button" onClick={() => setShowWorkflowSettings(true)} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">결재선 설정</button>}
        </div>

        {showWorkflowSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowWorkflowSettings(false)}>
            <section className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5"><div><h3 className="text-xl font-bold text-zinc-900">회사 결재선 설정</h3><p className="mt-1 text-sm text-zinc-500">결재에 참여할 직급을 선택하면 직급 순서대로 적용됩니다.</p></div><button type="button" onClick={() => setShowWorkflowSettings(false)} className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100">닫기</button></div>

              <div className="max-h-[70vh] overflow-y-auto p-6">
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-blue-900">현재 선택된 결재선</p><span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-600">{approvalPositions.length}개 직급</span></div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {approvalPositions.map((position, index) => <div key={position} className="flex items-center gap-2"><span className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700">{position}</span>{index < approvalPositions.length - 1 && <span className="text-blue-300">›</span>}</div>)}
                    {!approvalPositions.length && <p className="py-2 text-sm text-blue-400">아래에서 결재 직급을 선택하세요.</p>}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between"><p className="text-sm font-semibold text-zinc-700">직급 선택</p><div className="flex gap-2"><button type="button" onClick={() => setApprovalPositions(availableApprovalPositions)} className="text-xs text-blue-600 hover:underline">전체 선택</button><span className="text-zinc-300">·</span><button type="button" onClick={() => setApprovalPositions([])} className="text-xs text-zinc-500 hover:underline">선택 해제</button></div></div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {availableApprovalPositions.map((position) => {
                    const selected = approvalPositions.includes(position);
                    return <button key={position} type="button" aria-pressed={selected} onClick={() => setApprovalPositions((current) => selected ? current.filter((item) => item !== position) : availableApprovalPositions.filter((item) => current.includes(item) || item === position))} className={`relative rounded-xl border px-3 py-3 text-sm font-medium transition ${selected ? "border-blue-500 bg-blue-600 text-white shadow-sm" : "border-zinc-200 bg-white text-zinc-600 hover:border-blue-300 hover:bg-blue-50"}`}>
                      {position}{selected && <span className="absolute right-2 top-1.5 text-xs text-blue-100">✓</span>}
                    </button>;
                  })}
                </div>
                <p className="mt-4 text-xs text-zinc-400">변경 사항은 새로 작성하는 문서부터 적용됩니다.</p>
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/70 px-6 py-4"><button type="button" onClick={() => setShowWorkflowSettings(false)} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50">취소</button><button type="button" onClick={saveApprovalWorkflow} disabled={workflowSaving || !approvalPositions.length} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">{workflowSaving ? "저장 중..." : "저장"}</button></div>
            </section>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex justify-between border-b border-zinc-100 px-5 py-5 lg:px-6">
            <div>
              <h3 className="text-xl font-bold">처리 대기 문서</h3>
              <p className="mt-1 text-sm text-zinc-500">
                현재 결재 대기 중인 모든 문서가 표시됩니다.
              </p>
            </div>
            <span className="h-fit rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700">
              {documents.length}건 대기
            </span>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-zinc-100 px-5 py-4 lg:px-6">
            {positionTabs.map((position) => (
              <button
                key={position}
                type="button"
                onClick={() => setActivePosition(position)}
                className={`rounded-lg px-4 py-2 text-sm transition ${activePosition === position ? "bg-blue-600 text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
              >
                {position}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activePosition === position ? "bg-white/20" : "bg-white"}`}>
                  {positionCount(position)}
                </span>
              </button>
            ))}
          </div>

          {loading && <p className="py-12 text-center text-zinc-400">불러오는 중...</p>}

          {!loading && filteredDocuments.length === 0 && (
            <p className="py-12 text-center text-zinc-400">해당 직급의 결재 대기 문서가 없습니다.</p>
          )}

          <div className="space-y-3 p-5 lg:p-6">
            {filteredDocuments.map((document) => {
              const currentStep = document.approvalSteps.find((step) => step.status === "결재 대기");
              return (
                <article key={document.id} className="rounded-xl border border-zinc-200 p-5 transition hover:border-blue-200 hover:bg-blue-50/30">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => navigate(`/documents/${document.id}`)}
                        className="cursor-pointer text-left text-lg font-bold hover:text-blue-600"
                      >
                        {document.title}
                      </button>
                      <p className="mt-2 text-zinc-500">
                        {document.author || "작성자 없음"} · {document.requesterPosition || "직급 미설정"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {new Date(document.createdAt).toLocaleString("ko-KR")}
                      </p>
                      <p className="mt-3 text-sm text-blue-600">
                        현재 결재: {currentStep?.approver}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/documents/${document.id}`)}
                        className="cursor-pointer rounded-lg border px-4 py-2 hover:bg-zinc-100"
                      >
                        상세
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(document.id, "approve")}
                        disabled={processingId === document.id}
                        className="cursor-pointer rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(document.id, "reject")}
                        disabled={processingId === document.id}
                        className="cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        반려
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

export default Approval;
