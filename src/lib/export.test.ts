import { describe, expect, it } from "vitest";
import type { VisitWithVenue } from "@/lib/db/queries";
import type { LocalVenue } from "@/lib/db/localDb";
import { visitsToCsv, visitsToIcs } from "./export";

function makeVenue(overrides: Partial<LocalVenue> = {}): LocalVenue {
  return {
    id: "venue-1",
    place_id: null,
    name: "焼き鳥いろは",
    location: null,
    address: null,
    nearest_station: null,
    is_wished: false,
    category: "bar",
    wish_reason: null,
    place_category: null,
    syncStatus: "synced",
    ...overrides,
  };
}

function makeVisit(overrides: Partial<VisitWithVenue> = {}): VisitWithVenue {
  return {
    id: "visit-1",
    venue_id: "venue-1",
    visited_at: "2026-09-01T12:00:00.000Z",
    is_completed: true,
    who: [],
    revisit: null,
    budget: null,
    alcohol_tags: [],
    quietness: null,
    best_photo: null,
    memo: null,
    ai_tags: [],
    syncStatus: "synced",
    venue: makeVenue(),
    ...overrides,
  };
}

describe("visitsToCsv - CSVインジェクション対策", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(A1:A9)"])(
    "店名が「%s」のように=,+,-,@で始まる場合は先頭にシングルクォートを付けて無害化する",
    (dangerous) => {
      const csv = visitsToCsv([makeVisit({ venue: makeVenue({ name: dangerous }) })]);
      const dataLine = csv.split("\r\n")[1];
      const nameField = dataLine.split(",")[1];

      // 店名列(2列目)が「'」で始まっていること(=数式として解釈されなくなること)を検証する。
      expect(nameField.startsWith(`'${dangerous[0]}`)).toBe(true);
    }
  );

  it("=,+,-,@以外で始まる通常の値はそのまま出力する(誤爆させない)", () => {
    const csv = visitsToCsv([makeVisit({ venue: makeVenue({ name: "焼き鳥いろは" }) })]);
    const dataLine = csv.split("\r\n")[1];
    const nameField = dataLine.split(",")[1];

    expect(nameField).toBe("焼き鳥いろは");
  });

  it("メモ欄が=から始まる場合も無害化される", () => {
    const csv = visitsToCsv([makeVisit({ memo: "=cmd|'/c calc'!A1" })]);
    const dataLine = csv.split("\r\n")[1];
    const memoField = dataLine.split(",").at(-1) ?? "";

    expect(memoField.startsWith("'=")).toBe(true);
  });

  it("カンマを含み無害化も必要な値は、クォート付与と先頭シングルクォート付与の両方が効く", () => {
    const csv = visitsToCsv([makeVisit({ memo: "=1,2" })]);
    const dataLine = csv.split("\r\n")[1];

    expect(dataLine).toContain('"\'=1,2"');
  });
});

describe("visitsToIcs - iCalendarインジェクション対策", () => {
  it.each([
    ["\r\n", "CRLF"],
    ["\r", "CR単体"],
  ])("店名に%s(%s)が含まれていても本物の行区切りとして解釈されない", (lineBreak) => {
    const ics = visitsToIcs([
      makeVisit({ venue: makeVenue({ name: `いろは${lineBreak}BEGIN:VEVENT` }) }),
    ]);
    const lines = ics.split("\r\n");

    // SUMMARY行が1行に収まっており、注入した文字列が新しいVEVENT行として
    // 分離されていないこと(=\nへ正規化された上で\\nエスケープされていること)を検証する。
    const summaryLine = lines.find((line) => line.startsWith("SUMMARY:"));
    expect(summaryLine).toBe("SUMMARY:いろは\\nBEGIN:VEVENT");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("メモ内の\\r\\nと単独\\rが混在しても、どちらも\\\\nへ正規化してエスケープする", () => {
    const ics = visitsToIcs([makeVisit({ memo: "1軒目\r\n2軒目\r3軒目" })]);
    const descriptionLine = ics
      .split("\r\n")
      .find((line) => line.startsWith("DESCRIPTION:"));

    expect(descriptionLine).toBe("DESCRIPTION:メモ: 1軒目\\n2軒目\\n3軒目");
  });
});
