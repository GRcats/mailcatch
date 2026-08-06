import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../shared/api";
import Sidebar from "../components/Sidebar";

function CategoryDetail() {

    const { id } = useParams();
    const navigate = useNavigate();

    const [mails, setMails] = useState([]);
    const [folder, setFolder] = useState(null);
    const [folderName, setFolderName] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [settingsDirty, setSettingsDirty] = useState(false);
    const statusStyle = (status) => {
        if (["승인", "완료"].includes(status)) return "bg-green-100 text-green-700";
        if (status === "지급 완료") return "bg-green-100 text-green-700";
        if (status === "지급 대기") return "bg-orange-100 text-orange-700";
        if (status === "반려") return "bg-red-100 text-red-700";
        if (["검토 중", "결재 대기"].includes(status)) return "bg-yellow-100 text-yellow-700";
        return "bg-zinc-100 text-zinc-600";
    };

    useEffect(() => {

        api
            .get(`/api/folder/${id}`)
            .then(res => setMails(res.data))
            .catch(error => console.error(error));

        api
            .get(`/api/folder/${id}/settings`)
            .then(res => {
                setFolder(res.data);
                setFolderName(res.data.name || "");
            })
            .catch(error => console.error(error));

    }, [id]);

    const saveFolderSettings = async () => {
        try {
            await api.put(`/api/folder/${id}/settings`, {
                name: folderName
            });
            setSettingsDirty(false);
            setFolder((current) => ({
                ...current,
                name: folderName.trim()
            }));
            alert("폴더 설정을 저장했습니다.");
        } catch (error) {
            alert(error.response?.data?.message || "폴더 설정 저장에 실패했습니다.");
        }
    };

    const openFolderSettings = async () => {
        try {
            const res = await api.get(`/api/folder/${id}/settings`);
            setFolder(res.data);
            setFolderName(res.data.name || "");
            setSettingsDirty(false);
            setShowSettings(true);
        } catch (error) {
            alert(error.response?.data?.message || "폴더 설정을 불러오지 못했습니다.");
        }
    };

    return (
        <div className="
      min-h-screen
      bg-zinc-100
    ">


            <Sidebar />
            {/* 메인 */}
            <main className="
          ml-64
  p-8
      ">
                <div className="p-8">

                    <div className="mb-5 flex items-center justify-between">
                        <button
                            onClick={() => navigate("/category")}
                            className="
                            px-4
                            py-2
                            bg-zinc-200
                            rounded-lg
                            cursor-pointer
                            hover:bg-zinc-300
                        "
                    >
                        ← 분류함으로
                        </button>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => navigate("/write", {
                                    state: {
                                        folderId: Number(id),
                                        returnTo: `/category/${id}`
                                    }
                                })}
                                className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                            >
                                새 문서 작성
                            </button>
                            <button
                                type="button"
                                onClick={openFolderSettings}
                                className="cursor-pointer rounded-lg bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-800"
                            >
                                설정
                            </button>
                        </div>
                    </div>

                    <h2 className="text-3xl font-bold mb-6">
                        {folder?.name || "폴더"} 메일
                    </h2>

                    {showSettings && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
                        onClick={() => setShowSettings(false)}
                    >
                    <section
                        className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="folder-settings-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h3 id="folder-settings-title" className="text-xl font-bold">폴더 설정</h3>
                            <button
                                type="button"
                                onClick={() => setShowSettings(false)}
                                aria-label="설정 닫기"
                                className="cursor-pointer rounded-lg p-2 text-2xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                            >
                                ×
                            </button>
                        </div>
                        <p className="mt-1 text-sm text-zinc-500">
                            분류함의 표시 이름을 변경합니다.
                        </p>

                        <div className="mt-5">
                            <label htmlFor="folder-name" className="mb-2 block text-sm font-medium">
                                폴더 이름
                            </label>
                            <input
                                id="folder-name"
                                type="text"
                                value={folderName}
                                onChange={(event) => {
                                    setFolderName(event.target.value);
                                    setSettingsDirty(true);
                                }}
                                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                            />
                        </div>

                        <p className="mt-3 text-xs text-zinc-400">
                            {settingsDirty
                                ? "변경사항을 적용하려면 설정 저장을 눌러주세요."
                                : "저장된 설정입니다."}
                        </p>

                        <div className="mt-6 flex justify-end border-t border-zinc-200 pt-4">
                            <button
                                type="button"
                                onClick={saveFolderSettings}
                                disabled={!settingsDirty || !folderName.trim()}
                                className="cursor-pointer rounded-lg bg-zinc-700 px-5 py-2 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                설정 저장
                            </button>
                        </div>
                    </section>
                    </div>
                    )}


                    <div className="overflow-hidden rounded-xl bg-white p-6 shadow">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b text-zinc-500">
                                    <th className="w-36 py-3">상태</th>
                                    <th className="py-3">제목</th>
                                    <th className="w-72">보낸 사람</th>
                                    <th className="w-36">날짜</th>
                                    <th className="w-64">수신 계정</th>
                                </tr>
                            </thead>

                            <tbody>
                                {mails.map((mail) => (
                                    <tr
                                        key={mail.isDraft ? `draft-${mail.documentId}` : `${mail.mailboxKey}-${mail.gmail_uid}`}
                                        className="border-b last:border-b-0 hover:bg-zinc-50"
                                    >
                                        <td className="pr-4">
                                            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusStyle(mail.status)}`}>
                                                {mail.status || "미처리"}
                                            </span>
                                        </td>
                                        <td className="py-4 pr-5">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    navigate(mail.isDraft ? `/documents/${mail.documentId}` : `/mail/${mail.gmail_uid}`, {
                                                        state: {
                                                            ...mail,
                                                            openedFromCategory: true,
                                                            returnTo: `/category/${id}`
                                                        }
                                                    })
                                                }
                                                className="cursor-pointer text-left font-bold hover:text-blue-600"
                                            >
                                                {mail.subject || "(제목 없음)"}
                                            </button>
                                        </td>
                                        <td className="pr-5 [overflow-wrap:anywhere]">
                                            {mail.from}
                                        </td>
                                        <td>
                                            {mail.date
                                                ? new Date(mail.date).toLocaleDateString()
                                                : "-"}
                                        </td>
                                        <td>
                                            <p className="text-sm font-medium text-zinc-700">{mail.mailboxLabel || "기본 메일"}</p>
                                            {mail.mailboxUsername && <p className="mt-0.5 truncate text-xs text-zinc-400" title={`${mail.mailboxUsername}${mail.mailboxHost ? ` · ${mail.mailboxHost}` : ""}`}>{mail.mailboxUsername}{mail.mailboxHost ? ` · ${mail.mailboxHost}` : ""}</p>}
                                        </td>
                                    </tr>
                                ))}

                                {mails.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="py-12 text-center text-zinc-400">
                                            이 폴더에 분류된 메일이 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            </main>


        </div>
    );

}

export default CategoryDetail;
