import type { LatLng } from "@/types/models";

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  location: LatLng | null;
}

const SEARCH_RADIUS_METERS = 150;
// テキスト検索でのlocationBias半径。「除外」ではなく「優先」なので、車で通過した
// 直後で多少GPSがずれていても、この範囲より遠い候補が完全に漏れるわけではない。
const TEXT_SEARCH_BIAS_RADIUS_METERS = 3000;

interface NearbyPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

function toPlaceCandidates(places: NearbyPlace[]): PlaceCandidate[] {
  return places
    .filter((place): place is Required<Pick<NearbyPlace, "id" | "displayName">> & NearbyPlace =>
      Boolean(place.id && place.displayName?.text)
    )
    .map((place) => ({
      placeId: place.id!,
      name: place.displayName!.text!,
      address: place.formattedAddress ?? null,
      location:
        Number.isFinite(place.location?.latitude) && Number.isFinite(place.location?.longitude)
          ? { lat: place.location!.latitude!, lng: place.location!.longitude! }
          : null,
    }));
}

// 瞬録(GPS)チェックインで店名が未確定のVenueに対し、周辺の場所候補を提示するための
// Google Places API (New) Nearby Search呼び出し。飲食店に限らず周辺の場所を広く候補と
// して出したいので includedTypes は指定しない(未指定で全タイプが対象になる)。
// APIキー未設定/失敗時は候補なし扱いにして、手入力(既存フロー)には一切影響しないようにする。
export async function searchNearbyVenues(location: LatLng): Promise<PlaceCandidate[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        maxResultCount: 10,
        languageCode: "ja",
        locationRestriction: {
          circle: {
            center: { latitude: location.lat, longitude: location.lng },
            radius: SEARCH_RADIUS_METERS,
          },
        },
      }),
    });

    if (!response.ok) {
      console.warn("周辺店舗の取得に失敗しました:", response.status, await response.text());
      return [];
    }

    const data: { places?: NearbyPlace[] } = await response.json();
    return toPlaceCandidates(data.places ?? []);
  } catch (error) {
    console.warn("周辺店舗の取得に失敗しました:", error);
    return [];
  }
}

// 車から見かけた店など、GPSでは特定できない場所を店名で検索するための
// Google Places API (New) Text Search呼び出し。「行きたい」登録フロー(車のシナリオ)で使う。
// locationBiasは「除外」ではなく「優先」なので、現在地から離れていても候補から漏れない。
// APIキー未設定/失敗時は候補なし扱いにして、手入力フローには一切影響させない。
export async function searchVenuesByText(
  query: string,
  locationBias?: LatLng
): Promise<PlaceCandidate[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  const trimmed = query.trim();
  if (!apiKey || !trimmed) return [];

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: trimmed,
        languageCode: "ja",
        maxResultCount: 5,
        ...(locationBias && {
          locationBias: {
            circle: {
              center: { latitude: locationBias.lat, longitude: locationBias.lng },
              radius: TEXT_SEARCH_BIAS_RADIUS_METERS,
            },
          },
        }),
      }),
    });

    if (!response.ok) {
      console.warn("店舗の検索に失敗しました:", response.status, await response.text());
      return [];
    }

    const data: { places?: NearbyPlace[] } = await response.json();
    return toPlaceCandidates(data.places ?? []);
  } catch (error) {
    console.warn("店舗の検索に失敗しました:", error);
    return [];
  }
}
