"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  commuteDestinations,
  getLastTrainTime,
  getPriorityDestinationId,
} from "@/config/commute";
import { duplicateVisit } from "@/lib/db/checkin";
import { useVenue, useVisitsForVenue } from "@/lib/db/queries";

export function VenueDetailClient({ venueId }: { venueId: string }) {
  const venue = useVenue(venueId);
  const visits = useVisitsForVenue(venueId);
  const router = useRouter();
  const [checkingIn, setCheckingIn] = useState(false);

  const priorityId = useMemo(() => getPriorityDestinationId(new Date()), []);
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
      <header>
        <h1 className="text-lg font-bold">{venue.name || "店名未設定"}</h1>
        {venue.nearest_station && (
          <p className="text-xs text-neutral-400">最寄り駅: {venue.nearest_station}</p>
        )}
        {venue.address && <p className="text-xs text-neutral-400">{venue.address}</p>}
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
          {commuteDestinations.map((destination) => (
            <li
              key={destination.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                destination.id === priorityId
                  ? "bg-amber-400/10 text-amber-300"
                  : "text-neutral-300"
              }`}
            >
              <span>{destination.label}</span>
              <span className="font-mono">
                {getLastTrainTime(destination, venue.nearest_station)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
