"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import {
  createCheckInByVenueName,
  createCheckInForVenue,
  createInstantCheckIn,
  scheduleBackgroundSync,
  undoCheckIn,
} from "@/lib/db/checkin";
import type { LocalVenue } from "@/lib/db/localDb";
import { searchVenuesLocal, useIncompleteVisits, useSuggestedVenue } from "@/lib/db/queries";
import { getCurrentLocation } from "@/lib/geo";

const VENUE_NAME_MAX_LENGTH = 100;

export default function HomePage() {
  const [checkingIn, setCheckingIn] = useState(false);
  const [undoVisitId, setUndoVisitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocalVenue[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [instantNameInput, setInstantNameInput] = useState("");
  const router = useRouter();

  const incompleteVisits = useIncompleteVisits();
  const suggestion = useSuggestedVenue();

  useEffect(() => {
    if (!undoVisitId) return;
    const timer = setTimeout(() => {
      setUndoVisitId(null);
      scheduleBackgroundSync();
    }, 5000);
    return () => clearTimeout(timer);
  }, [undoVisitId]);

  useEffect(() => {
    let active = true;
    searchVenuesLocal(searchQuery).then((results) => {
      if (active) setSearchResults(results);
    });
    return () => {
      active = false;
    };
  }, [searchQuery]);

  function openNamePrompt() {
    setInstantNameInput("");
    setShowNamePrompt(true);
  }

  async function handleInstantCheckIn(name: string) {
    setShowNamePrompt(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const location = await getCurrentLocation();
      const visitId = await createInstantCheckIn(location, name);
      setUndoVisitId(visitId);
    } catch (error) {
      console.error(error);
      setErrorMessage("位置情報を取得できませんでした。設定をご確認ください。");
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleUndo() {
    if (!undoVisitId) return;
    await undoCheckIn(undoVisitId);
    setUndoVisitId(null);
  }

  async function goToRegisterForVenueId(venueId: string) {
    const visitId = await createCheckInForVenue(venueId);
    router.push(`/visits/${visitId}/register`);
  }

  async function goToRegisterForNewName(name: string) {
    const visitId = await createCheckInByVenueName(name);
    router.push(`/visits/${visitId}/register`);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 px-4 pt-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Matane</h1>
        <AuthStatus />
      </header>

      {errorMessage && (
        <p className="rounded-xl bg-red-950 px-4 py-3 text-sm text-red-300">{errorMessage}</p>
      )}

      <section className="flex flex-col items-center gap-4 py-8">
        <button
          type="button"
          onClick={openNamePrompt}
          disabled={checkingIn}
          className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-full bg-amber-400 text-black shadow-lg shadow-amber-400/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          {checkingIn ? (
            <span className="text-base font-semibold">登録中...</span>
          ) : (
            <>
              <span className="text-4xl">📍</span>
              <span className="text-base font-semibold">今ココを瞬録</span>
            </>
          )}
        </button>
      </section>

      {incompleteVisits && incompleteVisits.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-amber-400">⚠️ 登録待ち</h2>
          <ul className="flex flex-col gap-2">
            {incompleteVisits.map((visit) => (
              <li key={visit.id}>
                <Link
                  href={`/visits/${visit.id}/register`}
                  className="flex items-center justify-between rounded-xl bg-neutral-900 px-4 py-3 focus:ring-2 focus:ring-amber-400"
                >
                  <span>{visit.venue?.name || "店名未設定"}</span>
                  <span className="text-xs text-neutral-400">
                    {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-400" htmlFor="venue-search">
          後から登録（店名・駅名で検索）
        </label>
        <input
          id="venue-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="店名または駅名"
          maxLength={100}
          className="rounded-xl bg-neutral-900 px-4 py-3 text-base outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-amber-400"
        />
        {searchQuery.trim() && (
          <ul className="flex flex-col gap-2">
            {searchResults.map((venue) => (
              <li key={venue.id}>
                <button
                  type="button"
                  data-venue-id={venue.id}
                  onClick={() => goToRegisterForVenueId(venue.id)}
                  className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-left focus:ring-2 focus:ring-amber-400"
                >
                  {venue.name}
                  {venue.nearest_station && (
                    <span className="ml-2 text-xs text-neutral-400">
                      {venue.nearest_station}
                    </span>
                  )}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => goToRegisterForNewName(searchQuery.trim())}
                className="w-full rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-left text-neutral-400 focus:ring-2 focus:ring-amber-400"
              >
                「{searchQuery.trim()}」で新規チェックイン
              </button>
            </li>
          </ul>
        )}
      </section>

      {suggestion?.venue && (
        <section className="rounded-2xl bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-amber-400">今日どこ行く？</h2>
          <p className="mt-2 text-base font-medium">{suggestion.venue.name}</p>
          <p className="text-xs text-neutral-400">
            前回: {new Date(suggestion.visited_at).toLocaleDateString("ja-JP")}
            ・しばらく行っていません
          </p>
          <Link
            href={`/venues/${suggestion.venue.id}`}
            className="mt-3 inline-block rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-200"
          >
            店舗詳細を見る
          </Link>
        </section>
      )}

      {showNamePrompt && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="名前わかる？"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowNamePrompt(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-900 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-100">名前わかる？</p>
            <input
              autoFocus
              value={instantNameInput}
              onChange={(event) => setInstantNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleInstantCheckIn(instantNameInput);
              }}
              placeholder="わからなければ空欄でOK"
              maxLength={VENUE_NAME_MAX_LENGTH}
              className="mt-4 w-full rounded-xl bg-neutral-800 px-4 py-3 text-base outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-amber-400"
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowNamePrompt(false)}
                className="flex-1 rounded-full bg-neutral-800 py-3 text-sm font-semibold text-neutral-200 focus:ring-2 focus:ring-amber-400"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleInstantCheckIn(instantNameInput)}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400"
              >
                登録する
              </button>
            </div>
          </div>
        </div>
      )}

      {undoVisitId && (
        <div className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between rounded-xl bg-neutral-800 px-4 py-3 shadow-lg">
          <span className="text-sm">チェックインしました</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-semibold text-amber-400 focus:ring-2 focus:ring-amber-400"
          >
            取り消す
          </button>
        </div>
      )}
    </main>
  );
}
