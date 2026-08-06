import { Component } from "react";

export default class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("화면 오류", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <section className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold">화면을 표시하지 못했습니다.</h1>
          <p className="mt-3 text-zinc-500">저장 중인 데이터는 그대로 유지됩니다. 화면을 새로고침해 다시 시도해 주세요.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-lg bg-blue-600 px-5 py-3 text-white">새로고침</button>
        </section>
      </main>
    );
  }
}
