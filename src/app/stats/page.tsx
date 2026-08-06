"use client";

import { useMemo } from "react";
import { BarRow } from "@/components/BarRow";
import { useTimelineVisits } from "@/lib/db/queries";
import { alcoholTagFrequency, monthlyVisitCounts, overallAverageBudget, whoFrequency } from "@/lib/stats";

export default function StatsPage() {
  const visits = useTimelineVisits();

  // 未登録(二次登録待ち)の訪問は予算・お酒タグ等が空のため集計対象から除く。
  const completed = useMemo(() => (visits ?? []).filter((visit) => visit.is_completed), [visits]);

  const monthly = useMemo(() => monthlyVisitCounts(completed), [completed]);
  const monthlyMax = Math.max(1, ...monthly.map((m) => m.count));
  const alcoholFreq = useMemo(() => alcoholTagFrequency(completed), [completed]);
  const alcoholMax = Math.max(1, ...alcoholFreq.map((item) => item.count));
  const whoFreq = useMemo(() => whoFrequency(completed), [completed]);
  const whoMax = Math.max(1, ...whoFreq.map((item) => item.count));
  const avgBudget = useMemo(() => overallAverageBudget(completed), [completed]);
  const venueCount = useMemo(
    () => new Set(completed.map((visit) => visit.venue_id)).size,
    [completed]
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">統計</h1>
      </header>

      {!visits ? (
        <p className="text-sm text-neutral-400">読み込み中...</p>
      ) : completed.length === 0 ? (
        <p className="text-sm text-neutral-400">まだ訪問記録がありません。</p>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-neutral-900 p-4 text-center">
              <p className="text-2xl font-bold text-amber-300">{completed.length}</p>
              <p className="mt-1 text-xs text-neutral-400">総訪問回数</p>
            </div>
            <div className="rounded-2xl bg-neutral-900 p-4 text-center">
              <p className="text-2xl font-bold text-amber-300">{venueCount}</p>
              <p className="mt-1 text-xs text-neutral-400">訪問した店舗数</p>
            </div>
            <div className="rounded-2xl bg-neutral-900 p-4 text-center">
              <p className="text-2xl font-bold text-amber-300">
                {avgBudget !== null ? `¥${avgBudget.toLocaleString("ja-JP")}` : "—"}
              </p>
              <p className="mt-1 text-xs text-neutral-400">平均予算</p>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-900 p-4">
            <h2 className="text-sm font-semibold text-neutral-400">月別訪問回数</h2>
            <div className="flex flex-col gap-2">
              {monthly.map((month) => (
                <BarRow key={month.key} label={month.label} count={month.count} max={monthlyMax} />
              ))}
            </div>
          </section>

          {alcoholFreq.length > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl bg-neutral-900 p-4">
              <h2 className="text-sm font-semibold text-neutral-400">よく飲むお酒</h2>
              <div className="flex flex-col gap-2">
                {alcoholFreq.map((item) => (
                  <BarRow key={item.label} label={item.label} count={item.count} max={alcoholMax} />
                ))}
              </div>
            </section>
          )}

          {whoFreq.length > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl bg-neutral-900 p-4">
              <h2 className="text-sm font-semibold text-neutral-400">誰と行くことが多いか</h2>
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
