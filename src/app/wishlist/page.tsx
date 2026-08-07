"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SkeletonList } from "@/components/Skeleton";
import { toggleVenueWish } from "@/lib/db/checkin";
import type { LocalVenue } from "@/lib/db/localDb";
import { useWishedVenues } from "@/lib/db/queries";

const UNDO_VISIBLE_MS = 5000;

export default function WishlistPage() {
  const venues = useWishedVenues();
  const [undoVenue, setUndoVenue] = useState<LocalVenue | null>(null);

  useEffect(() => {
    if (!undoVenue) return;
    const timer = setTimeout(() => setUndoVenue(null), UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undoVenue]);

  async function handleRemove(venue: LocalVenue) {
    await toggleVenueWish(venue.id, false);
    setUndoVenue(venue);
  }

  async function handleUndo() {
    if (!undoVenue) return;
    await toggleVenueWish(undoVenue.id, true);
    setUndoVenue(null);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">行きたい店</h1>
      </header>

      {!venues ? (
        <SkeletonList />
      ) : venues.length === 0 ? (
        <p className="text-sm text-neutral-600">
          店舗詳細画面の☆ボタンや、ホーム画面の検索から「行きたい店」に追加できます。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {venues.map((venue) => (
            <li
              key={venue.id}
              className="flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-3"
            >
              <Link href={`/venues/${venue.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-medium">{venue.name || "店名未設定"}</p>
                {(venue.nearest_station || venue.address) && (
                  <p className="text-xs text-neutral-600">
                    {venue.nearest_station || venue.address}
                  </p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(venue)}
                aria-label="行きたいリストから外す"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-lg text-amber-600 focus:ring-2 focus:ring-amber-400 active:bg-neutral-200"
              >
                ⭐
              </button>
            </li>
          ))}
        </ul>
      )}

      {undoVenue && (
        <div className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between rounded-xl bg-neutral-200 px-4 py-3 shadow-lg">
          <span className="text-sm">
            {undoVenue.name || "この店"}を行きたいから外しました
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
          >
            取り消す
          </button>
        </div>
      )}
    </main>
  );
}
