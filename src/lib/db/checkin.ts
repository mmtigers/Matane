import type { PlaceCategory } from "@/constants/choices";
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

// 気になるリストに入っていた店へ実際にあしあと(訪問記録)が付いたら、そのVenueを
// 気になるリストから外す。「気になる」は未訪問の店を保存しておく機能のため、
// 訪問記録が作られた時点で役目を終える。
async function clearWishIfNeeded(venue: LocalVenue) {
  if (!venue.is_wished) return;
  await localDb.venues.update(venue.id, { is_wished: false, syncStatus: "pending" });
}

// ホーム画面の「ココを記録」用。GPSで現在地を取得し、店名(空欄可)と写真1枚(任意)を
// 確認するだけで、その場で完了(is_completed: true)まで一気に進める。誰と/予算感/
// お酒の武器/静かさ等の詳細な肉付けは行わないため、二次登録画面を経由しない。
export async function createQuickCheckIn(
  location: LatLng,
  name: string,
  photoDataUrl: string | null,
  place?: { placeId: string; address: string | null; category?: PlaceCategory | null }
) {
  const existingVenue = place ? await findVenueByPlaceId(place.placeId) : undefined;

  let venueId: string;
  if (existingVenue) {
    venueId = existingVenue.id;
    await clearWishIfNeeded(existingVenue);
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
      place_category: place?.category ?? null,
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

// 「名前で記録」の店名入力から、既存Venueの再利用または新規作成を行う共通処理。
// 重複防止はcreateQuickCheckInと同じ優先順位: place_id一致 → 完全一致店名。
async function findOrCreateVenueByNameOrPlace(
  name: string,
  place?: {
    placeId: string;
    address: string | null;
    location: LatLng | null;
    category?: PlaceCategory | null;
  }
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
    place_category: place?.category ?? null,
    syncStatus: "pending",
  };
  await localDb.venues.add(venue);
  return venueId;
}

// ホーム画面の「名前で記録」→「気になるに記録」用。GPSを使わず(その場にいない前提)、
// Google Places検索結果から選んだ店舗をVenue(店舗マスタ)として事前登録し、そのまま
// 「気になる」にも追加する(is_wished: true)。wishReasonが渡された場合は「気になる理由」
// タグを合わせて保存する。Visit(来店記録)は作らない。
export async function registerVenueFromPlace(
  name: string,
  place?: {
    placeId: string;
    address: string | null;
    location: LatLng | null;
    category?: PlaceCategory | null;
  },
  wishReason?: string[]
): Promise<string> {
  const venueId = await findOrCreateVenueByNameOrPlace(name, place);
  await toggleVenueWish(venueId, true);
  if (wishReason?.length) {
    await localDb.venues.update(venueId, { wish_reason: wishReason });
  }
  scheduleBackgroundSync();
  return venueId;
}

// ホーム画面の「名前で記録」→「あしあとに記録」用。GPSを使わず、店名(またはGoogle Places
// 候補)からVenueを事前登録し、is_completed: falseのVisitを作成する。呼び出し元はこの後
// 登録(二次登録)画面へ遷移し、そのまま詳細情報(誰と/また行きたい/予算感等)を入力させる。
export async function createNamedVisit(
  name: string,
  place?: {
    placeId: string;
    address: string | null;
    location: LatLng | null;
    category?: PlaceCategory | null;
  }
): Promise<string> {
  const venueId = await findOrCreateVenueByNameOrPlace(name, place);
  const venue = await localDb.venues.get(venueId);
  if (venue) await clearWishIfNeeded(venue);

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
  scheduleBackgroundSync();
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
  place?: { placeId: string; address: string | null; category?: PlaceCategory | null }
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
    await clearWishIfNeeded(existingVenue);
    return;
  }

  await localDb.venues.update(venueId, {
    name: trimmed,
    syncStatus: "pending",
    ...(place
      ? { place_id: place.placeId, address: place.address, place_category: place.category ?? null }
      : {}),
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
    user_id,
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
    user_id,
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

// 店舗詳細画面で、位置情報が未設定のVenue(候補を選ばず店名だけで登録した過去の
// あしあと・気になる)に、後からGoogle Places候補を選んで位置情報を追加設定するための
// 関数。「ちかく」画面はlocationがある店舗しか地図に出せないため、この後付け設定が
// あしあと・気になるを「ちかく」に反映させる唯一の手段になる。
export async function attachVenueLocation(
  venueId: string,
  place: { placeId: string; address: string | null; location: LatLng; category?: PlaceCategory | null }
) {
  // 同じplace_idの店舗が既に別Venueとして存在する場合、Supabase側のunique制約に
  // 抵触するため、このVenueにはplace_idを設定せず位置情報のみ反映する。
  const existingVenue = await findVenueByPlaceId(place.placeId);
  const placeIdPatch =
    existingVenue && existingVenue.id !== venueId ? {} : { place_id: place.placeId };

  await localDb.venues.update(venueId, {
    location: place.location,
    address: place.address,
    place_category: place.category ?? null,
    ...placeIdPatch,
    syncStatus: "pending",
  });
  scheduleBackgroundSync();
}

const IMPORT_WISH_REASON = "Googleマップからインポート";

export interface ImportPlaceInput {
  name: string;
  location: LatLng | null;
}

export interface ImportWishedVenuesResult {
  added: number;
  updated: number;
  skipped: number;
}

// Googleマップの「保存済み」リスト(星・旗)のエクスポートファイルから読み取った場所を、
// まとめて気になるリストへ取り込む。既存のVenueと店名が完全一致すれば、それを気になる
// リストに追加するだけ(重複登録しない)。位置情報が取れなかった項目もリストには
// 追加し、位置情報は店舗詳細画面から後付け設定できるようにする(attachVenueLocation)。
export async function importWishedVenues(
  items: ImportPlaceInput[]
): Promise<ImportWishedVenuesResult> {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const trimmed = item.name.trim().slice(0, VENUE_NAME_MAX_LENGTH);
    if (!trimmed) {
      skipped++;
      continue;
    }

    const matches = await searchVenuesLocal(trimmed);
    const existing = matches.find((venue) => venue.name === trimmed);

    if (existing) {
      const patch: Partial<LocalVenue> = {};
      if (!existing.is_wished) patch.is_wished = true;
      if (!existing.location && item.location) patch.location = item.location;

      if (Object.keys(patch).length > 0) {
        await localDb.venues.update(existing.id, { ...patch, syncStatus: "pending" });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const venueId = crypto.randomUUID();
    const venue: LocalVenue = {
      id: venueId,
      place_id: null,
      name: trimmed,
      location: item.location,
      address: null,
      nearest_station: null,
      is_wished: true,
      category: "family",
      wish_reason: [IMPORT_WISH_REASON],
      place_category: null,
      syncStatus: "pending",
    };
    await localDb.venues.add(venue);
    added++;
  }

  scheduleBackgroundSync();
  return { added, updated, skipped };
}

// 1分放置の自動保存トリガー。呼び出し元でsetTimeoutと組み合わせる。
export function scheduleBackgroundSync() {
  void syncPendingChanges();
}
