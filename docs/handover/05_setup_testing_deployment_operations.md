# 05 セットアップ・テスト・デプロイ・運用

> 本章のコマンドは `package.json` / `ci.yml` / README / `playwright.config.ts` で**定義を確認したもの**で、今回は**全て未実行・動作未確認**。

## 1. 前提

| 項目 | 内容 |
| --- | --- |
| Node.js | CI は 22。`.nvmrc`・`engines` は無い（22 を推奨、未確認） |
| パッケージ管理 | npm（`package-lock.json`） |
| 外部 | Supabase プロジェクト（PostGIS 利用可）、任意で Google Cloud の Places/Maps キー |

## 2. 構築手順

```bash
npm ci                       # README は npm install
cp .env.local.example .env.local   # 値を設定（04章）
npm run dev                  # http://localhost:3000
```

1. Supabase の SQL Editor で `supabase/schema.sql` を実行（`postgis` 拡張が必要。冪等）。
2. Authentication > URL Configuration に Site URL / Redirect URLs（`http://localhost:3000` と本番）。
3. Google Cloud で Places API (New) と Maps JavaScript API を有効化し、**HTTP リファラー制限**付きキーを発行（README が必須と明記）。
4. 環境変数未設定でもローカル単体動作は可能（同期・候補・地図が無効になる）。

`AGENTS.md` により、コード変更前に `node_modules/next/dist/docs/` を読む。

## 3. コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` / `build` / `start` | 開発/ビルド（型検査込み）/本番起動 |
| `npm run lint` | eslint |
| `npm run test` / `test:watch` | vitest（jsdom、`src/**/*.test.ts`、`fake-indexeddb`） |
| `npm run test:e2e` | Playwright（Pixel 7、workers=1、`npm run dev` を自動起動、`reuseExistingServer: !CI`） |
| 専用 typecheck / format スクリプト | **無い** |

E2E 初回は `npx playwright install --with-deps chromium` が必要（CI と同じ）。

## 4. CI（`.github/workflows/ci.yml`）

- トリガー: push / PR（`main`・`master`）。
- 単一ジョブ: checkout@v4 → setup-node@v4(22, npm cache) → `npm ci` → `npm audit --audit-level=high`（**`continue-on-error: true`**＝失敗しても通る）→ lint → test → build → Playwright install → E2E → 失敗時レポート upload（7日）。
- `permissions`・`concurrency`・`timeout-minutes` 未指定、アクションはタグ参照。DB スキーマ検証ジョブ無し。
- Dependabot 設定ファイルは**無い**（`.github/` は workflows のみ。コミット a273ece の「Dependabot依存監査」は `npm audit` を指す。実質 Dependabot は未設定）。

## 5. デプロイ

README にデプロイ手順なし。Vercel 環境変数への言及があるため Vercel 想定（推定）。`vercel.json` なし。ビルドは `next build`、`NEXT_PUBLIC_*` はビルド時に埋め込まれるため環境変数変更には再ビルドが必要。環境差分（ステージング）の定義は未確認。

PWA: `public/sw.js`（`CACHE_NAME=matane-shell-v4`）。アプリシェルを変えたら版数を上げないと古いキャッシュが残る可能性（navigate はネットワーク優先、同一オリジン GET はキャッシュ優先）。

## 6. 運用

| 項目 | 状況 |
| --- | --- |
| ログ・エラー | `console.warn`/`error` のみ。外部基盤なし |
| 監視 | 無し |
| バックアップ | リポジトリ内に無し（Supabase 側は未確認） |
| 定期処理 | 無し。期限切れ招待・孤立 Storage オブジェクトの掃除なし |
| 外部サービス管理 | Supabase、Google Cloud（キー制限・課金アラート）、ホスティング |

## 7. 危険な操作

- 本番 Supabase で `schema.sql` を再実行: 末尾付近の `update venues ... owner_group_id` 一括更新と `drop policy`/`create policy` が走る（冪等だが一瞬ポリシーが無い時間が生じる）。必ずメンテナンス時間帯に。
- `venues` 削除は連動して全員の `visits` を削除（cascade）。
- ログアウト＝ローカル全消去（未同期データ喪失）。サポート時は先に同期状態を確認。
- `NEXT_PUBLIC_` 変数に秘密を入れない。
- SW のキャッシュ名を変えずに配信すると古い資産が残る。
