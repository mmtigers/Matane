import { getSupabaseClient } from "@/lib/supabase/client";
import type { Venue, Visit } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";

let syncing = false;

function toVenueRecord(venue: LocalVenue): Venue {
  const { id, place_id, name, location, address, nearest_station } = venue;
  return { id, place_id, name, location, address, nearest_station };
}

function toVisitRecord(visit: LocalVisit): Visit {
  const {
    id,
    venue_id,
    visited_at,
    is_completed,
    who,
    revisit,
    budget,
    alcohol_tags,
    quietness,
    best_photo,
    memo,
    ai_tags,
  } = visit;
  return {
    id,
    venue_id,
    visited_at,
    is_completed,
    who,
    revisit,
    budget,
    alcohol_tags,
    quietness,
    best_photo,
    memo,
    ai_tags,
  };
}

// 通信回復時に呼び出し、syncStatus: "pending" のVenues/Visitsをクラウドへ送る。
// id はローカル生成のUUIDをそのまま使うためupsertで冪等に扱える。
export async function syncPendingChanges() {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  syncing = true;
  try {
    const supabase = getSupabaseClient();

    const pendingVenues = await localDb.venues
      .where("syncStatus")
      .equals("pending")
      .toArray();

    for (const venue of pendingVenues) {
      const { error } = await supabase.from("venues").upsert(toVenueRecord(venue));
      if (!error) {
        await localDb.venues.update(venue.id, { syncStatus: "synced" });
      }
    }

    const pendingVisits = await localDb.visits
      .where("syncStatus")
      .equals("pending")
      .toArray();

    for (const visit of pendingVisits) {
      const { error } = await supabase.from("visits").upsert(toVisitRecord(visit));
      if (!error) {
        await localDb.visits.update(visit.id, { syncStatus: "synced" });
      }
    }
  } catch (error) {
    console.warn("Supabaseへの同期をスキップしました:", error);
  } finally {
    syncing = false;
  }
}

// 起動時とオンライン復帰時に同期をトリガーする。オフライン中の変更をキャッシュに残したまま
// バックグラウンドで送信するため、UI側の待ち時間は発生しない。
export function registerSyncListeners() {
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    void syncPendingChanges();
  });

  void syncPendingChanges();
}
