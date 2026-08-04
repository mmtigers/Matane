export type HomeMode = "night" | "day";

// PRD 5章: 夜間モード（18:00〜24:00）、それ以外は日中モード。
export function getModeForHour(hour: number): HomeMode {
  return hour >= 18 ? "night" : "day";
}

export function getCurrentMode(): HomeMode {
  return getModeForHour(new Date().getHours());
}

export function formatMonthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
