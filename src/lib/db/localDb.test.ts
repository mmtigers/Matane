import { beforeEach, describe, expect, it } from "vitest";
import { clearLocalData, localDb } from "./localDb";

beforeEach(async () => {
  await clearLocalData();
});

function makeVenue(id: string) {
  return {
    id,
    place_id: null,
    name: "テスト店",
    location: null,
    category: "bar" as const,
    place_category: null,
    created_at: "2026-09-10T00:00:00.000Z",
    syncStatus: "pending" as const,
  };
}

function makeVisit(id: string, venueId: string) {
  return {
    id,
    venue_id: venueId,
    visited_at: "2026-09-10T00:00:00.000Z",
    created_at: "2026-09-10T00:00:00.000Z",
    syncStatus: "pending" as const,
  };
}

describe("clearLocalData", () => {
  it("ログアウト時に全テーブルを空にする(共有端末での次ユーザーへの誤同期防止 / #40)", async () => {
    await localDb.venues.add(makeVenue("venue-1") as never);
    await localDb.visits.add(makeVisit("visit-1", "venue-1") as never);
    await localDb.pendingVisitDeletes.add({ id: "visit-2" });
    await localDb.pendingVenueDeletes.add({ id: "venue-2" });

    await clearLocalData();

    for (const table of localDb.tables) {
      expect(await table.count(), `${table.name}がクリアされていない`).toBe(0);
    }
  });

  // テーブル名を列挙する実装に戻すとクリア漏れで#40が再発するため、
  // Dexieが知っている全テーブルを対象にしていることをここで固定する。
  it("Dexieに登録済みの全テーブルを対象にする", async () => {
    const tableNames = localDb.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual([
      "pendingVenueDeletes",
      "pendingVisitDeletes",
      "venues",
      "visits",
    ]);

    for (const table of localDb.tables) {
      await table.add({ id: `seed-${table.name}` } as never);
    }
    expect(
      (await Promise.all(localDb.tables.map((table) => table.count()))).every((n) => n > 0)
    ).toBe(true);

    await clearLocalData();

    for (const table of localDb.tables) {
      expect(await table.count(), `${table.name}がクリアされていない`).toBe(0);
    }
  });
});
