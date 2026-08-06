"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  commuteDestinations,
  getLastTrainTime,
  getMinutesUntilLastTrain,
  getPriorityDestinationId,
} from "@/config/commute";
import { duplicateVisit, toggleVenueWish } from "@/lib/db/checkin";
import { useVenue, useVisitsForVenue } from "@/lib/db/queries";

export function VenueDetailClient({ venueId }: { venueId: string }) {
  const venue = useVenue(venueId);
  const visits = useVisitsForVenue(venueId);
  const router = useRouter();
  const [checkingIn, setCheckingIn] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const priorityId = useMemo(() => getPriorityDestinationId(now), [now]);
  const latestCompleted = visits?.find((visit) => visit.is_completed) ?? null;

  async function handleRepeatCheckIn() {
    if (!latestCompleted) return;
    setCheckingIn(true);
    try {
      await duplicateVisit(latestCompleted);
      router.push("/timeline");
    } finally {
      setCheckingIn(false);
    }
  }

  if (!venue || !visits) {
    return <main className="px-4 pt-8 text-sm text-neutral-400">読み込み中...</main>;
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{venue.name || "店名未設定"}</h1>
          {venue.nearest_station && (
            <p className="text-xs text-neutral-400">最寄り駅: {venue.nearest_station}</p>
          )}
          {venue.address && <p className="text-xs text-neutral-400">{venue.address}</p>}
        </div>
        <button
          type="button"
          onClick={() => toggleVenueWish(venueId, !venue.is_wished)}
          aria-label={venue.is_wished ? "行きたいリストから外す" : "行きたいリストに追加"}
          aria-pressed={venue.is_wished}
          className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-xl transition-colors focus:ring-2 focus:ring-amber-400 ${
            venue.is_wished ? "bg-amber-400/20 text-amber-300" : "bg-neutral-900 text-neutral-500"
          }`}
        >
          {venue.is_wished ? "⭐" : "☆"}
        </button>
      </header>

      {latestCompleted && (
        <button
          type="button"
          onClick={handleRepeatCheckIn}
          disabled={checkingIn}
          className="rounded-full bg-amber-400 py-4 text-base font-semibold text-black focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
        >
          {checkingIn ? "登録中..." : "前回の設定でチェックイン"}
        </button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-400">これまでの訪問</h2>
        {visits.length === 0 ? (
          <p className="text-sm text-neutral-400">まだ訪問記録がありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visits.map((visit) => {
              const content = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                    </span>
                    {!visit.is_completed && (
                      <span className="text-xs text-amber-400">登録待ち</span>
                    )}
                  </div>
                  {visit.best_photo && (
                    // eslint-disable-next-line @next/next/no-img-element -- ローカルdata URLサムネイル
                    <img
                      src={visit.best_photo}
                      alt=""
                      className="mt-2 h-40 w-full rounded-lg object-cover"
                    />
                  )}
                  {(visit.who.length > 0 || visit.alcohol_tags.length > 0) && (
                    <p className="mt-2 text-xs text-neutral-400">
                      {[...visit.who, ...visit.alcohol_tags].join(" / ")}
                    </p>
                  )}
                  {visit.memo && <p className="mt-2 text-sm text-neutral-300">{visit.memo}</p>}
                </>
              );

              return (
                <li key={visit.id}>
                  <Link
                    href={
                      visit.is_completed
                        ? `/visits/${visit.id}`
                        : `/visits/${visit.id}/register`
                    }
                    className="block rounded-xl bg-neutral-900 p-4 focus:ring-2 focus:ring-amber-400"
                  >
                    {content}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-amber-400">🚃 終電・帰宅アラート</h2>
        <ul className="flex flex-col gap-1">
          {commuteDestinations.map((destination) => {
            const lastTrainTime = getLastTrainTime(destination, venue.nearest_station);
            const minutesLeft = getMinutesUntilLastTrain(lastTrainTime, now);
            const missed = minutesLeft < 0;
            const urgent = !missed && minutesLeft <= 30;
            return (
              <li
                key={destination.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  urgent
                    ? "bg-red-500/10 text-red-300"
                    : destination.id === priorityId
                      ? "bg-amber-400/10 text-amber-300"
                      : "text-neutral-300"
                }`}
              >
                <span>{destination.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{lastTrainTime}</span>
                  <span className="text-xs">
                    {missed
                      ? "終電を逃しました"
                      : Number.isFinite(minutesLeft)
                        ? `あと${minutesLeft}分`
                        : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
