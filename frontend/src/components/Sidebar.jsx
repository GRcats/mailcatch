import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { jwtDecode } from "jwt-decode";




function Sidebar() {
    const [user] = useState(() => {
        const token = localStorage.getItem("token");
        return token ? jwtDecode(token) : null;
    });

    const navigate = useNavigate();
    const canApprove = ["approver", "finance", "admin"].includes(user?.role);
    const canManagePayments = ["finance", "admin"].includes(user?.role);

    const logout = () => {

        localStorage.removeItem("token");

        navigate("/");

    };


    return (

        <aside className="
      fixed
      left-0
      top-0
      h-screen
      w-64
      bg-zinc-900
      text-white
      px-6
      pb-6
      pt-2
      flex
      flex-col
    ">

            <div className="shrink-0 py-8 ml-3">
                <button type="button" onClick={() => navigate("/dashboard")}
                    className="
        text-3xl
        font-bold
        cursor-pointer
      ">
                    MailCatch
                </button>

            </div>

            <nav className="
        space-y-3
        flex-1
        min-h-0
        overflow-y-auto
      ">

                <button
                    onClick={() => navigate("/dashboard")}
                    className="
            w-full
            text-left
            px-4
            py-3
            rounded-lg
            hover:bg-zinc-800
            transition
            cursor-pointer
          "
                >
                    대시보드
                </button>
                <button
                    onClick={() => navigate("/mail")}
                    className="
            w-full
            text-left
            px-4
            py-3
            rounded-lg
            hover:bg-zinc-800
            transition
            cursor-pointer
          "
                >
                    메일함
                </button>
                <button
                    onClick={() => navigate("/category")}
                    className="
            w-full
            text-left
            px-4
            py-3
            rounded-lg
            hover:bg-zinc-800
            transition
            cursor-pointer
    "
                >
                    분류함
                </button>
                <button
                    onClick={() => navigate("/documents")}
                    className="
            w-full
            text-left
            px-4
            py-3
            rounded-lg
            hover:bg-zinc-800
            transition
            cursor-pointer
          "
                >
                    문서함
                </button>

                {canApprove && <button
                    onClick={() => navigate("/approval")}
                    className="
            w-full
            text-left
            px-4
            py-3
            rounded-lg
            hover:bg-zinc-800
            transition
            cursor-pointer
          "
                >
                    결재 대기
                </button>}

                {canManagePayments && <button
                    onClick={() => navigate("/payments")}
                    className="w-full cursor-pointer rounded-lg px-4 py-3 text-left transition hover:bg-zinc-800"
                >
                    지급 관리
                </button>}

            </nav>
            <div className="
  shrink-0
  border-t
  border-zinc-700
  pt-5
">

                <div className="mb-4 flex items-start justify-between gap-3">

                    <div className="min-w-0">

                    <p className="
      text-sm
      text-zinc-400
    ">
                        사용자
                    </p>

                    <h3 className="font-bold text-lg">
                        {user?.name}
                    </h3>

                    <p className="text-sm text-zinc-400">
                        {user?.department} · {user?.position}
                    </p>

                    <p className="
      text-sm
      text-zinc-500
    ">
                        개발팀
                    </p>

                    </div>

                    {user?.role === "admin" && <button
                        type="button"
                        onClick={() => navigate("/settings")}
                        title="환경설정"
                        aria-label="환경설정"
                        className="shrink-0 cursor-pointer rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                    >
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-6 w-6"
                        >
                            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
                        </svg>
                    </button>}

                </div>

                <button
                    onClick={logout}
                    className="
      w-full
      px-4
      py-3
      rounded-lg
      bg-red-600
      hover:bg-red-700
      transition
      font-medium
      cursor-pointer
    "
                >
                    로그아웃
                </button>

            </div>
        </aside>

    );

}

export default Sidebar;
