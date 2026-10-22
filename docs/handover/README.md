# Matane（マタネ）引き継ぎ資料（開発凍結版）

## 基本情報

| 項目 | 内容 |
| --- | --- |
| プロジェクト | Matane（マタネ）。「またね」と言えるお店が、すぐ決まる。次にどこへ行くかを最短で決める自分専用の飲み会コンシェルジュ（スマホ専用 PWA） |
| 資料作成日 | 2026-10-22 |
| リポジトリ状態の記録日時 | 2026-10-22（最終コミット 2026-09-13） |
| 調査時のブランチ | `ccr-c90540ea-yf4bz2`（`origin/main` と同一） |
| HEAD | `884f9be0a03d24cd5f9b34c560c2ddfecf526e7b`（Merge pull request #48） |
| 作業ツリー | 調査開始時クリーン（未コミット変更・未追跡・スタッシュなし） |
| 今回の作業範囲 | ドキュメント作成のみ。ビルド・テスト・起動・DB操作は**未実行** |

## 一言でいうと

Next.js 16 (App Router) + Tailwind 4 + Dexie(IndexedDB) + Supabase(Postgres/Auth/Storage) のオフラインファースト PWA。
「ココを記録」（GPS）と「名前で記録」（Google Places 検索）の 2 ボタンで店・場所を素早く登録し、あとから肉付け。気になる店リスト、地図（ちかく）、統計、夫婦・家族グループ共有を持つ。ログイン不要でも端末内で使え、ログインすると Supabase と同期する。

## 凍結時点の状態（要約）

- PRD の MVP は「達成済み」と明記。Phase 2（気になる・統計・地図）、Phase 4 の一部（グループ共有）は実装済み。AI 機能（メモ要約・おすすめ・自然文検索・写真タグ）は**全て未実装**（`ai_tags` 列は空配列で予約のみ）。
- 直近の作業は品質・セキュリティ修正（CSV インジェクション、ログアウト時の IndexedDB 全消去、ICS エスケープ、CI への Vitest/audit 統合）。
- GitHub の open Issue / open PR は 0 件（調査時に確認）。
- ブランチは 99 コミット。ほぼ全て `claude/*` ブランチ由来の PR マージ。

## 重要な問題（詳細は [06](./06_issues_decisions_and_resume_plan.md) / [07](./07_security_risks_and_dependencies.md)）

1. **ログアウトすると未同期（pending）データも確認なしで全消去される**（`AuthStatus.tsx` → `clearLocalData`）。オフライン記録が失われうる。
2. **`pullFromCloud` が `select("*")` をページングなしで実行**（`sync.ts`）。PostgREST の行数上限（既定 1000。Supabase 設定依存）を超えると取りこぼし、さらに「クラウドで見えない synced 行をローカル削除」するため**データ消失につながる可能性**（推定。実環境未検証）。
3. 写真バケット `visit-photos` は public 読み取り（URL を知れば誰でも閲覧可。設計意図として記載あり）。
4. Google API キーが `NEXT_PUBLIC_*` でブラウザ公開。HTTP リファラー制限は Google Cloud 側設定（リポジトリから確認不能）。
5. スキーマは `supabase/schema.sql` 1 ファイルに冪等 SQL を積み増す方式で、マイグレーション履歴・CI での検証が無い。
6. 利用規約等・アカウント削除・バックアップは未整備（要確認）。

## 文書一覧

| ファイル | 役割 |
| --- | --- |
| [01_project_and_current_state.md](./01_project_and_current_state.md) | 目的・スタック・履歴・実装状況・文書差異 |
| [02_architecture_and_code_map.md](./02_architecture_and_code_map.md) | 構成図・コード地図 |
| [03_features_and_user_flows.md](./03_features_and_user_flows.md) | 画面・機能・フロー・テスト対応 |
| [04_data_api_and_integrations.md](./04_data_api_and_integrations.md) | DB・RLS・RPC・外部サービス・環境変数 |
| [05_setup_testing_deployment_operations.md](./05_setup_testing_deployment_operations.md) | 環境構築・テスト・CI・デプロイ・運用 |
| [06_issues_decisions_and_resume_plan.md](./06_issues_decisions_and_resume_plan.md) | 課題・決定事項・再開計画 |
| [07_security_risks_and_dependencies.md](./07_security_risks_and_dependencies.md) | セキュリティ・依存・保守リスク |

## 再開時に最初に確認すること

1. `AGENTS.md`（Next.js 16 の破壊的変更に関する注意。`node_modules/next/dist/docs/` を先に読む）と `docs/PRD.md` の「開発・設計の原則」。
2. `git fetch` で `origin/main` が `884f9be` から進んでいないか。
3. Supabase プロジェクトが存続し `supabase/schema.sql` が適用済みか、Storage バケット、Auth の Site URL / Redirect URLs（リポジトリ外）。
4. Vercel デプロイの有無（設定ファイルなし。README に明記が無い＝未確認）。
5. Google Cloud の API キーの制限・課金状況。

## 推奨手順

1. `npm ci` → `npm run lint && npm run test && npm run build`（任意で `npm run test:e2e`）でベースライン取得（今回未実行）。
2. 実機（スマホ）でオフライン記録→ログイン→同期→別端末で pull を通し確認。
3. 最初のタスクは [06](./06_issues_decisions_and_resume_plan.md) **T-01（ログアウト時の未同期データ保護）と T-02（pull のページング）**。理由: ユーザーデータ喪失に直結するため。

## この資料だけでは判断できないこと

本番運用の有無・URL・利用者、Supabase/Google/Vercel の現行設定、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 等の実値、PRD 上の「ATODE」表記（旧名称）の経緯。

## 区分の凡例

確認済み／推定／未確認／要確認。明記なしはコード・設定を読んだ事実。**テスト・ビルド・実行は未実施**のため「動作確認済み」ではない。
