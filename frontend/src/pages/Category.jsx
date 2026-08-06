import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../shared/api";
import Sidebar from "../components/Sidebar";

function Category() {

    const navigate = useNavigate();

    const [folders, setFolders] = useState([]);

    const addFolder = async () => {

        const name = prompt("폴더명을 입력하세요.");

        if (!name) return;

        if (folders.some(folder => folder.name === name)) {
            alert("이미 존재하는 폴더입니다.");
            return;
        }

        const res = await api.post(
            "/api/folder",
            { name }
        );

        setFolders(prev => [...prev, res.data]);
    };
    useEffect(() => {

        api.get("/api/folder")
            .then(res => setFolders(res.data));

    }, []);

    return (

        <div className="
      min-h-screen
      bg-zinc-100
    ">


            <Sidebar />


            {/* 메인 */}
            <main className="ml-64 min-w-0 p-5 lg:p-8">


                {/* 헤더 */}


                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

                    <div>
                        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">분류함</h2>
                        <p className="mt-2 text-sm text-zinc-500">메일을 업무별로 분류하고 연결된 문서와 첨부파일을 관리합니다.</p>
                    </div>

                    <button
                        onClick={addFolder}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                    >
                        + 새 폴더
                    </button>

                </div>
                <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:p-6">

                    <h3 className="
    text-xl
    font-bold
    mb-5
  ">
                        분류 폴더
                    </h3>

                    <div className="
    grid
    grid-cols-1
    sm:grid-cols-2
    xl:grid-cols-4
    gap-4
  ">

                        {folders.map(folder => (

                            <div
                                key={folder.id}
                                onClick={() => navigate(`/category/${folder.id}`)}
                                className="
        border
        border-zinc-200
        bg-white
        rounded-xl
        shadow-sm
        p-5
        cursor-pointer
        transition
        hover:-translate-y-0.5
        hover:border-blue-200
        hover:shadow-md
    "
                            >

                                <h3 className="text-xl font-bold">
                                    {folder.name}
                                </h3>

                                <p className="mt-2 text-sm text-zinc-500">
                                    메일 {folder.count}개
                                </p>

                            </div>

                        ))}

                    </div>

                </section>

            </main>


        </div>

    );
}


export default Category;
