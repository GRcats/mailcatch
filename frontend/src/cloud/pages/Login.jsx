import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getServerUrl, normalizeServerUrl, setServerUrl } from "../../shared/api";

function Login() {

  const navigate = useNavigate();

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverAddress, setServerAddress] = useState(() => getServerUrl());
  const [serverMessage, setServerMessage] = useState("");

  const testServer = async () => {
    const candidate = normalizeServerUrl(serverAddress);
    setServerMessage("연결 확인 중...");
    try {
      await api.get(`${candidate}/`, { baseURL: "", timeout: 5000 });
      setServerMessage("연결되었습니다.");
    } catch {
      setServerMessage("연결할 수 없습니다. IP와 포트를 확인하세요.");
    }
  };

  const saveServer = () => {
    const address = setServerUrl(serverAddress);
    setServerAddress(address);
    setServerMessage("서버 주소를 저장했습니다.");
  };


  const login = async (e) => {

    e.preventDefault();

    try {

        const res = await api.post(
            "/api/auth/login",
            {
                username: id,
                password: pw
            }
        );

        localStorage.setItem(
            "token",
            res.data.token
        );

        navigate("/dashboard");

    } catch (error) {

        alert(error.response?.data?.message || "아이디 또는 비밀번호가 올바르지 않습니다.");

    }

    

};
  
  return (

    <div className="
      min-h-screen 
      bg-zinc-100 
      flex 
      items-center 
      justify-center
    ">


      <div className="
        w-[420px]
        bg-white
        rounded-2xl
        shadow-xl
        p-10
      ">


        <div className="
          text-center
          mb-8
        ">

          <h1 className="
            text-4xl
            font-bold
            text-blue-600
          ">
            APRO
          </h1>


          <p className="
            text-zinc-500
            mt-2
          ">
            전자결재 시스템
          </p>

        </div>

        <button type="button" onClick={() => setShowServerSettings(true)} className="mt-5 w-full text-sm text-zinc-400 hover:text-blue-600">
          서버 설정
        </button>



        <form onSubmit={login}
          className="space-y-4"
        >

          <input
            className="
              w-full
              px-4
              py-3
              border
              rounded-lg
              outline-none
              focus:ring-2
              focus:ring-blue-500
            "
            placeholder="아이디"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />


          <input
            className="
              w-full
              px-4
              py-3
              border
              rounded-lg
              outline-none
              focus:ring-2
              focus:ring-blue-500
            "
            type="password"
            placeholder="비밀번호"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />


          <button
            className="
              w-full
              py-3
              rounded-lg
              bg-blue-600
              hover:bg-blue-700
              text-white
              font-semibold
              transition
              cursor-pointer
            "
          >
            로그인
          </button>


        </form>

      </div>

      {showServerSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setShowServerSettings(false)}>
          <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-bold">대표 서버 설정</h2>
            <p className="mt-2 text-sm text-zinc-500">서버 PC의 IP 주소와 포트를 입력하세요.</p>
            <input value={serverAddress} onChange={(event) => { setServerAddress(event.target.value); setServerMessage(""); }} placeholder="예: 192.168.0.20:3000" className="mt-5 w-full rounded-lg border border-zinc-300 px-4 py-3" />
            {serverMessage && <p className={`mt-3 text-sm ${serverMessage.includes("없습니다") ? "text-red-600" : "text-green-600"}`}>{serverMessage}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={testServer} className="rounded-lg border border-blue-200 px-4 py-2 text-blue-600">연결 테스트</button>
              <button type="button" onClick={saveServer} className="rounded-lg bg-blue-600 px-4 py-2 text-white">저장</button>
              <button type="button" onClick={() => setShowServerSettings(false)} className="rounded-lg bg-zinc-100 px-4 py-2">닫기</button>
            </div>
          </section>
        </div>
      )}


    </div>

  );
}


export default Login;
