export default function FolderBadge({ id, name }) {
  const label = name || "미분류";
  return <span className={`block max-w-full truncate rounded-full px-3 py-1 text-center text-sm ${id ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-500"}`} title={label}>{label}</span>;
}
