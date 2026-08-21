"use client";

import { useMemo, useState } from "react";
import { BarRow } from "@/components/BarRow";
import { SkeletonList } from "@/components/Skeleton";
import { useTimelineVisits } from "@/lib/db/queries";
import { alcoholTagFrequency, monthlyVisitCounts, monthsBetween, whoFrequency } from "@/lib/stats";
type Period = "6m" | "1y" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "6m", label: "6ヶ月" },
  { key: "1y", label: "1年" },
  { key: "all", label: "全期間" },
];
// 「全期間」で店舗の利用歴が長い場合に棒グラフが際限なく伸びないようにする上限。
const MAX_MONTHS_BACK = 36;

export default function StatsPage() {
  const visits = useTimelineVisits();
  const [period, setPeriod] = useState<Period>("6m");

  // 未登録(二次登録待ち)の訪問は予算・お酒タグ等が空のため集計対象から除く。
  const completed = useMemo(() => (visits ?? []).filter((visit) => visit.is_completed), [visits]);

  const monthsBack = useMemo(() => {
    if (period === "6m") return 6;
    if (period === "1y") return 12;
    if (completed.length === 0) return 6;
    const earliest = completed.reduce(
      (min, visit) => (visit.visited_at < min ? visit.visited_at : min),
      completed[0].visited_at
    );
    return Math.min(MAX_MONTHS_BACK, monthsBetween(new Date(earliest), new Date()));
  }, [period, completed]);

  const monthly = useMemo(() => monthlyVisitCounts(completed, monthsBack), [completed, monthsBack]);
  const monthlyMax = Math.max(1, ...monthly.map((m) => m.count));
  const alcoholFreq = useMemo(() => alcoholTagFrequency(completed), [completed]);
  const alcoholMax = Math.max(1, ...alcoholFreq.map((item) => item.count));
  const whoFreq = useMemo(() => whoFrequency(completed), [completed]);
  const whoMax = Math.max(1, ...whoFreq.map((item) => item.count));
  const venueCount = useMemo(
    () => new Set(completed.map((visit) => visit.venue_id)).size,
    [completed]
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">わたしデータ</h1>
      </header>

      {!visits ? (
        <SkeletonList />
      ) : completed.length === 0 ? (
        <p className="text-sm text-neutral-600">まだ訪問記録がありません。</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-neutral-100 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{completed.length}</p>
              <p className="mt-1 text-xs text-neutral-600">総訪問回数</p>
            </div>
            <div className="rounded-2xl bg-neutral-100 p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{venueCount}</p>
              <p className="mt-1 text-xs text-neutral-600">訪問した店舗数</p>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-neutral-600">月別訪問回数</h2>
              <div className="flex gap-1">
                {PERIODS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setPeriod(item.key)}
                    aria-pressed={period === item.key}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus:ring-2 focus:ring-amber-400 ${
                      period === item.key
                        ? "bg-amber-400 text-black"
                        : "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {monthly.map((month) => (
                <BarRow key={month.key} label={month.label} count={month.count} max={monthlyMax} />
              ))}
            </div>
          </section>

          {alcoholFreq.length > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
              <h2 className="text-sm font-semibold text-neutral-600">よく飲むお酒</h2>
              <div className="flex flex-col gap-2">
                {alcoholFreq.map((item) => (
                  <BarRow key={item.label} label={item.label} count={item.count} max={alcoholMax} />
                ))}
              </div>
            </section>
          )}

          {whoFreq.length > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
              <h2 className="text-sm font-semibold text-neutral-600">誰と行くことが多いか</h2>
              <div className="flex flex-col gap-2">
                {whoFreq.map((item) => (
                  <BarRow key={item.label} label={item.label} count={item.count} max={whoMax} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
