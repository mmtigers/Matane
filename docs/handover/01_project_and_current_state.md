# 01 プロジェクトと現在の状態

## 1. 目的・利用者

- 課題: 「またこの店に行きたい」という記憶が時間とともに埋もれ、次の店選びに使えない。入力が面倒で記録が続かない（`docs/UI_INVENTION_FRAMEWORK.md`）。
- 位置づけ: 記録アプリではなく「未来の意思決定を支援する自分専用の飲み会コンシェルジュ」。優先順位は「未来の意思決定 ＞ 思い出の保存 ＞ データ収集」（`docs/PRD.md`）。
- 想定ユーザー: 個人（元は仕事の飲み会中心）＋夫婦・家族（グループ共有）。スマホ専用、片手・親指操作。
- 主要シーン: 地下店舗など通信不能な場所でも 3 秒で仮登録／車から見かけた店を「気になる」登録／「今日どこ行く？」で提案を見る。
- 画面上の呼称: あしあと=タイムライン、気になる=ウィッシュリスト、わたしデータ=統計、ちかく=地図（PRD）。内部では `wish`/`is_wished`、`timeline`、`stats`、`map` が混在。

## 2. 要件・機能範囲

`docs/PRD.md`（141行）が単一情報源。MVP 完了条件は全てチェック済み（「MVPは達成済み」）。`docs/REQUIREMENTS_group_sharing.md`（グループ共有）、`docs/UI_INVENTION_FRAMEWORK.md`（UI 発明の検討ドキュメント。採用された設計ではない＝検討資料。実装反映は未確認）。

開発原則（PRD 2章）: 入力を増やさない／自動取得優先／2 段階登録／毎回使う機能のみ／片手操作／迷ったら削る。

## 3. 技術スタック（`package.json`）

| 区分 | 採用 |
| --- | --- |
| フレームワーク | Next.js ^16.3.4（App Router）、React 19.2.8（固定）、TypeScript 5 |
| スタイル | Tailwind CSS 4 |
| ローカルDB | Dexie ^4.4.4 + dexie-react-hooks（IndexedDB、DB名 `matane-db`、v5） |
| クラウド | `@supabase/supabase-js` ^2.112（Postgres+PostGIS / Auth / Storage）。SSR パッケージ（@supabase/ssr）は不使用＝完全クライアント側 |
| 画像 | browser-image-compression（最大1024px） |
| 外部API | Google Places API (New)、Google Maps JavaScript API、`geolocation` |
| テスト | Vitest ^4.1（jsdom, fake-indexeddb）、Playwright ^1.62（Pixel 7） |
| PWA | 手書き `public/sw.js`、`public/manifest.webmanifest` |
| ランタイム | Node 22（CI）。`.nvmrc`/`engines` は無し |

サーバー側コード（Server Action / Route Handler / API ルート）は**存在しない**。全ロジックがブラウザ上で動き、Supabase を RLS 越しに直接呼ぶ。

## 4. 開発履歴（99コミット）

| 時期 | 内容 |
| --- | --- |
| 2026-08-05 | 初期実装、コードレビュー指摘修正、終電アラートの個人情報を環境変数化 |
| 08-06〜09 | 気になるリスト・統計・地図、CSV/ICS エクスポート、店舗共有、瞬録（GPS）＋Google Places 候補、家族用の分離、チェックイン機能削除 |
| 08-13〜17 | ナビラベル刷新、ホームを 2 ボタンに簡素化、「名前で記録」、PRD 更新 |
| 08-15〜16 | **グループ共有**（スキーマ/データ層/UI）、RLS 再帰・作成アトミック化・SW エラーキャッシュ修正 |
| 08-21〜23 | ちかくを Google マップ化、Takeout/KML インポート、Venue 削除、重複排除のグループ単位化、UI 発明ドキュメント |
| 09-06〜13 | CI に Vitest・audit 統合(#39)、CSV インジェクション対策(#43)、ログイン通信エラー文言(#46)、写真削除/ICS 修正(#47)、ログアウト時全テーブル消去(#40) |

## 5. 主要な設計判断

| 判断 | 根拠 |
| --- | --- |
| オフラインファースト（Dexie に先に書き、後で同期） | PRD 6章、`checkin.ts`/`sync.ts` |
| 2 層（Venues/Visits）、Wish は Venue の列 | PRD 4章 |
| クライアント生成 UUID でべき等 upsert | README「オフライン同期の仕組み」 |
| ログイン任意（ゲストはローカルのみ） | `AuthProvider`、README |
| グループは N 人設計、1 ユーザー 1 グループ（`group_members.user_id` unique） | 要件書 |
| 招待・グループ作成は SECURITY DEFINER RPC でアトミック化 | `schema.sql` コメント |
| 同一 place_id の重複排除はグループ単位（`owner_group_id`） | `schema.sql` 重複排除ブロック |
| Service Worker は他オリジンをキャッシュしない・成功のみキャッシュ | `sw.js`、コミット 9360c63 |
| 個人設定（終電ラベル等）は環境変数＋設定画面の localStorage 上書き | `config/commute.ts` |

## 6. 実装状況

| 機能 | 状況 |
| --- | --- |
| ココを記録（GPS+写真） | 実装済み（`createQuickCheckIn`）。E2E あり |
| 名前で記録（あしあと/気になる） | 実装済み |
| 二次登録（肉付け） | 実装済み（`RegisterVisitClient`） |
| タイムライン/フィルタ/削除・取り消し | 実装済み。E2E あり |
| 店舗詳細（終電アラート、位置後付け、共有） | 実装済み |
| 気になる、Googleマップ CSV/KML インポート | 実装済み。パーサ単体テストあり |
| ちかく（Google Map／一覧フォールバック） | 実装済み。テスト無し |
| 統計 | 実装済み（`stats.ts`、`app/stats/page.tsx` に 6ヶ月/1年/全期間の切替あり）。テストは無し |
| グループ共有 | 実装済み。単体テストあり |
| 今日どこ行く？ | ルールベース実装済み（絶対行く＆半年以上） |
| CSV/ICS エクスポート | 実装済み |
| AI 機能（要約・おすすめ・検索・タグ） | **未実装**（PRD Phase 3） |
| 行き忘れ通知、カレンダー連携、友人共有、3人以上拡張 | 未実装 |
| 終電の駅別時刻データ | `lastTrainByStation` は空。全て既定値（スタブ） |

本番稼働の有無は判断不能。

## 7. ドキュメントと実装の差異

| 箇所 | 差異 |
| --- | --- |
| PRD 1章「ATODE(Matane)」 | 旧名称の残骸（要確認） |
| PRD/コード/E2E | 「行きたい」→「気になる」改称済みだが `wish`・`is_wished`・E2E 名称 `wish-with-reason` 等に旧語が残る |
| E2E ファイル名 `checkin-undo`/`family-checkin` | チェックイン機能は削除済み（コミット 44fb738）。名称だけ残存 |
| PRD 画面①「写真1枚の瞬録は...」と README | 瞬録＝「ココを記録」。呼称が混在（コメント内は「瞬録」） |
| `docs/REQUIREMENTS_group_sharing.md` 1章 | 「Venues が全ユーザー公開」は実装前の状態の記述。現行 RLS はグループ限定 |
| README セットアップ | `.nvmrc` なし・Node バージョン未記載。`typecheck` 専用スクリプト無し（build で型検査） |
| `supabase/schema.sql` | 「Venues / Visits schema」と題するが、groups 系・Storage ポリシーも含む |

## 8. 技術的負債・制約

- `src/app/page.tsx` 670 行等、巨大ページコンポーネント。
- スキーマ変更履歴が `schema.sql` 内の `alter ... if not exists` に埋め込み。
- 完全クライアント側のため、AI や機密処理を載せる場合はサーバー層の新設が必要。
- 端末間の競合解決は「pending を守るだけ」で LWW/タイムスタンプ比較なし（`visits.updated_at` はサーバー側既定のみ。クライアント更新で更新されるかは未確認）。

## 9. 凍結時の注意

- `AGENTS.md` の Next.js 注意ブロックは `next dev` が再生成する。
- 個人の生活圏情報（終電ラベル）はソースに含めない方針（コミット d43d2c6）。新規の個人情報をソース・PRD に書かない。
