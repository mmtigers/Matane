import type { LatLng } from "@/types/models";

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
}

const SEARCH_RADIUS_METERS = 150;
const INCLUDED_TYPES = ["restaurant", "bar", "night_club", "cafe"];

interface NearbyPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
}

// 瞬録(GPS)チェックインで店名が未確定のVenueに対し、周辺の飲食店候補を提示するための
// Google Places API (New) Nearby Search呼び出し。APIキー未設定/失敗時は候補なし扱いに
// して、手入力(既存フロー)には一切影響しないようにする。
export async function searchNearbyVenues(location: LatLng): Promise<PlaceCandidate[]> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        includedTypes: INCLUDED_TYPES,
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

    return (data.places ?? [])
      .filter((place): place is Required<Pick<NearbyPlace, "id" | "displayName">> & NearbyPlace =>
        Boolean(place.id && place.displayName?.text)
      )
      .map((place) => ({
        placeId: place.id!,
        name: place.displayName!.text!,
        address: place.formattedAddress ?? null,
      }));
  } catch (error) {
    console.warn("周辺店舗の取得に失敗しました:", error);
    return [];
  }
}
