import type { LatLng } from "@/types/models";

export interface ImportedPlace {
  name: string;
  location: LatLng | null;
}

const MAX_IMPORTED_PLACES = 500;

// GoogleマップのPlace URLから緯度経度を取り出す。取り得るパターンは主に2つ:
// 1. .../data=...!3d{lat}!4d{lng}... (実際の場所のピン座標。優先して使う)
// 2. .../@{lat},{lng},{zoom}z/...   (地図の表示中心。ピンとズレることがあるが無いよりはまし)
function extractLatLngFromUrl(url: string): LatLng | null {
  const dataMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) return { lat: Number(dataMatch[1]), lng: Number(dataMatch[2]) };

  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };

  return null;
}

// RFC4180寄りの簡易CSVパーサ。ダブルクォートで囲まれたフィールド内のカンマ・
// 改行・エスケープされた""に対応する(Google Takeoutの出力形式で必要十分)。
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// Googleマップの「保存済み」リスト(お気に入り☆・行ってみたい🚩など)は、Google
// Takeoutの「マップ(自分の場所)」からリストごとにCSV(Title,Note,URL)でエクスポート
// できる。URLに座標が埋め込まれていれば取り出し、無ければ位置情報なしとして返す
// (位置情報は店舗詳細画面から後付け設定できる)。
function parseSavedPlacesCsv(text: string): ImportedPlace[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const titleIndex = header.indexOf("title");
  const urlIndex = header.indexOf("url");
  const hasHeader = titleIndex !== -1;

  const nameIndex = hasHeader ? titleIndex : 0;
  const linkIndex = hasHeader ? urlIndex : rows[0].length - 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((cells) => {
      const name = (cells[nameIndex] ?? "").trim();
      const url = linkIndex >= 0 ? (cells[linkIndex] ?? "").trim() : "";
      return { name, location: url ? extractLatLngFromUrl(url) : null };
    })
    .filter((place) => place.name.length > 0);
}

// Google My Mapsからエクスポートしたリストの取り込み用。<Placemark>単位で
// 名前と座標(<Point><coordinates>lng,lat[,alt]</coordinates></Point>)を取り出す。
function parseKml(text: string): ImportedPlace[] {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));

  return placemarks
    .map((placemark) => {
      const name = placemark.getElementsByTagName("name")[0]?.textContent?.trim() ?? "";
      const coordinatesText = placemark.getElementsByTagName("coordinates")[0]?.textContent?.trim();
      let location: LatLng | null = null;
      if (coordinatesText) {
        const [lngStr, latStr] = coordinatesText.split(",");
        const lat = Number(latStr);
        const lng = Number(lngStr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) location = { lat, lng };
      }
      return { name, location };
    })
    .filter((place) => place.name.length > 0);
}

export class GoogleMapsImportError extends Error {}

// ファイル名の拡張子でKML/CSVを判定してパースする。件数上限を超える分は切り捨て、
// 呼び出し元にtruncated件数を伝える(APIキー未設定でも件数だけは取り込めるように
// 位置情報の有無を問わず全件パースした上で上限を適用する)。
export function parseGoogleMapsImportFile(
  filename: string,
  text: string
): { places: ImportedPlace[]; truncated: number } {
  const lower = filename.toLowerCase();
  let places: ImportedPlace[];

  if (lower.endsWith(".kml")) {
    places = parseKml(text);
  } else if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    places = parseSavedPlacesCsv(text);
  } else {
    throw new GoogleMapsImportError(
      "対応していないファイル形式です。GoogleマップのCSVエクスポート、またはGoogle MyマップのKMLエクスポートを選んでください。"
    );
  }

  if (places.length === 0) {
    throw new GoogleMapsImportError("ファイルから場所を読み取れませんでした。");
  }

  const truncated = Math.max(0, places.length - MAX_IMPORTED_PLACES);
  return { places: places.slice(0, MAX_IMPORTED_PLACES), truncated };
}
