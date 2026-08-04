export type Who = "1人" | "家族" | "友人" | "仕事/上司";
export type Revisit = "絶対行く" | "機会あり" | "1回でいい";
export type Budget = "〜3k" | "〜5k" | "〜10k" | "10k〜";
export type AlcoholTag = "日本酒" | "ハイボール" | "ビール" | "その他";
export type Quietness = "静か" | "普通" | "ガヤガヤ";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Venue {
  id: string;
  place_id: string | null;
  name: string;
  location: LatLng;
  address: string | null;
  nearest_station: string | null;
}

export interface Visit {
  id: string;
  venue_id: string;
  visited_at: string;
  is_completed: boolean;
  who: Who[];
  revisit: Revisit | null;
  budget: Budget | null;
  alcohol_tags: AlcoholTag[];
  quietness: Quietness | null;
  best_photo: string | null;
  memo: string | null;
  ai_tags: string[];
}
