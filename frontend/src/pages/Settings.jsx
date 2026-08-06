import Sidebar from "../components/Sidebar";
import { useCallback, useEffect, useState } from "react";
import api, { getServerUrl, normalizeServerUrl, setServerUrl } from "../shared/api";
import { jwtDecode } from "jwt-decode";

const availableApprovalPositions = ["팀장", "부서장", "임원", "대표"];

function Settings() {
  const [user] = useState(() => {
    const token = localStorage.getItem("token");
    return token ? jwtDecode(token) : null;
  });
  const isAdmin = user?.role === "admin";
  const [syncDays, setSyncDays] = useState(() =>
    localStorage.getItem("mailSyncDays") || "30"
  );
  const [saved, setSaved] = useState(false);
  const [serverAddress, setServerAddress] = useState(() => getServerUrl());
  const [connectionStatus, setConnectionStatus] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [approvalPositions, setApprovalPositions] = useState(availableApprovalPositions);
  const [approvalSaved, setApprovalSaved] = useState(false);
  const [health, setHealth] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupPreview, setBackupPreview] = useState(null);
  const [backupPreviewLoading, setBackupPreviewLoading] = useState(false);
  const [backupPreviewType, setBackupPreviewType] = useState("mail");
  const [backupPreviewSearch, setBackupPreviewSearch] = useState("");
  const [backupPreviewPage, setBackupPreviewPage] = useState(1);
  const [selectedBackupItem, setSelectedBackupItem] = useState(null);
  const [backupPath, setBackupPath] = useState("");
  const [backupPathStatus, setBackupPathStatus] = useState("");
  const [backupPathWorking, setBackupPathWorking] = useState(false);
  const [backupIntervalHours, setBackupIntervalHours] = useState(24);
  const [backupScheduleStatus, setBackupScheduleStatus] = useState("");
  const [temporaryUploads, setTemporaryUploads] = useState(null);
  const [maintenanceWorking, setMaintenanceWorking] = useState(false);
  const [mailAccount, setMailAccount] = useState({ host: "", port: "993", secure: true, username: "", password: "" });
  const [mailAccountStatus, setMailAccountStatus] = useState(null);
  const [mailAccountWorking, setMailAccountWorking] = useState(false);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: "", password: "", name: "", department: "", position: "", role: "employee" });
  const [userCreating, setUserCreating] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [adminAccess, setAdminAccess] = useState(null);
  useEffect(() => {
    api.get("/api/settings/approval-workflow")
      .then((res) => setApprovalPositions(res.data.positions || availableApprovalPositions))
      .catch((error) => console.error(error));
  }, []);

  const loadMaintenance = useCallback(async () => {
    const [healthResult, backupResult, temporaryResult, accountResult] = await Promise.allSettled([
      api.get("/api/settings/health"),
      api.get("/api/settings/backups"),
      api.get("/api/settings/storage/temporary-uploads"),
      api.get("/api/settings/mail-account")
    ]);

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value.data);
      setBackupPath((current) => current || healthResult.value.data.backupPath || "");
      setBackupIntervalHours(healthResult.value.data.backupIntervalHours ?? 24);
    }
    else {
      console.error(healthResult.reason);
      setHealth(healthResult.reason?.response?.data || { server: "disconnected", database: "unknown" });
    }
    if (backupResult.status === "fulfilled") setBackups(backupResult.value.data.backups || []);
    else console.error(backupResult.reason);
    if (temporaryResult.status === "fulfilled") setTemporaryUploads(temporaryResult.value.data);
    else console.error(temporaryResult.reason);
    if (accountResult.status === "fulfilled") {
      const account = accountResult.value.data;
      setMailAccountStatus(account);
      if (account.account) setMailAccount((current) => ({ ...current, ...account.account, password: "" }));
    } else console.error(accountResult.reason);

    if (isAdmin) {
      try {
        const [usersResponse, accessResponse] = await Promise.all([
          api.get("/api/settings/users"),
          api.get("/api/settings/admin-access")
        ]);
        setUsers(usersResponse.data.users || []);
        setAdminAccess(accessResponse.data);
      } catch (error) { console.error(error); }
    }
  }, [isAdmin]);

  const updateUserRole = async (userId, role) => {
    try {
      await api.patch(`/api/settings/users/${userId}/role`, { role });
      setUsers((current) => current.map((item) => item.id === userId ? { ...item, role } : item));
    } catch (error) { alert(error.response?.data?.message || "사용자 역할 변경에 실패했습니다."); }
  };

  const createUser = async (event) => {
    event.preventDefault();
    if (newUser.password.length < 8) return alert("비밀번호는 8자 이상 입력하세요.");
    setUserCreating(true);
    try {
      const response = await api.post("/api/settings/users", newUser);
      setUsers((current) => [...current, response.data.user]);
      setNewUser({ username: "", password: "", name: "", department: "", position: "", role: "employee" });
      setShowUserForm(false);
      alert("계정을 추가했습니다.");
    } catch (error) {
      alert(error.response?.data?.message || "계정을 추가할 수 없습니다.");
    } finally { setUserCreating(false); }
  };

  const deleteUser = async (item) => {
    if (!confirm(`${item.name} (${item.username}) 계정을 비활성화하시겠습니까? 기존 문서와 이력은 보존됩니다.`)) return;
    try {
      await api.delete(`/api/settings/users/${item.id}`);
      setUsers((current) => current.filter((userItem) => userItem.id !== item.id));
    } catch (error) {
      alert(error.response?.data?.message || "계정을 비활성화할 수 없습니다.");
    }
  };

  const rebindAdminAccess = async () => {
    if (!confirm("현재 IP와 이 브라우저를 관리자 PC로 다시 등록하시겠습니까?")) return;
    try {
      const response = await api.put("/api/settings/admin-access/rebind");
      setAdminAccess(response.data);
      alert("현재 관리자 PC 정보를 다시 등록했습니다.");
    } catch (error) {
      alert(error.response?.data?.message || "관리자 PC 정보를 등록할 수 없습니다.");
    }
  };

  const saveMailAccount = async () => {
    if (!mailAccount.password && !mailAccountStatus?.account) return alert("메일 앱 비밀번호를 입력하세요.");
    setMailAccountWorking(true);
    try {
      await api.put("/api/settings/mail-account", mailAccount);
      await api.post("/api/settings/mail-account/test");
      await loadMaintenance();
      setMailAccount((current) => ({ ...current, password: "" }));
      alert("메일 계정을 저장하고 연결을 확인했습니다.");
    } catch (error) { alert(error.response?.data?.message || "메일 계정 저장에 실패했습니다."); }
    finally { setMailAccountWorking(false); }
  };

  const disconnectMailAccount = async () => {
    if (!confirm("개인 메일 계정 연결을 해제하시겠습니까?")) return;
    await api.delete("/api/settings/mail-account");
    setMailAccount({ host: "", port: "993", secure: true, username: "", password: "" });
    await loadMaintenance();
  };

  useEffect(() => {
    Promise.resolve().then(loadMaintenance);
  }, [loadMaintenance]);

  const createFullBackup = async () => {
    setMaintenanceWorking(true);
    try {
      await api.post("/api/settings/backups");
      await loadMaintenance();
      alert("DB와 첨부파일 전체 백업을 생성했습니다.");
    } catch (error) {
      alert(error.response?.data?.message || "백업 생성에 실패했습니다.");
    } finally {
      setMaintenanceWorking(false);
    }
  };

  const browseBackupPath = async () => {
    setBackupPathWorking(true);
    try {
      const response = await api.get("/api/folder/browse/local-folder");
      if (response.data.path) {
        setBackupPath(response.data.path);
        setBackupPathStatus("");
      }
    } catch (error) {
      alert(error.response?.data?.message || "폴더 선택 창을 열지 못했습니다.");
    } finally { setBackupPathWorking(false); }
  };

  const saveBackupPath = async () => {
    setBackupPathWorking(true);
    try {
      const response = await api.put("/api/settings/backups/path", { path: backupPath });
      setBackupPath(response.data.backupPath);
      setHealth((current) => ({ ...current, backupPath: response.data.backupPath }));
      setBackups([]);
      setBackupPathStatus("saved");
      await loadMaintenance();
    } catch (error) {
      setBackupPathStatus("error");
      alert(error.response?.data?.message || "백업 경로를 저장할 수 없습니다.");
    } finally { setBackupPathWorking(false); }
  };

  const saveBackupSchedule = async () => {
    setBackupPathWorking(true);
    setBackupScheduleStatus("");
    try {
      const response = await api.put("/api/settings/backups/schedule", { intervalHours: backupIntervalHours });
      setBackupIntervalHours(response.data.backupIntervalHours);
      setHealth((current) => ({ ...current, backupIntervalHours: response.data.backupIntervalHours }));
      setBackupScheduleStatus("saved");
    } catch (error) {
      alert(error.response?.data?.message || "백업 주기를 저장할 수 없습니다.");
    } finally { setBackupPathWorking(false); }
  };

  const restoreBackup = async (backup) => {
    if (!confirm(`${new Date(backup.createdAt).toLocaleString("ko-KR")} 백업으로 복구하시겠습니까? 현재 상태는 복구 전에 자동 백업됩니다.`)) return;
    setMaintenanceWorking(true);
    try {
      await api.post(`/api/settings/backups/${encodeURIComponent(backup.id)}/restore`, { confirmation: "RESTORE" });
      await loadMaintenance();
      alert("복구가 완료되었습니다. 화면을 새로고침해 주세요.");
    } catch (error) {
      alert(error.response?.data?.message || "백업 복구에 실패했습니다.");
    } finally {
      setMaintenanceWorking(false);
    }
  };

  const openBackupPreview = async (backup, { type = "mail", page = 1, search = "" } = {}) => {
    setBackupPreviewLoading(true);
    setSelectedBackupItem(null);
    try {
      const response = await api.get(`/api/settings/backups/${encodeURIComponent(backup.id)}/preview`, {
        params: { type, page, limit: 20, search }
      });
      setBackupPreview({ ...response.data, listEntry: backup });
      setBackupPreviewType(type);
      setBackupPreviewPage(page);
    } catch (error) {
      alert(error.response?.data?.message || "백업 내용을 불러오지 못했습니다.");
    } finally {
      setBackupPreviewLoading(false);
    }
  };

  const closeBackupPreview = () => {
    setBackupPreview(null);
    setSelectedBackupItem(null);
    setBackupPreviewSearch("");
    setBackupPreviewPage(1);
  };

  const downloadBackupAttachment = async (attachment) => {
    try {
      const response = await api.get(`/api/settings/backups/${encodeURIComponent(backupPreview.backup.id)}/attachments/${encodeURIComponent(attachment.storedName)}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName || attachment.originalName || attachment.storedName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.response?.data?.message || "백업 첨부파일을 내려받지 못했습니다.");
    }
  };

  const cleanupTemporaryUploads = async () => {
    if (!temporaryUploads?.count || !confirm(`${temporaryUploads.count}개의 연결되지 않은 임시 파일을 삭제하시겠습니까?`)) return;
    setMaintenanceWorking(true);
    try {
      await api.post("/api/settings/storage/temporary-uploads/cleanup", { confirmation: "DELETE" });
      await loadMaintenance();
    } catch (error) {
      alert(error.response?.data?.message || "임시 파일 정리에 실패했습니다.");
    } finally {
      setMaintenanceWorking(false);
    }
  };

  const saveApprovalWorkflow = async () => {
    try {
      const res = await api.put("/api/settings/approval-workflow", { positions: approvalPositions });
      setApprovalPositions(res.data.positions);
      setApprovalSaved(true);
    } catch (error) {
      alert(error.response?.data?.message || "결재선 설정 저장에 실패했습니다.");
    }
  };

  const testConnection = async () => {
    const candidate = normalizeServerUrl(serverAddress);
    setTestingConnection(true);
    setConnectionStatus("");
    try {
      await api.get(`${candidate}/`, { baseURL: "", timeout: 5000 });
      setConnectionStatus("success");
    } catch {
      setConnectionStatus("error");
    } finally {
      setTestingConnection(false);
    }
  };

  const saveServerAddress = () => {
    const savedAddress = setServerUrl(serverAddress);
    setServerAddress(savedAddress);
    setConnectionStatus("saved");
  };

  const saveSettings = () => {
    const days = Math.min(3650, Math.max(1, Number(syncDays) || 30));
    localStorage.setItem("mailSyncDays", String(days));
    setSyncDays(String(days));
    setSaved(true);
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar />

      <main className="ml-64 p-8">
        <h2 className="mb-8 text-3xl font-bold">환경설정</h2>

        <section className="mb-6 rounded-xl bg-white p-6 shadow">
          <h3 className="text-xl font-bold">대표 서버 연결</h3>
          <p className="mt-2 text-zinc-500">
            같은 사내 네트워크에서 서버로 사용할 PC의 IP 주소와 포트를 입력하세요.
          </p>

          <div className="mt-6 flex max-w-3xl flex-col gap-3 sm:flex-row">
            <input
              value={serverAddress}
              onChange={(event) => {
                setServerAddress(event.target.value);
                setConnectionStatus("");
              }}
              placeholder="예: 192.168.0.20:3000"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 py-2"
            />
            <button type="button" onClick={testConnection} disabled={testingConnection} className="rounded-lg border border-blue-200 px-4 py-2 text-blue-600 hover:bg-blue-50 disabled:opacity-50">
              {testingConnection ? "확인 중..." : "연결 테스트"}
            </button>
            <button type="button" onClick={saveServerAddress} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
              저장
            </button>
          </div>

          {connectionStatus === "success" && <p className="mt-3 text-sm text-green-600">서버에 정상적으로 연결되었습니다. 저장을 눌러 적용하세요.</p>}
          {connectionStatus === "error" && <p className="mt-3 text-sm text-red-600">서버에 연결할 수 없습니다. IP, 포트, 서버 실행 상태와 방화벽을 확인하세요.</p>}
          {connectionStatus === "saved" && <p className="mt-3 text-sm text-green-600">대표 서버 주소가 저장되었습니다.</p>}
          <p className="mt-4 text-sm text-zinc-400">서버 PC에서 확인한 IPv4 주소를 입력합니다. 같은 공유기나 사내 네트워크에 연결되어 있어야 합니다.</p>
        </section>

        <section className="mb-6 rounded-xl bg-white p-6 shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold">서버 상태와 데이터 보호</h3>
              <p className="mt-2 text-zinc-500">대표 PC 연결 상태를 확인하고 DB와 첨부파일을 함께 백업합니다.</p>
            </div>
            <button type="button" onClick={loadMaintenance} disabled={maintenanceWorking} className="rounded-lg border px-4 py-2 hover:bg-zinc-50 disabled:opacity-50">상태 새로고침</button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["대표 PC", health?.server === "connected", health?.server === "connected" ? "연결됨" : "연결 안 됨"],
              ["데이터베이스", health?.database === "connected", health?.database === "connected" ? "정상" : "확인 필요"],
              ["메일 서버", health?.mailConnected, health?.mailConnected ? "연결됨" : (health?.mailConfigured ? "연결 실패" : "설정 필요")]
            ].map(([label, ok, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm text-zinc-500">{label}</p>
                <p className={`mt-2 font-bold ${ok ? "text-green-600" : "text-red-600"}`}>{value}</p>
              </div>
            ))}
          </div>
          {health?.serverTime && <p className="mt-3 text-xs text-zinc-400">서버 시각 {new Date(health.serverTime).toLocaleString("ko-KR")} · 응답 {health.responseMs}ms · DB 버전 {health.migrationVersion}</p>}
          {health?.backupPath && <p className="mt-1 break-all text-xs text-zinc-400">백업 저장 위치: {health.backupPath}</p>}

          {isAdmin && <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4">
            <div><h4 className="font-bold text-zinc-800">백업 저장 경로</h4><p className="mt-1 text-sm text-zinc-500">대표 PC의 다른 드라이브나 접근 가능한 사내 공유 폴더를 지정할 수 있습니다.</p></div>
            <div className="mt-4 flex flex-col gap-2 lg:flex-row">
              <input value={backupPath} onChange={(event) => { setBackupPath(event.target.value); setBackupPathStatus(""); }} placeholder="예: D:\MailCatchBackup 또는 \\192.168.0.20\공유폴더\MailCatchBackup" className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm outline-none focus:border-blue-400" />
              <button type="button" onClick={browseBackupPath} disabled={backupPathWorking} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-50">{backupPathWorking ? "선택 중..." : "찾아보기"}</button>
              <button type="button" onClick={saveBackupPath} disabled={backupPathWorking || !backupPath.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">저장</button>
            </div>
            {backupPathStatus === "saved" && <p className="mt-2 text-sm text-green-600">백업 경로를 변경했습니다. 다음 백업부터 새 경로를 사용합니다.</p>}
            <p className="mt-3 text-xs text-zinc-400">기존 백업은 이전 경로에 그대로 남아 있으며 자동으로 이동하지 않습니다.</p>
            <div className="mt-5 border-t border-zinc-200 pt-4">
              <div><h4 className="font-bold text-zinc-800">자동 백업 주기</h4><p className="mt-1 text-sm text-zinc-500">서버가 실행 중일 때 선택한 간격마다 DB와 첨부파일을 자동으로 백업합니다.</p></div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select value={backupIntervalHours} onChange={(event) => { setBackupIntervalHours(Number(event.target.value)); setBackupScheduleStatus(""); }} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm">
                  <option value={0}>자동 백업 사용 안 함</option>
                  <option value={6}>6시간마다</option>
                  <option value={12}>12시간마다</option>
                  <option value={24}>매일</option>
                  <option value={72}>3일마다</option>
                  <option value={168}>매주</option>
                </select>
                <button type="button" onClick={saveBackupSchedule} disabled={backupPathWorking} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">주기 저장</button>
                {backupScheduleStatus === "saved" && <span className="text-sm text-green-600">자동 백업 주기를 저장했습니다.</span>}
              </div>
              <p className="mt-3 text-xs text-zinc-400">수동 백업을 생성하면 다음 자동 백업은 해당 시점부터 선택한 주기 후에 실행됩니다.</p>
            </div>
          </div>}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div><h4 className="font-bold">전체 백업</h4><p className="mt-1 text-sm text-zinc-500">DB와 저장된 첨부파일을 함께 보관합니다.</p></div>
                {isAdmin && <button type="button" onClick={createFullBackup} disabled={maintenanceWorking} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">백업 생성</button>}
              </div>
              <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
                {backups.slice(0, 10).map((backup) => (
                  <div key={backup.id} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                    <span>{new Date(backup.createdAt).toLocaleString("ko-KR")} <small className={backup.verified ? "text-green-600" : "text-zinc-400"}>{backup.verified ? "· 검증 완료" : backup.legacy ? "· 이전 형식" : "· 확인 필요"}</small></span>
                    {isAdmin && <span className="flex shrink-0 gap-3">
                      <button type="button" onClick={() => { setBackupPreviewSearch(""); openBackupPreview(backup); }} disabled={maintenanceWorking || backupPreviewLoading} className="text-zinc-700 disabled:opacity-40">내용 보기</button>
                      <button type="button" onClick={() => restoreBackup(backup)} disabled={maintenanceWorking} className="text-blue-600 disabled:opacity-40">복구</button>
                    </span>}
                  </div>
                ))}
                {!backups.length && <p className="py-5 text-center text-sm text-zinc-400">생성된 백업이 없습니다.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4">
              <h4 className="font-bold">임시 첨부파일 정리</h4>
              <p className="mt-1 text-sm text-zinc-500">24시간 이상 문서에 연결되지 않은 업로드 파일만 안전하게 정리합니다.</p>
              <p className="mt-5 text-2xl font-bold">{temporaryUploads?.count ?? "-"}개</p>
              <p className="mt-1 text-sm text-zinc-500">예상 확보 용량 {temporaryUploads ? `${(temporaryUploads.bytes / 1024 / 1024).toFixed(2)} MB` : "-"}</p>
              {isAdmin && <button type="button" onClick={cleanupTemporaryUploads} disabled={maintenanceWorking || !temporaryUploads?.count} className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-white disabled:opacity-40">임시 파일 정리</button>}
            </div>
          </div>
        </section>

        {isAdmin && (
          <section className="mb-6 rounded-xl bg-white p-6 shadow">
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-xl font-bold">사용자 역할 관리</h3><p className="mt-2 text-zinc-500">업무에 필요한 최소 권한만 지정하세요.</p></div>
              <button type="button" onClick={() => setShowUserForm(true)} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">계정 추가</button>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div><h4 className="font-bold text-amber-900">관리자 PC 인증</h4><p className="mt-1 text-sm text-amber-800">등록 IP: {adminAccess?.allowedIp || "미등록"} · 현재 IP: {adminAccess?.currentIp || "확인 중"}</p><p className="mt-1 text-xs text-amber-700">IP와 이 브라우저의 기기 키를 함께 검사합니다.</p></div>
              <button type="button" onClick={rebindAdminAccess} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">현재 PC 재등록</button>
            </div>
            <div className="mt-5 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-zinc-50 text-zinc-500"><tr><th className="px-4 py-3 text-left">사용자</th><th className="px-4 py-3 text-left">부서</th><th className="px-4 py-3 text-left">직급</th><th className="px-4 py-3 text-left">역할</th><th className="px-4 py-3 text-center">관리</th></tr></thead>
                <tbody>{users.map((item) => (
                  <tr key={item.id} className="border-t"><td className="px-4 py-3">{item.name} <span className="text-zinc-400">({item.username})</span></td><td className="px-4 py-3">{item.department || "-"}</td><td className="px-4 py-3">{item.position || "-"}</td><td className="px-4 py-3"><select value={item.role} onChange={(event) => updateUserRole(item.id, event.target.value)} disabled={item.role === "admin"} className="rounded-lg border bg-white px-3 py-2 disabled:bg-zinc-100"><option value="employee">일반 사용자</option><option value="approver">결재자</option><option value="finance">지급 담당자</option>{item.role === "admin" && <option value="admin">관리자</option>}</select></td><td className="px-4 py-3 text-center">{item.role === "admin" ? <span className="text-xs text-zinc-400">비활성화 불가</span> : <button type="button" onClick={() => deleteUser(item)} className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">비활성화</button>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        <section className="hidden">
          <h3 className="text-xl font-bold">회사 결재선</h3>
          <p className="mt-2 text-zinc-500">회사에서 사용하는 결재 직급을 선택하세요. 순서는 자동으로 유지됩니다.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {availableApprovalPositions.map((position, index) => (
              <div key={position} className="flex items-center gap-3">
                <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 ${approvalPositions.includes(position) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-400"}`}>
                  <input
                    type="checkbox"
                    checked={approvalPositions.includes(position)}
                    onChange={(event) => {
                      setApprovalSaved(false);
                      setApprovalPositions((current) => event.target.checked
                        ? availableApprovalPositions.filter((item) => current.includes(item) || item === position)
                        : current.filter((item) => item !== position));
                    }}
                  />
                  {position}
                </label>
                {index < availableApprovalPositions.length - 1 && <span className="text-zinc-300">→</span>}
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            {isAdmin && <button type="button" onClick={saveApprovalWorkflow} disabled={!approvalPositions.length} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-40">결재선 저장</button>}
            {approvalSaved && <span className="text-sm text-green-600">결재선이 저장되었습니다.</span>}
          </div>
          <p className="mt-4 text-sm text-zinc-400">예: 부서장과 임원을 해제하면 팀장 → 대표 순서로 결재됩니다. 변경 사항은 새로 작성하는 문서부터 적용됩니다.</p>
        </section>

        <section className="hidden">
          <h3 className="text-xl font-bold">내 메일 계정</h3>
          <p className="mt-2 text-zinc-500">사용자별 IMAP 계정을 연결합니다. 비밀번호는 암호화되어 저장되고 화면에 다시 표시되지 않습니다.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_110px_1fr_1fr]">
            <label className="text-sm text-zinc-600">메일 서버<input value={mailAccount.host} onChange={(event) => setMailAccount((current) => ({ ...current, host: event.target.value }))} placeholder="imap.example.com" className="mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900" /></label>
            <label className="text-sm text-zinc-600">포트<input type="number" value={mailAccount.port} onChange={(event) => setMailAccount((current) => ({ ...current, port: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900" /></label>
            <label className="text-sm text-zinc-600">메일 아이디<input value={mailAccount.username} onChange={(event) => setMailAccount((current) => ({ ...current, username: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900" /></label>
            <label className="text-sm text-zinc-600">앱 비밀번호<input type="password" value={mailAccount.password} onChange={(event) => setMailAccount((current) => ({ ...current, password: event.target.value }))} placeholder={mailAccountStatus?.account ? "변경할 때만 입력" : "앱 비밀번호"} className="mt-1 w-full rounded-lg border px-3 py-2 text-zinc-900" /></label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={mailAccount.secure} onChange={(event) => setMailAccount((current) => ({ ...current, secure: event.target.checked }))} />보안 연결 사용</label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={saveMailAccount} disabled={mailAccountWorking} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{mailAccountWorking ? "연결 확인 중..." : "저장 및 연결 테스트"}</button>
            {mailAccountStatus?.account && <button type="button" onClick={disconnectMailAccount} className="rounded-lg border px-4 py-2 text-red-600 hover:bg-red-50">연결 해제</button>}
            <span className="text-sm text-zinc-500">{mailAccountStatus?.account ? `개인 계정 연결됨${mailAccountStatus.account.lastSyncAt ? ` · 최근 동기화 ${new Date(mailAccountStatus.account.lastSyncAt).toLocaleString("ko-KR")}` : ""}` : mailAccountStatus?.usingSharedAccount ? "공용 메일 계정 사용 중" : "메일 계정 미설정"}</span>
          </div>
        </section>

        <section className="hidden">
          <h3 className="text-xl font-bold">메일 가져오기</h3>
          <p className="mt-2 text-zinc-500">
            새로고침할 때 최근 몇 일 동안의 메일을 확인할지 설정합니다.
          </p>

          <div className="mt-6 flex items-center gap-3">
            <label htmlFor="mail-sync-days" className="font-medium">
              조회 기간
            </label>
            <input
              id="mail-sync-days"
              type="number"
              min="1"
              max="3650"
              value={syncDays}
              onChange={(event) => {
                setSyncDays(event.target.value);
                setSaved(false);
              }}
              className="w-28 rounded-lg border border-zinc-300 px-3 py-2"
            />
            <span className="text-zinc-600">일</span>
            <button
              type="button"
              onClick={saveSettings}
              className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
            >
              저장
            </button>
          </div>

          {saved && (
            <p className="mt-3 text-sm text-green-600">설정이 저장되었습니다.</p>
          )}

          <p className="mt-4 text-sm text-zinc-400">
            기본값은 최근 30일이며, 이미 저장된 메일은 삭제되지 않습니다.
          </p>
        </section>
      </main>

      {showUserForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowUserForm(false); }}>
          <form onSubmit={createUser} className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-xl font-bold">계정 추가</h3><p className="mt-1 text-sm text-zinc-500">관리자 권한을 제외한 새 사내 계정을 등록합니다.</p></div>
              <button type="button" onClick={() => setShowUserForm(false)} className="rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-100">닫기</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <input required autoFocus value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} placeholder="아이디" className="rounded-lg border px-3 py-2" />
              <input required type="password" minLength={8} value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} placeholder="비밀번호 (8자 이상)" className="rounded-lg border px-3 py-2" />
              <input required value={newUser.name} onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))} placeholder="이름" className="rounded-lg border px-3 py-2" />
              <input value={newUser.department} onChange={(event) => setNewUser((current) => ({ ...current, department: event.target.value }))} placeholder="부서" className="rounded-lg border px-3 py-2" />
              <input value={newUser.position} onChange={(event) => setNewUser((current) => ({ ...current, position: event.target.value }))} placeholder="직급" className="rounded-lg border px-3 py-2" />
              <select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))} className="rounded-lg border bg-white px-3 py-2"><option value="employee">일반 사용자</option><option value="approver">결재자</option><option value="finance">지급 담당자</option></select>
            </div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowUserForm(false)} className="rounded-lg border px-4 py-2 text-zinc-600">취소</button><button disabled={userCreating} className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50">{userCreating ? "추가 중..." : "계정 추가"}</button></div>
          </form>
        </div>
      )}

      {backupPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeBackupPreview(); }}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div>
                <h3 className="text-xl font-bold">백업 내용</h3>
                <p className="mt-1 text-sm text-zinc-500">{new Date(backupPreview.backup.createdAt || backupPreview.listEntry.createdAt).toLocaleString("ko-KR")} · 읽기 전용</p>
              </div>
              <button type="button" onClick={closeBackupPreview} className="rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-100">닫기</button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b bg-zinc-50 px-6 py-4 sm:grid-cols-4">
              <div><p className="text-xs text-zinc-500">메일</p><p className="font-bold">{backupPreview.counts.mail.toLocaleString()}건</p></div>
              <div><p className="text-xs text-zinc-500">문서</p><p className="font-bold">{backupPreview.counts.documents.toLocaleString()}건</p></div>
              <div><p className="text-xs text-zinc-500">사용자</p><p className="font-bold">{backupPreview.counts.users.toLocaleString()}명</p></div>
              <div><p className="text-xs text-zinc-500">폴더</p><p className="font-bold">{backupPreview.counts.folders.toLocaleString()}개</p></div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
              {[['mail', '메일'], ['documents', '문서']].map(([type, label]) => (
                <button key={type} type="button" onClick={() => openBackupPreview(backupPreview.listEntry, { type, page: 1, search: backupPreviewSearch })} className={`rounded-lg px-4 py-2 text-sm ${backupPreviewType === type ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700"}`}>{label}</button>
              ))}
              <form className="ml-auto flex min-w-0 flex-1 gap-2 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); openBackupPreview(backupPreview.listEntry, { type: backupPreviewType, page: 1, search: backupPreviewSearch }); }}>
                <input value={backupPreviewSearch} onChange={(event) => setBackupPreviewSearch(event.target.value)} placeholder={backupPreviewType === "mail" ? "제목, 발신자, 본문 검색" : "제목, 작성자, 내용 검색"} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
                <button type="submit" className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white">검색</button>
              </form>
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.4fr)]">
              <div className="overflow-y-auto border-r">
                {backupPreviewLoading && <p className="p-6 text-center text-zinc-500">불러오는 중...</p>}
                {!backupPreviewLoading && backupPreview.rows.map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedBackupItem(item)} className={`block w-full border-b px-5 py-4 text-left hover:bg-blue-50 ${selectedBackupItem?.id === item.id ? "bg-blue-50" : ""}`}>
                    <p className="font-medium text-zinc-900">{backupPreviewType === "mail" ? item.subject : item.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{backupPreviewType === "mail" ? item.sender : `${item.author || "작성자 없음"} · ${item.status}`}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-500">{backupPreviewType === "mail" ? item.bodyPreview : item.contentPreview}</p>
                  </button>
                ))}
                {!backupPreviewLoading && !backupPreview.rows.length && <p className="p-8 text-center text-sm text-zinc-400">표시할 내용이 없습니다.</p>}
              </div>

              <div className="overflow-y-auto p-6">
                {selectedBackupItem ? <>
                  <h4 className="text-xl font-bold">{backupPreviewType === "mail" ? selectedBackupItem.subject : `${selectedBackupItem.draftNumber ? `${selectedBackupItem.draftNumber} · ` : ""}${selectedBackupItem.title}`}</h4>
                  <p className="mt-2 text-sm text-zinc-500">{backupPreviewType === "mail"
                    ? `${selectedBackupItem.sender || "발신자 없음"} · ${selectedBackupItem.mailDate ? new Date(selectedBackupItem.mailDate).toLocaleString("ko-KR") : "날짜 없음"}`
                    : `${selectedBackupItem.author || "작성자 없음"} · ${selectedBackupItem.createdAt ? new Date(selectedBackupItem.createdAt).toLocaleString("ko-KR") : "날짜 없음"} · ${selectedBackupItem.status}`}</p>
                  <div className="mt-5 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-5 text-sm leading-7 text-zinc-700">{backupPreviewType === "mail" ? (selectedBackupItem.body || "본문이 없습니다.") : (selectedBackupItem.content || "내용이 없습니다.")}</div>
                  {backupPreviewType === "documents" && selectedBackupItem.attachments?.length > 0 && <div className="mt-5">
                    <h5 className="font-bold">첨부파일 기록</h5>
                    <div className="mt-2 space-y-2">{selectedBackupItem.attachments.map((attachment, index) => <div key={`${attachment.storedName || attachment.fileName}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                      <span>{attachment.fileName || attachment.originalName || `첨부파일 ${index + 1}`}{attachment.category ? ` · ${attachment.category}` : ""}</span>
                      {attachment.source === "upload" && attachment.storedName
                        ? <button type="button" onClick={() => downloadBackupAttachment(attachment)} className="shrink-0 text-blue-600">다운로드</button>
                        : <span className="shrink-0 text-xs text-zinc-400">메일 서버 원본</span>}
                    </div>)}</div>
                  </div>}
                </> : <div className="flex h-full min-h-48 items-center justify-center text-zinc-400">왼쪽 목록에서 내용을 선택하세요.</div>}
              </div>
            </div>

            <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
              <span>총 {backupPreview.total.toLocaleString()}건 · {backupPreviewPage} / {Math.max(1, Math.ceil(backupPreview.total / backupPreview.limit))} 페이지</span>
              <div className="flex gap-2">
                <button type="button" disabled={backupPreviewLoading || backupPreviewPage <= 1} onClick={() => openBackupPreview(backupPreview.listEntry, { type: backupPreviewType, page: backupPreviewPage - 1, search: backupPreviewSearch })} className="rounded-lg border px-3 py-2 disabled:opacity-40">이전</button>
                <button type="button" disabled={backupPreviewLoading || backupPreviewPage * backupPreview.limit >= backupPreview.total} onClick={() => openBackupPreview(backupPreview.listEntry, { type: backupPreviewType, page: backupPreviewPage + 1, search: backupPreviewSearch })} className="rounded-lg border px-3 py-2 disabled:opacity-40">다음</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
