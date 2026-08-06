import api from "./api";

export default async function openAuthenticatedFile(path) {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) throw new Error("팝업이 차단되었습니다.");
  previewWindow.document.title = "첨부파일 불러오는 중";
  previewWindow.document.body.textContent = "첨부파일을 불러오는 중입니다...";

  try {
    const response = await api.get(path, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(response.data);
    previewWindow.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}
