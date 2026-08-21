"use client";

import { useEffect, useState } from "react";

export type GoogleMapsScriptStatus = "idle" | "loading" | "ready" | "error";

// 複数コンポーネントが同時にマウントされても<script>タグを1回しか挿入しないよう、
// モジュールスコープでロード状況を共有する。
let loaderPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&language=ja&region=JP`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Google Maps JavaScript APIの読み込みに失敗しました"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

// 「ちかく」画面用。ユーザー自身のGoogleマップ(Google Maps JavaScript API)を
// 動的に読み込む。APIキー未設定時は"error"を返し、呼び出し元はリスト表示に
// フォールバックする(オフライン時のフォールバックと同じ扱い)。
export function useGoogleMapsScript(apiKey: string | undefined): GoogleMapsScriptStatus {
  // APIキー未設定はレンダー時点で確定するため、effect実行を待たず初期値に反映する
  // (effect内での同期的なsetStateは不要なカスケード再レンダーを招くため避ける)。
  const [status, setStatus] = useState<GoogleMapsScriptStatus>(() => (apiKey ? "loading" : "error"));

  useEffect(() => {
    if (!apiKey || typeof window === "undefined") return;

    let active = true;
    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch((error) => {
        console.error(error);
        if (active) setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [apiKey]);

  return status;
}
