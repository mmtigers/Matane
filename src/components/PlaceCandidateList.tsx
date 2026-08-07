"use client";

import { useMemo, useState } from "react";
import {
  PLACE_CATEGORY_ICONS,
  PLACE_CATEGORY_LABELS,
  PLACE_CATEGORY_OPTIONS,
  type PlaceCategory,
} from "@/constants/choices";
import type { PlaceCandidate } from "@/lib/places";

// 候補リストはmax-h-60(スクロール)で折りたたんでおり、この件数を超えると
// スクロールしないと見えなくなる。残り件数の目安表示に使う。
const VISIBLE_CANDIDATE_COUNT = 5;

interface PlaceCandidateListProps {
  candidates: PlaceCandidate[];
  selectedPlaceId: string | null;
  onSelect: (place: PlaceCandidate) => void;
  // 呼び出し元の背景色とのコントラストを保つための、未選択アイテムの背景クラス。
  itemClassName?: string;
}

// 瞬録の周辺候補一覧。カテゴリ(飲食店/公園/お店/駅)をワンタップで絞り込める
// チップ行を持つ。候補にカテゴリ判定できたものが1件もなければチップ自体を
// 表示せず、従来通りの単純なリストにフォールバックする。
export function PlaceCandidateList({
  candidates,
  selectedPlaceId,
  onSelect,
  itemClassName = "bg-neutral-200 text-neutral-800",
}: PlaceCandidateListProps) {
  const [activeCategory, setActiveCategory] = useState<PlaceCategory | null>(null);

  const availableCategories = useMemo(
    () => PLACE_CATEGORY_OPTIONS.filter((category) => candidates.some((c) => c.category === category)),
    [candidates]
  );

  const filtered =
    activeCategory === null ? candidates : candidates.filter((c) => c.category === activeCategory);

  return (
    <>
      {availableCategories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            aria-pressed={activeCategory === null}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-amber-400 ${
              activeCategory === null ? "bg-amber-400 text-black" : "bg-neutral-200 text-neutral-700"
            }`}
          >
            すべて
          </button>
          {availableCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory((current) => (current === category ? null : category))}
              aria-pressed={activeCategory === category}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-amber-400 ${
                activeCategory === category ? "bg-amber-400 text-black" : "bg-neutral-200 text-neutral-700"
              }`}
            >
              {PLACE_CATEGORY_ICONS[category]} {PLACE_CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-neutral-500">
        近くの候補 {filtered.length}件
        {filtered.length > VISIBLE_CANDIDATE_COUNT &&
          `（スクロールしてあと${filtered.length - VISIBLE_CANDIDATE_COUNT}件）`}
      </p>
      <ul className="mt-1.5 flex max-h-60 flex-col gap-1.5 overflow-y-auto">
        {filtered.map((place) => (
          <li key={place.placeId}>
            <button
              type="button"
              onClick={() => onSelect(place)}
              className={`w-full rounded-xl px-4 py-2 text-left text-sm focus:ring-2 focus:ring-amber-400 ${
                selectedPlaceId === place.placeId ? "bg-amber-400/20 text-amber-600" : itemClassName
              }`}
            >
              {place.name}
              {place.address && <span className="ml-2 text-xs text-neutral-600">{place.address}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
