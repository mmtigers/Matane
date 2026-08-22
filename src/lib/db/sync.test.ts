import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test-utils/fakeSupabase";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  uploadVisitPhotoIfNeeded: vi.fn(async (_visitId: string, _userId: string, photo: string | null) => photo),
}));

import { getSupabaseClient } from "@/lib/supabase/client";
import { localDb } from "./localDb";
import { pullFromCloud, syncPendingChanges } from "./sync";

const USER_ID = "user-1";

function useSupabase(fromQueues: Record<string, unknown[]>) {
  const supabase = createFakeSupabase({ userId: USER_ID, fromQueues });
  vi.mocked(getSupabaseClient).mockReturnValue(supabase as never);
  return supabase;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await localDb.venues.clear();
  await localDb.visits.clear();
  await localDb.pendingVisitDeletes.clear();
  await localDb.pendingVenueDeletes.clear();
});

describe("syncPendingChanges - Venue削除キュー(pendingVenueDeletes)の同期", () => {
  it("削除に成功したらキューから取り除く", async () => {
    await localDb.pendingVenueDeletes.bulkAdd([{ id: "venue-1" }, { id: "venue-2" }]);

    useSupabase({ venues: [{ error: null }] });

    await syncPendingChanges();

    expect(await localDb.pendingVenueDeletes.toArray()).toEqual([]);
  });

  it("削除に失敗した場合はキューに残し、次回再試行できるようにする", async () => {
    await localDb.pendingVenueDeletes.add({ id: "venue-1" });

    useSupabase({ venues: [{ error: { message: "network error" } }] });

    await syncPendingChanges();

    expect(await localDb.pendingVenueDeletes.toArray()).toEqual([{ id: "venue-1" }]);
  });
});

describe("syncPendingChanges - venuesの一括upsert失敗時の1件ずつ再試行", () => {
  it("成功した行だけをsyncedにし、失敗した行はpendingのまま残す(23505以外)", async () => {
    await localDb.venues.bulkAdd([
      {
        id: "v1",
        place_id: "p1",
        name: "店1",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "pending",
      },
      {
        id: "v2",
        place_id: "p2",
        name: "店2",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "pending",
      },
    ]);

    useSupabase({
      venues: [
        { error: { message: "bulk failed" } }, // 一括upsert失敗
        { error: null }, // v1個別upsert成功
        { error: { code: "other", message: "network error" } }, // v2個別upsert失敗(23505以外)
      ],
    });

    await syncPendingChanges();

    expect((await localDb.venues.get("v1"))?.syncStatus).toBe("synced");
    expect((await localDb.venues.get("v2"))?.syncStatus).toBe("pending");
  });

  it("23505(unique_violation)で該当行が既にクラウドに存在する場合、そのVenueへVisitを差し替えて自己修復する", async () => {
    await localDb.venues.bulkAdd([
      {
        id: "local-dup",
        place_id: "p1",
        name: "ローカルの複製",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "pending",
      },
    ]);
    await localDb.visits.add({
      id: "visit-1",
      venue_id: "local-dup",
      visited_at: "2026-01-01",
      is_completed: true,
      who: null,
      revisit: null,
      budget: null,
      alcohol_tags: null,
      quietness: null,
      best_photo: null,
      memo: null,
      ai_tags: null,
      syncStatus: "synced",
    } as never);

    const existingCloudRow = {
      id: "cloud-real",
      place_id: "p1",
      name: "本物の店(他端末が先に同期済み)",
      location: null,
      address: null,
      nearest_station: null,
      is_wished: false,
      category: "bar",
      wish_reason: null,
      place_category: null,
    };

    useSupabase({
      venues: [
        { error: { message: "bulk failed" } },
        { error: { code: "23505", message: "duplicate key" } },
        { data: [existingCloudRow] },
      ],
    });

    await syncPendingChanges();

    expect(await localDb.venues.get("local-dup")).toBeUndefined();
    const mergedVenue = await localDb.venues.get("cloud-real");
    expect(mergedVenue?.name).toBe("本物の店(他端末が先に同期済み)");

    const visit = await localDb.visits.get("visit-1");
    expect(visit?.venue_id).toBe("cloud-real");
    expect(visit?.syncStatus).toBe("pending");
  });

  it("23505でもクラウド側に一致する行が見つからない場合は諦めてpendingのまま残す", async () => {
    await localDb.venues.add({
      id: "local-orphan",
      place_id: "p1",
      name: "行き場のない店",
      location: null,
      address: null,
      nearest_station: null,
      is_wished: false,
      category: "bar",
      wish_reason: null,
      place_category: null,
      syncStatus: "pending",
    });

    useSupabase({
      venues: [
        { error: { message: "bulk failed" } },
        { error: { code: "23505", message: "duplicate key" } },
        { data: [] },
      ],
    });

    await syncPendingChanges();

    const venue = await localDb.venues.get("local-orphan");
    expect(venue?.syncStatus).toBe("pending");
  });
});

describe("pullFromCloud - pending行の保護とクラウドから消えた行の削除", () => {
  it("ローカルでpending中のVenueはクラウドの内容で上書きしない", async () => {
    await localDb.venues.bulkAdd([
      {
        id: "v-pending",
        place_id: "p1",
        name: "ローカル未送信の名前",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "pending",
      },
      {
        id: "v-synced",
        place_id: "p2",
        name: "旧い名前",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "synced",
      },
    ]);

    useSupabase({
      visits: [{ data: [], error: null }],
      venues: [
        {
          data: [
            {
              id: "v-pending",
              place_id: "p1",
              name: "クラウド側の名前(上書きされてはいけない)",
              location: null,
              address: null,
              nearest_station: null,
            },
            {
              id: "v-synced",
              place_id: "p2",
              name: "新しい名前",
              location: null,
              address: null,
              nearest_station: null,
            },
          ],
          error: null,
        },
      ],
    });

    await pullFromCloud();

    const pending = await localDb.venues.get("v-pending");
    expect(pending?.name).toBe("ローカル未送信の名前");
    expect(pending?.syncStatus).toBe("pending");

    const synced = await localDb.venues.get("v-synced");
    expect(synced?.name).toBe("新しい名前");
    expect(synced?.syncStatus).toBe("synced");
  });

  it("クラウドから消えた同期済み行はローカルからも削除するが、pending行や参照中のVenueは残す", async () => {
    await localDb.visits.bulkAdd([
      {
        id: "visit-stale",
        venue_id: "venue-x",
        visited_at: "2026-01-01",
        is_completed: true,
        who: null,
        revisit: null,
        budget: null,
        alcohol_tags: null,
        quietness: null,
        best_photo: null,
        memo: null,
        ai_tags: null,
        syncStatus: "synced",
      },
      {
        id: "visit-pending",
        venue_id: "venue-y",
        visited_at: "2026-01-02",
        is_completed: true,
        who: null,
        revisit: null,
        budget: null,
        alcohol_tags: null,
        quietness: null,
        best_photo: null,
        memo: null,
        ai_tags: null,
        syncStatus: "pending",
      },
    ] as never);

    await localDb.venues.bulkAdd([
      {
        id: "venue-x",
        place_id: null,
        name: "参照されなくなる店",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "synced",
      },
      {
        id: "venue-y",
        place_id: null,
        name: "pendingなVisitから参照され続ける店",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "synced",
      },
      {
        id: "venue-z",
        place_id: null,
        name: "誰からも参照されない店",
        location: null,
        address: null,
        nearest_station: null,
        is_wished: false,
        category: "bar",
        wish_reason: null,
        place_category: null,
        syncStatus: "synced",
      },
    ]);

    useSupabase({
      visits: [{ data: [], error: null }],
      venues: [{ data: [], error: null }],
    });

    await pullFromCloud();

    expect(await localDb.visits.get("visit-stale")).toBeUndefined();
    expect(await localDb.visits.get("visit-pending")).toBeDefined();

    expect(await localDb.venues.get("venue-x")).toBeUndefined();
    expect(await localDb.venues.get("venue-y")).toBeDefined();
    expect(await localDb.venues.get("venue-z")).toBeUndefined();
  });

  it("削除待ち(pendingVenueDeletes)のVenueはクラウドにまだ残っていてもローカルへ復活させない", async () => {
    await localDb.pendingVenueDeletes.add({ id: "deleted-venue" });

    useSupabase({
      visits: [{ data: [], error: null }],
      venues: [
        {
          data: [
            {
              id: "deleted-venue",
              place_id: null,
              name: "削除待ちの店",
              location: null,
              address: null,
              nearest_station: null,
            },
          ],
          error: null,
        },
      ],
    });

    await pullFromCloud();

    expect(await localDb.venues.get("deleted-venue")).toBeUndefined();
  });

  it("削除待ち(pendingVisitDeletes)のVisitはクラウドにまだ残っていてもローカルへ復活させない", async () => {
    await localDb.pendingVisitDeletes.add({ id: "deleted-visit" });

    useSupabase({
      visits: [
        {
          data: [
            {
              id: "deleted-visit",
              venue_id: "venue-a",
              visited_at: "2026-01-01",
              is_completed: true,
              who: null,
              revisit: null,
              budget: null,
              alcohol_tags: null,
              quietness: null,
              best_photo: null,
              memo: null,
              ai_tags: null,
              user_id: USER_ID,
            },
          ],
          error: null,
        },
      ],
      venues: [{ data: [], error: null }],
    });

    await pullFromCloud();

    expect(await localDb.visits.get("deleted-visit")).toBeUndefined();
  });
});
