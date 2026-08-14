"use client";

import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import { ChoiceChips } from "@/components/ChoiceChips";
import { PlaceCandidateList } from "@/components/PlaceCandidateList";
import { WISH_REASON_OPTIONS, type WishReason } from "@/constants/choices";
import {
  createNamedCheckIn,
  createNamedCheckInForVenue,
  createQuickCheckIn,
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
import type { LatLng } from "@/types/models";
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
  // 「ココを記録」共通の2段目のステップ。「名前わかる？」の後にもう1段
  // 「写真を1枚」を挟み、登録完了までダイアログを閉じずに進める。
  const [quickStep, setQuickStep] = useState<"name" | "photo">("name");
  const [quickPhotoDataUrl, setQuickPhotoDataUrl] = useState<string | null>(null);
  const [compressingQuickPhoto, setCompressingQuickPhoto] = useState(false);
  const [instantNameInput, setInstantNameInput] = useState("");
  const [pendingLocation, setPendingLocation] = useState<LatLng | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceCandidate | null>(null);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [locatingForPrompt, setLocatingForPrompt] = useState(false);
  const [wishSavedMessage, setWishSavedMessage] = useState<string | null>(null);
  // 「名前で記録」の訪問日。デフォルトは今日、過去日にも変更できる。new Date()を
  // SSR時点で評価するとhydrationミスマッチになるため、マウント後のeffectで設定する。
  const [todayDateValue, setTodayDateValue] = useState("");
  const [namedRegisterDate, setNamedRegisterDate] = useState("");
  const [showNamedDialog, setShowNamedDialog] = useState(false);
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

  const suggestion = useSuggestedVenue();

  useEffect(() => {
    if (!window.localStorage.getItem(NAV_GUIDE_STORAGE_KEY)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setShowNavGuide(true);
    }
  }, []);

  useEffect(() => {
    const today = toDateInputValue(new Date().toISOString());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new Date()はSSR時点で評価できないため、マウント後に一度だけ反映する
    setTodayDateValue(today);
    setNamedRegisterDate(today);
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

  // 位置情報の取得を待たずにダイアログを即表示することで、体感の待ち時間を縮める
  // (以前は取得完了までダイアログ自体が出ず、無反応に見えていた)。GPSは店内など
  // 電波の弱い場所だと数秒かかることがあるため、直近のキャッシュがあれば再利用する。
  function openNamePrompt() {
    setErrorMessage(null);
    setQuickStep("name");
    setQuickPhotoDataUrl(null);
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

  // 「名前で記録」ダイアログを開く。開くたびに前回の入力をリセットする。
  function openNamedDialog() {
    setErrorMessage(null);
    setSearchQuery("");
    setNamedRegisterDate(todayDateValue);
    setShowNamedDialog(true);
  }

  function handleSelectPlace(place: PlaceCandidate) {
    setSelectedPlace(place);
    setInstantNameInput(place.name);
  }

  // 「名前わかる？」ダイアログの確定ボタン。ダイアログを閉じずに写真ステップへ進む。
  function handleNameStepConfirm(name: string) {
    setInstantNameInput(name);
    setQuickStep("photo");
  }

  async function handleQuickPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setCompressingQuickPhoto(true);
    try {
      const dataUrl = await compressPhotoToDataUrl(file);
      setQuickPhotoDataUrl(dataUrl);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof PhotoTooLargeError ? error.message : "画像の処理に失敗しました"
      );
      if (error instanceof PhotoTooLargeError) event.target.value = "";
    } finally {
      setCompressingQuickPhoto(false);
    }
  }

  // 「ココを記録」の最終ステップ。写真の有無にかかわらずここで即完了(is_completed: true)
  // まで一気に進めるため、二次登録画面を経由しない。
  async function handleQuickCheckInSubmit() {
    if (!pendingLocation) return;
    setShowNamePrompt(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const trimmed = instantNameInput.trim();
      const place = selectedPlace?.name === trimmed ? selectedPlace : undefined;
      const visitId = await createQuickCheckIn(
        pendingLocation,
        instantNameInput,
        quickPhotoDataUrl,
        place ? { placeId: place.placeId, address: place.address } : undefined
      );
      setUndoVisitId(visitId);
    } catch (error) {
      console.error(error);
      setErrorMessage("登録に失敗しました。");
    } finally {
      setCheckingIn(false);
      setPendingLocation(null);
      setQuickPhotoDataUrl(null);
    }
  }

  async function handleUndo() {
    if (!undoVisitId) return;
    await undoCheckIn(undoVisitId);
    setUndoVisitId(null);
  }

  // 「名前で記録」共通。指定した日付(デフォルト今日)でその場で完了させる。
  async function checkInForVenue(venueId: string) {
    setShowNamedDialog(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const visitId = await createNamedCheckInForVenue(
        venueId,
        isoFromDateKeepingCurrentTime(namedRegisterDate)
      );
      setUndoVisitId(visitId);
      setSearchQuery("");
    } catch (error) {
      console.error(error);
      setErrorMessage("記録に失敗しました。");
    } finally {
      setCheckingIn(false);
    }
  }

  async function checkInForNewName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setShowNamedDialog(false);
    setErrorMessage(null);
    setCheckingIn(true);
    try {
      const visitId = await createNamedCheckIn(
        trimmed,
        isoFromDateKeepingCurrentTime(namedRegisterDate)
      );
      setUndoVisitId(visitId);
      setSearchQuery("");
    } catch (error) {
      console.error(error);
      setErrorMessage("記録に失敗しました。");
    } finally {
      setCheckingIn(false);
    }
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
      checkInForVenue(searchResults[0].id);
    } else {
      checkInForNewName(trimmed);
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
    setShowNamedDialog(false);
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

      <section className="flex flex-col items-center gap-4 py-8">
        <button
          type="button"
          onClick={openNamePrompt}
          disabled={checkingIn}
          className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full bg-amber-400 text-black shadow-lg shadow-amber-400/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          <span className="text-3xl">📍</span>
          <span className="text-base font-semibold">ココを記録</span>
          <span className="text-[10px] text-black/60">今いる場所をサクッと記録</span>
        </button>
        <button
          type="button"
          onClick={openNamedDialog}
          disabled={checkingIn}
          className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full bg-amber-400 text-black shadow-lg shadow-amber-400/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          <span className="text-3xl">🔍</span>
          <span className="text-base font-semibold">名前で記録</span>
          <span className="text-[10px] text-black/60">店名・駅名で記録</span>
        </button>
        {checkingIn && <span className="text-sm font-semibold text-neutral-600">登録中...</span>}
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

      {showNamePrompt && quickStep === "photo" && (
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
              {compressingQuickPhoto ? (
                "処理中..."
              ) : quickPhotoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- 圧縮後のdata URLをそのまま表示するため
                <img
                  src={quickPhotoDataUrl}
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
                disabled={checkingIn || compressingQuickPhoto}
                onChange={handleQuickPhotoChange}
              />
            </label>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setQuickStep("name")}
                disabled={checkingIn}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleQuickCheckInSubmit}
                disabled={checkingIn || compressingQuickPhoto}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {checkingIn ? "登録中..." : quickPhotoDataUrl ? "登録する" : "写真なしで登録"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNamePrompt && quickStep !== "photo" && (
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
                次へ
              </button>
            </div>
          </div>
        </div>
      )}

      {showNamedDialog && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="名前で記録"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setShowNamedDialog(false)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">名前で記録</p>
            <p className="mt-1 text-xs text-neutral-600">
              今その場にいなくても、店名だけで記録できます。日付も選べます。
            </p>

            <input
              id="venue-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="店名または駅名"
              maxLength={100}
              autoFocus
              className="mt-3 w-full rounded-xl bg-neutral-200 px-4 py-3 text-base outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-amber-400"
            />
            <label
              className="mt-3 flex items-center gap-2 text-xs text-neutral-600"
              htmlFor="named-register-date"
            >
              訪問日
              <input
                id="named-register-date"
                type="date"
                value={namedRegisterDate}
                max={todayDateValue || undefined}
                onChange={(event) => setNamedRegisterDate(event.target.value)}
                className="rounded-lg bg-neutral-200 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>

            {searchQuery.trim() && (
              <ul className="mt-3 flex flex-col gap-2">
                {searchResults.map((venue) => (
                  <li key={venue.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      data-venue-id={venue.id}
                      onClick={() => checkInForVenue(venue.id)}
                      disabled={checkingIn}
                      className="flex-1 rounded-xl bg-neutral-200 px-4 py-3 text-left focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
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
                      aria-label={
                        venue.is_wished ? "気になるリストから外す" : "気になるリストに追加"
                      }
                      aria-pressed={venue.is_wished}
                      className={`flex h-11 w-11 flex-none items-center justify-center rounded-full text-lg focus:ring-2 focus:ring-amber-400 ${
                        venue.is_wished
                          ? "bg-amber-400/20 text-amber-600"
                          : "bg-neutral-200 text-neutral-500"
                      }`}
                    >
                      {venue.is_wished ? "⭐" : "☆"}
                    </button>
                  </li>
                ))}
                <li className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => checkInForNewName(searchQuery.trim())}
                    disabled={checkingIn}
                    className="flex-1 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-left text-neutral-600 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
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

            <p className="mt-3 text-xs text-neutral-500">
              まだ行ったことのない店は「☆ 気になるに保存」からチェックインせずに登録できます。
            </p>

            <button
              type="button"
              onClick={() => setShowNamedDialog(false)}
              className="mt-4 w-full rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400"
            >
              閉じる
            </button>
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
