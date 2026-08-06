const styles = {
  "승인": "bg-green-100 text-green-700",
  "반려": "bg-red-100 text-red-700",
  "결재 대기": "bg-yellow-100 text-yellow-700",
  "검토 중": "bg-blue-100 text-blue-700",
  "지급 완료": "bg-green-100 text-green-700",
  "지급 대기": "bg-orange-100 text-orange-700",
  "완료": "bg-zinc-200 text-zinc-700"
};

export default function StatusBadge({ status, className = "" }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${styles[status] || "bg-zinc-100 text-zinc-600"} ${className}`}>{status || "상태 없음"}</span>;
}
