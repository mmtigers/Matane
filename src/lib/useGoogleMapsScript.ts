"use client";

import { useEffect, useState } from "react";

export type GoogleMapsScriptStatus = "idle" | "loading" | "ready" | "error";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

// 複数コンポーネントが同時にマウントされても<script>タグを1回しか挿入しないよう、
// モジュールスコープでロード状況を共有する。
let loaderPromise: Promise<void> | null = null;

// APIキーが無効・リファラー制限・課金未設定等の認証エラーの場合、Google Maps側は
// <script>の読み込み(onload)自体は成功させた上で、実際に地図を描画するタイミングで
// window.gm_authFailureを呼び出し、地図コンテナの中に独自のエラーオーバーレイ
// (「エラーが発生しました。」というグレーの表示)を出す。onloadの成否だけを見ていると
// この状態を検知できず、壊れた地図がそのまま表示され続けてしまうため、gm_authFailureも
// あわせて監視し、呼ばれたら"error"としてフォールバック表示に切り替える。
const authFailureListeners = new Set<() => void>();

function registerAuthFailureHandler() {
  if (typeof window === "undefined" || window.gm_authFailure) return;
  window.gm_authFailure = () => {
    authFailureListeners.forEach((listener) => listener());
  };
}

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  registerAuthFailureHandler();
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
    const handleAuthFailure = () => {
      if (active) setStatus("error");
    };
    authFailureListeners.add(handleAuthFailure);

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
      authFailureListeners.delete(handleAuthFailure);
    };
  }, [apiKey]);

  return status;
}
