// 登録画面のChoiceChips・タイムラインのフィルター等で使う選択肢の単一情報源。
// 型はここから派生させるため、値の追加・削除がこのファイルだけで完結する。
export const WHO_OPTIONS = ["1人", "家族", "友人", "仕事/上司"] as const;
export const REVISIT_OPTIONS = ["絶対行く", "機会あり", "1回でいい"] as const;
export const BUDGET_OPTIONS = ["〜3k", "〜5k", "〜10k", "10k〜"] as const;
export const ALCOHOL_OPTIONS = ["ビール", "ハイボール", "日本酒", "ワイン"] as const;
export const QUIETNESS_OPTIONS = ["静か", "普通", "ガヤガヤ"] as const;

export type Who = (typeof WHO_OPTIONS)[number];
export type Revisit = (typeof REVISIT_OPTIONS)[number];
export type Budget = (typeof BUDGET_OPTIONS)[number];
export type AlcoholTag = (typeof ALCOHOL_OPTIONS)[number];
export type Quietness = (typeof QUIETNESS_OPTIONS)[number];

// タイムラインのお酒クイックフィルター用アイコン。Record<AlcoholTag, string>に
// することで、ALCOHOL_OPTIONSに値を追加した際にアイコン未定義があればコンパイル
// エラーで検出できる。
export const ALCOHOL_ICONS: Record<AlcoholTag, string> = {
  ビール: "🍺",
  ハイボール: "🥃",
  日本酒: "🍶",
  ワイン: "🍷",
};
