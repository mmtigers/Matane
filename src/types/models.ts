// 選択肢の実体(配列)は constants/choices.ts が唯一の情報源。ここでは型だけを再公開する。
import type { Who, Revisit, Budget, AlcoholTag, Quietness, PlaceCategory } from "@/constants/choices";
export type { Who, Revisit, Budget, AlcoholTag, Quietness, PlaceCategory };

export interface LatLng {
  lat: number;
  lng: number;
}

// bar: 仕事での使用がメインの飲み屋。family: 家族での使用がメインのご飯屋・公園・スーパーなど。
// ホーム画面の瞬録ボタンをどちらから押したかで決まり、二次登録画面のフォーム内容を切り替える。
export type VenueCategory = "bar" | "family";

export interface Venue {
  id: string;
  place_id: string | null;
  name: string;
  location: LatLng | null;
  address: string | null;
  nearest_station: string | null;
  is_wished: boolean;
  category: VenueCategory;
  wish_reason: string[] | null;
  // 場所のカテゴリ(公園/飲食店/お店/駅)。あしあとのカテゴリフィルター用。Google Places
  // 候補から選んで登録した場合のみ判定でき、店名のみの手入力ではnullのまま(未分類)。
  place_category: PlaceCategory | null;
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
  // クラウド未同期のうちは未設定(=自分の記録として扱う)。同期・pull後はSupabaseの
  // user_idが入り、パートナーの記録かどうかの判定(グループ共有機能)に使う。
  user_id?: string | null;
}

// 場所・訪問記録を共有する単位(夫婦・家族を想定)。1ユーザーは同時に1グループのみ所属可能。
export interface Group {
  id: string;
  name: string | null;
  created_by: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  joined_at: string;
}

// グループ設定画面でのメンバー表示用。auth.usersのemailはSECURITY DEFINER関数
// (get_group_members)経由でのみ取得できる。
export interface GroupMemberProfile {
  user_id: string;
  email: string | null;
  joined_at: string;
}

export interface GroupInvite {
  id: string;
  group_id: string;
  code: string;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}
