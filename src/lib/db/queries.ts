import { useLiveQuery } from "dexie-react-hooks";
import { localDb, type LocalVenue, type LocalVisit } from "./localDb";

export interface VisitWithVenue extends LocalVisit {
  venue: LocalVenue | undefined;
}

async function attachVenue(visit: LocalVisit): Promise<VisitWithVenue> {
  const venue = await localDb.venues.get(visit.venue_id);
  return { ...visit, venue };
}

// ホーム画面の「登録待ち」リスト用。
export function useIncompleteVisits() {
  return useLiveQuery(async () => {
    const visits = await localDb.visits.toArray();
    const incomplete = visits.filter((v) => !v.is_completed);
    incomplete.sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    return Promise.all(incomplete.map(attachVenue));
  }, []);
}

export function useVisitWithVenue(visitId: string) {
  return useLiveQuery(async () => {
    const visit = await localDb.visits.get(visitId);
    if (!visit) return undefined;
    return attachVenue(visit);
  }, [visitId]);
}

export function useVenue(venueId: string) {
  return useLiveQuery(() => localDb.venues.get(venueId), [venueId]);
}

// 店舗詳細: 同じ店舗への過去の訪問を新しい順で返す。
export function useVisitsForVenue(venueId: string) {
  return useLiveQuery(async () => {
    const visits = await localDb.visits.where("venue_id").equals(venueId).toArray();
    visits.sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    return visits;
  }, [venueId]);
}

// タイムライン: 全訪問を新しい順で、店舗情報を紐付けて返す。
export function useTimelineVisits() {
  return useLiveQuery(async () => {
    const visits = await localDb.visits.toArray();
    visits.sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    return Promise.all(visits.map(attachVenue));
  }, []);
}

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

// 「今日どこ行く？」用のルールベース提案:
// 「また行きたい＝絶対行く」と回答した店のうち、半年以上訪問していない店をランダムに1件提案する。
export function useSuggestedVenue() {
  return useLiveQuery(async () => {
    const visits = await localDb.visits.toArray();
    const now = Date.now();

    const lastVisitByVenue = new Map<string, LocalVisit>();
    for (const visit of visits) {
      const current = lastVisitByVenue.get(visit.venue_id);
      if (!current || visit.visited_at > current.visited_at) {
        lastVisitByVenue.set(visit.venue_id, visit);
      }
    }

    const candidates = Array.from(lastVisitByVenue.values()).filter((visit) => {
      const isFavorite = visit.revisit === "絶対行く";
      const isStale = now - new Date(visit.visited_at).getTime() > SIX_MONTHS_MS;
      return isFavorite && isStale;
    });

    if (candidates.length === 0) return undefined;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return attachVenue(chosen);
  }, []);
}

// 行きたい店一覧画面用。
export function useWishedVenues() {
  return useLiveQuery(async () => {
    const venues = await localDb.venues.toArray();
    return venues
      .filter((venue) => venue.is_wished)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, []);
}

// マップ画面用: 位置情報を持つ店舗のうち、タイムラインから訪問記録が全て削除された
// (=どのVisitからも参照されなくなった)店舗はマーカーとして表示しない。ただし
// 「行きたい」店は訪問記録がなくても表示対象に含める。
export function useMapVenues() {
  return useLiveQuery(async () => {
    const [venues, visits] = await Promise.all([localDb.venues.toArray(), localDb.visits.toArray()]);
    const venueIdsWithVisits = new Set(visits.map((visit) => visit.venue_id));
    return venues.filter((venue) => venue.is_wished || venueIdsWithVisits.has(venue.id));
  }, []);
}

// 「最後の同期からn件未送信」をホーム画面に出すためのカウント。sync失敗が
// 完全にサイレントにならないよう、ユーザー自身がここで気づけるようにする。
export function usePendingSyncCount() {
  return useLiveQuery(async () => {
    const [pendingVenues, pendingVisits, pendingDeletes] = await Promise.all([
      localDb.venues.where("syncStatus").equals("pending").count(),
      localDb.visits.where("syncStatus").equals("pending").count(),
      localDb.pendingVisitDeletes.count(),
    ]);
    return pendingVenues + pendingVisits + pendingDeletes;
  }, []);
}

// place_id(Google PlacesのID)からVenueを引く。SupabaseのvenuesテーブルはplaceIdに
// unique制約があるため、瞬録で場所候補を選ぶ際にVenueを重複作成しないよう使う。
export async function findVenueByPlaceId(placeId: string): Promise<LocalVenue | undefined> {
  return localDb.venues.where("place_id").equals(placeId).first();
}

export async function searchVenuesLocal(query: string): Promise<LocalVenue[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const venues = await localDb.venues.toArray();
  const lower = trimmed.toLowerCase();
  return venues.filter(
    (venue) =>
      venue.name.toLowerCase().includes(lower) ||
      (venue.nearest_station ?? "").toLowerCase().includes(lower)
  );
}
