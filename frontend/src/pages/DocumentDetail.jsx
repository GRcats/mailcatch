import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { apiUrl } from "../shared/api";
import Sidebar from "../components/Sidebar";
import { jwtDecode } from "jwt-decode";

function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [document, setDocument] = useState(null);
  const [error, setError] = useState("");
  const [recalling, setRecalling] = useState(false);
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });

  useEffect(() => {
    api.get(`/api/documents/${id}`)
      .then((res) => setDocument(res.data))
      .catch((requestError) => {
        setError(requestError.response?.data?.message || "문서를 불러오지 못했습니다.");
      });
  }, [id]);

  const canRecall = document && Number(document.requesterUserId) === Number(user?.id)
    && document.status === "결재 대기"
    && document.approvalSteps?.[0]?.status === "결재 대기";

  const recallDocument = async () => {
    if (!confirm(`'${document.title}' 문서를 회수하시겠습니까?`)) return;
    setRecalling(true);
    try {
      const res = await api.patch(`/api/documents/${document.id}/recall`);
      const recalled = res.data.document;
      navigate("/write", {
        replace: true,
        state: {
          title: recalled.title,
          content: recalled.content,
          documentType: recalled.type,
          amount: recalled.amount,
          author: recalled.author,
          folderId: recalled.folderId,
          sourceMailUid: recalled.sourceMailUid,
          sourceMailboxKey: recalled.sourceMailboxKey || "primary",
          existingAttachments: (recalled.attachments || []).filter((attachment) => attachment.source === "upload"),
          returnTo: "/documents"
        }
      });
    } catch (requestError) {
      alert(requestError.response?.data?.message || "문서 회수에 실패했습니다.");
    } finally { setRecalling(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar />
      <main className="ml-64 p-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-5 cursor-pointer rounded-lg bg-zinc-200 px-4 py-2 hover:bg-zinc-300"
        >
          ← 목록으로
        </button>

        {error && <div className="rounded-xl bg-red-50 p-5 text-red-600">{error}</div>}
        {!document && !error && <p className="text-zinc-500">문서를 불러오는 중...</p>}

        {document && (
          <div className="space-y-6">
            <section className="rounded-xl bg-white p-6 shadow">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-500">{document.type}{document.draftNumber ? ` · ${document.draftNumber}` : ""}</p>
                  <h2 className="mt-1 text-3xl font-bold">{document.title}</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canRecall && <button type="button" onClick={recallDocument} disabled={recalling} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{recalling ? "회수 중..." : "회수"}</button>}
                  <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-700">
                    {document.status}
                  </span>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg bg-zinc-50 p-4 text-sm">
                <div><dt className="text-zinc-500">작성자</dt><dd className="mt-1 font-medium">{document.author || "-"}</dd></div>
                <div><dt className="text-zinc-500">작성자 직급</dt><dd className="mt-1 font-medium">{document.requesterPosition || "-"}</dd></div>
                <div><dt className="text-zinc-500">작성일</dt><dd className="mt-1 font-medium">{new Date(document.createdAt).toLocaleString("ko-KR")}</dd></div>
                {document.amount != null && (
                  <div><dt className="text-zinc-500">결제 금액</dt><dd className="mt-1 font-medium">{Number(document.amount).toLocaleString("ko-KR")}원</dd></div>
                )}
              </dl>
            </section>

            <section className="rounded-xl bg-white p-6 shadow">
              <h3 className="text-xl font-bold">승인 절차</h3>
              {document.approvalSteps.length ? (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 text-center">
                    <p className="text-sm text-blue-600">작성</p>
                    <p className="mt-1 font-bold">{document.requesterPosition || "작성자"}</p>
                  </div>
                  {document.approvalSteps.map((step) => (
                    <div key={step.order} className="flex items-center gap-3">
                      <span className="text-zinc-300">→</span>
                      <div className="rounded-lg border px-5 py-4 text-center">
                        <p className="text-sm text-zinc-500">{step.order}차 승인</p>
                        <p className="mt-1 font-bold">{step.approver}</p>
                        <p className="mt-1 text-xs text-yellow-600">{step.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-zinc-500">추가 승인 절차가 없습니다.</p>
              )}
            </section>

            <section className="rounded-xl bg-white p-6 shadow">
              <h3 className="text-xl font-bold">문서 내용</h3>
              <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere]">{document.content}</p>
            </section>

            {document.history?.length > 0 && (
              <section className="rounded-xl bg-white p-6 shadow">
                <h3 className="text-xl font-bold">처리 이력</h3>
                <div className="mt-4 divide-y divide-zinc-100">
                  {document.history.map((item, index) => {
                    const actionLabel = { created: "문서 작성", approved: "승인", rejected: "반려", payment_completed: "지급 완료", recalled: "회수" }[item.action] || item.action;
                    return (
                      <div key={`${item.processedAt}-${index}`} className="grid gap-2 py-3 text-sm sm:grid-cols-[140px_1fr_190px] sm:items-center">
                        <span className="font-medium text-zinc-800">{actionLabel}</span>
                        <span className="text-zinc-500">{item.processedBy || "시스템"}{item.processedPosition ? ` · ${item.processedPosition}` : ""}</span>
                        <time className="text-zinc-400 sm:text-right">{new Date(item.processedAt).toLocaleString("ko-KR")}</time>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {document.attachments.length > 0 && (
              <section className="rounded-xl bg-white p-6 shadow">
                <h3 className="text-xl font-bold">첨부파일</h3>
                <div className="mt-4 space-y-2">
                  {document.attachments.map((attachment, index) => (
                    <div key={`${attachment.source || "mail"}-${attachment.sourceIndex ?? index}`} className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        {attachment.fileName}
                        {attachment.category && <span className="ml-2 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">{attachment.category}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => window.open(apiUrl(`/api/documents/${document.id}/attachments/${index}`), "_blank", "noopener,noreferrer")}
                        className="cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm hover:bg-zinc-100"
                      >
                        열기
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

export default DocumentDetail;
