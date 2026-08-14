"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import { ChoiceChips } from "@/components/ChoiceChips";
import { PlaceCandidateList } from "@/components/PlaceCandidateList";
import { WISH_REASON_OPTIONS, type WishReason } from "@/constants/choices";
import {
  createCheckInByVenueName,
  createCheckInForVenue,
  createFamilyCheckIn,
  createInstantCheckIn,
  createWishOnlyVenue,
  scheduleBackgroundSync,
  toggleVenueWish,
  undoCheckIn,
} from "@/lib/db/checkin";
import type { LocalVenue } from "@/lib/db/localDb";
import { searchVenuesLocal, useSuggestedVenue } from "@/lib/db/queries";
import { isoFromDateKeepingCurrentTime, toDateInputValue } from "@/lib/datetimeLocal";
import { getCurrentLocation } from "@/lib/geo";
import { compressPhotoToDataUrl, PhotoTooLargeError } from "@/lib/photo";
import type { LatLng, VenueCategory } from "@/types/models";
import { type PlaceCandidate, searchNearbyVenues, searchVenuesByText } from "@/lib/places";

const VENUE_NAME_MAX_LENGTH = 100;
const NAV_GUIDE_STORAGE_KEY = "matane:seenNavGuide";

export default function HomePage() {
  const [checkingIn, setCheckingIn] = useState(false);
  const [undoVisitId, setUndoVisitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocalVenue[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [checkInCategory, setCheckInCategory] = useState<VenueCategory>("bar");
  // familyカテゴリのみ使う2段目のステップ。「名前わかる？」の後にもう1段
  // 「写真を1枚」を挟み、登録完了までダイアログを閉じずに進める。
  const [familyStep, setFamilyStep] = useState<"name" | "photo">("name");
  const [familyPhotoDataUrl, setFamilyPhotoDataUrl] = useState<string | null>(null);
  const [compressingFamilyPhoto, setCompressingFamilyPhoto] = useState(false);
  const [instantNameInput, setInstantNameInput] = useState("");
  const [pendingLocation, setPendingLocation] = useState<LatLng | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceCandidate | null>(null);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [locatingForPrompt, setLocatingForPrompt] = useState(false);
  const [wishSavedMessage, setWishSavedMessage] = useState<string | null>(null);
  const [showBackdatePrompt, setShowBackdatePrompt] = useState(false);
  const [backdateNameInput, setBackdateNameInput] = useState("");
  const [backdateResults, setBackdateResults] = useState<LocalVenue[]>([]);
  const [backdateSelectedVenue, setBackdateSelectedVenue] = useState<LocalVenue | null>(null);
  const [backdateDateInput, setBackdateDateInput] = useState("");
  const [backdateSaving, setBackdateSaving] = useState(false);
  const [showWishDialog, setShowWishDialog] = useState(false);
  const [wishDialogNameInput, setWishDialogNameInput] = useState("");
  const [wishCandidates, setWishCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingWishCandidates, setLoadingWishCandidates] = useState(false);
  const [selectedWishPlace, setSelectedWishPlace] = useState<PlaceCandidate | null>(null);
  const [wishReasons, setWishReasons] = useState<WishReason[]>([]);
  const [wishDialogSaving, setWishDialogSaving] = useState(false);
  // 初回起動時だけ、増えたタブ(⭐📊🗺️)の意味を軽く案内する。localStorageはSSR側で
  // 読めないため、初期値はSSRと揃えてfalseにし、マウント後のeffectで反映する
  // (hydrationミスマッチを避けるため)。
  const [showNavGuide, setShowNavGuide] = useState(false);
  const router = useRouter();

  const suggestion = useSuggestedVenue();

  useEffect(() => {
    if (!window.localStorage.getItem(NAV_GUIDE_STORAGE_KEY)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setShowNavGuide(true);
    }
  }, []);

  function dismissNavGuide() {
    window.localStorage.setItem(NAV_GUIDE_STORAGE_KEY, "1");
    setShowNavGuide(false);
  }

  useEffect(() => {
    if (!undoVisitId) return;
    const timer = setTimeout(() => {
      setUndoVisitId(null);
      scheduleBackgroundSync();
    }, 5000);
    return () => clearTimeout(timer);
  }, [undoVisitId]);

  useEffect(() => {
    if (!wishSavedMessage) return;
    const timer = setTimeout(() => setWishSavedMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [wishSavedMessage]);

  useEffect(() => {
    let active = true;
    searchVenuesLocal(searchQuery).then((results) => {
      if (active) setSearchResults(results);
    });
    return () => {
      active = false;
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!showBackdatePrompt) return;
    let active = true;
    searchVenuesLocal(backdateNameInput).then((results) => {
      if (active) setBackdateResults(results);
    });
    return () => {
      active = false;
    };
  }, [backdateNameInput, showBackdatePrompt]);

  // 位置情報の取得を待たずにダイアログを即表示することで、体感の待ち時間を縮める
  // (以前は取得完了までダイアログ自体が出ず、無反応に見えていた)。GPSは店内など
  // 電波の弱い場所だと数秒かかることがあるため、直近のキャッシュがあれば再利用する。
  function openNamePrompt(category: VenueCategory) {
    setErrorMessage(null);
    setCheckInCategory(category);
    setFamilyStep("name");
    setFamilyPhotoDataUrl(null);
    setPendingLocation(null);
    setInstantNameInput("");
    setSelectedPlace(null);
    setPlaceCandidates([]);
    setShowNamePrompt(true);
    setLocatingForPrompt(true);

    getCurrentLocation({ maximumAge: 30000 })
      .then((location) => {
        setPendingLocation(location);
        setLoadingPlaces(true);
        searchNearbyVenues(location)
          .then(setPlaceCandidates)
          .finally(() => setLoadingPlaces(false));
      })
      .catch((error) => {
        console.error(error);
        setShowNamePrompt(false);
        setErrorMessage("位置情報を取得できませんでした。設定をご確認ください。");
      })
      .finally(() => setLocatingForPrompt(false));
  }

  function handleSelectPlace(place: PlaceCandidate) {
    setSelectedPlace(place);
    setInstantNameInput(place.name);
  }

  async function handleInstantCheckIn(name: string) {
    if (!pendingLocation) return;
    setShowNamePrompt(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const trimmed = name.trim();
      const place = selectedPlace?.name === trimmed ? selectedPlace : undefined;
      const visitId = await createInstantCheckIn(
        pendingLocation,
        name,
        place ? { placeId: place.placeId, address: place.address } : undefined
      );
      setUndoVisitId(visitId);
    } catch (error) {
      console.error(error);
      setErrorMessage("チェックインに失敗しました。");
    } finally {
      setCheckingIn(false);
      setPendingLocation(null);
    }
  }

  // 「名前わかる？」ダイアログの確定ボタン。飲み屋(bar)はそのままチェックインして
  // 登録待ちにする(肉付けは後で/register画面)。家族(family)は写真ステップへ進み、
  // ダイアログを閉じずに1枚登録〜送信まで続ける。
  function handleNameStepConfirm(name: string) {
    if (checkInCategory === "family") {
      setInstantNameInput(name);
      setFamilyStep("photo");
      return;
    }
    handleInstantCheckIn(name);
  }

  async function handleFamilyPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setCompressingFamilyPhoto(true);
    try {
      const dataUrl = await compressPhotoToDataUrl(file);
      setFamilyPhotoDataUrl(dataUrl);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof PhotoTooLargeError ? error.message : "画像の処理に失敗しました"
      );
      if (error instanceof PhotoTooLargeError) event.target.value = "";
    } finally {
      setCompressingFamilyPhoto(false);
    }
  }

  // 家族用瞬録の最終ステップ。写真の有無にかかわらずここで即完了(is_completed: true)
  // まで一気に進めるため、二次登録画面を経由しない。
  async function handleFamilyCheckIn() {
    if (!pendingLocation) return;
    setShowNamePrompt(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const trimmed = instantNameInput.trim();
      const place = selectedPlace?.name === trimmed ? selectedPlace : undefined;
      const visitId = await createFamilyCheckIn(
        pendingLocation,
        instantNameInput,
        familyPhotoDataUrl,
        place ? { placeId: place.placeId, address: place.address } : undefined
      );
      setUndoVisitId(visitId);
    } catch (error) {
      console.error(error);
      setErrorMessage("登録に失敗しました。");
    } finally {
      setCheckingIn(false);
      setPendingLocation(null);
      setFamilyPhotoDataUrl(null);
    }
  }

  async function handleUndo() {
    if (!undoVisitId) return;
    await undoCheckIn(undoVisitId);
    setUndoVisitId(null);
  }

  async function goToRegisterForVenueId(venueId: string) {
    const visitId = await createCheckInForVenue(venueId);
    router.push(`/visits/${visitId}/register`);
  }

  async function goToRegisterForNewName(name: string) {
    const visitId = await createCheckInByVenueName(name);
    router.push(`/visits/${visitId}/register`);
  }

  // Enterキーで一番上の検索結果へ即進める(候補が無ければ新規チェックイン扱い)。
  // クリック操作しか受け付けなかったため、キーボード中心の操作を早くする。
  // isComposingのチェックが無いと、日本語IMEで漢字変換を確定するEnterにも反応し、
  // 変換途中の文字列でチェックインが走ってしまう。
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    event.preventDefault();
    if (searchResults.length > 0) {
      goToRegisterForVenueId(searchResults[0].id);
    } else {
      goToRegisterForNewName(trimmed);
    }
  }

  // 検索結果一覧から、チェックインせずにその場で「気になる」の状態だけ切り替える。
  async function handleToggleSearchResultWish(venue: LocalVenue) {
    const nextWished = !venue.is_wished;
    await toggleVenueWish(venue.id, nextWished);
    setSearchResults((current) =>
      current.map((v) => (v.id === venue.id ? { ...v, is_wished: nextWished } : v))
    );
  }

  // まだ行ったことのない店(車から見かけた店・友人に勧められた店など)を、チェックイン
  // を経由せず直接「気になる」へ追加するための入口。店名候補をGoogle検索で提示し、
  // 座標付きで保存できるようにする(車の現在地とお店の位置が一致しないシナリオのため、
  // 座標は選んだ候補自身のものを使う。現在地はlocationBiasとしてのみ使う)。
  function openWishDialog(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setErrorMessage(null);
    setWishDialogNameInput(trimmed);
    setWishCandidates([]);
    setSelectedWishPlace(null);
    setWishReasons([]);
    setShowWishDialog(true);

    setLoadingWishCandidates(true);
    getCurrentLocation({ maximumAge: 30000 })
      .catch(() => null)
      .then((location) => searchVenuesByText(trimmed, location ?? undefined))
      .then(setWishCandidates)
      .finally(() => setLoadingWishCandidates(false));
  }

  function handleSelectWishPlace(place: PlaceCandidate) {
    setSelectedWishPlace(place);
    setWishDialogNameInput(place.name);
  }

  async function handleSaveWish() {
    const trimmed = wishDialogNameInput.trim();
    if (!trimmed) return;
    setWishDialogSaving(true);
    setErrorMessage(null);
    try {
      const place = selectedWishPlace?.name === trimmed ? selectedWishPlace : undefined;
      await createWishOnlyVenue(trimmed, {
        location: place?.location,
        place: place ? { placeId: place.placeId, address: place.address } : undefined,
        wishReason: wishReasons,
      });
      setShowWishDialog(false);
      setWishSavedMessage(`「${trimmed}」を気になるリストに追加しました`);
      setSearchQuery("");
    } catch (error) {
      console.error(error);
      setErrorMessage("保存に失敗しました。");
    } finally {
      setWishDialogSaving(false);
    }
  }

  // 「忘れて数日後に気づいた」を解消するための入口。過去の日付を指定してVisitを作成する。
  function openBackdatePrompt() {
    setErrorMessage(null);
    setBackdateNameInput("");
    setBackdateResults([]);
    setBackdateSelectedVenue(null);
    setBackdateDateInput(toDateInputValue(new Date().toISOString()));
    setShowBackdatePrompt(true);
  }

  function handleSelectBackdateVenue(venue: LocalVenue) {
    setBackdateSelectedVenue(venue);
    setBackdateNameInput(venue.name);
  }

  async function handleBackdateSave() {
    const trimmed = backdateNameInput.trim();
    if (!trimmed) return;
    setBackdateSaving(true);
    setErrorMessage(null);
    try {
      const visitedAt = isoFromDateKeepingCurrentTime(backdateDateInput);
      const useExisting = backdateSelectedVenue?.name === trimmed;
      const visitId = useExisting
        ? await createCheckInForVenue(backdateSelectedVenue!.id, visitedAt)
        : await createCheckInByVenueName(trimmed, visitedAt);
      setShowBackdatePrompt(false);
      router.push(`/visits/${visitId}/register`);
    } catch (error) {
      console.error(error);
      setErrorMessage("記録に失敗しました。");
    } finally {
      setBackdateSaving(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-8 px-4 pt-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Matane</h1>
          <Link
            href="/settings"
            aria-label="設定"
            className="rounded-full p-1.5 text-lg text-neutral-500 focus:ring-2 focus:ring-amber-400"
          >
            ⚙️
          </Link>
        </div>
        <AuthStatus />
      </header>

      {showNavGuide && (
        <section className="flex flex-col gap-2 rounded-2xl bg-neutral-100 p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-amber-600">新しいタブができました</p>
            <button
              type="button"
              onClick={dismissNavGuide}
              aria-label="閉じる"
              className="text-neutral-500 focus:ring-2 focus:ring-amber-400"
            >
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1 text-xs text-neutral-600">
            <li>⭐ 気になる: 行きたいお店を保存しておける場所</li>
            <li>📊 わたしデータ: 訪問回数やよく飲むお酒などの振り返り</li>
            <li>🗺️ ちかく: 訪問済み・気になる店を地図で確認</li>
          </ul>
        </section>
      )}

      {errorMessage && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</p>
      )}

      <section className="flex flex-col items-center gap-3 py-8">
        <div className="flex justify-center gap-4">
          <button
            type="button"
            onClick={() => openNamePrompt("bar")}
            disabled={checkingIn}
            className="flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full bg-amber-400 text-black shadow-lg shadow-amber-400/20 transition-transform active:scale-95 disabled:opacity-60"
          >
            <span className="text-3xl">📍</span>
            <span className="text-sm font-semibold">今ココを瞬録</span>
            <span className="text-[10px] text-black/60">飲み屋・仕事</span>
          </button>
          <button
            type="button"
            onClick={() => openNamePrompt("family")}
            disabled={checkingIn}
            className="flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full bg-neutral-800 text-white shadow-lg shadow-neutral-800/20 transition-transform active:scale-95 disabled:opacity-60"
          >
            <span className="text-3xl">🍽️</span>
            <span className="text-sm font-semibold">お出かけを瞬録</span>
            <span className="text-[10px] text-white/60">ご飯・公園・買い物</span>
          </button>
        </div>
        {checkingIn && <span className="text-sm font-semibold text-neutral-600">登録中...</span>}
        <button
          type="button"
          onClick={openBackdatePrompt}
          className="rounded-full bg-neutral-200 px-6 py-2.5 text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
        >
          🕐 後から記録する
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-neutral-600" htmlFor="venue-search">
          後から登録（店名・駅名で検索）
        </label>
        <input
          id="venue-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="店名または駅名"
          maxLength={100}
          className="rounded-xl bg-neutral-100 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
        />
        {searchQuery.trim() && (
          <ul className="flex flex-col gap-2">
            {searchResults.map((venue) => (
              <li key={venue.id} className="flex items-center gap-2">
                <button
                  type="button"
                  data-venue-id={venue.id}
                  onClick={() => goToRegisterForVenueId(venue.id)}
                  className="flex-1 rounded-xl bg-neutral-100 px-4 py-3 text-left focus:ring-2 focus:ring-amber-400"
                >
                  {venue.name}
                  {venue.nearest_station && (
                    <span className="ml-2 text-xs text-neutral-600">
                      {venue.nearest_station}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchResultWish(venue)}
                  aria-label={venue.is_wished ? "気になるリストから外す" : "気になるリストに追加"}
                  aria-pressed={venue.is_wished}
                  className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-lg focus:ring-2 focus:ring-amber-400 ${
                    venue.is_wished
                      ? "bg-amber-400/20 text-amber-600"
                      : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {venue.is_wished ? "⭐" : "☆"}
                </button>
              </li>
            ))}
            <li className="flex gap-2">
              <button
                type="button"
                onClick={() => goToRegisterForNewName(searchQuery.trim())}
                className="flex-1 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-left text-neutral-600 focus:ring-2 focus:ring-amber-400"
              >
                「{searchQuery.trim()}」で新規チェックイン
              </button>
              <button
                type="button"
                onClick={() => openWishDialog(searchQuery)}
                className="flex-none rounded-xl border border-dashed border-neutral-300 px-3 py-3 text-xs font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
              >
                ☆ 気になるに保存
              </button>
            </li>
          </ul>
        )}
        <p className="text-xs text-neutral-500">
          まだ行ったことのない店は「☆ 気になるに保存」からチェックインせずに登録できます。
        </p>
      </section>

      {suggestion?.venue && (
        <section className="rounded-2xl bg-neutral-100 p-4">
          <h2 className="text-sm font-semibold text-amber-600">今日どこ行く？</h2>
          <p className="mt-2 text-base font-medium">{suggestion.venue.name}</p>
          <p className="text-xs text-neutral-600">
            前回: {new Date(suggestion.visited_at).toLocaleDateString("ja-JP")}
            ・しばらく行っていません
          </p>
          <Link
            href={`/venues/${suggestion.venue.id}`}
            className="mt-3 inline-block rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-200"
          >
            店舗詳細を見る
          </Link>
        </section>
      )}

      {showNamePrompt && checkInCategory === "family" && familyStep === "photo" && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="写真を1枚"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowNamePrompt(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">写真を1枚(なくてもOK)</p>

            <label className="mt-3 flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-neutral-300 bg-neutral-200 text-sm text-neutral-600">
              {compressingFamilyPhoto ? (
                "処理中..."
              ) : familyPhotoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- 圧縮後のdata URLをそのまま表示するため
                <img
                  src={familyPhotoDataUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                "タップして写真を撮る/選ぶ"
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={checkingIn || compressingFamilyPhoto}
                onChange={handleFamilyPhotoChange}
              />
            </label>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setFamilyStep("name")}
                disabled={checkingIn}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleFamilyCheckIn}
                disabled={checkingIn || compressingFamilyPhoto}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {checkingIn ? "登録中..." : familyPhotoDataUrl ? "登録する" : "写真なしで登録"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNamePrompt && !(checkInCategory === "family" && familyStep === "photo") && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="名前わかる？"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowNamePrompt(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">名前わかる？</p>

            {locatingForPrompt && (
              <p className="mt-3 text-xs text-neutral-600">現在地を取得中...</p>
            )}
            {!locatingForPrompt && loadingPlaces && (
              <p className="mt-3 text-xs text-neutral-600">近くの店舗を検索中...</p>
            )}

            {!loadingPlaces && placeCandidates.length > 0 && (
              <PlaceCandidateList
                candidates={placeCandidates}
                selectedPlaceId={selectedPlace?.placeId ?? null}
                onSelect={handleSelectPlace}
              />
            )}

            <input
              value={instantNameInput}
              onChange={(event) => {
                setInstantNameInput(event.target.value);
                setSelectedPlace(null);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  !checkingIn &&
                  !locatingForPrompt
                )
                  handleNameStepConfirm(instantNameInput);
              }}
              placeholder="候補にない場合は入力(わからなければ空欄でOK)"
              maxLength={VENUE_NAME_MAX_LENGTH}
              disabled={checkingIn}
              className="mt-3 w-full rounded-xl bg-neutral-200 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowNamePrompt(false)}
                disabled={checkingIn}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => handleNameStepConfirm(instantNameInput)}
                disabled={checkingIn || locatingForPrompt}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {checkingIn ? "登録中..." : checkInCategory === "family" ? "次へ" : "登録する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBackdatePrompt && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="後から記録する"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowBackdatePrompt(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">後から記録する</p>

            <input
              value={backdateNameInput}
              onChange={(event) => {
                setBackdateNameInput(event.target.value);
                setBackdateSelectedVenue(null);
              }}
              placeholder="店名を入力"
              maxLength={VENUE_NAME_MAX_LENGTH}
              className="mt-3 w-full rounded-xl bg-neutral-200 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
            />

            {backdateNameInput.trim() && backdateResults.length > 0 && (
              <ul className="mt-1.5 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {backdateResults.map((venue) => (
                  <li key={venue.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectBackdateVenue(venue)}
                      className={`w-full rounded-xl px-4 py-2 text-left text-sm focus:ring-2 focus:ring-amber-400 ${
                        backdateSelectedVenue?.id === venue.id
                          ? "bg-amber-400/20 text-amber-600"
                          : "bg-neutral-200 text-neutral-800"
                      }`}
                    >
                      {venue.name}
                      {venue.nearest_station && (
                        <span className="ml-2 text-xs text-neutral-600">
                          {venue.nearest_station}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label
              className="mt-3 flex flex-col gap-1 text-xs text-neutral-600"
              htmlFor="backdate-date"
            >
              訪問日
              <input
                id="backdate-date"
                type="date"
                value={backdateDateInput}
                max={toDateInputValue(new Date().toISOString())}
                onChange={(event) => setBackdateDateInput(event.target.value)}
                className="w-fit rounded-lg bg-neutral-200 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowBackdatePrompt(false)}
                disabled={backdateSaving}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleBackdateSave}
                disabled={backdateSaving || !backdateNameInput.trim()}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {backdateSaving ? "登録中..." : "登録する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWishDialog && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="気になるに保存"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowWishDialog(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">気になるに保存</p>

            {loadingWishCandidates && (
              <p className="mt-3 text-xs text-neutral-600">候補を検索中...</p>
            )}

            {!loadingWishCandidates && wishCandidates.length > 0 && (
              <ul className="mt-3 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {wishCandidates.map((place) => (
                  <li key={place.placeId}>
                    <button
                      type="button"
                      onClick={() => handleSelectWishPlace(place)}
                      className={`w-full rounded-xl px-4 py-2 text-left text-sm focus:ring-2 focus:ring-amber-400 ${
                        selectedWishPlace?.placeId === place.placeId
                          ? "bg-amber-400/20 text-amber-600"
                          : "bg-neutral-200 text-neutral-800"
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

            {!loadingWishCandidates && wishCandidates.length === 0 && (
              <p className="mt-3 text-xs text-neutral-600">
                候補が見つかりませんでした。店名で保存できます。
              </p>
            )}

            <input
              value={wishDialogNameInput}
              onChange={(event) => {
                setWishDialogNameInput(event.target.value);
                setSelectedWishPlace(null);
              }}
              placeholder="店名を入力"
              maxLength={VENUE_NAME_MAX_LENGTH}
              className="mt-3 w-full rounded-xl bg-neutral-200 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
            />

            <div className="mt-4">
              <ChoiceChips
                label="気になる理由（任意）"
                options={WISH_REASON_OPTIONS}
                value={wishReasons}
                onChange={setWishReasons}
                multiple
              />
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowWishDialog(false)}
                disabled={wishDialogSaving}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveWish}
                disabled={wishDialogSaving || !wishDialogNameInput.trim()}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {wishDialogSaving ? "保存中..." : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {undoVisitId && (
        <div className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between rounded-xl bg-neutral-200 px-4 py-3 shadow-lg">
          <span className="text-sm">チェックインしました</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
          >
            取り消す
          </button>
        </div>
      )}

      {wishSavedMessage && (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-xl bg-neutral-200 px-4 py-3 text-center text-sm shadow-lg">
          {wishSavedMessage}
        </div>
      )}
    </main>
  );
}
