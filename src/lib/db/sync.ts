import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import { uploadVisitPhotoIfNeeded } from "@/lib/storage";
import type { LatLng, PlaceCategory, VenueCategory, Visit } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";

let syncing = false;
let pulling = false;

// Postgresのunique_violation。venues.place_idのunique制約に当たった場合に使う。
const UNIQUE_VIOLATION = "23505";

// 複数端末でほぼ同時に同じ場所へチェックインした場合など、ローカルの重複チェック
// (findVenueByPlaceId)をすり抜けてplace_idが衝突することがある。その場合、この
// ローカルVenueはクラウドには存在しない「取り残された複製」なので、クラウド上の
// 本物のVenueを検索し、参照しているVisitをそちらへ差し替えて自己修復する
// (放置すると該当Venue/Visitが永久にsyncStatus: "pending"のまま残ってしまう)。
async function reconcileDuplicatePlaceId(
  supabase: SupabaseClient,
  localVenue: LocalVenue
): Promise<boolean> {
  if (!localVenue.place_id) return false;

  const { data } = await supabase
    .from("venues")
    .select("*")
    .eq("place_id", localVenue.place_id)
    .neq("id", localVenue.id)
    .limit(1);

  const existingRow = data?.[0] as CloudVenueRow | undefined;
  if (!existingRow) return false;

  // 他端末側のVenueをこの端末にも取り込んでおく(無いと差し替え直後は
  // 一時的に「店名未設定」表示になり、次回pullFromCloudまで解消しない)。
  await localDb.venues.put(fromVenueRecord(existingRow));

  const affectedVisits = await localDb.visits.where("venue_id").equals(localVenue.id).toArray();
  await localDb.visits.bulkUpdate(
    affectedVisits.map((v) => ({
      key: v.id,
      changes: { venue_id: existingRow.id, syncStatus: "pending" as const },
    }))
  );
  await localDb.venues.delete(localVenue.id);
  return true;
}

// SupabaseのlocationはPostGIS geography(point,4326)列で、プレーンな{lat,lng}オブジェクトを
// upsertすると型キャストに失敗し、error（=永久にsyncStatus: "pending"のまま）になる。
// geography列はEWKTテキスト("SRID=4326;POINT(lng lat)")を受け付けるため変換して送る。
// created_byはRLSのINSERT/UPDATEポリシーが要求するため必須で付与する。
function toVenueRecord(venue: LocalVenue, userId: string) {
  const {
    id,
    place_id,
    name,
    location,
    address,
    nearest_station,
    is_wished,
    category,
    wish_reason,
    place_category,
  } = venue;
  return {
    id,
    place_id,
    name,
    location: location ? `SRID=4326;POINT(${location.lng} ${location.lat})` : null,
    address,
    nearest_station,
    is_wished: is_wished ?? false,
    category: category ?? "bar",
    wish_reason: wish_reason ?? null,
    place_category: place_category ?? null,
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
  is_wished?: boolean | null;
  category?: VenueCategory | null;
  wish_reason?: string[] | null;
  place_category?: PlaceCategory | null;
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
    is_wished: row.is_wished ?? false,
    category: row.category ?? "bar",
    wish_reason: row.wish_reason ?? null,
    place_category: row.place_category ?? null,
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
    user_id,
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
    user_id,
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
      const venueRecords = pendingVenues.map((v) => toVenueRecord(v, userId));
      const { error } = await supabase.from("venues").upsert(venueRecords);

      if (!error) {
        await localDb.venues.bulkUpdate(
          pendingVenues.map((v) => ({ key: v.id, changes: { syncStatus: "synced" as const } }))
        );
      } else {
        // 一括upsertは1件でもエラー(unique制約違反等)になると全体が失敗するため、
        // 失敗時のみ1件ずつ再試行し、問題のない他のレコードまで巻き込まれないようにする。
        console.warn(
          `venues一括同期に失敗しました(${pendingVenues.length}件)。1件ずつ再試行します:`,
          error
        );
        for (let i = 0; i < pendingVenues.length; i++) {
          const { error: rowError } = await supabase.from("venues").upsert(venueRecords[i]);
          if (!rowError) {
            await localDb.venues.update(pendingVenues[i].id, { syncStatus: "synced" });
            continue;
          }

          const reconciled =
            rowError.code === UNIQUE_VIOLATION &&
            (await reconcileDuplicatePlaceId(supabase, pendingVenues[i]));
          if (!reconciled) {
            console.warn(`venue同期に失敗しました(id=${pendingVenues[i].id}):`, rowError);
          }
        }
      }
    }

    const pendingVisits = await localDb.visits
      .where("syncStatus")
      .equals("pending")
      .toArray();

    if (pendingVisits.length > 0) {
      // 写真(data URL)はDB行に埋め込まず、先にStorageへアップロードして軽量な
      // URLに差し替えてからupsertする(ローカルのbest_photoはdata URLのまま維持)。
      const visitRecords = await Promise.all(
        pendingVisits.map(async (visit) => {
          const uploadedPhoto = await uploadVisitPhotoIfNeeded(
            visit.id,
            userId,
            visit.best_photo
          );
          return toVisitRecord({ ...visit, best_photo: uploadedPhoto }, userId);
        })
      );

      const { error } = await supabase.from("visits").upsert(visitRecords);

      if (!error) {
        await localDb.visits.bulkUpdate(
          pendingVisits.map((v) => ({ key: v.id, changes: { syncStatus: "synced" as const } }))
        );
      } else {
        // venues同様、1件のエラーで一括upsert全体が失敗するため1件ずつ再試行する。
        console.warn(
          `visits一括同期に失敗しました(${pendingVisits.length}件)。1件ずつ再試行します:`,
          error
        );
        for (let i = 0; i < pendingVisits.length; i++) {
          const { error: rowError } = await supabase.from("visits").upsert(visitRecords[i]);
          if (rowError) {
            console.warn(`visit同期に失敗しました(id=${pendingVisits[i].id}):`, rowError);
          } else {
            await localDb.visits.update(pendingVisits[i].id, { syncStatus: "synced" });
          }
        }
      }
    }

    const pendingDeletes = await localDb.pendingVisitDeletes.toArray();
    if (pendingDeletes.length > 0) {
      const ids = pendingDeletes.map((d) => d.id);
      const { error } = await supabase.from("visits").delete().in("id", ids);

      if (error) {
        console.warn(`visits削除の同期に失敗しました(${ids.length}件):`, error);
      } else {
        await localDb.pendingVisitDeletes.bulkDelete(ids);
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
//
// visits/venuesのSELECTポリシーは自分自身に加えて同じグループのメンバーの行も
// 返すため、user_idでの絞り込みは行わずRLSに委ねる(グループメンバーのVisits/
// 気になるリストを含むVenuesもまとめてDexieへミラーするため)。
export async function pullFromCloud() {
  if (pulling) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  pulling = true;
  try {
    const supabase = getSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data: remoteVisits, error: visitsError } = await supabase.from("visits").select("*");

    if (visitsError) {
      console.warn("visitsのpullに失敗しました:", visitsError);
      return;
    }

    // Visitに紐付くVenueだけでなく、訪問記録のない気になるリスト単独のVenueも
    // グループ内で共有するため、venue_idでの絞り込みはせずまるごとpullする。
    const { data: venuesData, error: venuesError } = await supabase.from("venues").select("*");

    if (venuesError) {
      console.warn("venuesのpullに失敗しました:", venuesError);
      return;
    }
    const remoteVenues = (venuesData ?? []) as CloudVenueRow[];

    // ローカルで削除済み・削除待ちのVisitをpullで復活させないようにする。
    const pendingDeleteIds = new Set(
      (await localDb.pendingVisitDeletes.toArray()).map((d) => d.id)
    );

    for (const row of remoteVenues) {
      const local = await localDb.venues.get(row.id);
      if (local?.syncStatus === "pending") continue;
      await localDb.venues.put(fromVenueRecord(row));
    }

    for (const row of (remoteVisits ?? []) as CloudVisitRow[]) {
      if (pendingDeleteIds.has(row.id)) continue;
      const local = await localDb.visits.get(row.id);
      if (local?.syncStatus === "pending") continue;
      await localDb.visits.put(fromVisitRecord(row));
    }

    // クラウド側(RLS)からもう見えなくなったVisit/Venueをローカルからも削除する。
    // グループ脱退・相手による削除・別端末での削除などで可視範囲から外れた記録が
    // この端末にだけ残り続けるのを防ぐ(要件定義書7章のグループ解除フロー)。
    // 未同期(pending)の行は自分自身のローカル変更のため対象外にする。
    const remoteVisitIds = new Set((remoteVisits ?? []).map((v) => v.id as string));
    const staleVisits = (
      await localDb.visits.where("syncStatus").equals("synced").toArray()
    ).filter((v) => !remoteVisitIds.has(v.id));
    if (staleVisits.length > 0) {
      await localDb.visits.bulkDelete(staleVisits.map((v) => v.id));
    }

    // Visitの削除でvenue_idの参照が変わっている可能性があるため、Venueの棚卸しは
    // Visitの棚卸し後に行う。
    const remoteVenueIds = new Set(remoteVenues.map((v) => v.id));
    const referencedVenueIds = new Set((await localDb.visits.toArray()).map((v) => v.venue_id));
    const staleVenues = (
      await localDb.venues.where("syncStatus").equals("synced").toArray()
    ).filter((v) => !remoteVenueIds.has(v.id) && !referencedVenueIds.has(v.id));
    if (staleVenues.length > 0) {
      await localDb.venues.bulkDelete(staleVenues.map((v) => v.id));
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
