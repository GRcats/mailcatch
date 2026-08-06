import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../shared/api";
import openAuthenticatedFile from "../shared/openAuthenticatedFile";
import Sidebar from "../components/Sidebar";


function MailDetail(){

  const location = useLocation();
  const navigate = useNavigate();

  const mail = location.state;
  const [document, setDocument] = useState(null);
  const [documentError, setDocumentError] = useState("");

  const approvalStepStyle = (status) => {
    if (status === "승인") return "border-green-200 bg-green-50 text-green-700";
    if (status === "반려") return "border-red-200 bg-red-50 text-red-700";
    if (status === "결재 대기") return "border-yellow-200 bg-yellow-50 text-yellow-700";
    return "border-zinc-200 bg-zinc-50 text-zinc-500";
  };

  const formatProcessedAt = (value) => value
    ? new Date(value).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })
    : null;

  useEffect(() => {
    if (!mail?.linkedDocumentId) return;

    api.get(`/api/documents/${mail.linkedDocumentId}`)
      .then((res) => setDocument(res.data))
      .catch((error) => {
        setDocumentError(error.response?.data?.message || "작성된 문서를 불러오지 못했습니다.");
      });
  }, [mail?.linkedDocumentId]);

  if(!mail){
    return <div>메일 정보 없음</div>
  }


  return (

    <div className="
      min-h-screen
      bg-zinc-100
    ">

      <Sidebar />


      <main className="
        ml-64
        p-8
      ">


        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={()=>navigate(-1)}
            className="
            px-4
            py-2
            bg-zinc-200
            rounded-lg
            cursor-pointer
          "
        >
          ← 목록으로
          </button>

          {mail.openedFromCategory && !mail.linkedDocumentId && (
            <button
              type="button"
              onClick={() => navigate("/write", {
                state: {
                  title: mail.subject || "",
                  content: mail.text || "",
                  sourceMailUid: mail.gmail_uid,
                  sourceMailboxKey: mail.mailboxKey || "primary",
                  folderId: mail.folderId,
                  author: mail.from || "",
                  returnTo: mail.returnTo
                }
              })}
              className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              문서 작성
            </button>
          )}
        </div>

        {mail.linkedDocumentId && !document && !documentError && (
          <div className="mb-6 rounded-xl bg-white p-6 text-zinc-500 shadow">
            작성된 문서를 불러오는 중...
          </div>
        )}

        {documentError && (
          <div className="mb-6 rounded-xl bg-red-50 p-6 text-red-600 shadow">
            {documentError}
          </div>
        )}

        {document && (
          <section className="mb-6 overflow-hidden rounded-xl border-2 border-blue-200 bg-white shadow">
            <div className="flex items-start justify-between gap-4 bg-blue-50 px-6 py-5">
              <div>
                <p className="text-sm font-medium text-blue-600">작성된 문서 · {document.type}</p>
                <h2 className="mt-1 text-2xl font-bold">{document.title}</h2>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-blue-700 shadow-sm">
                {document.status}
              </span>
            </div>

            <div className="p-6">
              <dl className="grid gap-4 rounded-lg bg-zinc-50 p-4 text-sm sm:grid-cols-3">
                <div><dt className="text-zinc-500">작성자</dt><dd className="mt-1 font-medium">{document.author || "-"}</dd></div>
                <div><dt className="text-zinc-500">작성자 직급</dt><dd className="mt-1 font-medium">{document.requesterPosition || "-"}</dd></div>
                <div><dt className="text-zinc-500">작성일</dt><dd className="mt-1 font-medium">{new Date(document.createdAt).toLocaleString("ko-KR")}</dd></div>
                {document.amount != null && (
                  <div><dt className="text-zinc-500">결제 금액</dt><dd className="mt-1 font-medium">{Number(document.amount).toLocaleString("ko-KR")}원</dd></div>
                )}
              </dl>

              <div className="mt-5 rounded-xl border border-zinc-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold">현재 절차 상황</h3>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{document.status}</span>
                </div>

                <div className="mt-4 flex items-stretch gap-2 overflow-x-auto pb-2">
                  <div className="min-w-28 shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-center text-blue-700">
                    <p className="text-xs">작성</p>
                    <p className="mt-1 font-bold">{document.requesterPosition || document.author || "작성자"}</p>
                    <p className="mt-1 text-xs">완료</p>
                    <p className="mt-1 whitespace-nowrap text-[11px] opacity-75">{formatProcessedAt(document.createdAt)}</p>
                  </div>

                  {(document.approvalSteps || []).map((step) => (
                    <div key={step.order} className="flex shrink-0 items-center gap-2">
                      <span className="text-zinc-300">→</span>
                      <div className={`min-w-28 rounded-lg border px-4 py-3 text-center ${approvalStepStyle(step.status)}`}>
                        <p className="text-xs">{step.order}차 결재</p>
                        <p className="mt-1 font-bold">{step.approver}</p>
                        <p className="mt-1 text-xs">{step.status}</p>
                        {step.processedAt && <p className="mt-1 whitespace-nowrap text-[11px] opacity-75">{formatProcessedAt(step.processedAt)}</p>}
                      </div>
                    </div>
                  ))}

                  {!(document.approvalSteps || []).length && (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-zinc-300">→</span>
                      <div className="min-w-28 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center text-green-700">
                        <p className="text-xs">처리 결과</p>
                        <p className="mt-1 font-bold">{document.status}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <h3 className="font-bold">문서 내용</h3>
                <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{document.content}</p>
              </div>

              {document.attachments.length > 0 && (
                <div className="mt-5">
                  <h3 className="font-bold">첨부파일</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {document.attachments.map((attachment, index) => (
                      <div key={`${attachment.fileName}-${index}`} className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm">
                        <span>
                          {attachment.fileName || attachment.originalName}
                          {attachment.category && <span className="ml-2 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">{attachment.category}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => openAuthenticatedFile(`/api/documents/${document.id}/attachments/${index}`).catch((requestError) => alert(requestError.response?.data?.message || requestError.message || "첨부파일을 열 수 없습니다."))}
                          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50"
                        >
                          열기
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}


        <div className="
          bg-white
          rounded-xl
          shadow
          p-6
          min-w-0
          overflow-hidden
        ">

          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-4 py-3 text-sm">
            <span className="font-medium text-zinc-700">{mail.mailboxLabel || "기본 메일"}</span>
            {mail.mailboxUsername && <span className="text-zinc-500">{mail.mailboxUsername}</span>}
            {mail.mailboxHost && <span className="text-zinc-400">· {mail.mailboxHost}</span>}
          </div>

          <h2 className="
            text-2xl
            font-bold
            mb-4
            whitespace-pre-wrap
            [overflow-wrap:anywhere]
          ">
            {mail.subject}
          </h2>


          <p className="text-zinc-500 mb-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {mail.from}
          </p>


          {mail.html ? (
            <iframe
              title="메일 본문"
              srcDoc={mail.html}
              sandbox=""
              referrerPolicy="no-referrer"
              className="w-full h-[70vh] border-0 bg-white"
            />
          ) : (
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {mail.text || "표시할 본문이 없습니다."}
            </p>
          )}


        </div>

      </main>

    </div>

  );
}


export default MailDetail;
