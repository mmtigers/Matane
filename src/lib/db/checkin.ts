import { localDb, type LocalVenue, type LocalVisit } from "./localDb";
import { syncPendingChanges } from "./sync";
import type { LatLng } from "@/types/models";

// ホーム画面(夜間モード)の「📍今ココを瞬録」用。店名はこの時点では未確定のため
// Venueは位置情報のみでプレースホルダー生成し、肉付け(二次登録)時に確定させる。
export async function createInstantCheckIn(location: LatLng) {
  const now = new Date().toISOString();
  const venueId = crypto.randomUUID();
  const visitId = crypto.randomUUID();

  const venue: LocalVenue = {
    id: venueId,
    place_id: null,
    name: "",
    location,
    address: null,
    nearest_station: null,
    syncStatus: "pending",
  };

  const visit: LocalVisit = {
    id: visitId,
    venue_id: venueId,
    visited_at: now,
    is_completed: false,
    who: [],
    revisit: null,
    budget: null,
    alcohol_tags: [],
    quietness: null,
    best_photo: null,
    memo: null,
    ai_tags: [],
    syncStatus: "pending",
  };

  await localDb.venues.add(venue);
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

// 1分放置の自動保存トリガー。呼び出し元でsetTimeoutと組み合わせる。
export function scheduleBackgroundSync() {
  void syncPendingChanges();
}
