import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import api from "../shared/api";
import Sidebar from "../components/Sidebar";

function Dashboard() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1));
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });

  const roleMatches = (requiredRole, position) => {
    const groups = {
      "팀장": ["팀장", "과장", "차장"],
      "부서장": ["부서장", "부장"],
      "임원": ["임원", "이사", "상무", "전무"],
      "대표": ["대표", "대표이사"]
    };
    return requiredRole === position || groups[requiredRole]?.includes(position);
  };

  useEffect(() => {
    const canApprove = ["approver", "finance", "admin"].includes(user?.role);
    Promise.all([
      api.get("/api/documents", { params: { scope: "mine" } }),
      canApprove ? api.get("/api/documents/approval/pending") : Promise.resolve({ data: [] })
    ])
      .then(([documentResponse, approvalResponse]) => {
        setDocuments(documentResponse.data);
        setPendingApprovals(approvalResponse.data.filter((document) => {
          const currentStep = document.approvalSteps.find((step) => step.status === "결재 대기");
          return currentStep && roleMatches(currentStep.approver, user?.position);
        }));
      })
      .catch((error) => console.error(error))
      .finally(() => setLoading(false));
  }, [user?.position, user?.role]);

  const displayStatus = (document) => document.status === "승인"
    && Number(document.amount) > 0
    ? document.paymentStatus || "지급 대기"
    : document.status;
  const availableYears = [...new Set([
    new Date().getFullYear(),
    ...documents
      .filter((document) => document.createdAt)
      .map((document) => new Date(document.createdAt).getFullYear())
  ])].sort((left, right) => right - left);
  const matchesSelectedPeriod = (value) => {
    if (!value) return false;
    const date = new Date(value);
    const matchesYear = selectedYear === "all" || date.getFullYear() === Number(selectedYear);
    const matchesMonth = selectedMonth === "all" || date.getMonth() + 1 === Number(selectedMonth);
    return matchesYear && matchesMonth;
  };
  const filteredDocuments = documents.filter((document) => matchesSelectedPeriod(document.createdAt));
  const countStatus = (status) => filteredDocuments.filter((document) => displayStatus(document) === status).length;
  const recentDocuments = filteredDocuments.slice(0, 7);
  const now = new Date();
  const today = `${now.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  })} (${now.toLocaleDateString("ko-KR", { weekday: "short" })})`;

  const statusStyle = (status) => {
    if (["승인", "지급 완료", "완료"].includes(status)) return "bg-green-50 text-green-700";
    if (status === "지급 대기") return "bg-orange-50 text-orange-700";
    if (status === "반려") return "bg-red-50 text-red-700";
    return "bg-blue-50 text-blue-700";
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar />
      <main className="ml-64 p-8">
        <header className="mb-6 flex items-center justify-between border-b border-zinc-200 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-zinc-900">업무 대시보드</h2>
              <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700">
                <option value="all">전체 연도</option>
                {availableYears.map((year) => <option key={year} value={year}>{year}년</option>)}
              </select>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700">
                <option value="all">전체 월</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}월</option>)}
              </select>
            </div>
            <p className="mt-1 text-sm text-zinc-500">오늘 날짜 {today}</p>
          </div>
          <div className="text-right">
            <p className="font-medium text-zinc-800">{user?.name || "사용자"}</p>
            <p className="mt-1 text-sm text-zinc-500">{[user?.department, user?.position].filter(Boolean).join(" · ") || "소속 정보 없음"}</p>
          </div>
        </header>

        <nav className="mb-6 grid grid-cols-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {[
            ["메일함", "수신 메일 확인", "/mail"],
            ["문서함", `${filteredDocuments.length}개 문서`, "/documents"],
            ["결재 대기", `${pendingApprovals.length}건 처리`, "/approval"],
            ["지급 관리", `${countStatus("지급 대기")}건 대기`, "/payments"]
          ].map(([label, detail, path], index) => (
            <button key={path} type="button" onClick={() => navigate(path)} className={`px-5 py-4 text-left hover:bg-blue-50 ${index ? "border-l border-zinc-100" : ""}`}>
              <span className="block font-semibold text-zinc-800">{label}</span>
              <span className="mt-1 block text-xs text-zinc-400">{detail}</span>
            </button>
          ))}
        </nav>

        <section className="mb-6 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-6 py-4">
            <h3 className="font-bold text-zinc-900">내 결재 현황</h3>
          </div>
          <div
            className="divide-x divide-zinc-100 py-5"
            style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", width: "100%" }}
          >
                {[
                  ["전체", filteredDocuments.length, "text-zinc-900"],
                  ["결재 대기", countStatus("결재 대기"), "text-blue-600"],
                  ["승인", countStatus("승인"), "text-green-600"],
                  ["반려", countStatus("반려"), "text-red-600"],
                  ["지급 대기", countStatus("지급 대기"), "text-orange-600"],
                  ["지급 완료", countStatus("지급 완료"), "text-green-700"]
                ].map(([label, count, color]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => navigate(["지급 대기", "지급 완료"].includes(label) ? "/payments" : "/documents")}
                    className="min-w-0 text-center hover:bg-zinc-50"
                    style={{ flex: "1 1 16.666%" }}
                  >
                    <span className={`block text-2xl font-bold ${color}`}>{count}</span>
                    <span className="mt-1 block text-sm text-zinc-500">{label}</span>
                  </button>
                ))}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
                <h3 className="font-bold text-zinc-900">최근 작성 문서</h3>
                <button type="button" onClick={() => navigate("/documents")} className="text-sm text-zinc-500 hover:text-blue-600">더보기</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr><th className="w-[48%] px-6 py-3 text-left font-medium">제목</th><th className="w-[18%] text-left font-medium">유형</th><th className="w-[17%] text-center font-medium">상태</th><th className="w-[17%] pr-6 text-center font-medium">작성일</th></tr>
                  </thead>
                  <tbody>
                    {recentDocuments.map((document) => {
                      const status = displayStatus(document);
                      return (
                        <tr key={document.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                          <td className="px-6 py-3.5"><button type="button" onClick={() => navigate(`/documents/${document.id}`)} className="block w-full truncate text-left font-medium hover:text-blue-600">{document.title}</button></td>
                          <td className="truncate pr-3 text-zinc-500">{document.type}</td>
                          <td className="text-center"><span className={`rounded px-2.5 py-1 text-xs ${statusStyle(status)}`}>{status}</span></td>
                          <td className="pr-6 text-center text-zinc-400">{document.createdAt ? new Date(document.createdAt).toLocaleDateString("ko-KR") : "-"}</td>
                        </tr>
                      );
                    })}
                    {!loading && !recentDocuments.length && <tr><td colSpan="4" className="py-14 text-center text-zinc-400">작성한 문서가 없습니다.</td></tr>}
                    {loading && <tr><td colSpan="4" className="py-14 text-center text-zinc-400">불러오는 중...</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <h3 className="font-bold text-zinc-900">내가 결재할 문서</h3>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{pendingApprovals.length}건</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {pendingApprovals.slice(0, 6).map((document) => (
                <button key={document.id} type="button" onClick={() => navigate(`/documents/${document.id}`)} className="block w-full px-5 py-4 text-left hover:bg-zinc-50">
                  <p className="truncate font-medium text-zinc-800">{document.title}</p>
                  <p className="mt-1.5 truncate text-xs text-zinc-400">{document.author || "작성자 없음"} · {document.requesterPosition || "직급 미설정"}</p>
                  <p className="mt-1 text-xs text-zinc-400">{new Date(document.createdAt).toLocaleDateString("ko-KR")}</p>
                </button>
              ))}
              {!loading && !pendingApprovals.length && <p className="px-5 py-14 text-center text-sm text-zinc-400">처리할 결재 문서가 없습니다.</p>}
              {loading && <p className="px-5 py-14 text-center text-sm text-zinc-400">불러오는 중...</p>}
            </div>
            {pendingApprovals.length > 0 && <button type="button" onClick={() => navigate("/approval")} className="w-full border-t border-zinc-100 py-3 text-sm text-blue-600 hover:bg-blue-50">결재 대기함으로 이동</button>}
          </aside>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
