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

// 5時始まりの「営業日」内での経過分数に正規化する。飲み会の帰宅アラートは
// 深夜0時〜早朝に使われることが多く、素朴に「今日の日付+時刻」で比較すると
// 日付を跨いだ瞬間に「終電まであと22時間」のような誤った残り時間になって
// しまうため、5時未満の時刻は前日の深夜として扱う。
const SERVICE_DAY_START_MINUTES = 5 * 60;

function serviceMinutesOfDay(totalMinutes: number): number {
  const offset = totalMinutes - SERVICE_DAY_START_MINUTES;
  return ((offset % 1440) + 1440) % 1440;
}

// "HH:mm"形式の最終電車時刻(24:00表記も許容)までの残り分数を返す。
// 既に過ぎている場合は負の値になる(呼び出し側で「終電を逃した」表示に使う)。
export function getMinutesUntilLastTrain(lastTrainTime: string, now: Date): number {
  const [hourStr, minuteStr] = lastTrainTime.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Infinity;

  const nowOffset = serviceMinutesOfDay(now.getHours() * 60 + now.getMinutes());
  const targetOffset = serviceMinutesOfDay(hour * 60 + minute);
  return targetOffset - nowOffset;
}
