export interface CommuteDestination {
  id: string;
  label: string;
  // 最寄り駅名 -> 最終電車の目安時刻(HH:mm)。実データが無い駅はdefaultLastTrainを使う。
  // 実運用では駅時刻表や乗換API等で正確な値に置き換える想定（PRD 5章参照）。
  lastTrainByStation: Record<string, string>;
  defaultLastTrain: string;
}

export const commuteDestinations: CommuteDestination[] = [
  {
    id: "home",
    label: "自宅（[redacted]方面）",
    lastTrainByStation: {},
    defaultLastTrain: "24:00",
  },
  {
    id: "work",
    label: "赴任先（[redacted]方面）",
    lastTrainByStation: {},
    defaultLastTrain: "23:30",
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
