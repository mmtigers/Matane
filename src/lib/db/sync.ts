import { getSupabaseClient } from "@/lib/supabase/client";
import type { LatLng, Visit } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";

let syncing = false;
let pulling = false;

// SupabaseのlocationはPostGIS geography(point,4326)列で、プレーンな{lat,lng}オブジェクトを
// upsertすると型キャストに失敗し、error（=永久にsyncStatus: "pending"のまま）になる。
// geography列はEWKTテキスト("SRID=4326;POINT(lng lat)")を受け付けるため変換して送る。
// created_byはRLSのINSERT/UPDATEポリシーが要求するため必須で付与する。
function toVenueRecord(venue: LocalVenue, userId: string) {
  const { id, place_id, name, location, address, nearest_station } = venue;
  return {
    id,
    place_id,
    name,
    location: location ? `SRID=4326;POINT(${location.lng} ${location.lat})` : null,
    address,
    nearest_station,
    created_by: userId,
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

// PostgRESTはgeography列を返す際、通常GeoJSON({"type":"Point","coordinates":[lng,lat]})
// として返す。未知の形式(hex EWKB等)が返った場合は安全側に倒しGPS座標なしで取り込む。
function fromCloudLocation(raw: unknown): LatLng | null {
  if (!raw) return null;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "coordinates" in raw &&
    Array.isArray((raw as { coordinates: unknown }).coordinates)
  ) {
    const [lng, lat] = (raw as { coordinates: [number, number] }).coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  console.warn("位置情報の形式を解釈できませんでした。GPS座標なしで取り込みます:", raw);
  return null;
}

interface CloudVenueRow {
  id: string;
  place_id: string | null;
  name: string;
  location: unknown;
  address: string | null;
  nearest_station: string | null;
}

interface CloudVisitRow extends Visit {
  user_id: string;
}

function fromVenueRecord(row: CloudVenueRow): LocalVenue {
  return {
    id: row.id,
    place_id: row.place_id,
    name: row.name,
    location: fromCloudLocation(row.location),
    address: row.address,
    nearest_station: row.nearest_station,
    syncStatus: "synced",
  };
}

function fromVisitRecord(row: CloudVisitRow): LocalVisit {
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
  } = row;
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
    syncStatus: "synced",
  };
}

// 通信回復時に呼び出し、syncStatus: "pending" のVenues/Visitsをクラウドへ送る。
// id はローカル生成のUUIDをそのまま使うためupsertで冪等に扱える。行単位ではなく
// 配列でまとめてupsertし、往復回数をN回から1〜2回に減らす。
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

    if (pendingVenues.length > 0) {
      const { error } = await supabase
        .from("venues")
        .upsert(pendingVenues.map((v) => toVenueRecord(v, userId)));

      if (error) {
        console.warn(`venues同期に失敗しました(${pendingVenues.length}件):`, error);
      } else {
        await localDb.venues.bulkUpdate(
          pendingVenues.map((v) => ({ key: v.id, changes: { syncStatus: "synced" as const } }))
        );
      }
    }

    const pendingVisits = await localDb.visits
      .where("syncStatus")
      .equals("pending")
      .toArray();

    if (pendingVisits.length > 0) {
      const { error } = await supabase
        .from("visits")
        .upsert(pendingVisits.map((v) => toVisitRecord(v, userId)));

      if (error) {
        console.warn(`visits同期に失敗しました(${pendingVisits.length}件):`, error);
      } else {
        await localDb.visits.bulkUpdate(
          pendingVisits.map((v) => ({ key: v.id, changes: { syncStatus: "synced" as const } }))
        );
      }
    }
  } catch (error) {
    console.warn("Supabaseへの同期をスキップしました:", error);
  } finally {
    syncing = false;
  }
}

// クラウド→ローカルの取り込み(ログイン直後・起動時に一度実行)。他端末で記録した
// データや、この端末のIndexedDBが空になった場合(再インストール等)の復元に使う。
// ローカルにまだ送信していない変更(syncStatus: "pending")がある行は、クラウドの
// 古い値で上書きしないようスキップする。
export async function pullFromCloud() {
  if (pulling) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  pulling = true;
  try {
    const supabase = getSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data: remoteVisits, error: visitsError } = await supabase
      .from("visits")
      .select("*")
      .eq("user_id", userId);

    if (visitsError) {
      console.warn("visitsのpullに失敗しました:", visitsError);
      return;
    }

    const venueIds = [...new Set((remoteVisits ?? []).map((v) => v.venue_id as string))];
    let remoteVenues: CloudVenueRow[] = [];
    if (venueIds.length > 0) {
      const { data, error: venuesError } = await supabase
        .from("venues")
        .select("*")
        .in("id", venueIds);

      if (venuesError) {
        console.warn("venuesのpullに失敗しました:", venuesError);
        return;
      }
      remoteVenues = (data ?? []) as CloudVenueRow[];
    }

    for (const row of remoteVenues) {
      const local = await localDb.venues.get(row.id);
      if (local?.syncStatus === "pending") continue;
      await localDb.venues.put(fromVenueRecord(row));
    }

    for (const row of (remoteVisits ?? []) as CloudVisitRow[]) {
      const local = await localDb.visits.get(row.id);
      if (local?.syncStatus === "pending") continue;
      await localDb.visits.put(fromVisitRecord(row));
    }
  } catch (error) {
    console.warn("Supabaseからの取り込みをスキップしました:", error);
  } finally {
    pulling = false;
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
