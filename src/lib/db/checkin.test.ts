import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test-utils/fakeSupabase";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "@/lib/supabase/client";
import { deleteVenue } from "./checkin";
import { localDb } from "./localDb";

beforeEach(async () => {
  vi.clearAllMocks();
  // deleteVenueはバックグラウンド同期(syncPendingChanges)をfire-and-forgetで
  // 呼び出す。未ログイン扱いにしてsyncPendingChangesを早期returnさせ、
  // このテストではローカルの状態変化だけを検証する。
  vi.mocked(getSupabaseClient).mockReturnValue(
    createFakeSupabase({ userId: null }) as never
  );
  await localDb.venues.clear();
  await localDb.visits.clear();
  await localDb.pendingVenueDeletes.clear();
});

function makeVenue(overrides: Partial<Parameters<typeof localDb.venues.add>[0]> = {}) {
  return {
    id: "venue-1",
    place_id: null,
    name: "テスト店",
    location: null,
    address: null,
    nearest_station: null,
    is_wished: false,
    category: "bar" as const,
    wish_reason: null,
    place_category: null,
    syncStatus: "pending" as const,
    ...overrides,
  };
}

describe("deleteVenue", () => {
  it("未同期(pending)のVenueはローカルから削除するだけで、クラウド削除キューには積まない", async () => {
    await localDb.venues.add(makeVenue({ syncStatus: "pending" }));

    await deleteVenue("venue-1");

    expect(await localDb.venues.get("venue-1")).toBeUndefined();
    expect(await localDb.pendingVenueDeletes.toArray()).toEqual([]);
  });

  it("同期済みのVenueを削除するとクラウド削除キューに積まれる", async () => {
    await localDb.venues.add(makeVenue({ syncStatus: "synced" }));

    await deleteVenue("venue-1");

    expect(await localDb.venues.get("venue-1")).toBeUndefined();
    expect(await localDb.pendingVenueDeletes.toArray()).toEqual([{ id: "venue-1" }]);
  });

  it("紐づくVisits(パートナーの記録を含む)もローカルからまとめて削除する", async () => {
    await localDb.venues.add(makeVenue({ syncStatus: "synced" }));
    await localDb.visits.bulkAdd([
      {
        id: "visit-own",
        venue_id: "venue-1",
        visited_at: "2026-01-01",
        is_completed: true,
        who: [],
        revisit: null,
        budget: null,
        alcohol_tags: [],
        quietness: null,
        best_photo: null,
        memo: null,
        ai_tags: [],
        user_id: "me",
        syncStatus: "synced",
      },
      {
        id: "visit-partner",
        venue_id: "venue-1",
        visited_at: "2026-01-02",
        is_completed: true,
        who: [],
        revisit: null,
        budget: null,
        alcohol_tags: [],
        quietness: null,
        best_photo: null,
        memo: null,
        ai_tags: [],
        user_id: "partner",
        syncStatus: "synced",
      },
    ] as never);
    // 無関係な店のVisitは巻き込まない。
    await localDb.venues.add(makeVenue({ id: "venue-2", syncStatus: "synced" }));
    await localDb.visits.add({
      id: "visit-other-venue",
      venue_id: "venue-2",
      visited_at: "2026-01-03",
      is_completed: true,
      who: [],
      revisit: null,
      budget: null,
      alcohol_tags: [],
      quietness: null,
      best_photo: null,
      memo: null,
      ai_tags: [],
      user_id: "me",
      syncStatus: "synced",
    } as never);

    await deleteVenue("venue-1");

    expect(await localDb.visits.get("visit-own")).toBeUndefined();
    expect(await localDb.visits.get("visit-partner")).toBeUndefined();
    expect(await localDb.visits.get("visit-other-venue")).toBeDefined();
  });

  it("存在しないVenue IDを渡した場合は何もしない", async () => {
    await expect(deleteVenue("does-not-exist")).resolves.toBeUndefined();
    expect(await localDb.pendingVenueDeletes.toArray()).toEqual([]);
  });
});
