"use client";

import { useEffect, useState } from "react";

// navigator.onLineの変化をReactの状態として追跡する。地図タイルなど、オンライン時のみ
// 意味のあるUIを出し分けるために使う。
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
