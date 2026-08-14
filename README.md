# Matane（マタネ）

「またね」と言えるお店が、すぐ決まる。次にどこへ行くかを最短で決める、自分専用の飲み会コンシェルジュ。

詳細な要求仕様は [docs/PRD.md](./docs/PRD.md) を参照。

## 技術スタック

- Next.js (App Router, TypeScript, Tailwind CSS)
- Supabase (Postgres / Auth / Storage)
- Dexie.js (IndexedDB) — オフライン優先のローカルキャッシュ
- 手書きService Worker (`public/sw.js`) — PWAオフラインシェル

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local に Supabase の URL / anon key を設定
npm run dev
```

Supabase側のテーブル作成は [supabase/schema.sql](./supabase/schema.sql) をSQL Editorで実行する。

### 認証（マジックリンク/Email OTP）

パスワード不要のマジックリンク認証を採用している。Supabaseダッシュボードで以下を設定すること。

1. 「Authentication」→「URL Configuration」で **Site URL** と **Redirect URLs** に
   アプリのURL（開発時は `http://localhost:3000`、本番は実際のドメイン）を追加する。
   未設定だとログインリンクのリダイレクトが失敗する。
2. ログインしなくてもこの端末内での記録・閲覧は可能（オフラインファースト）。
   ログインするとSupabaseへの同期が有効になり、他の端末ともデータを共有できる。

### 終電・帰宅アラートの個人設定（任意）

店舗詳細画面の終電・帰宅アラートは、行き先ラベルと終電目安時刻を環境変数から読む
（未設定時は「自宅」「職場」という汎用ラベル・時刻にフォールバックする）。個人の
生活圏に依存する情報のためソースには含めていない。カスタマイズする場合は
`.env.local`（またはVercelの環境変数）に以下を設定する。

```
NEXT_PUBLIC_COMMUTE_HOME_LABEL=自宅（○○方面）
NEXT_PUBLIC_COMMUTE_HOME_LAST_TRAIN=24:00
NEXT_PUBLIC_COMMUTE_WORK_LABEL=職場（○○方面）
NEXT_PUBLIC_COMMUTE_WORK_LAST_TRAIN=23:30
```

## ディレクトリ構成

```
src/
  app/            App Routerのページ・レイアウト
  components/     共有UIコンポーネント
  lib/
    supabase/     Supabaseクライアント
    db/           Dexieローカルキャッシュ・オフライン同期ロジック
  types/          Venue / Visit などの型定義
supabase/
  schema.sql      Venues / Visits テーブル定義・RLSポリシー
docs/
  PRD.md          プロダクト要求仕様書
```

## オフライン同期の仕組み

1. 「ココを記録」等の操作は `src/lib/db/checkin.ts` を通じて即座にDexie(IndexedDB)へ書き込まれる（`syncStatus: "pending"`）。
2. `src/lib/db/sync.ts` の `syncPendingChanges` がオンライン復帰時・起動時に `syncStatus: "pending"` のレコードをSupabaseへバッチupsertし、成功したものを `"synced"` に更新する。
3. `src/lib/db/sync.ts` の `pullFromCloud` がログイン直後・起動時にSupabase側の記録をDexieへ取り込む。他端末での記録や、この端末のIndexedDBが空(再インストール等)の場合の復元に使う。ローカルに未送信の変更(`"pending"`)がある行は上書きしない。
4. IDはクライアント側でUUID生成し、ローカルとクラウドで同一IDを使うため、同期はべき等（idempotent）に行える。

## テスト

```bash
npm run lint       # ESLint
npm run build      # 型チェック込みの本番ビルド
npm run test:e2e   # Playwright E2E（devサーバーを自動起動して実行）
```

push・PR毎に `.github/workflows/ci.yml` が上記3つを自動実行する。

## 開発の原則（要約）

- 入力を増やさない。自動取得できるものは自動取得する。
- 「あとで入力できる」なら今は入力させない（一次登録＝仮登録、二次登録＝肉付け）。
- 迷ったら機能を削る。

詳細は [docs/PRD.md](./docs/PRD.md) の「開発・設計の原則」を参照。
