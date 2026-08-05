import type { LatLng } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";
import { searchVenuesLocal } from "./queries";
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
// わからず空欄の場合はVenueを位置情報のみのプレースホルダーとして作成し、
// 登録(二次登録)時に確定させる。
export async function createInstantCheckIn(location: LatLng, name = "") {
  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: null,
    name: name.trim().slice(0, VENUE_NAME_MAX_LENGTH),
    location,
    address: null,
    nearest_station: null,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);

  return createCheckInForVenue(venueId);
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
  await localDb.venues.delete(visit.venue_id);
}

// GPSのみで店名が未確定の瞬録に、登録画面から店名を確定させる。
// 周辺店舗候補(Google Places)から選んだ場合はplaceId/addressも合わせて確定させる。
export async function setVenueName(
  venueId: string,
  name: string,
  place?: { placeId: string; address: string | null }
) {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
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

// 店舗詳細画面の「もう一度チェックイン」。前回のChoiceChips選択を引き継いだ新しいVisitを即座に作る。
export async function duplicateVisit(previous: LocalVisit) {
  const visitId = crypto.randomUUID();
  const visit: LocalVisit = {
    id: visitId,
    venue_id: previous.venue_id,
    visited_at: new Date().toISOString(),
    is_completed: true,
    who: previous.who,
    revisit: previous.revisit,
    budget: previous.budget,
    alcohol_tags: previous.alcohol_tags,
    quietness: previous.quietness,
    best_photo: null,
    memo: null,
    ai_tags: [],
    syncStatus: "pending",
  };
  await localDb.visits.add(visit);
  scheduleBackgroundSync();
  return visitId;
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

// 1分放置の自動保存トリガー。呼び出し元でsetTimeoutと組み合わせる。
export function scheduleBackgroundSync() {
  void syncPendingChanges();
}
