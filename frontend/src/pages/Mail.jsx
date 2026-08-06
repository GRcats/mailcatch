import { useEffect, useState } from "react";
import api from "../shared/api";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import MailSettingsModal from "../components/MailSettingsModal";

const localDateKey = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

function Mail() {

  const navigate = useNavigate();
  const legacyCleanupModalEnabled = Boolean(import.meta.env.VITE_LEGACY_MAIL_CLEANUP_MODAL);

  const [mails, setMails] = useState([]);
  const [mailAccounts, setMailAccounts] = useState([]);
  const [selectedMailbox, setSelectedMailbox] = useState(() => localStorage.getItem("selectedMailboxKey") || "primary");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [selectedMails, setSelectedMails] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(() =>
    localStorage.getItem(`mailLastAutoRefreshDate:${localStorage.getItem("selectedMailboxKey") || "primary"}`) !== localDateKey()
  );
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() =>
    localStorage.getItem("mailLastRefreshedAt")
  );
  const [showCleanup, setShowCleanup] = useState(false);
  const [storageStats, setStorageStats] = useState(null);
  const [retentionDays, setRetentionDays] = useState("365");
  const [cleanupScope, setCleanupScope] = useState("unclassified");
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  };

  const loadStorageStats = () => api.get("/api/settings/storage")
    .then((res) => setStorageStats(res.data))
    .catch((error) => console.error(error));

  const openCleanup = () => {
    setCleanupPreview(null);
    setShowCleanup(true);
  };

  const previewCleanup = async () => {
    try {
      const res = await api.get("/api/settings/storage/cleanup-preview", { params: { days: retentionDays, scope: cleanupScope } });
      setCleanupPreview(res.data);
    } catch (error) {
      alert(error.response?.data?.message || "삭제 대상 확인에 실패했습니다.");
    }
  };

  const cleanupOldMails = async () => {
    if (!cleanupPreview?.count) return;
    const scopeLabel = cleanupScope === "all" ? "전체 메일(문서 연결 메일 포함)" : "미분류 메일";
    if (!confirm(`${cleanupPreview.count}개의 오래된 ${scopeLabel} 데이터를 삭제하시겠습니까? 작성된 문서는 유지되지만 삭제된 원본 메일은 복구할 수 없습니다.`)) return;
    setCleaning(true);
    try {
      const res = await api.post("/api/settings/storage/cleanup", { days: retentionDays, scope: cleanupScope, confirmation: "DELETE" });
      alert(`${res.data.deletedCount}개의 메일을 삭제했습니다.`);
      setCleanupPreview(null);
      await Promise.all([loadStorageStats(), loadMails()]);
    } catch (error) {
      alert(error.response?.data?.message || "오래된 메일 삭제에 실패했습니다.");
    } finally {
      setCleaning(false);
    }
  };

  const loadMails = async (mailboxKey = selectedMailbox) => {
    const res = await api.get("/api/mail", { params: { mailboxKey } });
    setMails(res.data);
  };

  const refreshMails = async (silent = false) => {
    setRefreshing(true);

    try {
      const savedDays = Number(localStorage.getItem("mailSyncDays"));
      const days = Number.isInteger(savedDays) && savedDays >= 1 ? savedDays : 30;
      const res = await api.post("/api/mail/sync", { days, mailboxKey: selectedMailbox });
      setMails(res.data);
      setPage(1);
      const refreshedAt = new Date().toISOString();
      localStorage.setItem("mailLastRefreshedAt", refreshedAt);
      localStorage.setItem(`mailLastAutoRefreshDate:${selectedMailbox}`, localDateKey());
      setLastRefreshedAt(refreshedAt);
      return true;
    } catch (err) {
      console.error(err);
      if (!silent) alert("메일 새로고침에 실패했습니다.");
      return false;
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };


  const startIndex = (page - 1) * pageSize;

  const filteredMails = mails;

  const statusStyle = (status) => {
    if (["승인", "완료"].includes(status)) return "bg-green-100 text-green-700";
    if (status === "지급 완료") return "bg-green-100 text-green-700";
    if (status === "지급 대기") return "bg-orange-100 text-orange-700";
    if (status === "반려") return "bg-red-100 text-red-700";
    if (["검토 중", "결재 대기"].includes(status)) return "bg-yellow-100 text-yellow-700";
    return "bg-zinc-100 text-zinc-600";
  };


  const currentMails = filteredMails.slice(
    startIndex,
    startIndex + pageSize
  );

  // ▼ 여기 추가
  const pageCount = Math.ceil(filteredMails.length / pageSize);

  const pageGroup = 10;

  const currentGroup = Math.ceil(page / pageGroup);

  const startPage = (currentGroup - 1) * pageGroup + 1;

  const endPage = Math.min(
    startPage + pageGroup - 1,
    pageCount
  );



  const moveSelected = async () => {

    if (!folderId) {
      alert("폴더를 선택하세요.");
      return;
    }

    await api.post(
      "/api/mail/move-folder",
      {
        mailIds: selectedMails,
        folderId,
        mailboxKey: selectedMailbox
      }
    );

    setSelectedMails([]);
    setFolderId("");
    await loadMails();

  };

  useEffect(() => {
    api.get("/api/settings/shared-mail-accounts")
      .then((res) => {
        setMailAccounts(res.data);
        if (!res.data.some((account) => account.key === selectedMailbox) && res.data.length) {
          setSelectedMailbox(res.data[0].key);
        }
      })
      .catch((error) => console.error(error));
  }, [selectedMailbox]);

  useEffect(() => {
    if (!mailAccounts.length) return;
    const today = localDateKey();
    const refreshDateKey = `mailLastAutoRefreshDate:${selectedMailbox}`;
    const lastAutoRefreshDate = localStorage.getItem(refreshDateKey);

    if (lastAutoRefreshDate !== today) {
      localStorage.setItem(refreshDateKey, today);
      Promise.resolve()
        .then(() => {
          setLoading(true);
          setMails([]);
          setPage(1);
          return refreshMails(true);
        })
        .then((success) => {
          if (!success) localStorage.removeItem(refreshDateKey);
        });
      return;
    }

    Promise.resolve()
      .then(() => {
        setLoading(true);
        setMails([]);
        setPage(1);
        return loadMails();
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  // Account changes intentionally restart this fetch with the latest selected mailbox.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMailbox, mailAccounts.length]);

  useEffect(() => {

    api.get("/api/folder")
      .then(res => {
        setFolders(res.data);
      });

  }, []);

  return (

    <div className="
      min-h-screen
      bg-zinc-100
    ">

      <Sidebar />


      <main className="ml-64 min-w-0 p-5 lg:p-8">


        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">

          <div><h2 className="text-3xl font-bold tracking-tight text-zinc-900">메일함</h2><p className="mt-2 text-sm text-zinc-500">수신 메일을 확인하고 업무 분류함으로 이동할 수 있습니다.</p></div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 text-xs text-zinc-400">
              {lastRefreshedAt
                ? `마지막 새로고침: ${new Date(lastRefreshedAt).toLocaleString("ko-KR")}`
                : "아직 새로고침하지 않음"}
            </span>

            <button
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              onClick={() => refreshMails(false)}
              disabled={loading || refreshing}
            >
              {refreshing ? "가져오는 중..." : "새로고침"}
            </button>
            <button type="button" onClick={openCleanup} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50">
              메일 설정
            </button>
          </div>
        </div>

        {mailAccounts.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
            <span className="mr-1 text-sm font-medium text-zinc-600">메일 계정</span>
            {mailAccounts.map((account) => (
              <button
                key={account.key}
                type="button"
                onClick={() => {
                  localStorage.setItem("selectedMailboxKey", account.key);
                  setSelectedMailbox(account.key);
                }}
                className={`rounded-lg px-4 py-2 text-sm transition ${selectedMailbox === account.key ? "bg-blue-600 text-white shadow-sm" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
              >
                {account.label} <span className="ml-1 opacity-75">{account.username} · {account.host}</span>
              </button>
            ))}
          </div>
        )}

        {showCleanup && <MailSettingsModal onClose={() => {
          setShowCleanup(false);
          api.get("/api/settings/shared-mail-accounts").then((res) => setMailAccounts(res.data)).catch(console.error);
        }} onCleanup={loadMails} />}

        {legacyCleanupModalEnabled && showCleanup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setShowCleanup(false)}>
            <section className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="text-xl font-bold">메일 저장 공간 관리</h3><p className="mt-1 text-sm text-zinc-500">오래된 로컬 메일 데이터를 확인하고 정리합니다.</p></div>
                <button type="button" onClick={() => setShowCleanup(false)} className="rounded-lg px-3 py-2 text-zinc-400 hover:bg-zinc-100">닫기</button>
              </div>
              <div className="mt-5 grid grid-cols-4 divide-x divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
                {[["DB 사용량", formatBytes(storageStats?.databaseBytes)], ["업로드 파일 사용량", formatBytes(storageStats?.uploadBytes)], ["저장된 메일", `${storageStats?.mailCount ?? "-"}개`], ["작성 문서", `${storageStats?.documentCount ?? "-"}개`]].map(([label, value]) => (
                  <div key={label} className="px-4 py-4 text-center"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 font-bold">{value}</p></div>
                ))}
              </div>
              {storageStats?.databaseDisk && (
                <div className="mt-5 space-y-3">
                  {[
                    {
                      label: storageStats.databaseDisk.drive === storageStats.uploadDisk?.drive ? "DB·업로드 저장 드라이브" : "DB 저장 드라이브",
                      disk: storageStats.databaseDisk
                    },
                    ...(storageStats.uploadDisk && storageStats.databaseDisk.drive !== storageStats.uploadDisk.drive
                      ? [{ label: "업로드 저장 드라이브", disk: storageStats.uploadDisk }]
                      : [])
                  ].map(({ label, disk }) => (
                    <div key={label} className="rounded-xl border border-zinc-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-zinc-800">{label} <span className="text-zinc-400">({disk.drive})</span></p>
                          <p className="mt-1 text-xs text-zinc-400">확인 경로: {disk.path}</p>
                        </div>
                        <p className="text-sm text-zinc-600">사용률 <strong className="text-zinc-900">{disk.usedPercent}%</strong></p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                        <div className={`h-full rounded-full ${disk.usedPercent >= 90 ? "bg-red-500" : disk.usedPercent >= 75 ? "bg-orange-500" : "bg-blue-500"}`} style={{ width: `${Math.min(100, disk.usedPercent)}%` }} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                        <div><span className="text-zinc-400">전체 용량</span><strong className="ml-2 text-zinc-700">{formatBytes(disk.totalBytes)}</strong></div>
                        <div><span className="text-zinc-400">사용 중</span><strong className="ml-2 text-zinc-700">{formatBytes(disk.usedBytes)}</strong></div>
                        <div><span className="text-zinc-400">남은 용량</span><strong className="ml-2 text-green-700">{formatBytes(disk.freeBytes)}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-5 rounded-xl bg-zinc-50 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-medium">삭제 범위</label>
                  <select value={cleanupScope} onChange={(event) => { setCleanupScope(event.target.value); setCleanupPreview(null); }} className="rounded-lg border border-zinc-300 bg-white px-3 py-2"><option value="unclassified">미분류 메일만</option><option value="all">전체 메일(문서 연결 메일 포함)</option></select>
                  <label className="text-sm font-medium">보관 기간</label>
                  <input type="number" min="30" max="3650" value={retentionDays} onChange={(event) => { setRetentionDays(event.target.value); setCleanupPreview(null); }} className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2" />
                  <span className="text-sm">일</span>
                  <button type="button" onClick={previewCleanup} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-600">삭제 대상 확인</button>
                </div>
                {cleanupScope === "all" && <p className="mt-3 text-xs text-red-600">문서에 연결된 원본 메일도 삭제됩니다. 작성된 문서와 저장 경로의 첨부파일은 유지됩니다.</p>}
                {cleanupPreview && <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4"><p className="text-sm text-orange-800"><strong>{cleanupPreview.count}개</strong> · 예상 {formatBytes(cleanupPreview.estimatedBytes)}</p><button type="button" onClick={cleanupOldMails} disabled={cleaning || !cleanupPreview.count} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40">{cleaning ? "삭제 중..." : "삭제"}</button></div>}
              </div>
              <p className="mt-4 text-xs text-zinc-400">실제 메일 서버의 받은편지함은 삭제하지 않습니다.</p>
            </section>
          </div>
        )}

        {(loading || refreshing) && (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-xl shadow text-center">

              <div className="
        w-12
        h-12
        border-4
        border-blue-500
        border-t-transparent
        rounded-full
        animate-spin
        mx-auto
      "></div>

              <p className="mt-4 font-medium text-zinc-700">
                새 메일을 가져오는 중...
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                잠시만 기다려 주세요.
              </p>

            </div>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">


          <div className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-6">


            <h3 className="text-lg font-bold text-zinc-900">
              수신 메일
            </h3>



            <div className="flex items-center gap-3 text-sm">
              <span className="
              text-zinc-500
            ">
                총 메일 수 {filteredMails.length}개  |
              </span>

              <span className="text-zinc-500">
                표시
              </span>

              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
              >

                <option value={10}>
                  10개
                </option>

                <option value={20}>
                  20개
                </option>

                <option value={50}>
                  50개
                </option>

              </select>

            </div>




          </div>




          <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">


            <thead>

              <tr className="border-b border-zinc-100 bg-zinc-50/80 text-xs font-semibold text-zinc-500">
                <th className="w-14 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    aria-label="현재 페이지 메일 전체 선택"
                    checked={currentMails.length > 0 && currentMails.every((mail) => selectedMails.includes(mail.gmail_uid))}
                    onChange={(event) => {
                      const pageIds = currentMails.map((mail) => mail.gmail_uid);
                      setSelectedMails((current) => event.target.checked
                        ? [...new Set([...current, ...pageIds])]
                        : current.filter((id) => !pageIds.includes(id)));
                    }}
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                  />
                </th>
                <th className="w-36 px-6 py-3.5">분류</th>
                <th className="w-32 px-3 py-3.5">상태</th>
                <th className="px-3 py-3.5">
                  제목
                </th>

                <th className="w-52 px-3 py-3.5">
                  보낸 사람
                </th>

                <th className="w-32 px-3 py-3.5">
                  날짜
                </th>

              </tr>

            </thead>



            <tbody>

              {currentMails.map((mail, index) => (

                <tr
                  key={index}
                  className={`border-b border-zinc-100 transition ${selectedMails.includes(mail.gmail_uid) ? "bg-blue-50 hover:bg-blue-100/70" : "hover:bg-blue-50/40"}`}
                >
                  <td className={`border-l-2 px-4 py-4 text-center ${selectedMails.includes(mail.gmail_uid) ? "border-blue-500" : "border-transparent"}`}>
                    <input
                      type="checkbox"
                      aria-label={`${mail.subject || "제목 없음"} 선택`}
                      checked={selectedMails.includes(mail.gmail_uid)}
                      onChange={(event) => {
                        const id = mail.gmail_uid;
                        setSelectedMails((current) => event.target.checked
                          ? [...new Set([...current, id])]
                          : current.filter((value) => value !== id));
                      }}
                      className="h-4 w-4 cursor-pointer accent-blue-600"
                    />
                  </td>
                  <td className="px-6 py-4">

                    {mail.folder ? (

                      <span
                        className="
                px-3
                py-1
                rounded-full
                bg-blue-100
                text-blue-700
                text-sm
            "
                      >
                        {mail.folder}
                      </span>

                    ) : (

                      <span
                        className="
                text-zinc-400
                text-sm
            "
                      >
                        미분류
                      </span>

                    )}

                  </td>
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusStyle(mail.status)}`}>
                      {mail.status || "미처리"}
                    </span>
                  </td>
                  <td className="px-3 py-4">

                    <div className="min-w-0">
                      <span
                        className="block min-w-0 cursor-pointer truncate font-semibold text-zinc-800 hover:text-blue-600"
                        onClick={() =>
                          navigate(`/mail/${startIndex + index}`, {
                            state: mail,
                          })
                        }
                      >
                        {mail.subject || "(제목 없음)"}
                      </span>

                    </div>

                  </td>

                  <td className="max-w-52 truncate pr-4 text-zinc-600" title={mail.from}>{mail.from}</td>

                  <td className="whitespace-nowrap text-zinc-500">
                    {mail.date
                      ? new Date(mail.date).toLocaleDateString()
                      : "-"}
                  </td>

                </tr>

              ))}
              {!loading && !refreshing && !currentMails.length && <tr><td colSpan="6" className="px-6 py-20 text-center"><p className="font-medium text-zinc-500">표시할 메일이 없습니다.</p><p className="mt-1 text-sm text-zinc-400">새로고침을 눌러 새 메일을 확인해 보세요.</p></td></tr>}

            </tbody>


          </table>
          </div>



          <div className="flex flex-wrap justify-center gap-1.5 border-t border-zinc-100 px-5 py-5">

            <button
              disabled={page === 1}
              onClick={() => setPage(1)}
              className="h-9 min-w-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {"<<"}
            </button>

            <button
              disabled={currentGroup === 1}
              onClick={() => setPage(startPage - 1)}
              className="h-9 min-w-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {"<"}
            </button>

            {Array.from(
              { length: endPage - startPage + 1 },
              (_, i) => startPage + i
            ).map((num) => (

              <button
                key={num}
                onClick={() => setPage(num)}
                className={`h-9 min-w-9 rounded-lg px-3 text-sm ${page === num
                  ? "bg-blue-600 font-medium text-white shadow-sm"
                  : "border border-zinc-200 bg-white hover:bg-zinc-50"
                  }`}
              >
                {num}
              </button>

            ))}

            <button
              disabled={endPage === pageCount}
              onClick={() => setPage(endPage + 1)}
              className="h-9 min-w-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {">"}
            </button>

            <button
              disabled={page === pageCount}
              onClick={() => setPage(pageCount)}
              className="h-9 min-w-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {">>"}
            </button>

          </div>

          {/* 하단 선택 바 */}

          {selectedMails.length > 0 && (

            <div
              className="
fixed
bottom-5
left-[calc(50%+8rem)]
-translate-x-1/2
bg-white
shadow-2xl
rounded-2xl
border
border-zinc-200
px-5
py-3
flex
items-center
gap-4
z-50
max-w-[calc(100vw-18rem)]
flex-wrap
"
            >

              <span className="font-bold">
                {selectedMails.length}개 선택됨
              </span>


              {/* 문서 작성 여부 */}

              <div className="flex items-center gap-2">

                <span>분류</span>

                <select
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  className="
        border
        rounded-lg
        px-3
        py-2
    "
                >

                  <option value="">
                    폴더 선택
                  </option>

                  <option value="unclassified">
                    미분류
                  </option>

                  {folders.map(folder => (
                    <option
                      key={folder.id}
                      value={folder.id}
                    >
                      {folder.name}
                    </option>
                  ))}

                </select>

              </div>


              {/* 이동 */}

              <button
                onClick={moveSelected}
                className="
        px-4
        py-2
        rounded-lg
        bg-blue-600
        text-white
        cursor-pointer
      "
              >
                이동
              </button>


              {/* 선택 해제 */}

              <button
                onClick={() => {
                  setSelectedMails([]);
                }}
                className="
        px-4
        py-2
        rounded-lg
        bg-zinc-200
        cursor-pointer
      "
              >
                선택 해제
              </button>

            </div>

          )}


        </section>


      </main>


    </div>

  );

}


export default Mail;
