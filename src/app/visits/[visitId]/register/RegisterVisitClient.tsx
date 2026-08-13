"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Skeleton } from "@/components/Skeleton";
import {
  ALCOHOL_OPTIONS,
  BUDGET_OPTIONS,
  QUIETNESS_OPTIONS,
  REVISIT_OPTIONS,
  WHO_OPTIONS,
  type AlcoholTag,
  type Budget,
  type Quietness,
  type Revisit,
  type Who,
} from "@/constants/choices";
import { completeVisitRegistration, setVenueName } from "@/lib/db/checkin";
import { useVisitWithVenue } from "@/lib/db/queries";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetimeLocal";
import { type PlaceCandidate, searchNearbyVenues } from "@/lib/places";
import { compressPhotoToDataUrl, PhotoTooLargeError } from "@/lib/photo";
import { SAVED_TOAST_KEY } from "@/lib/sessionFlags";

const MEMO_MAX_LENGTH = 2000;
const VENUE_NAME_MAX_LENGTH = 100;

export function RegisterVisitClient({ visitId }: { visitId: string }) {
  const visit = useVisitWithVenue(visitId);
  const router = useRouter();
  const initialized = useRef(false);

  const [venueNameInput, setVenueNameInput] = useState("");
  const [visitedAtInput, setVisitedAtInput] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<PlaceCandidate | null>(null);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [hasSearchedPlaces, setHasSearchedPlaces] = useState(false);
  const [who, setWho] = useState<Who[]>([]);
  const [revisit, setRevisit] = useState<Revisit[]>([]);
  const [budget, setBudget] = useState<Budget[]>([]);
  const [alcoholTags, setAlcoholTags] = useState<AlcoholTag[]>([]);
  const [quietness, setQuietness] = useState<Quietness[]>([]);
  const [memo, setMemo] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dexieからの初回ロード時だけフォームへ反映する（以降のuseLiveQuery再発火では上書きしない）。
  useEffect(() => {
    if (!visit || initialized.current) return;
    initialized.current = true;
    setVenueNameInput(visit.venue?.name ?? "");
    setVisitedAtInput(toDatetimeLocalValue(visit.visited_at));
    setWho(visit.who);
    setRevisit(visit.revisit ? [visit.revisit] : []);
    setBudget(visit.budget ? [visit.budget] : []);
    setAlcoholTags(visit.alcohol_tags);
    setQuietness(visit.quietness ? [visit.quietness] : []);
    setMemo(visit.memo ?? "");
    setPhotoDataUrl(visit.best_photo ?? null);
  }, [visit]);

  // GPSのみ(瞬録)で店名未確定のVenueに対し、ボタン操作で周辺の飲食店候補を取得する
  // (自動取得にするとAPI呼び出しコストが無駄にかかるため、ユーザー操作を起点にする)。
  async function handleSearchNearbyPlaces() {
    if (!visit?.venue?.location) return;
    setLoadingPlaces(true);
    try {
      const results = await searchNearbyVenues(visit.venue.location);
      setPlaceCandidates(results);
      setHasSearchedPlaces(true);
    } finally {
      setLoadingPlaces(false);
    }
  }

  function handleSelectPlace(place: PlaceCandidate) {
    setSelectedPlace(place);
    setVenueNameInput(place.name);
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setCompressing(true);
    try {
      const dataUrl = await compressPhotoToDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof PhotoTooLargeError ? error.message : "画像の処理に失敗しました"
      );
      if (error instanceof PhotoTooLargeError) event.target.value = "";
    } finally {
      setCompressing(false);
    }
  }

  async function handleSave() {
    if (!visit) return;

    setErrorMessage(null);
    const trimmedName = venueNameInput.trim();
    if (needsVenueName && !trimmedName) {
      setErrorMessage("店名を入力してください");
      return;
    }

    setSaving(true);
    try {
      if (visit.venue && trimmedName && trimmedName !== visit.venue.name) {
        const place = selectedPlace?.name === trimmedName ? selectedPlace : undefined;
        await setVenueName(
          visitId,
          visit.venue.id,
          trimmedName,
          place ? { placeId: place.placeId, address: place.address } : undefined
        );
      }

      const newVisitedAt = visitedAtInput ? fromDatetimeLocalValue(visitedAtInput) : undefined;
      const visitedAtChanged =
        newVisitedAt !== undefined && newVisitedAt !== visit.visited_at;

      await completeVisitRegistration(visitId, {
        who,
        revisit: revisit[0] ?? null,
        budget: budget[0] ?? null,
        alcohol_tags: alcoholTags,
        quietness: quietness[0] ?? null,
        best_photo: photoDataUrl,
        memo: memo.trim() ? memo.trim() : null,
        ...(visitedAtChanged ? { visited_at: newVisitedAt } : {}),
      });

      // タイムライン側で「保存しました」トーストを出すための一時フラグ。
      window.sessionStorage.setItem(SAVED_TOAST_KEY, String(Date.now()));
      router.push("/timeline");
    } finally {
      setSaving(false);
    }
  }

  if (!visit) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-8">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </main>
    );
  }

  const needsVenueName = !visit.venue?.name;
  // 家族での使用がメインのご飯屋・公園・スーパー等では、お酒の武器・静かさなど
  // 飲み屋向けの項目は不要なため隠す(原則1: 入力を増やさない)。
  const isFamily = visit.venue?.category === "family";

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-lg font-bold">登録</h1>
        <label className="flex flex-col gap-1 text-xs text-neutral-600" htmlFor="visited-at">
          訪問日時
          <input
            id="visited-at"
            type="datetime-local"
            value={visitedAtInput}
            max={toDatetimeLocalValue(new Date().toISOString())}
            onChange={(event) => setVisitedAtInput(event.target.value)}
            className="w-fit rounded-lg bg-neutral-100 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-amber-400"
          />
        </label>
      </header>

      {errorMessage && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</p>
      )}

      {needsVenueName && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-neutral-600" htmlFor="venue-name">
            店名（GPSのみのため入力してください）
          </label>

          {visit.venue?.location && placeCandidates.length === 0 && (
            <button
              type="button"
              onClick={handleSearchNearbyPlaces}
              disabled={loadingPlaces}
              className="self-start rounded-full bg-neutral-200 px-4 py-2 text-xs font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
            >
              {loadingPlaces ? "検索中..." : "📍 近くの店舗を候補から選ぶ"}
            </button>
          )}

          {!loadingPlaces && hasSearchedPlaces && placeCandidates.length === 0 && (
            <p className="text-xs text-neutral-600">近くに候補となる店舗が見つかりませんでした。</p>
          )}

          {!loadingPlaces && placeCandidates.length > 0 && (
            <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
              {placeCandidates.map((place) => (
                <li key={place.placeId}>
                  <button
                    type="button"
                    onClick={() => handleSelectPlace(place)}
                    className={`w-full rounded-xl px-4 py-2 text-left text-sm focus:ring-2 focus:ring-amber-400 ${
                      selectedPlace?.placeId === place.placeId
                        ? "bg-amber-400/20 text-amber-600"
                        : "bg-neutral-100 text-neutral-800"
                    }`}
                  >
                    {place.name}
                    {place.address && (
                      <span className="ml-2 text-xs text-neutral-600">{place.address}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            id="venue-name"
            value={venueNameInput}
            onChange={(event) => {
              setVenueNameInput(event.target.value);
              setSelectedPlace(null);
            }}
            placeholder="候補にない場合は店名を入力"
            maxLength={VENUE_NAME_MAX_LENGTH}
            className="rounded-xl bg-neutral-100 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
          />
        </div>
      )}

      <ChoiceChips label="誰と" options={WHO_OPTIONS} value={who} onChange={setWho} multiple />
      {!isFamily && (
        <>
          <ChoiceChips
            label="また行きたい"
            options={REVISIT_OPTIONS}
            value={revisit}
            onChange={setRevisit}
          />
          <ChoiceChips
            label="予算感"
            options={BUDGET_OPTIONS}
            value={budget}
            onChange={setBudget}
          />
          <ChoiceChips
            label="お酒の武器"
            options={ALCOHOL_OPTIONS}
            value={alcoholTags}
            onChange={setAlcoholTags}
            multiple
          />
          <ChoiceChips
            label="静かさ"
            options={QUIETNESS_OPTIONS}
            value={quietness}
            onChange={setQuietness}
          />
        </>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-neutral-600">厳選の1枚</span>
        <label className="flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-neutral-300 bg-neutral-100 text-sm text-neutral-600">
          {compressing ? (
            "処理中..."
          ) : photoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 圧縮後のdata URLをそのまま表示するため
            <img src={photoDataUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            "タップして写真を選択"
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-600" htmlFor="memo">
          自由メモ
        </label>
        <textarea
          id="memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          rows={3}
          placeholder="音声入力もおすすめです"
          maxLength={MEMO_MAX_LENGTH}
          className="rounded-xl bg-neutral-100 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
        />
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-full bg-amber-400 py-4 text-base font-semibold text-black disabled:opacity-60"
      >
        {saving ? "保存中..." : "保存する"}
      </button>
    </main>
  );
}
