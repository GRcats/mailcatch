export default function ErrorNotice({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
      <p>{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-red-100">다시 시도</button>}
    </div>
  );
}
