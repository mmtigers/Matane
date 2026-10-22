# 06 課題・決定事項・再開計画

GitHub open Issue/PR は調査時 0 件。以下はコード・コメント・docs・コミット履歴から拾った。「提案」は筆者の推定による案で、合意済みではない。

## 1. タスク一覧

| ID | 優先度 | 状態 | 内容 | 根拠 | 関連箇所 | 対応案 | 完了条件 | テスト | 依存 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | P1 | 未着手 | ログアウトが未同期データを確認なしで全消去 | `AuthStatus.tsx` `handleLogout`（#40 の全消去対応）。他リポ Suwalist は pending 件数確認＋事前同期を実装（AGENTS.md） | `AuthStatus.tsx`, `localDb.ts` | 提案: 先に `syncPendingChanges()`、pending が残れば件数を示して確認 | pending が残る状態では確認なしに消えない | 単体＋E2E | なし |
| T-02 | P1 | 未着手（要検証） | pull がページングなし。上限超過で取りこぼし、続くクラウド不可視行の削除ロジックで**ローカルの synced 行が消える**可能性 | `sync.ts` `pullFromCloud` の `select("*")` と stale 削除 | `sync.ts` | `range()` で `created_at,id` 順にページング。取得が完全でない場合は stale 削除をしない | 1000件超の模擬データで欠落しない | `sync.test.ts` に追加 | なし |
| T-03 | P1 | 未着手 | ベースライン確認（lint/test/build/E2E、依存古化） | 凍結期間 | CI 全体 | 実行し結果を記録 | CI 緑 | 全コマンド | 環境 |
| T-04 | P1 | 未着手 | 実機でオフライン→ログイン→同期→別端末 pull、グループ作成/参加/脱退の通し確認 | RLS/RPC を自動検証する手段が無い | `groups.ts`, `sync.ts` | 2 アカウント・2 端末で確認 | 全シナリオ成功 | 手動 | Supabase 環境 |
| T-05 | P2 | 未着手 | `schema.sql` の適用状況確認と、マイグレーション運用・CI 検証の導入 | `schema.sql` が単一ファイルに追記方式 | `supabase/` | 提案: `supabase/migrations/` へ分割、素の Postgres に適用して RLS 存在を検査する CI ジョブ（Futarigoto/Suwalist の方式を参考） | CI で schema 適用が検証される | CI | T-04 |
| T-06 | P2 | 未着手 | `npm audit` が `continue-on-error`、Dependabot 未設定、アクション SHA 未固定 | `ci.yml` | `.github/` | `dependabot.yml` 追加、audit の扱い決定 | 依存更新が自動で上がる | CI | なし |
| T-07 | P2 | 未着手 | グループ RPC のエラー判定が `message.includes` | `groups.ts` | `groups.ts`, `schema.sql` | 例外の DETAIL トークン化（Futarigoto 方式） | 文言変更で壊れない | `groups.test.ts` | schema 変更 |
| T-08 | P2 | 要確認 | `visits.updated_at` が更新されない、端末間 LWW なし | `schema.sql`（トリガーなし）、`sync.ts` | 同 | 必要なら updated_at トリガー＋比較導入（提案） | 方針決定 | 単体 | 仕様判断 |
| T-09 | P2 | 要確認 | 写真バケットが public、グループ脱退後も URL で閲覧可能 | `schema.sql` Storage ポリシーコメント | `storage.ts` | 署名付き URL 等を検討（仕様判断） | 方針決定 | 手動 | 仕様判断 |
| T-10 | P2 | 要確認 | Google API キー制限（リファラー・API 制限）と予算アラート | README が必須と記載、リポ外 | — | Cloud Console で確認 | 設定済みの確認 | — | 人間 |
| T-11 | P3 | 未着手 | 終電データが既定値のみ（駅別未実装） | `commute.ts` `lastTrainByStation: {}` | `config/commute.ts` | 時刻表データ/API 検討（PRD「実運用では置換」） | 仕様判断 | 単体（現在テスト無し） | 仕様 |
| T-12 | P3 | 未着手 | AI 機能（Phase 3）全て未実装、`ai_tags` は予約のみ | PRD 7章 | — | サーバー層新設が前提。原則 1〜7 に照らして要否判断 | 要否決定 | — | 仕様 |
| T-13 | P3 | 提案 | `app/page.tsx` 670行等の分割、`commute.ts`/`stats.ts`/`places.ts` のテスト追加 | 行数・テスト無し | 該当 | 段階分割 | — | 単体 | — |
| T-14 | P3 | 未着手 | 用語・名称整理（ATODE、行きたい→気になる、checkin ファイル名） | 01 章差異表 | docs, e2e | リネームは E2E 参照に注意 | 差異解消 | — | なし |
| T-15 | P3 | 要確認 | アカウント削除・利用規約・プライバシー表記が無い | grep で該当ページなし（確認した範囲） | — | 公開範囲に応じ検討 | 方針決定 | — | 仕様 |

## 2. TODO/FIXME/暫定

`TODO`/`FIXME` コメントは検出されなかった（`ai_tags` 空配列＝将来用）。PRD 内の「未実装」明記: AI 要約・おすすめ・自然文検索・行き忘れ通知・写真タグ・3人以上・友人共有・カレンダー連携。

## 3. 既知の不具合

過去に修正済み: RLS 無限再帰、SW のエラーキャッシュ、グループ作成の孤立行、place_id グローバル unique 問題。**現行の確定バグはコードからは未確認**（実行していない）。懸念は T-01/T-02/T-08。

## 4. 設計判断と採用されなかった案

| 判断 | 根拠 |
| --- | --- |
| チェックイン機能の削除 | コミット 44fb738「もう一度チェックイン機能を削除」 |
| 飲み屋/家族の用途選択をホームから撤廃、新規は一律 `family` | PRD 5章①、コミット 975bc00/f10a599 |
| 共有は ON/OFF 選択式にせず所属で全共有 | 要件書 2章 |
| 別グループの同一店舗は別レコードを許容 | 要件書 8章 |
| UI 発明（操作原理の再設計）は検討資料のみ | `UI_INVENTION_FRAMEWORK.md`（採用有無は未確認） |

## 5. 再開時の最初のタスク

1. **T-03**: `npm ci` → `lint` → `test` → `build`（→ 任意で E2E）を実行し結果記録。
2. **T-04**: 2 端末で通し確認（特にグループ）。
3. **T-01**: `AuthStatus.tsx` の `handleLogout` に事前同期＋pending 確認。`usePendingSyncCount` を再利用可。
4. **T-02**: `sync.ts` の pull をページング化し、stale 削除の安全条件を追加。`sync.test.ts` に 1000 件超ケース。
5. **T-05/T-06**: スキーマ運用と CI の整備。

## 6. 再開前の確認事項

Supabase の存続・schema 適用状況・Auth リダイレクト設定、Google キーの制限、デプロイ先、利用者の有無、`origin/main` の更新。
