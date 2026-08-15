"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { commuteDestinations } from "@/config/commute";
import {
  clearCommuteOverrides,
  loadCommuteOverrides,
  saveCommuteOverrides,
  type CommuteOverride,
  type CommuteOverrides,
} from "@/lib/commuteSettings";
import { useTimelineVisits } from "@/lib/db/queries";
import { downloadTextFile, visitsToCsv, visitsToIcs } from "@/lib/export";

const COMMUTE_SAVED_VISIBLE_MS = 2000;

function defaultCommuteDrafts(): CommuteOverrides {
  return Object.fromEntries(
    commuteDestinations.map((destination) => [
      destination.id,
      { label: destination.label, lastTrain: destination.defaultLastTrain },
    ])
  );
}

function destinationLabel(id: string): string {
  return id === "home" ? "自宅" : id === "work" ? "職場" : id;
}

export default function SettingsPage() {
  const visits = useTimelineVisits();
  // 未登録(二次登録待ち)の訪問は予算・お酒タグ等が空のため書き出し対象から除く。
  const completed = useMemo(() => (visits ?? []).filter((visit) => visit.is_completed), [visits]);
  const hasCompleted = completed.length > 0;

  // localStorageの上書きはSSR時点で読めないため、初期値は環境変数由来のデフォルトにし、
  // マウント後のeffectで反映する(hydrationミスマッチを避けるため)。
  const [commuteDrafts, setCommuteDrafts] = useState<CommuteOverrides>(defaultCommuteDrafts);
  const [commuteSaved, setCommuteSaved] = useState(false);

  useEffect(() => {
    const stored = loadCommuteOverrides();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setCommuteDrafts((current) => ({ ...current, ...stored }));
    }
  }, []);

  useEffect(() => {
    if (!commuteSaved) return;
    const timer = setTimeout(() => setCommuteSaved(false), COMMUTE_SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [commuteSaved]);

  function updateCommuteDraft(id: string, patch: Partial<CommuteOverride>) {
    setCommuteDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  function handleSaveCommute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 空欄のまま保存すると、店舗詳細側はwithCommuteOverridesが既定値にフォールバック
    // する一方でこの画面の入力欄だけ空欄で残り、実際の表示値と食い違って見える。
    // 保存時点で既定値へ正規化し、フォームと実際の表示を一致させる。
    const normalized: CommuteOverrides = {};
    for (const destination of commuteDestinations) {
      const draft = commuteDrafts[destination.id];
      normalized[destination.id] = {
        label: draft?.label.trim() || destination.label,
        lastTrain: draft?.lastTrain.trim() || destination.defaultLastTrain,
      };
    }
    saveCommuteOverrides(normalized);
    setCommuteDrafts(normalized);
    setCommuteSaved(true);
  }

  function handleResetCommute() {
    clearCommuteOverrides();
    setCommuteDrafts(defaultCommuteDrafts());
    setCommuteSaved(false);
  }

  function handleExportCsv() {
    downloadTextFile("matane-visits.csv", visitsToCsv(completed), "text/csv;charset=utf-8");
  }

  function handleExportIcs() {
    downloadTextFile("matane-visits.ics", visitsToIcs(completed), "text/calendar;charset=utf-8");
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">設定</h1>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
        <h2 className="text-sm font-semibold text-neutral-600">👨‍👩‍👧 グループ共有</h2>
        <p className="text-xs text-neutral-500">
          夫婦・家族とVisits・気になるリストを共有できます。
        </p>
        <Link
          href="/group"
          className="rounded-full bg-neutral-200 py-3 text-center text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400"
        >
          グループ設定を開く
        </Link>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
        <h2 className="text-sm font-semibold text-neutral-600">🚃 終電・帰宅アラート</h2>
        <p className="text-xs text-neutral-500">
          店舗詳細に表示される終電目安時刻です。日をまたぐ場合は「25:30」のように24時以降の表記で入力できます。
        </p>
        <form onSubmit={handleSaveCommute} className="flex flex-col gap-4">
          {commuteDestinations.map((destination) => {
            const draft = commuteDrafts[destination.id] ?? {
              label: destination.label,
              lastTrain: destination.defaultLastTrain,
            };
            const label = destinationLabel(destination.id);
            return (
              <div key={destination.id} className="flex flex-col gap-2">
                <span className="text-xs font-medium text-neutral-600">{label}</span>
                <div className="flex gap-2">
                  <input
                    value={draft.label}
                    onChange={(event) =>
                      updateCommuteDraft(destination.id, { label: event.target.value })
                    }
                    placeholder="表示名"
                    maxLength={20}
                    aria-label={`${label}の表示名`}
                    className="flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <input
                    value={draft.lastTrain}
                    onChange={(event) =>
                      updateCommuteDraft(destination.id, { lastTrain: event.target.value })
                    }
                    placeholder="24:00"
                    maxLength={5}
                    aria-label={`${label}の終電時刻`}
                    className="w-24 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400"
            >
              保存する
            </button>
            <button
              type="button"
              onClick={handleResetCommute}
              className="rounded-full bg-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400"
            >
              既定に戻す
            </button>
          </div>
          {commuteSaved && <p className="text-xs text-amber-600">保存しました</p>}
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
        <h2 className="text-sm font-semibold text-neutral-600">エクスポート</h2>
        <p className="text-xs text-neutral-500">登録済みの訪問記録をまとめて書き出します。</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!hasCompleted}
            className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 active:bg-neutral-300 disabled:opacity-50"
          >
            CSVで書き出す
          </button>
          <button
            type="button"
            onClick={handleExportIcs}
            disabled={!hasCompleted}
            className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 active:bg-neutral-300 disabled:opacity-50"
          >
            カレンダーに書き出す
          </button>
        </div>
      </section>
    </main>
  );
}
