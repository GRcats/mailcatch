import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api, { apiUrl } from "../shared/api";
import Sidebar from "../components/Sidebar";
import { jwtDecode } from "jwt-decode";

function Write() {

  const navigate = useNavigate();
  const location = useLocation();

  const [title, setTitle] = useState(() => location.state?.title || "");
  const [content, setContent] = useState(() => location.state?.content || "");
  const [documentType, setDocumentType] = useState(() => location.state?.documentType || "일반 문서");
  const [amount, setAmount] = useState(() => location.state?.amount ?? "");
  const [attachmentInfo, setAttachmentInfo] = useState(null);
  const [localFiles, setLocalFiles] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState(() => location.state?.existingAttachments || []);
  const [submitting, setSubmitting] = useState(false);
  const [attachmentsLoading, setAttachmentsLoading] = useState(Boolean(location.state?.sourceMailUid));
  const [attachmentLoadError, setAttachmentLoadError] = useState("");
  const [attachmentCategories, setAttachmentCategories] = useState([]);
  const [attachmentClassifications, setAttachmentClassifications] = useState({});
  const [newAttachmentCategory, setNewAttachmentCategory] = useState("");
  const [showCategorySettings, setShowCategorySettings] = useState(false);
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });
  const author = location.state?.sourceMailUid
    ? location.state?.author || ""
    : user?.name || "";
  useEffect(() => {
    api.get("/api/documents/attachment-categories")
      .then((res) => setAttachmentCategories(res.data.categories || []))
      .catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    if (!location.state?.sourceMailUid) return;

    api.get(`/api/mail/${location.state.sourceMailUid}/attachments`, { params: { mailboxKey: location.state.sourceMailboxKey || "primary" } })
      .then((res) => {
        setAttachmentInfo(res.data);
        setAttachmentCategories((current) => [...new Set([...current, ...(res.data.attachmentCategories || [])])]);
        setAttachmentClassifications(Object.fromEntries(
          (res.data.attachments || [])
            .filter((attachment) => attachment.category)
            .map((attachment) => [`mail-${attachment.index}`, attachment.category])
        ));
      })
      .catch((error) => {
        console.error(error);
        const message = error.response?.data?.message || "메일 첨부파일을 불러오지 못했습니다.";
        setAttachmentLoadError(message);
        alert(message);
      })
      .finally(() => setAttachmentsLoading(false));
  }, [location.state?.sourceMailUid, location.state?.sourceMailboxKey]);

  useEffect(() => {
    if (!location.state?.folderId) return;
    api.get(`/api/folder/${location.state.folderId}/attachment-categories`)
      .then((res) => setAttachmentCategories((current) => [...new Set([...current, ...(res.data.categories || [])])]))
      .catch((error) => console.error(error));
  }, [location.state?.folderId]);

  const addAttachmentCategory = () => {
    const category = newAttachmentCategory.trim();
    if (!category || attachmentCategories.includes(category)) {
      setNewAttachmentCategory("");
      return;
    }

    const nextCategories = [...attachmentCategories, category];
    setAttachmentCategories(nextCategories);
    setNewAttachmentCategory("");
  };

  const saveAttachmentCategories = async () => {
    try {
      const response = await api.put("/api/documents/attachment-categories", { categories: attachmentCategories });
      setAttachmentCategories(response.data.categories || []);
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "분류 항목을 저장하지 못했습니다.");
      return;
    }

    if (location.state?.folderId) {
      try {
        const response = await api.put(`/api/folder/${location.state.folderId}/attachment-categories`, { categories: attachmentCategories });
        setAttachmentCategories(response.data.categories || []);
      } catch (error) {
        console.error(error);
        alert(error.response?.data?.message || "분류 항목을 저장하지 못했습니다.");
        return;
      }
    }
    setShowCategorySettings(false);
  };

  const renderCategorySelect = (classificationKey) => (
    <select
      value={attachmentClassifications[classificationKey] || ""}
      onChange={(event) => setAttachmentClassifications((current) => ({ ...current, [classificationKey]: event.target.value }))}
      className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">분류 선택</option>
      {attachmentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
    </select>
  );

  const buildAttachmentNames = () => {
    if (!attachmentInfo) return [];

    const usedNames = new Set();
    return attachmentInfo.attachments.map((attachment, index) => {
      const dotIndex = attachment.originalName.lastIndexOf(".");
      const hasExtension = dotIndex > 0;
      const extension = hasExtension ? attachment.originalName.slice(dotIndex) : "";
      const originalBaseName = hasExtension
        ? attachment.originalName.slice(0, dotIndex)
        : attachment.originalName;
      const date = attachmentInfo.mailDate
        ? new Date(attachmentInfo.mailDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      let baseName = attachmentInfo.attachmentNameTemplate
        .replaceAll("{{폴더이름}}", attachmentInfo.folderName || "")
        .replaceAll("{{메일제목}}", attachmentInfo.mailSubject || "")
        .replaceAll("{{문서제목}}", title || "")
        .replaceAll("{{기안번호}}", documentType === "지출 문서" ? "기안번호-저장후생성" : "")
        .replaceAll("{{기안제목}}", title || "")
        .replaceAll("{{날짜}}", date)
        .replaceAll("{{원본파일명}}", originalBaseName)
        .replaceAll("{{순번}}", String(index + 1))
        // 파일명에 사용할 수 없는 Windows 제어문자까지 함께 정리한다.
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .trim();

      if (!baseName) baseName = originalBaseName || `attachment-${index + 1}`;
      let fileName = `${baseName}${extension}`;
      if (usedNames.has(fileName.toLowerCase())) {
        fileName = `${baseName}_${index + 1}${extension}`;
      }
      usedNames.add(fileName.toLowerCase());

      return { ...attachment, fileName };
    });
  };

  const submitDocument = async () => {

    if (location.state?.sourceMailUid && (attachmentsLoading || !attachmentInfo)) {
      if (attachmentLoadError) {
        alert(`메일 첨부파일 정보를 불러오지 못해 결재를 요청할 수 없습니다.\n${attachmentLoadError}`);
        return;
      }
      alert("메일 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }

    if (!title || !content) {
      alert("제목과 내용을 입력하세요.");
      return;
    }

    if (documentType === "지출 문서" && (!amount || Number(amount) <= 0)) {
      alert("결제 금액을 입력하세요.");
      return;
    }

    setSubmitting(true);
    try {
      const uploadedAttachments = [];
      for (let index = 0; index < localFiles.length; index += 1) {
        const file = localFiles[index];
        const response = await api.post(
          "/api/documents/attachments/upload",
          file,
          {
            headers: {
              "Content-Type": "application/octet-stream",
              "X-File-Name": encodeURIComponent(file.name),
              "X-File-Content-Type": file.type || "application/octet-stream"
            }
          }
        );
        uploadedAttachments.push({
          ...response.data,
          category: attachmentClassifications[`local-${index}`] || ""
        });
      }

      await api.post("/api/documents", {
        title,
        content,
        author,
        requesterUserId: user?.id || null,
        requesterPosition: user?.position || "",
        type: documentType,
        amount: documentType === "지출 문서" ? Number(amount) : null,
        folderId: location.state?.folderId || null,
        sourceMailUid: location.state?.sourceMailUid || null,
        sourceMailboxKey: location.state?.sourceMailboxKey || "primary",
        attachmentCategories,
        attachments: [...buildAttachmentNames().map((attachment) => ({
          sourceIndex: attachment.index,
          originalName: attachment.originalName,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          size: attachment.size,
          source: "mail",
          category: attachmentClassifications[`mail-${attachment.index}`] || ""
        })), ...existingAttachments, ...uploadedAttachments]
      });

      alert("결재 요청 완료");
      navigate(location.state?.returnTo || "/dashboard");
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "결재 요청에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };


  return (

    <div className="
      min-h-screen
      bg-zinc-100
    ">
      <Sidebar />
      {/* Content */}
      <main className="
         ml-64
      p-8
      ">
        <div className="
  relative
  flex
  justify-end
  items-center
  mb-8
  
">
          <h2 className="
    absolute
    left-1/2
    -translate-x-1/2
    text-3xl
    font-bold

  ">
            문서 작성
          </h2>




        </div>

        <div className="
          bg-white
          rounded-xl
          shadow
          p-8
        ">
          {/* 문서 정보 */}

          <h3 className="
            text-xl
            font-bold
            mb-5
          ">
            문서 정보
          </h3>


          <div className="
            grid
            grid-cols-2
            gap-5
            mb-8
          ">


            <div>

              <label className="
                block
                text-sm
                mb-2
                text-zinc-600
              ">
                문서 종류
              </label>


              <select
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value);
                  if (event.target.value !== "지출 문서") setAmount("");
                }}
                className="
                  w-full
                  border
                  rounded-lg
                  px-4
                  py-3
                "
              >

                <option>
                  일반 문서
                </option>

                <option>
                  휴가 신청
                </option>

                <option>
                  구매 요청
                </option>

                <option>
                  지출 문서
                </option>

              </select>

            </div>



            <div>

              <label className="
                block
                text-sm
                mb-2
                text-zinc-600
              ">
                작성자
              </label>


              <input
                value={author}
                readOnly
                className="
        w-full
        border
        rounded-lg
        px-4
        py-3
        bg-zinc-100
    "
              />

            </div>

            {documentType === "지출 문서" && (
              <div>
                <label className="mb-2 block text-sm text-zinc-600">
                  결제 금액
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="금액을 입력하세요"
                    className="w-full rounded-lg border px-4 py-3 pr-12"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
                    원
                  </span>
                </div>
              </div>
            )}


          </div>






          <div className="
            hidden
            flex
            gap-4
            mb-8
          ">

            {
              ["작성자", "팀장", "부서장"].map((item) => (

                <div
                  key={item}
                  className="
                    border
                    rounded-lg
                    px-6
                    py-4
                    text-center
                  "
                >

                  <p className="
                    text-sm
                    text-zinc-500
                  ">
                    {item}
                  </p>


                  <p className="
                    mt-2
                    font-bold
                  ">
                    대기
                  </p>


                </div>

              ))
            }


          </div>







          {/* 내용 */}

          <h3 className="
            text-xl
            font-bold
            mb-5
          ">
            내용
          </h3>


          <input

            className="
              w-full
              border
              rounded-lg
              px-4
              py-3
              mb-4
            "

            placeholder="제목"

            value={title}

            onChange={(e) => setTitle(e.target.value)}

          />



          <textarea

            className="
              w-full
              h-64
              border
              rounded-lg
              px-4
              py-3
              resize-none
            "

            placeholder="문서 내용을 입력하세요."

            value={content}

            onChange={(e) => setContent(e.target.value)}

          />







          {/* 첨부 */}

          <div className="
            mt-6
            border
            border-dashed
            rounded-lg
            p-5
            text-center
            text-zinc-500
          ">

            <div className="mb-4 flex items-center justify-center gap-3">
              <h3 className="text-lg font-bold text-zinc-800">첨부파일</h3>
              <button type="button" onClick={() => setShowCategorySettings(true)} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50">
                분류 설정
              </button>
              <label className="cursor-pointer rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
                파일 직접 첨부
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files || []);
                    setLocalFiles((current) => [...current, ...selectedFiles]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="mb-4 text-xs text-zinc-400">파일당 최대 25MB · 실행 파일(exe, bat, cmd, ps1 등)은 첨부할 수 없습니다.</p>

            {attachmentsLoading ? (
              <p>메일 첨부파일을 불러오는 중...</p>
            ) : attachmentLoadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
                <p className="font-medium">첨부파일 정보를 불러오지 못했습니다.</p>
                <p className="mt-1">결재를 요청하려면 문서 작성 화면을 다시 열어주세요.</p>
              </div>
            ) : buildAttachmentNames().length > 0 ? (
              <div className="space-y-3 text-left">
                <p className="font-bold text-zinc-700">메일 첨부파일</p>
                {buildAttachmentNames().map((attachment) => (
                  <div key={attachment.index} className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-800 [overflow-wrap:anywhere]">{attachment.fileName}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        원본: {attachment.originalName} · {(attachment.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    {renderCategorySelect(`mail-${attachment.index}`)}
                    <button
                      type="button"
                      onClick={() => window.open(
                        apiUrl(`/api/mail/${attachmentInfo.sourceMailUid}/attachments/${attachment.index}/preview?mailboxKey=${encodeURIComponent(location.state.sourceMailboxKey || "primary")}`),
                        "_blank",
                        "noopener,noreferrer"
                      )}
                      className="shrink-0 cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
                    >
                      미리보기
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p>첨부된 파일이 없습니다.</p>
            )}

            {localFiles.length > 0 && (
              <div className="mt-4 space-y-3 text-left">
                <p className="font-bold text-zinc-700">직접 첨부파일</p>
                {localFiles.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-4 rounded-lg bg-blue-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-800 [overflow-wrap:anywhere]">{file.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    {renderCategorySelect(`local-${index}`)}
                    <button
                      type="button"
                      onClick={() => setLocalFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                      className="cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}

            {existingAttachments.length > 0 && (
              <div className="mt-4 space-y-3 text-left">
                <p className="font-bold text-zinc-700">회수 문서 첨부파일</p>
                {existingAttachments.map((attachment, index) => (
                  <div key={`${attachment.storedName || attachment.fileName}-${index}`} className="flex items-center justify-between gap-4 rounded-lg bg-blue-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-800 [overflow-wrap:anywhere]">{attachment.fileName || attachment.originalName}</p>
                      {attachment.category && <p className="mt-1 text-xs text-blue-600">분류: {attachment.category}</p>}
                    </div>
                    <button type="button" onClick={() => setExistingAttachments((current) => current.filter((_, attachmentIndex) => attachmentIndex !== index))} className="rounded-lg border bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50">삭제</button>
                  </div>
                ))}
              </div>
            )}

          </div>







          {/* 버튼 */}

          <div className="
            flex
            justify-end
            gap-3
            mt-8
          ">


            <button

              type="button"

              className="
                px-6
                py-3
                rounded-lg
                border
                hover:bg-zinc-100
              "

            >

              임시저장

            </button>



            <button

              onClick={submitDocument}
              disabled={submitting || attachmentsLoading || Boolean(location.state?.sourceMailUid && !attachmentInfo)}

              className="
                px-6
                py-3
                rounded-lg
                bg-blue-600
                hover:bg-blue-700
                text-white
                transition disabled:cursor-not-allowed disabled:opacity-50
              "

            >

              {submitting ? "업로드 및 요청 중..." : attachmentsLoading ? "첨부파일 확인 중..." : "결재 요청"}

            </button>


          </div>



        </div>


      </main>

      {showCategorySettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setShowCategorySettings(false)}>
          <section className="w-full max-w-lg rounded-xl bg-white p-6 text-left shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-xl font-bold">첨부파일 분류 설정</h3>
            <p className="mt-1 text-sm text-zinc-500">첨부파일에서 선택할 분류 항목을 직접 추가하세요.</p>
            <div className="mt-5 flex gap-2">
              <input
                value={newAttachmentCategory}
                onChange={(event) => setNewAttachmentCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addAttachmentCategory();
                }}
                placeholder="예: 견적서, 세금계산서"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2"
              />
              <button type="button" onClick={addAttachmentCategory} className="rounded-lg bg-blue-600 px-4 py-2 text-white">추가</button>
            </div>
            <div className="mt-4 flex min-h-20 flex-wrap content-start gap-2 rounded-lg bg-zinc-50 p-3">
              {attachmentCategories.map((category) => (
                <button key={category} type="button" onClick={() => setAttachmentCategories((current) => current.filter((item) => item !== category))} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-red-50 hover:text-red-600">
                  {category} ×
                </button>
              ))}
              {!attachmentCategories.length && <span className="text-sm text-zinc-400">등록된 분류가 없습니다.</span>}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCategorySettings(false)} className="rounded-lg bg-zinc-100 px-4 py-2">취소</button>
              <button type="button" onClick={saveAttachmentCategories} className="rounded-lg bg-zinc-800 px-4 py-2 text-white">저장</button>
            </div>
          </section>
        </div>
      )}


    </div>

  );
}


export default Write;
