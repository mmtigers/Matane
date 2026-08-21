"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import { localDb, type LocalVenue } from "@/lib/db/localDb";
import { useLiveQuery } from "dexie-react-hooks";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { distanceMeters, formatDistance, getCurrentLocation } from "@/lib/geo";
import { useGoogleMapsScript } from "@/lib/useGoogleMapsScript";
import type { LatLng } from "@/types/models";

const MAP_FILTER_STORAGE_KEY = "matane:mapFilter";

// 東京駅。位置情報を持つ店舗が1件も無い場合のフォールバック中心座標。
const DEFAULT_CENTER: LatLng = { lat: 35.681236, lng: 139.767125 };

// Maps JavaScript API専用キーが無ければ、瞬録の周辺候補取得で使っているPlaces
// APIキーを流用する(同じGoogle CloudプロジェクトでMaps JavaScript APIも有効化
// していれば、追加設定なしでそのまま動く)。
const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

type LocatedVenue = LocalVenue & { location: LatLng };
type MapFilter = "all" | "visited" | "wished";

const FILTERS: { key: MapFilter; label: string; icon: string }[] = [
  { key: "all", label: "すべて", icon: "🗂" },
  { key: "visited", label: "訪問済み", icon: "🏮" },
  { key: "wished", label: "気になる", icon: "⭐" },
];

// 絵文字をそのままマーカーアイコンにする(タイムライン等の絵文字表現と統一)。
// Google Maps JavaScript APIはSVGのdata URLをアイコンとしてそのまま扱える。
function createEmojiMarkerIcon(emoji: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><text x="16" y="24" font-size="24" text-anchor="middle">${emoji}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 16),
  };
}

function buildInfoWindowContent(venue: LocatedVenue, onNavigate: (venueId: string) => void) {
  const container = document.createElement("div");
  container.style.minWidth = "160px";

  const title = document.createElement("p");
  title.textContent = venue.name || "店名未設定";
  title.style.fontWeight = "600";
  title.style.color = "#171717";
  title.style.marginBottom = "4px";
  container.appendChild(title);

  const link = document.createElement("button");
  link.type = "button";
  link.textContent = "店舗詳細を見る";
  Object.assign(link.style, {
    color: "#d97706",
    textDecoration: "underline",
    background: "none",
    border: "none",
    padding: "0",
    font: "inherit",
    cursor: "pointer",
  });
  link.addEventListener("click", () => onNavigate(venue.id));
  container.appendChild(link);

  return container;
}

// ユーザー自身のGoogleマップ(Google Maps JavaScript API)を使った地図描画。
// react-leaflet相当の宣言的ラッパーは使わず、Google Maps SDKを直接操作する
// (絵文字マーカー・InfoWindowなど、このアプリの表現をそのまま再現するため)。
function GoogleMapView({
  venues,
  currentLocation,
  initialCenter,
}: {
  venues: LocatedVenue[];
  currentLocation: LatLng | null;
  initialCenter: LatLng;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const currentMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new google.maps.Map(containerRef.current, {
      center: initialCenter,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    infoWindowRef.current = new google.maps.InfoWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初期中心はマウント時の1回だけ使う
  }, []);

  // currentLocationが後から取得・更新された際に地図を追従させる。
  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;
    mapRef.current.panTo(currentLocation);
    mapRef.current.setZoom(15);
  }, [currentLocation]);

  useEffect(() => {
    if (!mapRef.current) return;
    currentMarkerRef.current?.setMap(null);
    currentMarkerRef.current = currentLocation
      ? new google.maps.Marker({
          position: currentLocation,
          map: mapRef.current,
          icon: createEmojiMarkerIcon("📍"),
          title: "現在地",
          zIndex: 10,
        })
      : null;
  }, [currentLocation]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = venues.map((venue) => {
      const marker = new google.maps.Marker({
        position: venue.location,
        map,
        icon: createEmojiMarkerIcon(venue.is_wished ? "⭐" : "🏮"),
        title: venue.name || "店名未設定",
      });
      marker.addListener("click", () => {
        infoWindowRef.current?.setContent(
          buildInfoWindowContent(venue, (venueId) => router.push(`/venues/${venueId}`))
        );
        infoWindowRef.current?.open({ map, anchor: marker });
      });
      return marker;
    });

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
    };
  }, [venues, router]);

  return <div ref={containerRef} className="h-full w-full" />;
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
  const mapsStatus = useGoogleMapsScript(GOOGLE_MAPS_API_KEY);

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

  const center: LatLng = currentLocation ?? located[0]?.location ?? DEFAULT_CENTER;
  const showMap = isOnline && mapsStatus === "ready";

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">ちかく</h1>
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

          {showMap ? (
            <>
              <div className="h-[55vh] overflow-hidden rounded-2xl">
                <GoogleMapView
                  venues={sorted}
                  currentLocation={currentLocation}
                  initialCenter={center}
                />
              </div>
              <p className="text-xs text-neutral-600">🏮 訪問済み ・ ⭐ 気になる ・ 📍 現在地</p>
            </>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-2xl bg-neutral-100 px-4 text-center">
              {!isOnline ? (
                <>
                  <p className="text-sm text-neutral-700">📡 オフラインのため地図画像は表示できません</p>
                  <p className="text-xs text-neutral-500">下の一覧は引き続き使えます</p>
                </>
              ) : mapsStatus === "error" ? (
                <>
                  <p className="text-sm text-neutral-700">
                    🗺️ Googleマップを表示できませんでした
                  </p>
                  <p className="text-xs text-neutral-500">
                    APIキー未設定、または読み込みに失敗しました。下の一覧は引き続き使えます
                  </p>
                </>
              ) : (
                <p className="text-sm text-neutral-700">地図を読み込み中...</p>
              )}
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
