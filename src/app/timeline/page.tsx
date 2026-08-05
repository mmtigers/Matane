"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { estimateAverageBudget } from "@/lib/budget";
import { deleteVisit } from "@/lib/db/checkin";
import { useTimelineVisits, type VisitWithVenue } from "@/lib/db/queries";
import { formatMonthLabel, monthKey } from "@/lib/time";
import type { AlcoholTag } from "@/types/models";

const ALCOHOL_FILTERS: { icon: string; tag: AlcoholTag }[] = [
  { icon: "🍶", tag: "日本酒" },
  { icon: "🥃", tag: "ハイボール" },
  { icon: "🍺", tag: "ビール" },
  { icon: "🍷", tag: "その他" },
];

interface MonthGroup {
  key: string;
  label: string;
  visits: VisitWithVenue[];
}

function groupByMonth(visits: VisitWithVenue[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();

  for (const visit of visits) {
    const date = new Date(visit.visited_at);
    const key = monthKey(date);
    const group = groups.get(key);
    if (group) {
      group.visits.push(visit);
    } else {
      groups.set(key, { key, label: formatMonthLabel(date), visits: [visit] });
    }
  }

  return Array.from(groups.values());
}

export default function TimelinePage() {
  const visits = useTimelineVisits();
  const [activeTag, setActiveTag] = useState<AlcoholTag | null>(null);

  const filtered = useMemo(() => {
    if (!visits) return [];
    if (!activeTag) return visits;
    return visits.filter((visit) => visit.alcohol_tags.includes(activeTag));
  }, [visits, activeTag]);

  const monthGroups = useMemo(() => groupByMonth(filtered), [filtered]);

  async function handleDelete(visit: VisitWithVenue) {
    const label = visit.venue?.name || "この記録";
    if (!window.confirm(`${label}を削除しますか？この操作は取り消せません。`)) return;
    await deleteVisit(visit.id);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">タイムライン</h1>
      </header>

      <div className="flex gap-2">
        {ALCOHOL_FILTERS.map(({ icon, tag }) => (
          <button
            key={tag}
            type="button"
            onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-colors ${
              activeTag === tag ? "bg-amber-400" : "bg-neutral-900"
            }`}
            aria-label={tag}
          >
            {icon}
          </button>
        ))}
      </div>

      {!visits ? (
        <p className="text-sm text-neutral-500">読み込み中...</p>
      ) : monthGroups.length === 0 ? (
        <p className="text-sm text-neutral-500">まだ訪問記録がありません。</p>
      ) : (
        <div className="flex flex-col gap-6">
          {monthGroups.map((group) => {
            const avgBudget = estimateAverageBudget(
              group.visits.flatMap((visit) => (visit.budget ? [visit.budget] : []))
            );
            return (
              <section key={group.key} className="flex flex-col gap-3">
                <h2 className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-300">
                  {group.label} （{group.visits.length}回
                  {avgBudget !== null && ` / 平均¥${avgBudget.toLocaleString("ja-JP")}`}）
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.visits.map((visit) => (
                    <li
                      key={visit.id}
                      className="flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-3"
                    >
                      <Link
                        href={
                          visit.venue
                            ? `/venues/${visit.venue.id}`
                            : `/visits/${visit.id}/register`
                        }
                        className="flex flex-1 items-center gap-3 min-w-0"
                      >
                        <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-lg bg-neutral-800 text-lg">
                          {visit.best_photo ? (
                            // eslint-disable-next-line @next/next/no-img-element -- ローカルdata URLサムネイル
                            <img
                              src={visit.best_photo}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            "🍶"
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {visit.venue?.name || "店名未設定"}
                            {!visit.is_completed && (
                              <span className="ml-2 text-xs text-amber-400">盛り付け待ち</span>
                            )}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                            {visit.alcohol_tags.length > 0 &&
                              ` ・ ${visit.alcohol_tags.join("/")}`}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(visit)}
                        aria-label="削除"
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-neutral-500 active:bg-neutral-800"
                      >
                        🗑
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
