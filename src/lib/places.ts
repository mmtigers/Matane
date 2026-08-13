import type { PlaceCategory } from "@/constants/choices";
import type { LatLng } from "@/types/models";

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  // どのカテゴリにも当てはまらない場合(APIキー未設定時のtypes欠如や、該当なしの
  // 施設種別)はnull。「すべて」では表示するが、カテゴリフィルターの対象外にする。
  category: PlaceCategory | null;
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
  types?: string[];
  location?: { latitude?: number; longitude?: number };
}

// 駅・公園は施設種別がほぼ一意に定まるため個別のtype名を列挙する。
const STATION_TYPES = new Set([
  "train_station",
  "subway_station",
  "transit_station",
  "light_rail_station",
  "bus_station",
]);

const PARK_TYPES = new Set([
  "park",
  "national_park",
  "state_park",
  "dog_park",
  "wildlife_park",
  "hiking_area",
  "picnic_ground",
  "botanical_garden",
]);

// 飲食店・お店はGoogle Places APIのtypeバリエーションが非常に多い
// (例: japanese_restaurant, sushi_restaurant, ...)ため、代表的なtypeに加えて
// "_restaurant"/"_cafe"/"_bar"/"_store"/"_shop"の接尾辞でも判定する。
const FOOD_TYPES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "coffee_shop",
  "food_court",
  "night_club",
  "pub",
  "wine_bar",
  "brewery",
  "brewpub",
  "distillery",
  "tea_house",
  "dessert_shop",
  "ice_cream_shop",
  "donut_shop",
  "bagel_shop",
  "candy_store",
  "confectionery",
  "deli",
  "diner",
]);

const SHOP_TYPES = new Set([
  "store",
  "convenience_store",
  "supermarket",
  "department_store",
  "discount_store",
  "shopping_mall",
  "market",
  "grocery_store",
  "warehouse_store",
  "wholesaler",
]);

// 周辺候補のtypesからアプリ内カテゴリを判定する。駅・公園を最優先で判定し、
// 次に飲食店・お店を判定することで、"gas_station"のようなtypeにstationが
// 含まれる誤判定を避ける(個別列挙+限定的な接尾辞判定のみで行うため)。
function categorizePlace(types: string[] | undefined): PlaceCategory | null {
  if (!types || types.length === 0) return null;

  if (types.some((type) => STATION_TYPES.has(type))) return "station";
  if (types.some((type) => PARK_TYPES.has(type))) return "park";
  if (
    types.some(
      (type) => FOOD_TYPES.has(type) || type.endsWith("_restaurant") || type.endsWith("_cafe")
    )
  ) {
    return "food";
  }
  if (types.some((type) => SHOP_TYPES.has(type) || type.endsWith("_store"))) {
    return "shop";
  }

  return null;
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
      category: categorizePlace(place.types),
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
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.types,places.location",
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
