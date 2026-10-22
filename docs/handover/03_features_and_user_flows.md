# 03 機能とユーザーフロー

## 1. 画面一覧

| URL | 画面（ナビ呼称） | 認証 | 実装 |
| --- | --- | --- | --- |
| `/` | ホーム（ココを記録／名前で記録／今日どこ行く？／⚙️） | 不要 | `app/page.tsx` |
| `/timeline` | あしあと（月別、カテゴリ/目的フィルタ） | 不要（ローカル） | `app/timeline/page.tsx` |
| `/wishlist` | 気になる（理由タグ、Googleマップインポート） | 不要 | `app/wishlist/page.tsx` |
| `/stats` | わたしデータ（月別回数、お酒、誰と。6m/1y/全期間） | 不要 | `app/stats/page.tsx` |
| `/map` | ちかく（Google Map／一覧） | 不要 | `app/map/MapClient.tsx` |
| `/venues/[venueId]` | 店舗詳細（履歴、気になるトグル、共有、位置後付け、終電アラート、削除） | 不要 | `VenueDetailClient.tsx` |
| `/visits/[visitId]` | 訪問詳細 | 不要 | `VisitDetailClient.tsx` |
| `/visits/[visitId]/register` | 二次登録（肉付け） | 不要 | `RegisterVisitClient.tsx` |
| `/group` | グループ設定 | **ログイン要**（`requireUserId`） | `app/group/page.tsx` |
| `/settings` | 設定（終電上書き、CSV/ICS書き出し、グループ導線） | 不要 | `app/settings/page.tsx` |
| `/login` | マジックリンク送信（30秒クールダウン） | 不要 | `app/login/page.tsx` |

保護ルートは無い（ゲストでも全画面を使える）。同期・グループのみログインが必要。

## 2. 主要フロー

### 2.1 ココを記録（GPS、`createQuickCheckIn`）
1. ホームで「ココを記録」→「名前わかる？」（空欄可）。GPS 取得（`geo.getCurrentLocation`）。`searchNearbyVenues`（半径150m、最大10件）で候補表示（キー未設定・失敗時は空）。
2. 写真ステップ（任意、`compressPhotoToDataUrl` 最大1024px）。
3. 確定で Venue（既存 `place_id` 一致なら再利用し気になるフラグを解除、無ければ `category:"family"` で新規）と Visit（`is_completed:true`）を Dexie へ pending 保存。5 秒の「取り消す」スナックバー（`undoCheckIn`）。
4. 背景同期。

### 2.2 名前で記録
「あしあとに記録」: 店名入力→Places Text Search 候補→`createNamedVisit`→`/visits/{id}/register` へ遷移して肉付け。
「気になるに記録」: `registerVenueFromPlace`（`is_wished:true`、理由タグ任意）。Visit は作らない。既存 `place_id` → 完全一致名の順で重複回避（`findOrCreateVenueByNameOrPlace`）。

### 2.3 肉付け（二次登録）
`who`/`revisit`/`budget`/`alcohol_tags`/`quietness` をチップ、写真1枚、メモ(≤2000字)、訪問日時(`clampVisitedAt`)。`completeVisitRegistration` で `is_completed:true`。

### 2.4 削除・復元
`deleteVisit`（同期済みは削除キューへ）→ 5 秒アンドゥ `restoreVisit`。`deleteVenue`（紐づく Visit も連動、クラウドは `on delete cascade`。グループメンバーの記録も消える点に注意）。写真削除は `removeVisitPhoto`。

### 2.5 気になるリスト
Visit が記録されると自動で気になる解除（`clearWishIfNeeded`）。インポート: Takeout CSV（`Title,Note,URL`）/ KML を `parseGoogleMapsImportFile` → プレビュー → `importWishedVenues`（完全一致名は既存にフラグのみ）。

### 2.6 グループ共有
作成（`create_group` RPC）→ 招待コード発行（8桁、24時間、1回、既存有効コードは併記）→ 相手が `redeem_group_invite` で参加→ 次回 pull で相互に可視化。抜ける（確認ダイアログ）→ 自分の行のみ削除、相手の記録はローカルから次回 pull で除去。パートナー記録は `PartnerAvatar` 表示・編集削除不可（`isOwnVisit`）。

### 2.7 ログイン・同期
`/login` で `signInWithOtp`。リンク経由で戻ると `SIGNED_IN` → `pullFromCloud`。以後 pending を push。ログアウト（`AuthStatus`）は `signOut` ＋ `clearLocalData`（**確認なし、未同期も消える**）。

### 2.8 今日どこ行く？
`useSuggestedVenue`: 最終訪問が半年（30日×6）超かつ `revisit==="絶対行く"` の店からランダム1件。

### 2.9 終電・帰宅アラート
`config/commute.ts`: 行き先2つ（home/work）、ラベル・時刻は環境変数＋設定の localStorage 上書き、週末=自宅/平日=職場を優先、営業日 5:00 起点で残り分を計算。`lastTrainByStation` は空で**駅別データは未実装**。`category:"family"` の店では非表示（PRD）。

## 3. 入力検証

| 項目 | 内容 |
| --- | --- |
| 店名 | `VENUE_NAME_MAX_LENGTH=100`（クライアント slice、DB CHECK ≤100） |
| メモ | ≤2000（DB CHECK） |
| 写真 | 圧縮後サイズ超過は `PhotoTooLargeError` |
| 招待コード | trim+大文字化、空は拒否。32文字種（紛らわしい文字除外） |
| インポート | `GoogleMapsImportError`（形式不正） |
| CSV | 先頭の `= + - @` 等のインジェクション対策（#43。`export.ts`） |
| ICS | `escapeIcsText`（CR 含む。#47） |

## 4. 状態表示

`Skeleton`、`useOnlineStatus` によるオフライン表示、地図は API キー無し/オフライン時に一覧フォールバック、未同期件数（`AuthStatus`: 「未同期N件」）、ログインエラーの日本語化。

## 5. テスト対応

| 機能 | テスト |
| --- | --- |
| 書き込み系 | `lib/db/checkin.test.ts` |
| 同期 | `lib/db/sync.test.ts`（412行） |
| グループ | `lib/db/groups.test.ts`、`test-utils/fakeSupabase.ts` |
| ローカルDB | `lib/db/localDb.test.ts` |
| エクスポート/インポート | `lib/export.test.ts`、`lib/googleMapsImport.test.ts` |
| E2E（Playwright, Pixel 7） | `checkin-undo`、`family-checkin`、`login-flow`、`timeline-delete`、`venue-delete`、`wish-with-reason` |

**テスト無し**: 統計(`stats.ts`)、地図、`places.ts`（カテゴリ判定）、`commute.ts`（終電計算。ロジックが複雑）、`geo.ts`、`storage.ts`、UI コンポーネント、RLS（SQL 検証手段なし）、実 Supabase 連携。今回テストは**未実行**で、現在の合否は不明。
