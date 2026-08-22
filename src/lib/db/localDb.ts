import Dexie, { type Table } from "dexie";
import type { Venue, Visit } from "@/types/models";

export type SyncStatus = "pending" | "synced";

export type LocalVenue = Venue & { syncStatus: SyncStatus };
export type LocalVisit = Visit & { syncStatus: SyncStatus };

// 既にSupabaseへ同期済み(syncStatus: "synced")のVisitを削除する際、その場で
// リモート削除を試みるのではなく一旦ここに積み、sync.tsの通常サイクルで
// まとめて処理する(オフライン中の削除も再試行できるようにするため)。
export interface PendingVisitDelete {
  id: string;
}

// Venue削除も同様に、既に同期済みの行はその場でリモート削除せず一旦ここに積み、
// sync.tsの通常サイクルでまとめて処理する(オフライン中の削除も再試行できるようにするため)。
export interface PendingVenueDelete {
  id: string;
}

// GPS取得直後にオフラインでも仮保存できるよう、Supabaseと同じ形のレコードを
// IndexedDBにミラーリングし、通信回復時にsyncStatus: "pending"のものだけを送る。
class MataneDB extends Dexie {
  venues!: Table<LocalVenue, string>;
  visits!: Table<LocalVisit, string>;
  pendingVisitDeletes!: Table<PendingVisitDelete, string>;
  pendingVenueDeletes!: Table<PendingVenueDelete, string>;

  constructor() {
    super("matane-db");
    // IndexedDBはboolean型をキーにできないため、is_completedはインデックスせず
    // 取得後にJS側でフィルタする（件数が少ない個人利用データのため問題ない）。
    this.version(1).stores({
      venues: "id, place_id, syncStatus",
      visits: "id, venue_id, visited_at, syncStatus",
    });
    // v2: オフライン削除の再試行キューを追加。既存ストアの形は変えないため
    // Dexieが自動でテーブル追加のみのマイグレーションを行う。
    this.version(2).stores({
      venues: "id, place_id, syncStatus",
      visits: "id, venue_id, visited_at, syncStatus",
      pendingVisitDeletes: "id",
    });
    // v3: 飲み屋(仕事)/家族向け(ご飯・公園・スーパー等)の区別用にcategoryを追加。
    // 既存データにはcategoryが無いため、upgradeで一律"bar"を補完する
    // (旧バージョンはこのアプリ自体が飲み屋記録専用だったため)。
    this.version(3)
      .stores({
        venues: "id, place_id, syncStatus, category",
        visits: "id, venue_id, visited_at, syncStatus",
        pendingVisitDeletes: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("venues")
          .toCollection()
          .modify((venue: LocalVenue) => {
            if (!venue.category) venue.category = "bar";
          });
      });
    // v4: あしあとのフィルターをお酒の種類から場所のカテゴリ(公園/飲食店/お店/駅)に
    // 変更するため、Venueに場所のカテゴリを持たせる。既存データは判定できないためnull
    // (未分類)で補完する。
    this.version(4)
      .stores({
        venues: "id, place_id, syncStatus, category",
        visits: "id, venue_id, visited_at, syncStatus",
        pendingVisitDeletes: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("venues")
          .toCollection()
          .modify((venue: LocalVenue) => {
            if (venue.place_category === undefined) venue.place_category = null;
          });
      });
    // v5: Venue削除機能の追加に伴い、オフライン削除の再試行キューをVenue用にも追加。
    // 既存ストアの形は変えないためDexieが自動でテーブル追加のみのマイグレーションを行う。
    this.version(5).stores({
      venues: "id, place_id, syncStatus, category",
      visits: "id, venue_id, visited_at, syncStatus",
      pendingVisitDeletes: "id",
      pendingVenueDeletes: "id",
    });
  }
}

export const localDb = new MataneDB();
