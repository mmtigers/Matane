import type { LatLng } from "@/types/models";

// APIキー不要のOpenStreetMap埋め込みで、瞬録したGPS座標をそのまま地図表示する。
export function osmEmbedUrl({ lat, lng }: LatLng, delta = 0.005): string {
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${lat}%2C${lng}`;
}

export function googleMapsUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function getCurrentLocation(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("この端末では位置情報を利用できません"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
