import { getSupabaseClient } from "@/lib/supabase/client";
import type { Visit } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";

let syncing = false;

// SupabaseのlocationはPostGIS geography(point,4326)列で、プレーンな{lat,lng}オブジェクトを
// upsertすると型キャストに失敗し、error（=永久にsyncStatus: "pending"のまま）になる。
// geography列はEWKTテキスト("SRID=4326;POINT(lng lat)")を受け付けるため変換して送る。
function toVenueRecord(venue: LocalVenue) {
  const { id, place_id, name, location, address, nearest_station } = venue;
  return {
    id,
    place_id,
    name,
    location: location ? `SRID=4326;POINT(${location.lng} ${location.lat})` : null,
    address,
    nearest_station,
  };
}

// visitsテーブルはRLSで自分のuser_idの行のみ読み書きできるため、認証ユーザーIDを付与する。
function toVisitRecord(visit: LocalVisit, userId: string): Visit & { user_id: string } {
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
    user_id: userId,
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

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return; // 未ログインの間はRLSにより書き込めないため同期しない

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
      const { error } = await supabase.from("visits").upsert(toVisitRecord(visit, userId));
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
