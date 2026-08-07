"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import { localDb, type LocalVenue } from "@/lib/db/localDb";
import { useLiveQuery } from "dexie-react-hooks";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { distanceMeters, formatDistance, getCurrentLocation } from "@/lib/geo";
import type { LatLng } from "@/types/models";

const MAP_FILTER_STORAGE_KEY = "matane:mapFilter";

// 東京駅。位置情報を持つ店舗が1件も無い場合のフォールバック中心座標。
const DEFAULT_CENTER: [number, number] = [35.681236, 139.767125];

// Leafletの既定マーカー画像はNext.jsのバンドルでは自動解決できないため、
// アセットコピーが不要な絵文字divIconを使う(タイムライン等の絵文字表現とも統一)。
function createEmojiIcon(emoji: string) {
  return L.divIcon({
    html: `<span style="font-size:22px;line-height:1">${emoji}</span>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const visitedIcon = createEmojiIcon("🏮");
const wishedIcon = createEmojiIcon("⭐");
const currentLocationIcon = createEmojiIcon("📍");

type LocatedVenue = LocalVenue & { location: LatLng };
type MapFilter = "all" | "visited" | "wished";

const FILTERS: { key: MapFilter; label: string; icon: string }[] = [
  { key: "all", label: "すべて", icon: "🗂" },
  { key: "visited", label: "訪問済み", icon: "🏮" },
  { key: "wished", label: "行きたい", icon: "⭐" },
];

// currentLocationが後から変わった際にMapContainerの中心を追従させる。
// react-leafletはcenter propの変更を自動追従しないためuseMapで明示的にpanする。
function RecenterOnLocation({ location }: { location: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (location) map.setView([location.lat, location.lng], 15);
  }, [location, map]);
  return null;
}

export default function MapClient() {
  const data = useLiveQuery(async () => {
    const [venues, visits] = await Promise.all([
      localDb.venues.toArray(),
      localDb.visits.toArray(),
    ]);
    const completedVenueIds = new Set(
      visits.filter((visit) => visit.is_completed).map((visit) => visit.venue_id)
    );
    // タイムラインから削除されてVisitが0件になったVenueは、行きたい登録もなければ
    // 地図に出す意味が無い(訪問済みマーカーとして残り続けてしまうバグの原因だった)。
    const visitedVenueIds = new Set(visits.map((visit) => visit.venue_id));
    return { venues, completedVenueIds, visitedVenueIds };
  }, []);

  // 直前に選んでいた絞り込みをセッション内で覚えておく(タブを出入りするたびに
  // 選び直さなくて済むように)。位置情報は精度が古くなり得るため意図的に記憶しない。
  const [filter, setFilter] = useState<MapFilter>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.sessionStorage.getItem(MAP_FILTER_STORAGE_KEY);
    return stored === "visited" || stored === "wished" ? stored : "all";
  });
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    window.sessionStorage.setItem(MAP_FILTER_STORAGE_KEY, filter);
  }, [filter]);

  const located = useMemo<LocatedVenue[]>(() => {
    const visitedVenueIds = data?.visitedVenueIds ?? new Set<string>();
    return (data?.venues ?? []).filter(
      (venue): venue is LocatedVenue =>
        venue.location !== null && (visitedVenueIds.has(venue.id) || venue.is_wished)
    );
  }, [data]);

  const filtered = useMemo(() => {
    const completedVenueIds = data?.completedVenueIds ?? new Set<string>();
    return located.filter((venue) => {
      if (filter === "visited") return completedVenueIds.has(venue.id);
      if (filter === "wished") return venue.is_wished;
      return true;
    });
  }, [located, filter, data]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (currentLocation) {
      list.sort(
        (a, b) =>
          distanceMeters(currentLocation, a.location) - distanceMeters(currentLocation, b.location)
      );
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }
    return list;
  }, [filtered, currentLocation]);

  async function handleLocate() {
    setLocating(true);
    setLocationError(null);
    try {
      const location = await getCurrentLocation();
      setCurrentLocation(location);
    } catch (error) {
      console.error(error);
      setLocationError("位置情報を取得できませんでした。設定をご確認ください。");
    } finally {
      setLocating(false);
    }
  }

  if (!data) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[55vh] w-full rounded-2xl" />
        <SkeletonList />
      </main>
    );
  }

  const center: [number, number] = currentLocation
    ? [currentLocation.lat, currentLocation.lng]
    : located[0]
      ? [located[0].location.lat, located[0].location.lng]
      : DEFAULT_CENTER;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">マップ</h1>
      </header>

      {located.length === 0 ? (
        <p className="text-sm text-neutral-600">位置情報を持つ店舗の記録がまだありません。</p>
      ) : (
        <>
          <div className="flex gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-pressed={filter === item.key}
                className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors focus:ring-2 focus:ring-amber-400 ${
                  filter === item.key
                    ? "bg-amber-400 text-black"
                    : "bg-neutral-100 text-neutral-700 active:bg-neutral-200"
                }`}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            className="self-start rounded-full bg-neutral-100 px-4 py-2 text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
          >
            {locating
              ? "取得中..."
              : currentLocation
                ? "📍 現在地を更新"
                : "📍 現在地から近い順に並べる"}
          </button>
          {locationError && <p className="text-xs text-red-600">{locationError}</p>}

          {isOnline ? (
            <>
              <div className="h-[55vh] overflow-hidden rounded-2xl">
                <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full w-full">
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <RecenterOnLocation location={currentLocation} />
                  {currentLocation && (
                    <Marker
                      position={[currentLocation.lat, currentLocation.lng]}
                      icon={currentLocationIcon}
                    >
                      <Popup>現在地</Popup>
                    </Marker>
                  )}
                  {sorted.map((venue) => (
                    <Marker
                      key={venue.id}
                      position={[venue.location.lat, venue.location.lng]}
                      icon={venue.is_wished ? wishedIcon : visitedIcon}
                    >
                      <Popup>
                        <p className="font-semibold text-neutral-900">
                          {venue.name || "店名未設定"}
                        </p>
                        <Link href={`/venues/${venue.id}`} className="text-amber-600 underline">
                          店舗詳細を見る
                        </Link>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
              <p className="text-xs text-neutral-600">🏮 訪問済み ・ ⭐ 行きたい ・ 📍 現在地</p>
            </>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-2xl bg-neutral-100 px-4 text-center">
              <p className="text-sm text-neutral-700">📡 オフラインのため地図画像は表示できません</p>
              <p className="text-xs text-neutral-500">下の一覧は引き続き使えます</p>
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="text-sm text-neutral-600">この条件に一致する店舗がありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sorted.map((venue) => (
                <li key={venue.id}>
                  <Link
                    href={`/venues/${venue.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl bg-neutral-100 px-4 py-3 focus:ring-2 focus:ring-amber-400"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex-none">{venue.is_wished ? "⭐" : "🏮"}</span>
                      <span className="truncate text-sm font-medium">
                        {venue.name || "店名未設定"}
                      </span>
                    </span>
                    {currentLocation && (
                      <span className="flex-none text-xs text-neutral-600">
                        {formatDistance(distanceMeters(currentLocation, venue.location))}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
