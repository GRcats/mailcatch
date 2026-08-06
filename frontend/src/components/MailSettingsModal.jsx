import { useEffect, useState } from "react";
import api from "../shared/api";

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
};

const mailGuides = [
  {
    name: "네이버", host: "imap.naver.com", port: "993",
    steps: ["네이버 메일 환경설정 → POP3/IMAP 설정에서 IMAP/SMTP를 사용함으로 변경", "네이버 계정 2단계 인증 설정", "애플리케이션 비밀번호를 발급해 아래 앱 비밀번호에 입력"],
    href: "https://help.naver.com/service/30029/contents/21344?osType=COMMONOS"
  },
  {
    name: "Gmail", host: "imap.gmail.com", port: "993",
    steps: ["개인 Gmail은 IMAP이 항상 활성화되어 별도 사용 설정이 필요하지 않음", "Google 계정에서 2단계 인증 설정", "Google 앱 비밀번호 페이지에서 MailCatch용 16자리 비밀번호를 발급해 입력"],
    href: "https://support.google.com/accounts/answer/185833?hl=ko"
  },
  {
    name: "다음", host: "imap.daum.net", port: "993",
    steps: ["다음메일 환경설정에서 IMAP 사용을 활성화", "카카오계정 2단계 인증 설정", "카카오계정 앱 비밀번호를 발급해 일반 비밀번호 대신 입력"],
    href: "https://cs.daum.net/faq/service/43/category/9234/detail/35945"
  },
  {
    name: "카카오메일", host: "imap.kakao.com", port: "993",
    steps: ["카카오메일 환경설정에서 IMAP 사용을 활성화", "카카오계정 2단계 인증 설정", "카카오계정 앱 비밀번호를 발급해 입력"],
    href: "https://mail-notice.kakao.com/mboard/en/notice/79"
  },
  {
    name: "Outlook", host: "outlook.office365.com", port: "993",
    steps: ["Outlook 설정 → 메일 → 전달 및 IMAP에서 IMAP 사용을 활성화", "Microsoft 계정의 앱 비밀번호 사용 가능 여부 확인", "회사·학교 계정처럼 OAuth2만 허용하는 계정은 현재 MailCatch에 연결할 수 없음"],
    href: "https://support.microsoft.com/en-us/Outlook/pop-imap-and-smtp-settings-for-outlook-com"
  }
];

function MailSettingsModal({ onClose, onCleanup }) {
  const [tab, setTab] = useState("account");
  const [mailAccount, setMailAccount] = useState({ host: "", port: "993", secure: true, username: "", password: "" });
  const [mailAccounts, setMailAccounts] = useState([]);
  const [accountWorking, setAccountWorking] = useState(false);
  const [syncDays, setSyncDays] = useState(() => localStorage.getItem("mailSyncDays") || "30");
  const [syncSaved, setSyncSaved] = useState(false);
  const [storageStats, setStorageStats] = useState(null);
  const [retentionDays, setRetentionDays] = useState("365");
  const [cleanupScope, setCleanupScope] = useState("unclassified");
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  const loadAccount = async () => {
    const response = await api.get("/api/settings/shared-mail-accounts");
    setMailAccounts(response.data);
  };

  const loadStorage = async () => {
    const response = await api.get("/api/settings/storage");
    setStorageStats(response.data);
  };

  useEffect(() => {
    Promise.resolve()
      .then(() => Promise.all([loadAccount(), loadStorage()]))
      .catch(console.error);
  }, []);

  const saveAccount = async () => {
    if (!mailAccount.label || !mailAccount.host || !mailAccount.username || !mailAccount.password) return alert("메일 계정 정보를 모두 입력하세요.");
    setAccountWorking(true);
    let savedAccountId = null;
    try {
      const saved = await api.post("/api/settings/shared-mail-accounts", mailAccount);
      savedAccountId = saved.data.id;
      await api.post(`/api/settings/shared-mail-accounts/${saved.data.id}/test`);
      await loadAccount();
      setMailAccount({ label: "", host: "", port: "993", secure: true, username: "", password: "" });
      alert("공용 메일 계정을 추가하고 연결을 확인했습니다.");
    } catch (error) {
      if (savedAccountId) await api.delete(`/api/settings/shared-mail-accounts/${savedAccountId}`).catch(() => {});
      alert(error.response?.data?.message || "메일 계정 저장에 실패했습니다.");
    } finally {
      setAccountWorking(false);
    }
  };

  const disconnectAccount = async (account) => {
    const warning = [
      `${account.label} 계정을 삭제하시겠습니까?`,
      "",
      "• 받은메일과 분류함에 있는 해당 계정의 메일도 메일함에서 함께 삭제됩니다.",
      "• 해당 메일로 이미 작성된 문서와 결재 기록은 그대로 남습니다.",
      account.primary ? "• 다른 계정이 있으면 자동으로 기본 메일로 지정됩니다." : ""
    ].filter(Boolean).join("\n");
    if (!confirm(warning)) return;
    await api.delete(`/api/settings/shared-mail-accounts/${account.id}`);
    await loadAccount();
  };

  const setPrimaryAccount = async (account) => {
    setAccountWorking(true);
    try {
      await api.put(`/api/settings/shared-mail-accounts/${account.id}/primary`);
      await loadAccount();
    } catch (error) {
      alert(error.response?.data?.message || "기본 메일 계정을 변경하지 못했습니다.");
    } finally { setAccountWorking(false); }
  };

  const saveSyncDays = () => {
    const days = Math.min(3650, Math.max(1, Number(syncDays) || 30));
    localStorage.setItem("mailSyncDays", String(days));
    setSyncDays(String(days));
    setSyncSaved(true);
  };

  const previewCleanup = async () => {
    try {
      const response = await api.get("/api/settings/storage/cleanup-preview", { params: { days: retentionDays, scope: cleanupScope } });
      setCleanupPreview(response.data);
    } catch (error) {
      alert(error.response?.data?.message || "삭제 대상을 확인하지 못했습니다.");
    }
  };

  const cleanupMails = async () => {
    if (!cleanupPreview?.count) return;
    const scope = cleanupScope === "all" ? "전체 메일" : "미분류 메일";
    if (!confirm(`${cleanupPreview.count}개의 오래된 ${scope}을 삭제하시겠습니까?`)) return;
    setCleaning(true);
    try {
      const response = await api.post("/api/settings/storage/cleanup", { days: retentionDays, scope: cleanupScope, confirmation: "DELETE" });
      alert(`${response.data.deletedCount}개의 메일을 삭제했습니다.`);
      setCleanupPreview(null);
      await loadStorage();
      await onCleanup?.();
    } catch (error) {
      alert(error.response?.data?.message || "오래된 메일 삭제에 실패했습니다.");
    } finally {
      setCleaning(false);
    }
  };

  const tabs = [["account", "공용 메일 계정"], ["sync", "메일 가져오기"], ["cleanup", "메일 정리"]];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5">
          <div><h3 className="text-xl font-bold">메일 설정</h3><p className="mt-1 text-sm text-zinc-500">메일 계정과 가져오기, 저장 공간을 관리합니다.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-100">닫기</button>
        </div>
        <div className="border-b px-6 pt-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${tab === value ? "border-blue-600 text-blue-600" : "border-transparent text-zinc-500"}`}>{label}</button>)}
          </div>
        </div>
        <div className="p-6">
          {tab === "account" && <div>
            <h4 className="text-lg font-bold">공용 메일 계정</h4>
            <p className="mt-1 text-sm text-zinc-500">등록한 계정은 모든 사용자가 메일함에서 선택할 수 있습니다. 비밀번호는 암호화되어 저장됩니다.</p>
            <details className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <summary className="cursor-pointer font-medium text-blue-800">메일별 연결 가이드</summary>
              <p className="mt-2 text-sm text-blue-700">사용할 서비스를 선택하면 서버와 포트가 자동 입력됩니다.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {mailGuides.map((guide) => <button key={guide.name} type="button" onClick={() => setMailAccount((current) => ({ ...current, host: guide.host, port: guide.port, secure: true }))} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">{guide.name}</button>)}
              </div>
              <div className="mt-4 space-y-2">
                {mailGuides.map((guide) => <details key={guide.name} className="rounded-lg bg-white px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">{guide.name} · {guide.host}:{guide.port}</summary>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-600">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <a href={guide.href} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-blue-600 hover:underline">공식 설정 안내 열기</a>
                </details>)}
              </div>
              <p className="mt-3 text-xs text-zinc-500">회사·학교·자체 도메인 메일은 관리자에게 IMAP 서버, 포트, 인증 방식을 확인하세요.</p>
            </details>
            <div className="mt-5 space-y-2">
              {mailAccounts.map((account) => {
                return <div key={account.key} className="flex items-center justify-between gap-3 rounded-xl border bg-zinc-50 px-4 py-3"><div><p className="font-medium">{account.label}{account.primary && <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-600">기본</span>}</p><p className="mt-1 text-sm text-zinc-500">{account.username} · {account.host}</p></div><div className="flex shrink-0 items-center gap-2">{!account.primary && <button type="button" onClick={() => setPrimaryAccount(account)} disabled={accountWorking} className="rounded-lg px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40">기본 지정</button>}<button type="button" onClick={() => disconnectAccount(account)} disabled={accountWorking} className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40">삭제</button></div></div>;
              })}
            </div>
            <h5 className="mt-6 font-bold">계정 추가</h5>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-zinc-600">표시 이름<input value={mailAccount.label || ""} onChange={(e) => setMailAccount((v) => ({ ...v, label: e.target.value }))} placeholder="예: 회계 메일" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm text-zinc-600">메일 서버<input value={mailAccount.host} onChange={(e) => setMailAccount((v) => ({ ...v, host: e.target.value }))} placeholder="imap.example.com" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm text-zinc-600">포트<input type="number" value={mailAccount.port} onChange={(e) => setMailAccount((v) => ({ ...v, port: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm text-zinc-600">메일 아이디<input value={mailAccount.username} onChange={(e) => setMailAccount((v) => ({ ...v, username: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm text-zinc-600">앱 비밀번호<input type="password" value={mailAccount.password} onChange={(e) => setMailAccount((v) => ({ ...v, password: e.target.value }))} placeholder="앱 비밀번호" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            </div>
            <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
              <strong>보안 경고:</strong> 앱 비밀번호를 알면 다른 기기나 프로그램에서 메일 계정에 접근할 수 있습니다. 타인에게 공유하거나 외부에 노출하지 마세요. 노출이 의심되면 메일 서비스에서 즉시 앱 비밀번호를 폐기하고 새로 발급하세요.
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={mailAccount.secure} onChange={(e) => setMailAccount((v) => ({ ...v, secure: e.target.checked }))} />보안 연결 사용</label>
            <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={saveAccount} disabled={accountWorking} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{accountWorking ? "연결 확인 중..." : "추가 및 연결 테스트"}</button></div>
          </div>}
          {tab === "sync" && <div>
            <h4 className="text-lg font-bold">메일 가져오기</h4><p className="mt-1 text-sm text-zinc-500">메일함을 새로고침할 때 가져올 기간을 설정합니다.</p>
            <div className="mt-5 flex items-center gap-3"><label htmlFor="sync-days" className="font-medium">조회 기간</label><input id="sync-days" type="number" min="1" max="3650" value={syncDays} onChange={(e) => { setSyncDays(e.target.value); setSyncSaved(false); }} className="w-28 rounded-lg border px-3 py-2" /><span>일</span><button type="button" onClick={saveSyncDays} className="rounded-lg bg-blue-600 px-4 py-2 text-white">저장</button></div>
            {syncSaved && <p className="mt-3 text-sm text-green-600">설정이 저장되었습니다.</p>}
          </div>}
          {tab === "cleanup" && <div>
            <h4 className="text-lg font-bold">메일 저장 공간 관리</h4><p className="mt-1 text-sm text-zinc-500">오래된 로컬 메일 데이터를 확인하고 정리합니다.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["DB 사용량", formatBytes(storageStats?.databaseBytes)], ["첨부파일 사용량", formatBytes(storageStats?.uploadBytes)], ["저장된 메일", `${storageStats?.mailCount ?? "-"}개`], ["작성 문서", `${storageStats?.documentCount ?? "-"}개`]].map(([label, value]) => <div key={label} className="rounded-xl border bg-zinc-50 p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 font-bold">{value}</p></div>)}</div>
            <div className="mt-5 rounded-xl bg-zinc-50 p-5"><div className="flex flex-wrap items-center gap-3"><label className="text-sm font-medium">삭제 범위</label><select value={cleanupScope} onChange={(e) => { setCleanupScope(e.target.value); setCleanupPreview(null); }} className="rounded-lg border bg-white px-3 py-2"><option value="unclassified">미분류 메일만</option><option value="all">전체 메일(문서 연결 메일 포함)</option></select><label className="text-sm font-medium">보관 기간</label><input type="number" min="30" max="3650" value={retentionDays} onChange={(e) => { setRetentionDays(e.target.value); setCleanupPreview(null); }} className="w-28 rounded-lg border bg-white px-3 py-2" /><span>일</span><button type="button" onClick={previewCleanup} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-600">삭제 대상 확인</button></div>
              {cleanupPreview && <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4"><p className="text-sm text-orange-800"><strong>{cleanupPreview.count}개</strong> · 예상 {formatBytes(cleanupPreview.estimatedBytes)}</p><button type="button" onClick={cleanupMails} disabled={cleaning || !cleanupPreview.count} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40">{cleaning ? "삭제 중..." : "삭제"}</button></div>}
            </div><p className="mt-4 text-xs text-zinc-400">실제 메일 서버에서 받은 원본은 삭제되지 않습니다.</p>
          </div>}
        </div>
      </section>
    </div>
  );
}

export default MailSettingsModal;
