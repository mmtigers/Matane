"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  commuteDestinations as defaultCommuteDestinations,
  getLastTrainTime,
  getMinutesUntilLastTrain,
  getPriorityDestinationId,
  withCommuteOverrides,
} from "@/config/commute";
import { PartnerAvatar } from "@/components/PartnerAvatar";
import { PlaceCandidateList } from "@/components/PlaceCandidateList";
import { Skeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadCommuteOverrides } from "@/lib/commuteSettings";
import { attachVenueLocation, toggleVenueWish } from "@/lib/db/checkin";
import { buildMemberEmailMap, isOwnVisit, useGroupMembers } from "@/lib/db/groups";
import { useVenue, useVisitsForVenue } from "@/lib/db/queries";
import { googleMapsUrl } from "@/lib/geo";
import { type PlaceCandidate, searchVenuesByText } from "@/lib/places";

export function VenueDetailClient({ venueId }: { venueId: string }) {
  const venue = useVenue(venueId);
  const visits = useVisitsForVenue(venueId);
  const { session, loading: authLoading } = useAuth();
  const groupMembers = useGroupMembers();
  const memberEmailById = useMemo(() => buildMemberEmailMap(groupMembers), [groupMembers]);
  const [now, setNow] = useState(() => new Date());
  const [shareCopied, setShareCopied] = useState(false);
  // 位置情報未設定のVenueに、Google Places候補から後付けで位置情報を設定するための状態。
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const [locationCandidates, setLocationCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingLocationCandidates, setLoadingLocationCandidates] = useState(false);
  const [attachingLocation, setAttachingLocation] = useState(false);
  // 設定画面での上書きはlocalStorageに保存されておりSSR時点では読めないため、
  // 初期値は環境変数由来のデフォルトのままにし、マウント後のeffectで反映する
  // (hydrationミスマッチを避けるため)。
  const [destinations, setDestinations] = useState(defaultCommuteDestinations);

  useEffect(() => {
    const overrides = loadCommuteOverrides();
    if (overrides) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageの値はSSR時点で読めないため、マウント後に一度だけ反映する
      setDestinations(withCommuteOverrides(defaultCommuteDestinations, overrides));
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = setTimeout(() => setShareCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  const priorityId = useMemo(() => getPriorityDestinationId(now), [now]);

  async function handleShare() {
    if (!venue) return;
    const lines = [venue.name || "店名未設定"];
    if (venue.nearest_station) lines.push(`最寄り駅: ${venue.nearest_station}`);
    if (venue.address) lines.push(venue.address);
    const mapUrl = venue.location ? googleMapsUrl(venue.location) : undefined;
    const text = lines.join("\n");

    if (navigator.share) {
      try {
        await navigator.share({ title: venue.name || "Matane", text, url: mapUrl });
      } catch (error) {
        // ユーザーが共有シートをキャンセルした場合のAbortErrorは無視する。
        if ((error as DOMException).name !== "AbortError") console.error(error);
      }
      return;
    }

    await navigator.clipboard.writeText(mapUrl ? `${text}\n${mapUrl}` : text);
    setShareCopied(true);
  }

  async function handleOpenLocationSearch() {
    if (!venue) return;
    setShowLocationSearch(true);
    setLoadingLocationCandidates(true);
    try {
      const results = await searchVenuesByText(venue.name);
      setLocationCandidates(results);
    } finally {
      setLoadingLocationCandidates(false);
    }
  }

  async function handleAttachLocation(place: PlaceCandidate) {
    if (!venue || !place.location) return;
    setAttachingLocation(true);
    try {
      await attachVenueLocation(venue.id, {
        placeId: place.placeId,
        address: place.address,
        location: place.location,
        category: place.category,
      });
      setShowLocationSearch(false);
    } finally {
      setAttachingLocation(false);
    }
  }

  if (!venue || !visits) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{venue.name || "店名未設定"}</h1>
          {venue.nearest_station && (
            <p className="text-xs text-neutral-600">最寄り駅: {venue.nearest_station}</p>
          )}
          {venue.address && <p className="text-xs text-neutral-600">{venue.address}</p>}
        </div>
        <div className="flex flex-none flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleShare}
              aria-label="この店を共有する"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-xl text-neutral-700 transition-colors focus:ring-2 focus:ring-amber-400"
            >
              📤
            </button>
            <button
              type="button"
              onClick={() => toggleVenueWish(venueId, !venue.is_wished)}
              aria-label={venue.is_wished ? "気になるリストから外す" : "気になるリストに追加"}
              aria-pressed={venue.is_wished}
              className={`flex h-11 w-11 items-center justify-center rounded-full text-xl transition-colors focus:ring-2 focus:ring-amber-400 ${
                venue.is_wished
                  ? "bg-amber-400/20 text-amber-600"
                  : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {venue.is_wished ? "⭐" : "☆"}
            </button>
          </div>
          {shareCopied && <span className="text-xs text-amber-600">コピーしました</span>}
        </div>
      </header>

      {!venue.location && (
        <section className="flex flex-col gap-2 rounded-2xl bg-neutral-100 p-4">
          <p className="text-sm text-neutral-700">
            📍 位置情報が未設定です。設定すると「ちかく」画面の地図に表示されます。
          </p>
          {!showLocationSearch ? (
            <button
              type="button"
              onClick={handleOpenLocationSearch}
              className="self-start rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400"
            >
              Googleマップから位置情報を検索
            </button>
          ) : (
            <>
              {loadingLocationCandidates && (
                <p className="text-xs text-neutral-600">検索中...</p>
              )}
              {!loadingLocationCandidates && locationCandidates.length === 0 && (
                <p className="text-xs text-neutral-600">
                  候補が見つかりませんでした。店名を変えて店舗詳細を再検索してください。
                </p>
              )}
              {!loadingLocationCandidates && locationCandidates.length > 0 && (
                <PlaceCandidateList
                  candidates={locationCandidates}
                  selectedPlaceId={null}
                  onSelect={handleAttachLocation}
                  itemClassName="bg-neutral-200 text-neutral-800"
                />
              )}
              {attachingLocation && <p className="text-xs text-neutral-600">設定中...</p>}
              <button
                type="button"
                onClick={() => setShowLocationSearch(false)}
                disabled={attachingLocation}
                className="self-start text-xs font-semibold text-neutral-600 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                キャンセル
              </button>
            </>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-600">これまでの訪問</h2>
        {visits.length === 0 ? (
          <p className="text-sm text-neutral-600">まだ訪問記録がありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visits.map((visit) => {
              const isOwn = isOwnVisit(visit, session?.user.id, authLoading);
              const content = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {new Date(visit.visited_at).toLocaleDateString("ja-JP")}
                      {!isOwn && (
                        <PartnerAvatar email={memberEmailById.get(visit.user_id ?? "")} />
                      )}
                    </span>
                    {!visit.is_completed && (
                      <span className="text-xs text-amber-600">登録待ち</span>
                    )}
                  </div>
                  {visit.best_photo && (
                    // eslint-disable-next-line @next/next/no-img-element -- ローカルdata URLサムネイル
                    <img
                      src={visit.best_photo}
                      alt=""
                      className="mt-2 h-40 w-full rounded-lg object-cover"
                    />
                  )}
                  {(visit.who.length > 0 || visit.alcohol_tags.length > 0) && (
                    <p className="mt-2 text-xs text-neutral-600">
                      {[...visit.who, ...visit.alcohol_tags].join(" / ")}
                    </p>
                  )}
                  {visit.memo && <p className="mt-2 text-sm text-neutral-700">{visit.memo}</p>}
                </>
              );

              return (
                <li key={visit.id}>
                  <Link
                    href={
                      visit.is_completed
                        ? `/visits/${visit.id}`
                        : `/visits/${visit.id}/register`
                    }
                    className="block rounded-xl bg-neutral-100 p-4 focus:ring-2 focus:ring-amber-400"
                  >
                    {content}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {venue.category !== "family" && (
        <section className="flex flex-col gap-2 rounded-2xl bg-neutral-100 p-4">
          <h2 className="text-sm font-semibold text-amber-600">🚃 終電・帰宅アラート</h2>
          <ul className="flex flex-col gap-1">
            {destinations.map((destination) => {
              const lastTrainTime = getLastTrainTime(destination, venue.nearest_station);
              const minutesLeft = getMinutesUntilLastTrain(lastTrainTime, now);
              const missed = minutesLeft < 0;
              const urgent = !missed && minutesLeft <= 30;
              return (
                <li
                  key={destination.id}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    urgent
                      ? "bg-red-500/10 text-red-600"
                      : destination.id === priorityId
                        ? "bg-amber-400/10 text-amber-600"
                        : "text-neutral-700"
                  }`}
                >
                  <span>{destination.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{lastTrainTime}</span>
                    <span className="text-xs">
                      {missed
                        ? "終電を逃しました"
                        : Number.isFinite(minutesLeft)
                          ? `あと${minutesLeft}分`
                          : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
