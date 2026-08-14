import type { LatLng } from "@/types/models";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";
import { findVenueByPlaceId, searchVenuesLocal } from "./queries";
import { syncPendingChanges } from "./sync";

const VENUE_NAME_MAX_LENGTH = 100;

// visited_atは「未来の日時」を許容しない(チェックインアプリであり予定管理ではないため)。
// 不正なISO文字列や未来日時は現在時刻に丸める。どの呼び出し経路(名前で記録の日付欄、
// 登録画面の日時編集)から来ても、この関数を通すことで一元的にガードする。
function clampVisitedAt(input: string | undefined): string {
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  const now = new Date();
  return parsed > now ? now.toISOString() : parsed.toISOString();
}

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

// ホーム画面の「ココを記録」用。GPSで現在地を取得し、店名(空欄可)と写真1枚(任意)を
// 確認するだけで、その場で完了(is_completed: true)まで一気に進める。誰と/予算感/
// お酒の武器/静かさ等の詳細な肉付けは行わないため、二次登録画面を経由しない。
export async function createQuickCheckIn(
  location: LatLng,
  name: string,
  photoDataUrl: string | null,
  place?: { placeId: string; address: string | null }
) {
  const existingVenue = place ? await findVenueByPlaceId(place.placeId) : undefined;

  let venueId: string;
  if (existingVenue) {
    venueId = existingVenue.id;
  } else {
    venueId = crypto.randomUUID();
    const venue: LocalVenue = {
      id: venueId,
      place_id: place?.placeId ?? null,
      name: name.trim().slice(0, VENUE_NAME_MAX_LENGTH),
      location,
      address: place?.address ?? null,
      nearest_station: null,
      is_wished: false,
      category: "family",
      wish_reason: null,
      syncStatus: "pending",
    };
    await localDb.venues.add(venue);
  }

  const visitId = crypto.randomUUID();
  const visit: LocalVisit = {
    id: visitId,
    venue_id: venueId,
    visited_at: new Date().toISOString(),
    is_completed: true,
    ...emptyVisitFields(),
    best_photo: photoDataUrl,
    syncStatus: "pending",
  };
  await localDb.visits.add(visit);
  scheduleBackgroundSync();
  return visitId;
}

// ホーム画面の検索から、チェックインを経由せず直接「行きたい」へ追加する用。
// まだ行ったことのない店(友人に勧められた等・車から見かけた店など)を気軽に記録できる
// ようにする。placeが渡された場合はGoogle Places候補の座標・住所を、wishReasonが
// 渡された場合は「行きたい理由」タグを合わせて保存する。
// 重複防止はcreateQuickCheckInと同じ優先順位: place_id一致 → 完全一致店名。
export async function createWishOnlyVenue(
  name: string,
  options?: {
    location?: LatLng | null;
    place?: { placeId: string; address: string | null };
    wishReason?: string[];
  }
): Promise<string> {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
  if (!trimmed) throw new Error("店名を入力してください");

  const existingByPlaceId = options?.place
    ? await findVenueByPlaceId(options.place.placeId)
    : undefined;
  if (existingByPlaceId) {
    await toggleVenueWish(existingByPlaceId.id, true);
    if (options?.wishReason?.length) {
      await localDb.venues.update(existingByPlaceId.id, { wish_reason: options.wishReason });
    }
    return existingByPlaceId.id;
  }

  const matches = await searchVenuesLocal(trimmed);
  const exactMatch = matches.find((venue) => venue.name === trimmed);
  if (exactMatch) {
    await toggleVenueWish(exactMatch.id, true);
    if (options?.wishReason?.length) {
      await localDb.venues.update(exactMatch.id, { wish_reason: options.wishReason });
    }
    return exactMatch.id;
  }

  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: options?.place?.placeId ?? null,
    name: trimmed,
    location: options?.location ?? null,
    address: options?.place?.address ?? null,
    nearest_station: null,
    is_wished: true,
    category: "bar",
    wish_reason: options?.wishReason?.length ? options.wishReason : null,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);
  scheduleBackgroundSync();
  return venueId;
}

// ホーム画面の「名前で記録」用。GPSを使わず(その場にいない前提)、Google Places検索結果
// から選んだ店舗をVenue(店舗マスタ)として事前登録する。Visit(来店記録)は作らない。
// 重複防止はcreateQuickCheckInと同じ優先順位: place_id一致 → 完全一致店名。
export async function registerVenueFromPlace(
  name: string,
  place?: { placeId: string; address: string | null; location: LatLng | null }
): Promise<string> {
  const trimmed = name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
  if (!trimmed) throw new Error("店名を入力してください");

  const existingByPlaceId = place ? await findVenueByPlaceId(place.placeId) : undefined;
  if (existingByPlaceId) return existingByPlaceId.id;

  const matches = await searchVenuesLocal(trimmed);
  const exactMatch = matches.find((venue) => venue.name === trimmed);
  if (exactMatch) return exactMatch.id;

  const venueId = crypto.randomUUID();
  const venue: LocalVenue = {
    id: venueId,
    place_id: place?.placeId ?? null,
    name: trimmed,
    location: place?.location ?? null,
    address: place?.address ?? null,
    nearest_station: null,
    is_wished: false,
    category: "family",
    wish_reason: null,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);
  scheduleBackgroundSync();
  return venueId;
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
// visited_atが渡された場合は日時も更新する(登録画面での日時修正用)。
export async function completeVisitRegistration(
  visitId: string,
  patch: Partial<VisitChoiceFields> & { visited_at?: string }
) {
  const { visited_at, ...rest } = patch;
  await localDb.visits.update(visitId, {
    ...rest,
    ...(visited_at !== undefined ? { visited_at: clampVisitedAt(visited_at) } : {}),
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
