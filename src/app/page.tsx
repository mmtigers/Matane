"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import {
  createCheckInByVenueName,
  createCheckInForVenue,
  createInstantCheckIn,
  createWishOnlyVenue,
  scheduleBackgroundSync,
  toggleVenueWish,
  undoCheckIn,
} from "@/lib/db/checkin";
import type { LocalVenue } from "@/lib/db/localDb";
import { searchVenuesLocal, useIncompleteVisits, useSuggestedVenue } from "@/lib/db/queries";
import { getCurrentLocation } from "@/lib/geo";
import type { LatLng } from "@/types/models";
import { type PlaceCandidate, searchNearbyVenues } from "@/lib/places";

const VENUE_NAME_MAX_LENGTH = 100;
const NAV_GUIDE_STORAGE_KEY = "matane:seenNavGuide";
// 候補リストはmax-h-60(スクロール)で折りたたんでおり、この件数を超えると
// スクロールしないと見えなくなる。残り件数の目安表示に使う。
const VISIBLE_CANDIDATE_COUNT = 5;

export default function HomePage() {
  const [checkingIn, setCheckingIn] = useState(false);
  const [undoVisitId, setUndoVisitId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocalVenue[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [instantNameInput, setInstantNameInput] = useState("");
  const [pendingLocation, setPendingLocation] = useState<LatLng | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceCandidate | null>(null);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [locatingForPrompt, setLocatingForPrompt] = useState(false);
  const [wishSavedMessage, setWishSavedMessage] = useState<string | null>(null);
  // 初回起動時だけ、増えたタブ(⭐📊🗺️)の意味を軽く案内する。localStorageはSSR側で
  // 読めないため、初期値はSSRと揃えてfalseにし、マウント後のeffectで反映する
  // (hydrationミスマッチを避けるため)。
  const [showNavGuide, setShowNavGuide] = useState(false);
  const router = useRouter();

  const incompleteVisits = useIncompleteVisits();
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

  // 位置情報の取得を待たずにダイアログを即表示することで、体感の待ち時間を縮める
  // (以前は取得完了までダイアログ自体が出ず、無反応に見えていた)。GPSは店内など
  // 電波の弱い場所だと数秒かかることがあるため、直近のキャッシュがあれば再利用する。
  function openNamePrompt() {
    setErrorMessage(null);
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

  // 検索結果一覧から、チェックインせずにその場で「行きたい」の状態だけ切り替える。
  async function handleToggleSearchResultWish(venue: LocalVenue) {
    const nextWished = !venue.is_wished;
    await toggleVenueWish(venue.id, nextWished);
    setSearchResults((current) =>
      current.map((v) => (v.id === venue.id ? { ...v, is_wished: nextWished } : v))
    );
  }

  // まだ行ったことのない店(友人に勧められた等)を、チェックインを経由せず直接
  // 行きたいリストへ追加するための入口。
  async function handleSaveAsWish(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createWishOnlyVenue(trimmed);
    setWishSavedMessage(`「${trimmed}」を行きたいリストに追加しました`);
    setSearchQuery("");
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
            <li>⭐ 行きたい: 気になる店を保存しておける場所</li>
            <li>📊 統計: 訪問回数やよく飲むお酒などの振り返り</li>
            <li>🗺️ マップ: 訪問済み・行きたい店を地図で確認</li>
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
          className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-full bg-amber-400 text-black shadow-lg shadow-amber-400/20 transition-transform active:scale-95 disabled:opacity-60"
        >
          {checkingIn ? (
            <span className="text-base font-semibold">登録中...</span>
          ) : (
            <>
              <span className="text-4xl">📍</span>
              <span className="text-base font-semibold">今ココを瞬録</span>
            </>
          )}
        </button>
      </section>

      {incompleteVisits && incompleteVisits.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-amber-600">⚠️ 登録待ち</h2>
          <ul className="flex flex-col gap-2">
            {incompleteVisits.map((visit) => (
              <li key={visit.id}>
                <Link
                  href={`/visits/${visit.id}/register`}
                  className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3 focus:ring-2 focus:ring-amber-400"
                >
                  <span>{visit.venue?.name || "店名未設定"}</span>
                  <span className="text-xs text-neutral-600">
                    {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  aria-label={venue.is_wished ? "行きたいリストから外す" : "行きたいリストに追加"}
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
                onClick={() => handleSaveAsWish(searchQuery)}
                className="flex-none rounded-xl border border-dashed border-neutral-300 px-3 py-3 text-xs font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
              >
                ☆ 行きたいに保存
              </button>
            </li>
          </ul>
        )}
        <p className="text-xs text-neutral-500">
          まだ行ったことのない店は「☆ 行きたいに保存」からチェックインせずに登録できます。
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

      {showNamePrompt && (
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
              <>
                <p className="mt-3 text-xs text-neutral-500">
                  近くの候補 {placeCandidates.length}件
                  {placeCandidates.length > VISIBLE_CANDIDATE_COUNT &&
                    `（スクロールしてあと${placeCandidates.length - VISIBLE_CANDIDATE_COUNT}件）`}
                </p>
                <ul className="mt-1.5 flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {placeCandidates.map((place) => (
                    <li key={place.placeId}>
                      <button
                        type="button"
                        onClick={() => handleSelectPlace(place)}
                        className={`w-full rounded-xl px-4 py-2 text-left text-sm focus:ring-2 focus:ring-amber-400 ${
                          selectedPlace?.placeId === place.placeId
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
              </>
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
                  handleInstantCheckIn(instantNameInput);
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
                onClick={() => handleInstantCheckIn(instantNameInput)}
                disabled={checkingIn || locatingForPrompt}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                登録する
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
