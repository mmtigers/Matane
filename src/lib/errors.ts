// ブラウザのfetch自体が失敗した場合(オフライン・DNS解決失敗・CORS等)に投げられる
// エラーメッセージ。ブラウザ実装ごとに文言が異なるため代表的なものを列挙して判定する。
const NETWORK_ERROR_MESSAGES = [
  "failed to fetch", // Chrome/Edge
  "networkerror when attempting to fetch resource", // Firefox
  "load failed", // Safari
];

// supabase-jsはHTTPレベルのエラー(PostgrestError等、Errorのサブクラス)だけでなく、
// fetch自体が失敗した場合は素のオブジェクト{ message, name, ... }を投げてくる。
// instanceof Errorだけで判定するとこのケースを取りこぼしString(error)が
// "[object Object]"になってしまうため、messageプロパティの有無でも判定する。
export function describeErrorDetail(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

// 「Failed to fetch」等のブラウザ生の英語メッセージをそのままUIに出すと、日本語UIの中で
// 意味不明な文言になってしまう。オフライン・DNS失敗・CORS等の通信不達を検知し、
// 別途わかりやすい日本語メッセージに差し替えるための判定関数。
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = describeErrorDetail(error)?.toLowerCase();
  if (!message) return false;
  return NETWORK_ERROR_MESSAGES.some((needle) => message.includes(needle));
}

export const NETWORK_ERROR_MESSAGE_JA =
  "通信エラーが発生しました。ネットワーク接続をご確認のうえ、もう一度お試しください。";

// UI表示用にエラーを日本語メッセージへ変換する。通信不達は共通の案内文に差し替え、
// それ以外はfallbackに(あれば)詳細を括弧書きで添えて返す。
export function describeErrorForUser(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE_JA;
  const detail = describeErrorDetail(error);
  return detail ? `${fallback}(${detail})` : fallback;
}
