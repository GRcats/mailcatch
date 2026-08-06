import { useEffect, useState } from "react";
import api from "../shared/api";

export default function NetworkStatusBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const handleOffline = () => setOffline(true);
    const handleOnline = () => setOffline(false);
    const handleApiError = () => setOffline(true);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("mailcatch:api-unavailable", handleApiError);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("mailcatch:api-unavailable", handleApiError);
    };
  }, []);

  if (!offline) return null;
  const retry = async () => {
    setChecking(true);
    try {
      await api.get("/");
      setOffline(false);
    } catch { setOffline(true); }
    finally { setChecking(false); }
  };

  return (
    <div className="fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-red-600 px-5 py-3 text-sm text-white shadow-xl">
      <span>대표 PC 서버에 연결할 수 없습니다.</span>
      <button type="button" onClick={retry} disabled={checking} className="rounded-lg bg-white/20 px-3 py-1.5 font-medium hover:bg-white/30 disabled:opacity-50">{checking ? "확인 중..." : "다시 연결"}</button>
    </div>
  );
}
