// 終電・帰宅アラート(config/commute.ts)の表示名・終電時刻は環境変数が既定値だが、
// 設定画面からユーザー自身が上書きできるようにする。アカウントに紐づくデータでは
// なく端末ごとの好みのため、Supabase同期は行わずlocalStorageのみで完結させる。
export interface CommuteOverride {
  label: string;
  lastTrain: string;
}

export type CommuteOverrides = Record<string, CommuteOverride>;

const COMMUTE_OVERRIDES_KEY = "matane:commuteOverrides";

export function loadCommuteOverrides(): CommuteOverrides | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(COMMUTE_OVERRIDES_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as CommuteOverrides;
  } catch {
    return null;
  }
}

export function saveCommuteOverrides(overrides: CommuteOverrides) {
  window.localStorage.setItem(COMMUTE_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function clearCommuteOverrides() {
  window.localStorage.removeItem(COMMUTE_OVERRIDES_KEY);
}
