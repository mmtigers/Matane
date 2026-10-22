# 04 データ・API・外部連携

## 1. データストア

| 層 | 内容 |
| --- | --- |
| ローカル | Dexie `matane-db` v5。テーブル `venues`(id, place_id, syncStatus, category)、`visits`(id, venue_id, visited_at, syncStatus)、`pendingVisitDeletes`、`pendingVenueDeletes`。boolean はインデックス不可のため `is_completed` は JS 側フィルタ |
| クラウド | Supabase Postgres（`uuid-ossp`、`postgis` 拡張）＋ Storage バケット `visit-photos`（public）。**定義は `supabase/schema.sql` のみ**（マイグレーション機構なし） |

### テーブル（`supabase/schema.sql`）

| テーブル | 主要カラム・制約 |
| --- | --- |
| `venues` | `id` uuid PK、`place_id`、`name`(≤100)、`location` geography(point,4326)、`address`、`nearest_station`、`is_wished`、`category`('bar'/'family')、`wish_reason` text[]、`place_category`('food'/'park'/'shop'/'station'/null)、`created_by`→auth.users、`owner_group_id`→groups（INSERT トリガーで作成者の所属グループを設定）、`created_at`。一意: `(place_id, coalesce(owner_group_id, created_by))` where place_id not null |
| `visits` | `id`、`user_id`→auth.users(cascade)、`venue_id`→venues(cascade)、`visited_at`、`is_completed`、`who` text[]、`revisit`、`budget`、`alcohol_tags` text[]、`quietness`、`best_photo`(URL)、`memo`(≤2000)、`ai_tags` text[]、`created_at`、`updated_at`。インデックス4本 |
| `groups` | `id`、`name`、`created_by`、`created_at` |
| `group_members` | PK(group_id,user_id)、`user_id` **unique**（1人1グループ） |
| `group_invites` | `code` unique、`expires_at` 既定 now()+24h、`used_at`、`used_by` |

CHECK 制約は DB に `category`/`place_category`/長さのみ。`who`/`revisit` 等の選択肢は DB で未検証（アプリ側 `choices.ts` のみ）。`visits.updated_at` を更新するトリガーは**無い**（既定値のみ）。

### RLS（要点）

- `venues`: SELECT/UPDATE/DELETE = 作成者 or 作成者と同じグループのメンバー。INSERT = `created_by = auth.uid()`。UPDATE の `with check` は using と同条件。
- `visits`: SELECT = 本人 or 同グループ。INSERT/UPDATE/DELETE = 本人のみ。
- `groups`: SELECT = 作成者 or メンバー、INSERT = 作成者。UPDATE ポリシー無し（意図的）。
- `group_members`: SELECT = 自分 or 同グループ（`is_fellow_group_member()` で再帰回避）。INSERT = 自分が作成したグループへ自分を追加のみ。DELETE = 自分。
- `group_invites`: SELECT/INSERT = グループメンバー、INSERT は `expires_at <= now()+24h+5min` を強制。
- Storage: SELECT = 誰でも（bucket public）、INSERT/UPDATE/DELETE = パス先頭フォルダ = `auth.uid()`。

### SECURITY DEFINER 関数
`create_group()`、`redeem_group_invite(p_code)`（失敗は例外メッセージ `invite_invalid` / `already_in_group` をクライアントが `message.includes` で判定）、`get_group_members()`（email 返却）、`is_fellow_group_member(uuid)`、`set_venue_owner_group()`（トリガー）。

### 適用方法
README: SQL Editor で `schema.sql` を実行。冪等記述（`if not exists` / `drop policy if exists`）で再実行可。履歴・バージョン管理・ロールバック無し。**本番適用状況は未確認**。型の自動生成は無く、`types/models.ts` は手書き。

## 2. 同期の仕様（`lib/db/sync.ts`）

- Push: pending の venues を一括 upsert（失敗時は 1 件ずつ。`23505` なら `reconcileDuplicatePlaceId` で既存 Venue に差し替え）→ visits（写真は先に Storage へ upload し URL に置換、失敗時は base64 のまま送る）→ 削除キュー処理。location は EWKT `SRID=4326;POINT(lng lat)` で送信。
- Pull: `visits`/`venues` を `select("*")`（**ページングなし**）。pending/削除待ちは上書きしない。クラウドに見えない synced 行はローカル削除（Venue は Visit から参照されていれば残す）。
- 排他: モジュール変数 `syncing`/`pulling`。
- 競合: タイムスタンプ比較なし。pending 優先、それ以外はクラウド勝ち。

## 3. API

自前 API は無い。Supabase 呼び出し（全てブラウザから、anon key＋ユーザー JWT）:

| 対象 | 呼び出し |
| --- | --- |
| venues/visits | `from(..).upsert/select/delete` |
| グループ | `rpc("create_group")`、`rpc("redeem_group_invite")`、`rpc("get_group_members")`、`from("group_invites")`、`from("group_members")` |
| 認証 | `auth.signInWithOtp`、`getSession`、`getUser`、`signOut`、`onAuthStateChange` |
| 写真 | `storage.from("visit-photos").upload/getPublicUrl/list/remove` |

## 4. 外部サービス

| サービス | 用途 | 失敗時 |
| --- | --- | --- |
| Supabase | 同期・認証・写真 | 未設定: `getSupabaseClient()` が throw → ローカルのみ動作。通信失敗は warn して次回再試行 |
| Google Places API (New) | `places:searchNearby`/`places:searchText`（キーは `X-Goog-Api-Key` ヘッダでブラウザから直接送信） | 空配列を返し手入力へ |
| Google Maps JavaScript API | 地図（`useGoogleMapsScript`） | 一覧表示にフォールバック |
| OpenStreetMap 埋め込み | 詳細の小地図（`geo.osmEmbedUrl`） | — |
| Google Maps URL | 外部リンク（`googleMapsUrl`） | — |
| Web Share API | 店舗・招待コード共有 | 未対応ブラウザの挙動は未確認 |

Webhook・定期処理・メール送信（Auth のマジックリンク以外）・Push は未使用。

## 5. 環境変数（値は記載しない。`.env.local.example`）

| 変数 | 用途 | 必須 | 備考 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 接続先 | 同期に必須（無くてもローカル動作） | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/公開キー | 同上 | RLS 前提で公開可 |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Places 検索 | 任意 | 未設定で候補なし。ブラウザ露出 |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 地図 | 任意 | 未設定時は PLACES キーを流用 |
| `NEXT_PUBLIC_COMMUTE_HOME_LABEL` / `_HOME_LAST_TRAIN` / `_WORK_LABEL` / `_WORK_LAST_TRAIN` | 終電アラートの個人設定 | 任意 | 既定「自宅」24:00／「職場」23:30。**個人情報なのでソースへ書かない** |

全て `NEXT_PUBLIC_`（ビルド成果物に埋め込まれる）。サーバー専用の秘密は存在しない。Supabase Auth 側で Site URL / Redirect URLs の設定が必須（README。現状は未確認）。

## 6. セッション・保存

Supabase JS が localStorage にセッションを保存（`@supabase/ssr` 不使用、Cookie なし）。localStorage の独自キーは [02](./02_architecture_and_code_map.md) 参照。

## 7. バックアップ・復元

自前の仕組みは無い。ユーザー向け: CSV/ICS 書き出し（取り込みは Google マップ形式のみ。自アプリ形式の取り込みは無し）。復元は「ログイン→`pullFromCloud`」。Supabase 側バックアップは未確認。

## 8. 障害時の挙動

オフライン: 全操作はローカルで成功、`online` イベントで再送。Supabase 書き込みが RLS 等で恒常的に失敗する行は pending のまま残り続け、ユーザーには「未同期N件」としてのみ見える（原因表示は無い）。
