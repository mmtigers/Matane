import type { VisitWithVenue } from "@/lib/db/queries";

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADERS = ["日付", "店名", "最寄り駅", "誰と", "また行くか", "予算", "お酒", "静かさ", "メモ"];

// ExcelでCSVを開いたときに文字化けしないよう、UTF-8のBOMを先頭に付ける。
const UTF8_BOM = "﻿";

export function visitsToCsv(visits: VisitWithVenue[]): string {
  const rows = visits.map((visit) =>
    [
      new Date(visit.visited_at).toLocaleDateString("ja-JP"),
      visit.venue?.name ?? "",
      visit.venue?.nearest_station ?? "",
      visit.who.join("/"),
      visit.revisit ?? "",
      visit.budget ?? "",
      visit.alcohol_tags.join("/"),
      visit.quietness ?? "",
      visit.memo ?? "",
    ]
      .map(escapeCsvField)
      .join(",")
  );
  return [UTF8_BOM + CSV_HEADERS.join(","), ...rows].join("\r\n");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function icsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function icsTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

// 訪問日を終日イベントとして書き出す(飲み会の記録は時刻より「その日行った」事実が主なため)。
export function visitsToIcs(visits: VisitWithVenue[]): string {
  const dtstamp = icsTimestamp(new Date());
  const events = visits.flatMap((visit) => {
    const venueName = visit.venue?.name || "店名未設定";
    const description = [
      visit.who.length > 0 ? `誰と: ${visit.who.join("/")}` : null,
      visit.alcohol_tags.length > 0 ? `お酒: ${visit.alcohol_tags.join("/")}` : null,
      visit.memo ? `メモ: ${visit.memo}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    return [
      "BEGIN:VEVENT",
      `UID:${visit.id}@matane`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(new Date(visit.visited_at))}`,
      `SUMMARY:${escapeIcsText(venueName)}`,
      ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
      "END:VEVENT",
    ];
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Matane//JP",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
