# LINEレンジャー PvP統計＋新キャラ情報掲示板 確認版

このRepositoryは、**PvPランキングを主画面として復元し、同一サイトへ新キャラ情報掲示板を併設するOwner確認版**です。

## 現在の構成

- `/` : `/pvp/index.html` のPvPランキングを開く。
- `/pvp/index.html` : pre-maintenance版の画面構造・操作契約を基準に復元したランキング画面。
- `/boards` : 新キャラ情報掲示板。投票、コメント、写真/動画、翻訳、Owner/Moderator機能を扱う。
- PvP画面から同一サイトの `/boards` へ移動できる。
- 掲示板を主画面にしてPvPランキングを小型表示する旧方式へ戻さない。

## PvPファイルとデータ

- `public/pvp/index.html`
- `public/pvp/assets/style.css`
- `public/pvp/assets/app.js`
- `public/pvp/data/character_usage.json`
- `public/pvp/data/character_usage_history.json`
- `scripts/collect-pvp.mjs`
- `scripts/patch-pvp-metadata.mjs`
- `.github/workflows/refresh-pvp-data.yml`

PvP正本Repository `line-rangers-fan/line-rangers-pvp` はPrivateのまま読み取り専用とし、確認版BuildはPrivate raw/codeloadへ依存しません。確認版のcollectorが `rangers.lerico.net` の公開APIからLEGEND上位200人を取得し、**200/200の正常検証に成功した場合だけ**snapshotを生成します。部分/異常取得では正常snapshotを上書きしません。

workflowは毎時17分に更新し、ブラウザは同一originの追跡済みsnapshotを読みます。履歴は蓄積式で、基準snapshotがない比較期間は推測せず「履歴待ち」と表示します。

## 掲示板の重要仕様

- 2026-09対象は `u1631e-sally` / `かに座 サリー` / 究極進化側のみ。
- コメントは投稿成功時だけ入力欄とlocalStorage draftを消し、失敗時は保持。
- Owner / Moderator / Userはサーバー側で判定し、表示名からRoleを付与しない。
- Secrets、Token、Cookie signing secret、Owner認証情報、DB/Storage credentialをCommitしない。
- noindex / nofollow / noarchive / nosnippetを維持する。

## Build / Test

- Node.js `>=22.13.0`
- `npm run install:ci`
- `npm run build`
- `npm test`
- `.github/workflows/verify-owner-copy.yml` はBuild/Test専用でDeployしない。
- `.github/workflows/refresh-pvp-data.yml` はPvP snapshot更新専用で、サイトDeployは行わない。

## Workへの正本指示

Owner Previewを作るときはRepository rootの `WORK_OWNER_PREVIEW_HANDOFF.md` を最優先で読み、**現在mainに追跡済みの `public/pvp/` を上書きせずそのままBuild**すること。
