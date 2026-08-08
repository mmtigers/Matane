import type { LatLng } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";
import { findVenueByPlaceId, searchVenuesLocal } from "./queries";
import { syncPendingChanges } from "./sync";

const VENUE_NAME_MAX_LENGTH = 100;

type VisitChoiceFields = Pick<
  LocalVisit,
  "who" | "revisit" | "budget" | "alcohol_tags" | "quietness" | "best_photo" | "memo"
>;

function emptyVisitFields(): VisitChoiceFields & { ai_tags: string[] } {
  return {
    who: [],
    revisit: null,
    budget: null,
    alcohol_tags: [],
    quietness: null,
    best_photo: null,
    memo: null,
    ai_tags: [],
  };
}

// ホーム画面の「📍今ココを瞬録」用。タップ時に店名を聞き、わかれば即確定する。
// 周辺店舗候補(Google Places)から選んだ場合はplaceId/addressも合わせて確定させる。
// わからず空欄の場合はVenueを位置情報のみのプレースホルダーとして作成し、
// 登録(二次登録)時に確定させる。
export async function createInstantCheckIn(
  location: LatLng,
  name = "",
  place?: { placeId: string; address: string | null }
) {
  // Supabase側のvenues.place_idはunique制約があるため、同じ場所に既存Venueがあれば
  // 新規作成せず再利用する(重複作成するとその回のVenue/Visitとも同期が永久に失敗する)。
  const existingVenue = place ? await findVenueByPlaceId(place.placeId) : undefined;

  if (existingVenue) {
    return createCheckInForVenue(existingVenue.id);
  }

  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: place?.placeId ?? null,
    name: name.trim().slice(0, VENUE_NAME_MAX_LENGTH),
    location,
    address: place?.address ?? null,
    nearest_station: null,
    is_wished: false,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);

  return createCheckInForVenue(venueId);
}

// ホーム画面の検索から、チェックインを経由せず直接「行きたい」へ追加する用。
// まだ行ったことのない店(友人に勧められた等)を気軽に記録できるようにする。
// 同名の既存Venueがあれば新規作成せず、その行きたいフラグだけ立てる。
export async function createWishOnlyVenue(name: string): Promise<string> {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
  if (!trimmed) throw new Error("店名を入力してください");

  const matches = await searchVenuesLocal(trimmed);
  const exactMatch = matches.find((venue) => venue.name === trimmed);
  if (exactMatch) {
    await toggleVenueWish(exactMatch.id, true);
    return exactMatch.id;
  }

  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: null,
    name: trimmed,
    location: null,
    address: null,
    nearest_station: null,
    is_wished: true,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);
  scheduleBackgroundSync();
  return venueId;
}

// ホーム画面共通の「後から登録（店名・駅名検索）」用。既存の店名と完全一致する場合は
// キャッシュ済みのVenueを再利用し、無ければ入力名でプレースホルダーVenueを作る。
export async function createCheckInByVenueName(name: string) {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
  if (!trimmed) throw new Error("店名を入力してください");

  const matches = await searchVenuesLocal(trimmed);
  const exactMatch = matches.find((venue) => venue.name === trimmed);

  let venueId: string;
  if (exactMatch) {
    venueId = exactMatch.id;
  } else {
    venueId = crypto.randomUUID();
    const venue: LocalVenue = {
      id: venueId,
      place_id: null,
      name: trimmed,
      location: null,
      address: null,
      nearest_station: null,
      is_wished: false,
      syncStatus: "pending",
    };
    await localDb.venues.add(venue);
  }

  return createCheckInForVenue(venueId);
}

// ホーム画面の検索結果を直接タップした場合に使う。同名の別Venueが存在していても
// 名前での再解決を挟まないため、表示されている店舗と紐付け先が食い違わない。
export async function createCheckInForVenue(venueId: string) {
  const visitId = crypto.randomUUID();
  const visit: LocalVisit = {
    id: visitId,
    venue_id: venueId,
    visited_at: new Date().toISOString(),
    is_completed: false,
    ...emptyVisitFields(),
    syncStatus: "pending",
  };
  await localDb.visits.add(visit);
  return visitId;
}

// 5秒間の「取り消す」スナックバー用。基本は未同期のはずだが、5秒の間にバック
// グラウンド同期(オンライン復帰やトークン更新時)が先に走りsynced済みになる
// ケースがあるため、その場合はdeleteVisitと同じ経路でcrowd側の削除もキューに積む
// (単純delete()だとクラウドに孤児レコードが残り、他端末で復活してしまう)。
export async function undoCheckIn(visitId: string) {
  const visit = await localDb.visits.get(visitId);
  if (!visit) return;

  await deleteVisit(visitId);

  const venue = await localDb.venues.get(visit.venue_id);
  if (!venue) return;

  // 既にクラウド同期済みのVenueはここで消さない。クラウド側にvenuesを削除する
  // 手段(RLS)が無いため、ローカルだけ消すと「クラウドにだけ孤児として残る」状態に
  // なり、後で同じ場所に再チェックインした際にplace_idの重複で同期が永久に
  // 失敗する原因になる(ローカルに残しておけば次回はfindVenueByPlaceIdで再利用できる)。
  if (venue.syncStatus === "synced") return;

  // 「行きたい」登録済みのVenueは、たまたま訪問記録が0件になっていても消さない。
  // (訪問記録とは独立してWishを保持できるのが仕様のため、GPS再チェックイン→
  // 取り消しという無関係な操作でユーザーのWish登録が消えてしまうのを防ぐ)。
  if (venue.is_wished) return;

  // 他のVisitがまだ参照しているVenue(名前・駅名検索で再利用された既存店舗など)は
  // 取り消し操作で巻き込んで消さない。
  const otherVisitCount = await localDb.visits.where("venue_id").equals(visit.venue_id).count();
  if (otherVisitCount === 0) {
    await localDb.venues.delete(visit.venue_id);
  }
}

// GPSのみで店名が未確定の瞬録に、登録画面から店名を確定させる。
// 周辺店舗候補(Google Places)から選んだ場合はplaceId/addressも合わせて確定させる。
export async function setVenueName(
  visitId: string,
  venueId: string,
  name: string,
  place?: { placeId: string; address: string | null }
) {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);

  // Supabase側のvenues.place_idはunique制約があるため、選んだ場所が既に別Venueとして
  // 存在する場合はこのVenueにplace_idを設定せず、Visitの紐付け先をその既存Venueへ
  // 差し替える(そのままplace_idを重複させるとクラウド同期が永久に失敗する)。
  const existingVenue = place ? await findVenueByPlaceId(place.placeId) : undefined;
  if (existingVenue && existingVenue.id !== venueId) {
    await localDb.visits.update(visitId, {
      venue_id: existingVenue.id,
      syncStatus: "pending",
    });
    return;
  }

  await localDb.venues.update(venueId, {
    name: trimmed,
    syncStatus: "pending",
    ...(place ? { place_id: place.placeId, address: place.address } : {}),
  });
}

// 登録(二次登録)画面の保存。選択項目を反映し、is_completedをtrueにする。
export async function completeVisitRegistration(
  visitId: string,
  patch: Partial<VisitChoiceFields>
) {
  await localDb.visits.update(visitId, {
    ...patch,
    is_completed: true,
    syncStatus: "pending",
  });
  scheduleBackgroundSync();
}

// タイムラインからの削除(誤登録の取り消し用)。ローカルからは即座に削除する。
// 既にSupabaseへ同期済みだった場合は削除キューに積み、sync.tsの通常サイクルで
// クラウド側の削除も処理する(オフライン中でも取りこぼさず、失敗時は次回再試行される)。
export async function deleteVisit(visitId: string) {
  const visit = await localDb.visits.get(visitId);
  if (!visit) return;

  await localDb.visits.delete(visitId);

  if (visit.syncStatus === "synced") {
    await localDb.pendingVisitDeletes.put({ id: visitId });
    scheduleBackgroundSync();
  }
}

// deleteVisitの5秒アンドゥ用。既に削除済みのVisitをそのまま書き戻す。deleteVisitが
// 積んだ削除キューも取り消し、undo後に同期サイクルがクラウド側を誤って消さないようにする
// (キューへの追加後・実際の同期実行前のタイミングであれば確実に取り消せる。ごく稀に
// アンドゥ猶予中に同期が完了しクラウド側が先に消えてしまうケースはundoCheckIn同様に許容する)。
export async function restoreVisit(visit: LocalVisit) {
  const alreadyExists = await localDb.visits.get(visit.id);
  if (alreadyExists) return;

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
    syncStatus,
  } = visit;
  await localDb.visits.add({
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
    syncStatus,
  });

  if (syncStatus === "synced") {
    await localDb.pendingVisitDeletes.delete(id);
  }
}

// 店舗詳細画面の「行きたい」トグル用。
export async function toggleVenueWish(venueId: string, isWished: boolean) {
  await localDb.venues.update(venueId, { is_wished: isWished, syncStatus: "pending" });
  scheduleBackgroundSync();
}

// 1分放置の自動保存トリガー。呼び出し元でsetTimeoutと組み合わせる。
export function scheduleBackgroundSync() {
  void syncPendingChanges();
}
