// 選択肢の実体(配列)は constants/choices.ts が唯一の情報源。ここでは型だけを再公開する。
import type { Who, Revisit, Budget, AlcoholTag, Quietness } from "@/constants/choices";
export type { Who, Revisit, Budget, AlcoholTag, Quietness };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Venue {
  id: string;
  place_id: string | null;
  name: string;
  location: LatLng | null;
  address: string | null;
  nearest_station: string | null;
  is_wished: boolean;
  wish_reason: string[] | null;
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
