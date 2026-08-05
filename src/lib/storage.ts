import { getSupabaseClient } from "@/lib/supabase/client";

const BUCKET = "visit-photos";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Visitのbest_photoがdata URL(ローカルで圧縮した写真)の場合、Supabase Storageへ
// アップロードして軽量なURLに差し替える。一覧クエリ(pullFromCloud等)がbase64画像
// ごと転送するのを防ぐため、クラウド側にはURLのみを保存する。ローカルのIndexedDB
// は引き続きdata URLを保持するため、この端末ではオフラインでも表示できる。
export async function uploadVisitPhotoIfNeeded(
  visitId: string,
  userId: string,
  photo: string | null
): Promise<string | null> {
  if (!photo || !photo.startsWith("data:")) return photo;

  try {
    const supabase = getSupabaseClient();
    const blob = dataUrlToBlob(photo);
    const path = `${userId}/${visitId}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true, contentType: blob.type });

    if (error) {
      console.warn("写真のアップロードに失敗しました(base64のまま同期します):", error);
      return photo;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    console.warn("写真のアップロードに失敗しました(base64のまま同期します):", error);
    return photo;
  }
}
