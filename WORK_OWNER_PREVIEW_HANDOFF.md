# LINE Rangers PvP + Community — 改修用コピー運用基準

## 目的

`nyu1791-collab/copy-LINE-` を、元サイトを壊さず改善するためのレビュー／改修用コピーとして使う。

2026-09-15、ユーザー確認済みの元サイト Owner Preview
`https://line-rangers-pvp-owner-preview.n-yu1791.workers.dev`
の表示構成を改修用コピーへ同期した。

## Repository の役割

- 改修先: `nyu1791-collab/copy-LINE-` / `main`
- 元サイト正本: `line-rangers-fan/line-rangers-pvp`
- 元サイトは、改修内容がレビュー完了するまで**読み取り専用**として扱う。
- 元Repositoryのmain、Pages、Production Workerへ、改修途中の変更を直接反映しない。
- 改善はまず `copy-LINE-` で実装・テスト・実機確認し、ユーザー承認後に元サイトへ必要な差分だけ反映する。

## 2026-09-15 Owner Preview 同期基準

元サイト側の確認基準UIは、同期時点で `line-rangers-fan/line-rangers-pvp` の commit
`09f829c0f136230f3839f243e69ced93fccac6bc` に含まれる `docs/` と Owner Preview Worker の表示結果。

Owner Preview Worker は元 `docs/index.html` の maintenance overlay だけを除去してランキング本体を表示するため、改修コピーでは最初から maintenance overlay を含めずに表示する。

同期対象の主要要素:

- `UNOFFICIAL STATISTICS`
- `レジェンド帯 キャラ集計`
- 7言語切替
- リーグ / 全編成キャラ数 / 最終更新
- キャラクターランキング
- 順位 / キャラクター / 編成数 / 採用人数 / 採用率
- 1時間前 / 前日締め / 先週締め / 先月締め
- キャラクタータップ時の装備ランキング
- 集計方法 / データ出典
- 新キャラ情報掲示板の入口
- ダークネイビー＋緑の元デザイン
- スマホ優先レイアウト

## 改修コピー側の実装

- `/` → `/pvp/index.html`
- `public/pvp/index.html` は Owner Preview の表示シェルを再現し、maintenance overlayを含めない。
- `public/pvp/assets/style.css` は元PvPスタイルを維持する。
- `public/pvp/assets/community-entry.css` / `community-entry.js` は Owner Preview の掲示板入口を再現する。
- コピー側の掲示板入口は外部開発URLではなく、同一サイトの `/boards` を使う。
- 2026-09対象は `u1631e-sally` / `かに座 サリー` のみ。別進化を混同しない。
- `public/pvp/assets/app.js` はコピー環境用の互換runtimeを維持し、同一originの検証済みデータだけを読む。
- 旧固定式 `community-bridge-link` は互換runtime内に残る場合があるが、Owner Preview型の掲示板カードを正本UIとして表示し、重複導線はCSSで非表示にする。

## PvPデータの隔離

元サイトの現在データを無条件にコピーして、正常な改修用snapshotを上書きしてはいけない。

改修コピーでは:

- `target_players = 200`
- `sampled_players = 200`
- `complete_target = true`

を満たした検証済みsnapshotだけを表示対象にする。

部分取得、空データ、異常減少、検証失敗を正常snapshotへ上書きしない。

## 掲示板

`/boards` を維持する。

- 投票
- コメント
- 写真 / 動画
- 翻訳
- 新着 / いいね / 役に立った
- 固定 / 非表示 / 復元
- Owner / Moderator / User
- request ID / idempotency
- コメント失敗時のdraft保持

を既存仕様どおり維持する。

PvP表示障害と掲示板障害は分離し、一方の障害で他方を停止させない。

## Security

- Secret、PAT、Cloudflare token、Cookie signing secret、DB/R2 credentialをCommitしない。
- Owner / Moderator権限はサーバー側で判定する。
- 表示名から権限を付与しない。
- 元Private Repositoryをブラウザから直接参照しない。
- 検索index対象にしない。

## 改修フロー

1. `copy-LINE-` の最新mainを取得。
2. Owner Preview同期状態と200/200 snapshotを確認。
3. 改善をコピー側だけへ実装。
4. `npm run install:ci` / `npm run build` / `npm test`。
5. Review Workerへ明示的にDeploy。
6. 実サイトでスマホ/iPad/PC、ランキング、比較、装備、掲示板をE2E確認。
7. ユーザーへ変更点と確認URLを提示。
8. ユーザー承認後、元サイトへ差分を適用。
9. 元サイト側でも再度Build/Test/E2Eしてから公開再開を判断。

## 禁止

- コピー側の未確認変更を元サイトへ直接Pushすること。
- 元サイトProductionを無断で再公開すること。
- 正常な200/200データを部分取得で上書きすること。
- Secretsを公開Repositoryへコピーすること。
- 掲示板をPvP本体と置き換えること。
- `u1631e-sally` と別進化を誤統合すること。

## 完了条件

改修コピーで、元Owner PreviewのPvP画面・主要操作が再現され、同一サイト `/boards` が利用でき、200/200正常snapshotが表示され、テストと実機確認が通った時点で「改修開始可能」とする。

元サイトへの反映は別工程であり、コピー側の完成だけでは自動反映しない。
