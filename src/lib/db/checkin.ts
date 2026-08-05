import { localDb, type LocalVenue, type LocalVisit } from "./localDb";
import { searchVenuesLocal } from "./queries";
import { syncPendingChanges } from "./sync";
import type { LatLng } from "@/types/models";

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

// ホーム画面(夜間モード)の「📍今ココを瞬録」用。店名はこの時点では未確定のため
// Venueは位置情報のみでプレースホルダー生成し、盛り付け(二次登録)時に確定させる。
export async function createInstantCheckIn(location: LatLng) {
  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: null,
    name: "",
    location,
    address: null,
    nearest_station: null,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);

  return createVisitForVenue(venueId);
}

// ホーム画面共通の「後から登録（店名・駅名検索）」用。既存の店名と完全一致する場合は
// キャッシュ済みのVenueを再利用し、無ければ入力名でプレースホルダーVenueを作る。
export async function createCheckInByVenueName(name: string) {
  const trimmed = name.trim();
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

  return createVisitForVenue(venueId);
}

async function createVisitForVenue(venueId: string) {
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

// 5秒間の「取り消す」スナックバー用。まだ同期されていない前提で即座にローカルから削除する。
export async function undoCheckIn(visitId: string) {
  const visit = await localDb.visits.get(visitId);
  if (!visit) return;

  await localDb.visits.delete(visitId);
  await localDb.venues.delete(visit.venue_id);
}

// GPSのみで店名が未確定の瞬録に、盛り付け画面から店名を確定させる。
export async function setVenueName(venueId: string, name: string) {
  await localDb.venues.update(venueId, { name: name.trim(), syncStatus: "pending" });
}

// 盛り付け(二次登録)画面の保存。選択項目を反映し、is_completedをtrueにする。
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

// 1分放置の自動保存トリガー。呼び出し元でsetTimeoutと組み合わせる。
export function scheduleBackgroundSync() {
  void syncPendingChanges();
}
