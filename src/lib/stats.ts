import { ALCOHOL_OPTIONS, WHO_OPTIONS } from "@/constants/choices";
import { estimateAverageBudget } from "@/lib/budget";
import type { VisitWithVenue } from "@/lib/db/queries";
import { formatMonthLabel, monthKey } from "@/lib/time";

export interface MonthlyCount {
  key: string;
  label: string;
  count: number;
}

// 直近monthsBackヶ月を、訪問0件の月も含めて生成する(棒グラフを途切れさせないため)。
export function monthlyVisitCounts(visits: VisitWithVenue[], monthsBack = 6): MonthlyCount[] {
  const now = new Date();
  const buckets: MonthlyCount[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: monthKey(date), label: formatMonthLabel(date), count: 0 });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const visit of visits) {
    const bucket = byKey.get(monthKey(new Date(visit.visited_at)));
    if (bucket) bucket.count += 1;
  }

  return buckets;
}

export interface FrequencyItem {
  label: string;
  count: number;
}

// order(選択肢の定義順)に沿って集計し、0件のものは除外・件数の多い順に並べる。
function countFrequency(values: string[], order: readonly string[]): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return order
    .map((label) => ({ label, count: counts.get(label) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function alcoholTagFrequency(visits: VisitWithVenue[]): FrequencyItem[] {
  return countFrequency(
    visits.flatMap((visit) => visit.alcohol_tags),
    ALCOHOL_OPTIONS
  );
}

export function whoFrequency(visits: VisitWithVenue[]): FrequencyItem[] {
  return countFrequency(
    visits.flatMap((visit) => visit.who),
    WHO_OPTIONS
  );
}

export function overallAverageBudget(visits: VisitWithVenue[]): number | null {
  return estimateAverageBudget(visits.flatMap((visit) => (visit.budget ? [visit.budget] : [])));
}
