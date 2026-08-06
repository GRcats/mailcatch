import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../shared/api";
import { jwtDecode } from "jwt-decode";
import Sidebar from "../components/Sidebar";

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

function Documents() {

  const navigate = useNavigate();

  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState("전체");
  const [search, setSearch] = useState("");
  const [myDocumentsOnly, setMyDocumentsOnly] = useState(false);
  const [periodPreset, setPeriodPreset] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ search: "", startDate: "", endDate: "" });
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });

  useEffect(() => {
    api.get("/api/documents")
      .then((res) => setDocuments(res.data.map((document) => ({
        ...document,
        status: ["결재 요청", "결제 요청"].includes(document.status)
          ? "결재 대기"
          : document.status
      }))))
      .catch((error) => console.error(error));
  }, []);

  const visibleDocuments = documents.filter((document) => {
    if (myDocumentsOnly && Number(document.requesterUserId) !== Number(user?.id)) return false;
    const createdAt = new Date(document.createdAt);
    if (appliedFilters.startDate && createdAt < new Date(`${appliedFilters.startDate}T00:00:00`)) return false;
    if (appliedFilters.endDate && createdAt > new Date(`${appliedFilters.endDate}T23:59:59.999`)) return false;
    return true;
  });

  const selectPeriodPreset = (value) => {
    setPeriodPreset(value);
    if (value === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    const range = recentDateRange(Number(value));
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const applyDocumentFilters = () => {
    if (startDate && endDate && startDate > endDate) {
      alert("시작일은 종료일보다 늦을 수 없습니다.");
      return;
    }
    setAppliedFilters({ search, startDate, endDate });
    setActiveTab("전체");
  };

  const preferredStatusOrder = ["결재 대기", "승인", "지급 대기", "지급 완료", "반려", "완료"];
  const documentStatus = (document) => document.status === "승인"
    && document.amount != null
    && Number(document.amount) > 0
    ? document.paymentStatus || "지급 대기"
    : document.status;
  const removedStatuses = ["결재 요청", "결제 요청", "회수"];
  const additionalStatuses = [...new Set(visibleDocuments
    .map(documentStatus)
    .filter((status) => status
      && !preferredStatusOrder.includes(status)
      && !removedStatuses.includes(status)))]
    .sort((left, right) => left.localeCompare(right, "ko"));
  const tabs = ["전체", ...preferredStatusOrder, ...additionalStatuses];

  const tabCount = (tab) => tab === "전체"
    ? visibleDocuments.length
    : visibleDocuments.filter((document) => documentStatus(document) === tab).length;

  const filteredDocuments = visibleDocuments.filter((document) => {
    const keyword = appliedFilters.search.toLowerCase();
    const matchesSearch = document.title.toLowerCase().includes(keyword)
      || (document.author || "").toLowerCase().includes(keyword);
    const matchesTab = activeTab === "전체" || documentStatus(document) === activeTab;
    return matchesSearch && matchesTab;
  });



  const statusStyle = (status) => {

    if (status === "승인")
      return "bg-green-100 text-green-700";

    if (status === "지급 완료")
      return "bg-green-100 text-green-700";

    if (status === "지급 대기")
      return "bg-orange-100 text-orange-700";

    if (status === "반려")
      return "bg-red-100 text-red-700";

    return "bg-yellow-100 text-yellow-700";

  };

  return (

    <div className="
      min-h-screen
      bg-zinc-100
    ">
      <Sidebar />

      {/* Main */}

      <main className="ml-64 min-w-0 p-5 lg:p-8">



        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

          <div>
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">문서함</h2>
            <p className="mt-2 text-sm text-zinc-500">작성한 문서와 진행 상태를 한곳에서 검색하고 확인합니다.</p>
          </div>


          <button
            onClick={() => navigate("/write")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            + 새 문서
          </button>

        </div>



        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">



          {/* Filter */}

          <div className="border-b border-zinc-100 p-5 lg:p-6">

            <label className={`mb-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm ${myDocumentsOnly ? "border-blue-300 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-600"}`}>
              <input type="checkbox" checked={myDocumentsOnly} onChange={(event) => {
                setMyDocumentsOnly(event.target.checked);
                setActiveTab("전체");
              }} />
              내가 작성한 문서
            </label>


            <div className="flex flex-wrap gap-3">

              {
                tabs.map((tab) => (

                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`
                      px-4
                      py-2
                      rounded-lg
                      hover:bg-zinc-200
                      ${activeTab === tab ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-zinc-100"}
                    `}
                  >
                    {tab}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeTab === tab ? "bg-white/20" : "bg-white"}`}>
                      {tabCount(tab)}
                    </span>
                  </button>

                ))
              }

            </div>



            <div className="mt-4 grid grid-cols-1 items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 md:grid-cols-2 xl:grid-cols-[150px_150px_150px_minmax(220px,1fr)_auto]">
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                작성 기간
                <select value={periodPreset} onChange={(event) => selectPeriodPreset(event.target.value)} className="rounded-lg border bg-white px-3 py-2 text-zinc-900">
                  <option value="all">전체 기간</option>
                  <option value="1">오늘</option>
                  <option value="7">최근 7일</option>
                  <option value="30">최근 30일</option>
                  <option value="custom" disabled>직접 설정</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                시작일
                <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => {
                  setStartDate(event.target.value);
                  setPeriodPreset("custom");
                }} className="rounded-lg border bg-white px-3 py-2 text-zinc-900" />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600">
                종료일
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => {
                  setEndDate(event.target.value);
                  setPeriodPreset("custom");
                }} className="rounded-lg border bg-white px-3 py-2 text-zinc-900" />
              </label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyDocumentFilters();
                }}
                className="w-full min-w-0 rounded-lg border bg-white px-4 py-2"
                placeholder="제목 또는 작성자 검색"
              />
              <button type="button" onClick={applyDocumentFilters} className="w-full rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 xl:w-auto">
                검색
              </button>
            </div>


          </div>







          {/* Table */}

          <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] table-fixed text-sm">


            <thead>

              <tr className="border-b border-zinc-100 bg-zinc-50/80 text-xs font-semibold text-zinc-500">

                <th className="w-[14%] py-4 text-center">
                  상태
                </th>

                <th className="w-[38%] py-4 pl-2 text-left">
                  제목
                </th>

                <th className="w-[14%] text-left">
                  작성자
                </th>

                <th className="w-[18%] text-left">
                  유형
                </th>



                <th className="w-[16%] text-center">
                  작성일
                </th>


              </tr>


            </thead>





            <tbody>


              {
                filteredDocuments.map((doc) => (


                  <tr
                    key={doc.id}
                    className="
                      border-b
                      border-zinc-100
                      last:border-b-0
                      transition
                      hover:bg-blue-50/40
                    "
                  >


                    <td className="text-center">

                      <span
                        className={`
                          px-3
                          py-1
                          rounded-full
                          text-sm
                          ${statusStyle(documentStatus(doc))}
                        `}
                      >

                        {documentStatus(doc)}

                      </span>

                    </td>

                    <td className="py-5 pl-2 pr-6 font-medium">
                      <button
                        type="button"
                        onClick={() => navigate(`/documents/${doc.id}`)}
                        className="block w-full cursor-pointer truncate text-left hover:text-blue-600"
                      >
                        {doc.draftNumber && <span className="mr-2 text-xs font-medium text-blue-600">{doc.draftNumber}</span>}
                        {doc.title}
                      </button>
                    </td>

                    <td className="pr-4 text-left text-zinc-600">
                      <div className="truncate" title={doc.author || "-"}>
                        {doc.author || "-"}
                      </div>
                    </td>


                    <td className="pr-4 text-left">

                      {doc.type}

                    </td>





                    <td className="text-center text-zinc-500">

                      {doc.createdAt
                        ? new Date(doc.createdAt).toLocaleDateString("ko-KR")
                        : "-"}

                    </td>



                  </tr>


                ))
              }

              {filteredDocuments.length === 0 && (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-zinc-400">
                    내가 작성한 문서가 없습니다.
                  </td>
                </tr>
              )}


            </tbody>


          </table>
          </div>


        </section>


      </main>


    </div>

  );

}


export default Documents;
