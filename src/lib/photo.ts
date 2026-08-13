import imageCompression from "browser-image-compression";

// 圧縮前の生ファイルに対する安全弁。モバイルカメラの超高解像度写真をそのまま
// デコードしようとしてタブがクラッシュ/フリーズするのを防ぐ。
const MAX_UPLOAD_BYTES = 20_000_000;

export class PhotoTooLargeError extends Error {}

// 登録画面(二次登録)・お出かけ瞬録の一発登録フロー双方で使う共通の写真圧縮処理。
// 最大1024px・1MB程度まで圧縮したdata URLを返す。
export async function compressPhotoToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new PhotoTooLargeError(
      "ファイルサイズが大きすぎます(20MBまで)。別の写真を選んでください"
    );
  }

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1024,
    maxSizeMB: 1,
  });
  return imageCompression.getDataUrlFromFile(compressed);
}
