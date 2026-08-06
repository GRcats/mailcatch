import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../shared/api";
import Sidebar from "../components/Sidebar";
import { jwtDecode } from "jwt-decode";
import FolderBadge from "../components/FolderBadge";
import StatusBadge from "../components/StatusBadge";

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recentDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

function Payments() {
  const navigate = useNavigate();
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [selectedPendingFolder, setSelectedPendingFolder] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFolder, setHistoryFolder] = useState("all");
  const [recentDays, setRecentDays] = useState("7");
  const [startDate, setStartDate] = useState(() => recentDateRange(7).start);
  const [endDate, setEndDate] = useState(() => recentDateRange(7).end);
  const [historySort, setHistorySort] = useState("newest");
  const [appliedHistoryFilter, setAppliedHistoryFilter] = useState(() => ({
    search: "",
    startDate: recentDateRange(7).start,
    endDate: recentDateRange(7).end,
    sort: "newest",
    folder: "all"
  }));
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "history" ? "지급 내역" : "지급 대기";
  const showsPaidDocuments = activeTab === "지급 내역";

  useEffect(() => {
    api.get("/api/documents/payments")
      .then((response) => setDocuments(response.data))
      .catch((error) => alert(error.response?.data?.message || "지출 문서를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const completePayment = async (document) => {
    if (!confirm(`${Number(document.amount).toLocaleString("ko-KR")}원을 지급 완료 처리하시겠습니까?`)) return;

    setProcessingId(document.id);
    try {
      await api.patch(`/api/documents/${document.id}/payment`, {
        processedBy: user?.name || "",
        processedPosition: user?.position || ""
      });
      setDocuments((current) => current.map((item) => (
        item.id === document.id
          ? { ...item, paymentStatus: "지급 완료", paidAt: new Date().toISOString() }
          : item
      )));
    } catch (error) {
      alert(error.response?.data?.message || "지급 완료 처리에 실패했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  const paidFolderOptions = Object.values(documents
    .filter((document) => document.paymentStatus === "지급 완료")
    .reduce((groups, document) => {
      const key = String(document.folderId ?? "none");
      if (!groups[key]) groups[key] = { id: key, name: document.folderName || "미분류", count: 0 };
      groups[key].count += 1;
      return groups;
    }, {}))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));

  const filteredDocuments = documents.filter((document) => {
    const requiredStatus = showsPaidDocuments ? "지급 완료" : "지급 대기";
    if (document.paymentStatus !== requiredStatus) return false;
    if (activeTab !== "지급 내역") {
      return selectedPendingFolder === "all"
        || String(document.folderId ?? "none") === selectedPendingFolder;
    }

    if (appliedHistoryFilter.folder !== "all"
      && String(document.folderId ?? "none") !== appliedHistoryFilter.folder) return false;

    const keyword = appliedHistoryFilter.search.trim().toLowerCase();
    const matchesKeyword = !keyword
      || document.title.toLowerCase().includes(keyword)
      || (document.author || "").toLowerCase().includes(keyword);
    if (!document.paidAt) return false;
    const paidDate = new Date(document.paidAt);
    const matchesStartDate = !appliedHistoryFilter.startDate || paidDate >= new Date(`${appliedHistoryFilter.startDate}T00:00:00`);
    const matchesEndDate = !appliedHistoryFilter.endDate || paidDate <= new Date(`${appliedHistoryFilter.endDate}T23:59:59.999`);

    return matchesKeyword && matchesStartDate && matchesEndDate;
  }).sort((left, right) => {
    if (appliedHistoryFilter.sort === "oldest") return new Date(left.paidAt) - new Date(right.paidAt);
    if (appliedHistoryFilter.sort === "amountHigh") return Number(right.amount) - Number(left.amount);
    if (appliedHistoryFilter.sort === "amountLow") return Number(left.amount) - Number(right.amount);
    return new Date(right.paidAt) - new Date(left.paidAt);
  });
  const allPendingDocuments = documents.filter((document) => document.paymentStatus === "지급 대기");
  const pendingDocuments = filteredDocuments;
  const pendingTotal = pendingDocuments
    .reduce((total, document) => total + Number(document.amount), 0);
  const pendingFolderSummaries = Object.values(allPendingDocuments.reduce((groups, document) => {
    const key = document.folderId || "none";
    if (!groups[key]) groups[key] = { folderId: key, folderName: document.folderName || "미분류", count: 0, total: 0 };
    groups[key].count += 1;
    groups[key].total += Number(document.amount);
    return groups;
  }, {})).sort((left, right) => right.total - left.total);
  const selectedPendingFolderName = selectedPendingFolder === "all"
    ? "전체"
    : pendingFolderSummaries.find((folder) => String(folder.folderId) === selectedPendingFolder)?.folderName || "미분류";
  const historyTotal = filteredDocuments.reduce((total, document) => total + Number(document.amount), 0);
  const appliedHistoryFolderName = appliedHistoryFilter.folder === "all"
    ? "전체 분류함"
    : paidFolderOptions.find((folder) => folder.id === appliedHistoryFilter.folder)?.name || "미분류";

  const applyHistorySearch = () => {
    if (startDate && endDate && startDate > endDate) {
      alert("시작일은 종료일보다 늦을 수 없습니다.");
      return;
    }
    setAppliedHistoryFilter({ search: historySearch, startDate, endDate, sort: historySort, folder: historyFolder });
  };

  const exportHistoryCsv = async () => {
    if (!filteredDocuments.length) {
      alert("저장할 지급 내역이 없습니다.");
      return;
    }
    setExporting(true);
    try {
      const folderResponse = await api.get("/api/folder/browse/local-folder");
      if (!folderResponse.data.path) return;
      const response = await api.post("/api/documents/payments/export-csv", {
        documentIds: filteredDocuments.map((document) => document.id),
        startDate: appliedHistoryFilter.startDate,
        endDate: appliedHistoryFilter.endDate,
        basePath: folderResponse.data.path
      });
      alert(`지급 자료를 저장했습니다.\n\n${response.data.targetPath}\n문서 ${response.data.documentCount}건 · 첨부파일 ${response.data.attachmentCount}개`);
    } catch (error) {
      alert(error.response?.data?.message || "지급 자료를 저장하지 못했습니다.");
    } finally { setExporting(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar />
      <main className="ml-64 min-w-0 p-5 lg:p-8">
        <div className="mb-6"><h2 className="text-3xl font-bold tracking-tight text-zinc-900">지급 관리</h2><p className="mt-2 text-sm text-zinc-500">승인된 문서의 지급 예정 금액과 처리 내역을 관리합니다.</p></div>

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex gap-2 border-b border-zinc-100 px-5 py-4 lg:px-6">
            {["지급 대기", "지급 내역"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSearchParams(tab === "지급 내역" ? { tab: "history" } : {})}
                className={`cursor-pointer rounded-lg px-4 py-2 ${activeTab === tab ? "bg-blue-600 text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "지급 대기" && (
            <section className="p-5 lg:p-6">
              <div className="rounded-xl border border-zinc-200 p-4">
                <h3 className="font-bold text-zinc-800">분류함 선택</h3>
                {pendingFolderSummaries.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPendingFolder("all")}
                      className={`rounded-lg border px-4 py-2 text-left text-sm transition ${selectedPendingFolder === "all" ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-blue-300"}`}
                    >
                      <span className="font-bold">전체</span>
                      <span className="ml-2 opacity-75">{allPendingDocuments.length}건 · {allPendingDocuments.reduce((sum, document) => sum + Number(document.amount), 0).toLocaleString("ko-KR")}원</span>
                    </button>
                    {pendingFolderSummaries.map((folder) => (
                      <button
                        key={folder.folderId}
                        type="button"
                        onClick={() => setSelectedPendingFolder(String(folder.folderId))}
                        title={folder.folderName}
                        className={`max-w-full rounded-lg border px-4 py-2 text-left text-sm transition ${selectedPendingFolder === String(folder.folderId) ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-blue-300"}`}
                      >
                        <span className="font-bold">{folder.folderName}</span>
                        <span className="ml-2 opacity-75">{folder.count}건 · {folder.total.toLocaleString("ko-KR")}원</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-8 text-center text-sm text-zinc-400">지급 대기 문서가 없습니다.</p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
                  <p className="text-sm text-zinc-500">지급 대기 · {selectedPendingFolderName}</p>
                  <p className="mt-2 text-2xl font-bold">{pendingDocuments.length}건</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                  <p className="text-sm text-blue-600">지급 예정 금액 · {selectedPendingFolderName}</p>
                  <p className="mt-2 text-2xl font-bold text-blue-700">{pendingTotal.toLocaleString("ko-KR")}원</p>
                </div>
              </div>
            </section>
          )}

          {activeTab === "지급 내역" && (
            <div className="p-5 lg:p-6">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                분류함
                <select value={historyFolder} onChange={(event) => setHistoryFolder(event.target.value)} className="w-full min-w-0 cursor-pointer rounded-lg border bg-white px-3 py-2 text-zinc-900">
                  <option value="all">전체 분류함</option>
                  {paidFolderOptions.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name} ({folder.count}건)</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                정렬
                <select value={historySort} onChange={(event) => setHistorySort(event.target.value)} className="w-full min-w-0 cursor-pointer rounded-lg border bg-white px-3 py-2 text-zinc-900">
                  <option value="newest">최근 지급일순</option>
                  <option value="oldest">오래된 지급일순</option>
                  <option value="amountHigh">금액 높은순</option>
                  <option value="amountLow">금액 낮은순</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                조회 기간
                <select
                  value={recentDays}
                  onChange={(event) => {
                    const days = event.target.value;
                    const range = recentDateRange(Number(days));
                    setRecentDays(days);
                    setStartDate(range.start);
                    setEndDate(range.end);
                  }}
                  className="w-full min-w-0 cursor-pointer rounded-lg border bg-white px-3 py-2 text-zinc-900"
                >
                  <option value="custom" disabled>직접 설정</option>
                  <option value="1">당일</option>
                  <option value="7">최근 7일</option>
                  <option value="30">최근 30일</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                시작일
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    setRecentDays("custom");
                  }}
                  className="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-zinc-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                종료일
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    setRecentDays("custom");
                  }}
                  className="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-zinc-900"
                />
              </label>
              </div>

              <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-zinc-600">
                문서명 또는 작성자
                <input
                  type="search"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyHistorySearch();
                  }}
                  placeholder="검색어 입력"
                  className="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-zinc-900"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setHistorySearch("");
                  setRecentDays("7");
                  const range = recentDateRange(7);
                  setStartDate(range.start);
                  setEndDate(range.end);
                  setHistorySort("newest");
                  setHistoryFolder("all");
                  setAppliedHistoryFilter({ search: "", startDate: range.start, endDate: range.end, sort: "newest", folder: "all" });
                }}
                className="w-full shrink-0 cursor-pointer rounded-lg border bg-white px-4 py-2 hover:bg-zinc-100 lg:w-auto"
              >
                필터 초기화
              </button>
              <button
                type="button"
                onClick={applyHistorySearch}
                className="w-full shrink-0 cursor-pointer rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 lg:w-auto"
              >
                검색
              </button>
              </div>
              </div>
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm text-blue-700">{appliedHistoryFolderName} · 조회 결과 {filteredDocuments.length}건</span>
                  <button type="button" onClick={exportHistoryCsv} disabled={!filteredDocuments.length || exporting} className="ml-3 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40">
                    {exporting ? "저장 중..." : "CSV·첨부 저장"}
                  </button>
                </div>
                <p className="text-sm text-zinc-600">
                  합계 금액 <strong className="ml-2 text-xl text-blue-700">{historyTotal.toLocaleString("ko-KR")}원</strong>
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <p className="py-12 text-center text-zinc-400">불러오는 중...</p>
          ) : (
            <div className="mx-5 mb-5 overflow-x-auto rounded-xl border border-zinc-200 lg:mx-6 lg:mb-6">
              <table className={`w-full table-fixed ${showsPaidDocuments ? "min-w-[920px]" : "min-w-[900px]"}`}>
                <thead className="bg-zinc-50/80 text-xs font-semibold text-zinc-500">
                  <tr>
                    <th className="w-36 px-4 py-3 text-left">분류함</th>
                    <th className="px-4 py-3 text-left">문서</th>
                    <th className="w-36 px-4 py-3 text-left">작성자</th>
                    <th className="w-36 px-4 py-3 text-right">지급 금액</th>
                    {showsPaidDocuments && <th className="w-48 px-4 py-3 text-center">지급일</th>}
                    <th className="w-28 px-4 py-3 text-center">상태</th>
                    {!showsPaidDocuments && <th className="w-32 px-4 py-3 text-center">처리</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((document) => (
                    <tr key={document.id} className="border-t border-zinc-100 transition hover:bg-blue-50/40">
                      <td className="px-4 py-4">
                        <FolderBadge id={document.folderId} name={document.folderName} />
                      </td>
                      <td className="min-w-0 px-4 py-4">
                        <button type="button" onClick={() => navigate(`/documents/${document.id}`)} title={document.title} className="block w-full cursor-pointer truncate text-left font-medium hover:text-blue-600">
                          {document.draftNumber && <span className="mr-2 text-xs text-blue-600">{document.draftNumber}</span>}
                          {document.title}
                        </button>
                      </td>
                      <td className="truncate px-4 py-4" title={document.author || "-"}>{document.author || "-"}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-semibold">{Number(document.amount).toLocaleString("ko-KR")}원</td>
                      {showsPaidDocuments && (
                        <td className="whitespace-nowrap px-4 py-4 text-center text-sm">
                          {document.paidAt ? new Date(document.paidAt).toLocaleString("ko-KR") : "-"}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-4 text-center">
                        <StatusBadge status={document.paymentStatus} />
                      </td>
                      {!showsPaidDocuments && (
                        <td className="whitespace-nowrap px-4 py-4 text-center">
                          <button
                            type="button"
                            disabled={processingId === document.id}
                            onClick={() => completePayment(document)}
                            className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            지급 완료
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!filteredDocuments.length && (
                    <tr><td colSpan={6} className="py-12 text-center text-zinc-400">해당하는 지출 문서가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default Payments;
