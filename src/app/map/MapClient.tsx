"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { LocalVenue } from "@/lib/db/localDb";
import { useMapVenues } from "@/lib/db/queries";
import type { LatLng } from "@/types/models";

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

type LocatedVenue = LocalVenue & { location: LatLng };

export default function MapClient() {
  const venues = useMapVenues();

  const located = useMemo<LocatedVenue[]>(
    () => (venues ?? []).filter((venue): venue is LocatedVenue => venue.location !== null),
    [venues]
  );

  if (!venues) {
    return <p className="px-4 pt-8 text-sm text-neutral-400">読み込み中...</p>;
  }

  const center: [number, number] = located[0]
    ? [located[0].location.lat, located[0].location.lng]
    : DEFAULT_CENTER;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">マップ</h1>
      </header>

      {located.length === 0 ? (
        <p className="text-sm text-neutral-400">位置情報を持つ店舗の記録がまだありません。</p>
      ) : (
        <>
          <div className="h-[65vh] overflow-hidden rounded-2xl">
            <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full w-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {located.map((venue) => (
                <Marker
                  key={venue.id}
                  position={[venue.location.lat, venue.location.lng]}
                  icon={venue.is_wished ? wishedIcon : visitedIcon}
                >
                  <Popup>
                    <p className="font-semibold text-neutral-900">{venue.name || "店名未設定"}</p>
                    <Link href={`/venues/${venue.id}`} className="text-amber-600 underline">
                      店舗詳細を見る
                    </Link>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
          <p className="text-xs text-neutral-400">🏮 訪問済み ・ ⭐ 行きたい</p>
        </>
      )}
    </main>
  );
}
