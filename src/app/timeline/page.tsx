"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ALCOHOL_ICONS, ALCOHOL_OPTIONS, type AlcoholTag } from "@/constants/choices";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonList } from "@/components/Skeleton";
import { estimateAverageBudget } from "@/lib/budget";
import { deleteVisit } from "@/lib/db/checkin";
import { useTimelineVisits, type VisitWithVenue } from "@/lib/db/queries";
import { SAVED_TOAST_KEY } from "@/lib/sessionFlags";
import { formatMonthLabel, monthKey } from "@/lib/time";

const ALCOHOL_FILTERS = ALCOHOL_OPTIONS.map((tag) => ({ tag, icon: ALCOHOL_ICONS[tag] }));

const MONTHS_PER_PAGE = 6;
const FILTER_STORAGE_KEY = "matane:timelineFilter";
const SAVED_TOAST_VALID_MS = 5000;
const SAVED_TOAST_VISIBLE_MS = 2000;

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
  // 直前に選んでいたお酒フィルターをセッション内で覚えておき、画面を出入りするたびに
  // 選び直さなくて済むようにする(端末再起動やタブを閉じれば自然にリセットされる)。
  // sessionStorageはSSR側で読めないため、初期値はSSRと揃えてnullにし、マウント後の
  // effectで復元する(hydrationミスマッチを避けるため)。
  const [activeTag, setActiveTag] = useState<AlcoholTag | null>(null);
  const [visibleMonthCount, setVisibleMonthCount] = useState(MONTHS_PER_PAGE);
  const [deleteTarget, setDeleteTarget] = useState<VisitWithVenue | null>(null);
  // 二次登録画面の保存直後の遷移でだけ「保存しました」を一瞬表示する(同様の理由でfalse始まり)。
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    if ((ALCOHOL_OPTIONS as readonly string[]).includes(stored ?? "")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setActiveTag(stored as AlcoholTag);
    }
  }, []);

  useEffect(() => {
    if (activeTag) {
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, activeTag);
    } else {
      window.sessionStorage.removeItem(FILTER_STORAGE_KEY);
    }
  }, [activeTag]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(SAVED_TOAST_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(SAVED_TOAST_KEY);
    if (Date.now() - Number(raw) < SAVED_TOAST_VALID_MS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setSavedToast(true);
    }
  }, []);

  useEffect(() => {
    if (!savedToast) return;
    const timer = setTimeout(() => setSavedToast(false), SAVED_TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [savedToast]);

  const filtered = useMemo(() => {
    if (!visits) return [];
    if (!activeTag) return visits;
    return visits.filter((visit) => visit.alcohol_tags.includes(activeTag));
  }, [visits, activeTag]);

  const monthGroups = useMemo(() => groupByMonth(filtered), [filtered]);
  const visibleGroups = monthGroups.slice(0, visibleMonthCount);
  const hasMore = monthGroups.length > visibleMonthCount;

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    await deleteVisit(deleteTarget.id);
    setDeleteTarget(null);
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
            className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-colors focus:ring-2 focus:ring-amber-400 ${
              activeTag === tag ? "bg-amber-400" : "bg-neutral-900"
            }`}
            aria-label={tag}
            aria-pressed={activeTag === tag}
          >
            {icon}
          </button>
        ))}
      </div>

      {!visits ? (
        <SkeletonList />
      ) : monthGroups.length === 0 ? (
        <p className="text-sm text-neutral-400">まだ訪問記録がありません。</p>
      ) : (
        <div className="flex flex-col gap-6">
          {visibleGroups.map((group) => {
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
                          visit.is_completed
                            ? `/visits/${visit.id}`
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
                          ) : visit.alcohol_tags.length > 0 ? (
                            ALCOHOL_ICONS[visit.alcohol_tags[0]]
                          ) : (
                            "🏮"
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {visit.venue?.name || "店名未設定"}
                            {!visit.is_completed && (
                              <span className="ml-2 text-xs text-amber-400">登録待ち</span>
                            )}
                          </p>
                          <p className="text-xs text-neutral-400">
                            {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                            {visit.alcohol_tags.length > 0 &&
                              ` ・ ${visit.alcohol_tags.join("/")}`}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(visit)}
                        aria-label="削除"
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-neutral-400 focus:ring-2 focus:ring-amber-400 active:bg-neutral-800"
                      >
                        🗑
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleMonthCount((count) => count + MONTHS_PER_PAGE)}
              className="rounded-full bg-neutral-900 py-3 text-sm font-semibold text-neutral-200 focus:ring-2 focus:ring-amber-400"
            >
              もっと見る
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        message={`${deleteTarget?.venue?.name || "この記録"}を削除しますか？この操作は取り消せません。`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {savedToast && (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-xl bg-neutral-800 px-4 py-3 text-center text-sm shadow-lg">
          保存しました
        </div>
      )}
    </main>
  );
}
