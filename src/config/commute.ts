export interface CommuteDestination {
  id: string;
  label: string;
  // 最寄り駅名 -> 最終電車の目安時刻(HH:mm)。実データが無い駅はdefaultLastTrainを使う。
  // 実運用では駅時刻表や乗換API等で正確な値に置き換える想定（PRD 5章参照）。
  lastTrainByStation: Record<string, string>;
  defaultLastTrain: string;
}

// ラベル・終電目安時刻は個人の生活圏に依存する情報のため、ソースにハードコードせず
// 環境変数から与える(未設定時は汎用的な既定値にフォールバックする)。実際の値は
// .env.local(gitignore対象)やVercelの環境変数に設定する。
export const commuteDestinations: CommuteDestination[] = [
  {
    id: "home",
    label: process.env.NEXT_PUBLIC_COMMUTE_HOME_LABEL ?? "自宅",
    lastTrainByStation: {},
    defaultLastTrain: process.env.NEXT_PUBLIC_COMMUTE_HOME_LAST_TRAIN ?? "24:00",
  },
  {
    id: "work",
    label: process.env.NEXT_PUBLIC_COMMUTE_WORK_LABEL ?? "職場",
    lastTrainByStation: {},
    defaultLastTrain: process.env.NEXT_PUBLIC_COMMUTE_WORK_LAST_TRAIN ?? "23:30",
  },
];

// 週末は自宅、平日は赴任先を優先表示する（PRD 5章「曜日による優先度」）。
export function getPriorityDestinationId(date: Date): string {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? "home" : "work";
}

export function getLastTrainTime(
  destination: CommuteDestination,
  nearestStation: string | null
): string {
  if (nearestStation && destination.lastTrainByStation[nearestStation]) {
    return destination.lastTrainByStation[nearestStation];
  }
  return destination.defaultLastTrain;
}
