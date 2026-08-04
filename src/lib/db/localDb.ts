import Dexie, { type Table } from "dexie";
import type { Venue, Visit } from "@/types/models";

export type SyncStatus = "pending" | "synced";

export type LocalVenue = Venue & { syncStatus: SyncStatus };
export type LocalVisit = Visit & { syncStatus: SyncStatus };

// GPS取得直後にオフラインでも仮保存できるよう、Supabaseと同じ形のレコードを
// IndexedDBにミラーリングし、通信回復時にsyncStatus: "pending"のものだけを送る。
class MataneDB extends Dexie {
  venues!: Table<LocalVenue, string>;
  visits!: Table<LocalVisit, string>;

  constructor() {
    super("matane-db");
    // IndexedDBはboolean型をキーにできないため、is_completedはインデックスせず
    // 取得後にJS側でフィルタする（件数が少ない個人利用データのため問題ない）。
    this.version(1).stores({
      venues: "id, place_id, syncStatus",
      visits: "id, venue_id, visited_at, syncStatus",
    });
  }
}

export const localDb = new MataneDB();
