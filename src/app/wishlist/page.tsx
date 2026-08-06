"use client";

import Link from "next/link";
import { toggleVenueWish } from "@/lib/db/checkin";
import { useWishedVenues } from "@/lib/db/queries";

export default function WishlistPage() {
  const venues = useWishedVenues();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">行きたい店</h1>
      </header>

      {!venues ? (
        <p className="text-sm text-neutral-400">読み込み中...</p>
      ) : venues.length === 0 ? (
        <p className="text-sm text-neutral-400">
          店舗詳細画面の☆ボタンから「行きたい店」に追加できます。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {venues.map((venue) => (
            <li
              key={venue.id}
              className="flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-3"
            >
              <Link href={`/venues/${venue.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-medium">{venue.name || "店名未設定"}</p>
                {(venue.nearest_station || venue.address) && (
                  <p className="text-xs text-neutral-400">
                    {venue.nearest_station || venue.address}
                  </p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => toggleVenueWish(venue.id, false)}
                aria-label="行きたいリストから外す"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-lg text-amber-300 focus:ring-2 focus:ring-amber-400 active:bg-neutral-800"
              >
                ⭐
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
