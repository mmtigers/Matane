"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ALCOHOL_ICONS, ALCOHOL_OPTIONS, type AlcoholTag } from "@/constants/choices";
import { SkeletonList } from "@/components/Skeleton";
import { estimateAverageBudget } from "@/lib/budget";
import { deleteVisit, restoreVisit } from "@/lib/db/checkin";
import { useTimelineVisits, type VisitWithVenue } from "@/lib/db/queries";
import { SAVED_TOAST_KEY } from "@/lib/sessionFlags";
import { formatMonthLabel, monthKey } from "@/lib/time";

const ALCOHOL_FILTERS = ALCOHOL_OPTIONS.map((tag) => ({ tag, icon: ALCOHOL_ICONS[tag] }));

const MONTHS_PER_PAGE = 6;
const FILTER_STORAGE_KEY = "matane:timelineFilter";
const SAVED_TOAST_VALID_MS = 5000;
const TOAST_VISIBLE_MS = 2000;
const DELETE_UNDO_VISIBLE_MS = 5000;

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
  // 保存直後の遷移など、一時的な単発メッセージをまとめて扱う
  // (同時に出さない前提のため単一の状態で十分)。
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // 削除は行きたいリストと同じ「即実行+5秒アンドゥ」方式に統一する(削除自体は
  // deleteVisitで即座に実行し、取り消された場合のみrestoreVisitで書き戻す)。
  const [undoDelete, setUndoDelete] = useState<VisitWithVenue | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const jumpSelectRef = useRef<HTMLSelectElement>(null);

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
      setToastMessage("保存しました");
    }
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!undoDelete) return;
    const timer = setTimeout(() => setUndoDelete(null), DELETE_UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undoDelete]);

  const filtered = useMemo(() => {
    if (!visits) return [];
    if (!activeTag) return visits;
    return visits.filter((visit) => visit.alcohol_tags.includes(activeTag));
  }, [visits, activeTag]);

  const monthGroups = useMemo(() => groupByMonth(filtered), [filtered]);
  const visibleGroups = useMemo(
    () => monthGroups.slice(0, visibleMonthCount),
    [monthGroups, visibleMonthCount]
  );
  const hasMore = monthGroups.length > visibleMonthCount;

  // 月ジャンプ選択後、対象の月がまだ折りたたまれていれば表示件数を広げてからスクロールする。
  // visibleMonthCountの反映(再描画でDOMに月見出しが現れる)を待つ必要があるため、
  // ジャンプ先のkeyをstateに置いてuseEffectでDOM出現後にscrollIntoViewする。
  // 要素が見つからない場合(フィルター変更等で対象月が消えた等の稀なケース)でも
  // jumpTargetを残さず必ずクリアし、次回のジャンプ操作に影響しないようにする。
  useEffect(() => {
    if (!jumpTarget) return;
    const el = document.getElementById(`month-${jumpTarget}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- スクロール実行(DOM操作)の直後に一度だけトリガーを消費する後始末で、レンダー結果には影響しない
    setJumpTarget(null);
  }, [jumpTarget]);

  function handleJumpToMonth(key: string) {
    const index = monthGroups.findIndex((group) => group.key === key);
    if (index === -1) return;
    setVisibleMonthCount((count) => Math.max(count, index + 1));
    setJumpTarget(key);
    // valueを""固定のジャンプ専用セレクトのため、選択直後にフォーカスを外し
    // 見た目のラベルが即座に「月を選ぶ」へ戻るようにする。
    jumpSelectRef.current?.blur();
  }

  async function handleDelete(visit: VisitWithVenue) {
    await deleteVisit(visit.id);
    setUndoDelete(visit);
  }

  async function handleUndoDelete() {
    if (!undoDelete) return;
    await restoreVisit(undoDelete);
    setUndoDelete(null);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">あしあと</h1>
      </header>

      <div className="flex items-center gap-2">
        <div className="flex gap-2">
          {ALCOHOL_FILTERS.map(({ icon, tag }) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-colors focus:ring-2 focus:ring-amber-400 ${
                activeTag === tag ? "bg-amber-400" : "bg-neutral-100"
              }`}
              aria-label={tag}
              aria-pressed={activeTag === tag}
            >
              {icon}
            </button>
          ))}
        </div>

        {monthGroups.length > 1 && (
          <select
            ref={jumpSelectRef}
            value=""
            onChange={(event) => {
              if (event.target.value) handleJumpToMonth(event.target.value);
            }}
            aria-label="月を選んでジャンプ"
            className="ml-auto rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">月を選ぶ</option>
            {monthGroups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {!visits ? (
        <SkeletonList />
      ) : monthGroups.length === 0 ? (
        <p className="text-sm text-neutral-600">まだ訪問記録がありません。</p>
      ) : (
        <div className="flex flex-col gap-6">
          {visibleGroups.map((group) => {
            const avgBudget = estimateAverageBudget(
              group.visits.flatMap((visit) => (visit.budget ? [visit.budget] : []))
            );
            return (
              <section key={group.key} id={`month-${group.key}`} className="flex flex-col gap-3">
                <h2 className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-600">
                  {group.label} （{group.visits.length}回
                  {avgBudget !== null && ` / 平均¥${avgBudget.toLocaleString("ja-JP")}`}）
                </h2>
                <ul className="flex flex-col gap-2">
                  {group.visits.map((visit) => (
                    <li
                      key={visit.id}
                      className="flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-3"
                    >
                      <Link
                        href={
                          visit.is_completed
                            ? `/visits/${visit.id}`
                            : `/visits/${visit.id}/register`
                        }
                        className="flex flex-1 items-center gap-3 min-w-0"
                      >
                        <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-lg bg-neutral-200 text-lg">
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
                              <span className="ml-2 text-xs text-amber-600">登録待ち</span>
                            )}
                          </p>
                          <p className="text-xs text-neutral-600">
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
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-neutral-600 focus:ring-2 focus:ring-amber-400 active:bg-neutral-200"
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
              className="rounded-full bg-neutral-100 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400"
            >
              もっと見る
            </button>
          )}
        </div>
      )}

      {undoDelete ? (
        <div className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between rounded-xl bg-neutral-200 px-4 py-3 shadow-lg">
          <span className="text-sm">{undoDelete.venue?.name || "この記録"}を削除しました</span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
          >
            取り消す
          </button>
        </div>
      ) : (
        toastMessage && (
          <div className="fixed inset-x-4 bottom-24 z-50 rounded-xl bg-neutral-200 px-4 py-3 text-center text-sm shadow-lg">
            {toastMessage}
          </div>
        )
      )}
    </main>
  );
}
