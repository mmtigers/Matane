"use client";

import dynamic from "next/dynamic";

// leafletはwindowに依存するためSSR不可。クライアントでのみ読み込む。
const MapClient = dynamic(() => import("./MapClient"), {
  ssr: false,
  loading: () => <p className="px-4 pt-8 text-sm text-neutral-600">地図を読み込み中...</p>,
});

export default function MapPage() {
  return <MapClient />;
}
