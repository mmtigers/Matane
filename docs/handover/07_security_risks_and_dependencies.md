# 07 セキュリティ・依存・保守リスク

> コードを読んだ範囲の整理であり、セキュリティ監査・脆弱性スキャンは**実施していない**。依存の現在の脆弱性状況は未確認で、「安全」とは結論できない。

## 1. 認証・認可

- 認証: Supabase マジックリンク（パスワードなし）。ログインは任意。サーバー側コードが無いため、**すべての認可は RLS/SECURITY DEFINER 関数**に依存（[04](./04_data_api_and_integrations.md)）。
- クライアントは `created_by`/`user_id` を自己申告で付与するが、RLS の `with check` が `auth.uid()` と突き合わせる。
- 招待: コード 8 桁（32 種）、24 時間、1 回、`for update` で消費（`redeem_group_invite`）。INSERT ポリシーで有効期限上限を強制。総当たりのレート制限はアプリ側に無い（Supabase のレート制限に依存。未確認）。
- ログイン連打: localStorage の 30 秒クールダウン（クライアント側のみ）。

## 2. データアクセス制御の評価ポイント

| 観点 | 内容 |
| --- | --- |
| 証拠あり | `venues` は同グループのメンバーなら**更新・削除可**。削除は `visits` を cascade し他メンバーの記録も消える（要件書の権限マトリクスで意図的） |
| 証拠あり | 写真は public バケットで URL を知れば誰でも閲覧可（コメントに設計意図あり） |
| 証拠あり | `visits` UPDATE ポリシーは `using` のみ（`with check` 省略 → using が適用されるため `user_id` を他人に書き換える INSERT/UPDATE は不可と読めるが、実DBでの検証は未実施） |
| 証拠あり | 未ログイン時は Supabase 同期なし。ローカルデータは端末の IndexedDB に平文 |
| 未検証 | RLS シナリオの実DB検証手段が無い。ポリシー全体の網羅的な攻撃テストは未実施 |
| 未検証 | `get_group_members()` が同グループメンバーの email を返す（意図通りだが、脱退直後の挙動など未確認） |

## 3. 入力・外部入力

- CSV 書き出しのインジェクション対策、ICS エスケープ、Takeout/KML のパーサ（`googleMapsImport.ts`。形式エラーは `GoogleMapsImportError`）。KML はクライアント側でパース（XXE は DOM パーサ依存で、特別な対策コードは未確認）。
- 画像は圧縮してからアップロード。MIME は Blob から決定。拡張子は正規表現で制限。
- `src` 内に `dangerouslySetInnerHTML` の使用は検出されなかった（grep で確認）。

## 4. 秘密情報

- サーバー専用の秘密は無い。全環境変数が `NEXT_PUBLIC_*` でバンドルに含まれる。Supabase anon key は RLS 前提で公開可。**Google API キーは第三者に流用されうるため、リファラー/API 制限が事実上唯一の防御**（Cloud Console 側。未確認）。
- `.env*` は gitignore（`.env.local.example` のみ追跡）。Git 履歴の秘密情報スキャンは未実施。
- 終電ラベルなど個人の生活圏情報はソース/PRD から除去済み（コミット d43d2c6, 8980f52）。履歴には残っている可能性（未確認）。

## 5. ヘッダ・Cookie・CORS

`next.config.ts` は空（セキュリティヘッダ・CSP 無し）。Cookie 不使用（セッションは localStorage ＝ XSS 時に奪取可能）。CORS は Supabase/Google 側設定。

## 6. 依存関係

| パッケージ | 役割 | メモ |
| --- | --- | --- |
| next ^16.3.4 / eslint-config-next 16.3.0（固定） | フレームワーク | キャレットと固定が混在 |
| react / react-dom 19.2.8（固定） | UI | — |
| @supabase/supabase-js ^2.112 | 同期・認証 | — |
| dexie ^4.4.4 / dexie-react-hooks ^4.4 | ローカル DB | スキーマ v5、`upgrade` あり |
| browser-image-compression ^2 | 画像圧縮 | 保守状況は未確認 |
| tailwindcss ^4 | スタイル | — |
| vitest ^4.1 / jsdom ^30 / fake-indexeddb ^6 / @playwright/test ^1.62 | テスト | — |
| @types/google.maps | 地図型 | — |
| @types/node ^20 | 型 | CI は Node 22（乖離） |

凍結期間で Next/Supabase/Playwright の更新が溜まる。Dependabot は未設定（[05](./05_setup_testing_deployment_operations.md)）。

## 7. 品質維持

CI（lint/Vitest/build/Playwright）、`npm audit`（失敗無視）、単体 6 ファイル＋E2E 6 本。型検査は `next build` 内のみ。監視・エラートラッキング無し。

## 8. 保守リスク

- 属人化: ほぼ AI 生成ブランチ由来。設計意図は PRD・要件書・コードコメントに多い（良質）が、`AGENTS.md` は自動生成ブロックのみでプロジェクト固有の指針が無い（Futarigoto 等と対照的）。
- 単一障害点: Supabase・Google・個人運用。
- クライアント完結のため、秘匿が必要な機能（AI 等）を足す際に設計変更が必要。
- 手書きのマッピング（`sync.ts`）と `schema.sql` のズレを検出する自動テストが無い（Futarigoto の `supabaseSchema.test.ts` のような仕組みなし）。
- SW のキャッシュ設計（手書き）の保守負担。
