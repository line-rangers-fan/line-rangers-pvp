# line-rangers-pvp

LINE Rangers Handbook の PvP Tracker を参照し、レジェンド帯の防衛チームを集計する非公式ファンサイトです。

## 仕様
- データ取得元: https://rangers.lerico.net/ja/pvp-tracker の公開PvP API
- 画面の画像要素ではなく、公開APIの `unitCode` を直接集計します。遅延読み込み・画面外表示・分割行による取りこぼしを防ぎ、1体だけ編成されたキャラクターも集計対象です。
- GitHub Actions は手動実行でき、取得人数・編成枠数・重複・順位・採用率・装備率・異常な急減を相互検証してからJSONを公開します。200人の情報が揃わない場合は部分データを公開せず、前回の正常JSONと更新時刻を維持します。
- キャラクターは編成数、採用人数、採用率でランキングします。同一プレイヤー内の同一キャラクター重複は編成数では加算し、採用人数では1人にまとめます。
- 装備はキャラクターごとに `WEAPON` / `ARMOR` / `ACC` を分け、装着回数、使用プレイヤー数、装備IDの順で順位を決めます。
- 前回データと比較して集計人数または総編成枠数が50%以上減った場合は、壊れたデータを公開しません。
- 主集計は混雑しにくい時刻に2回起動機会を持ち、50分の鮮度判定で約1時間に1回だけ収集します。別ワークフローの監視処理が55分以上古いデータを検知すると、主集計を再起動します。
- 主集計は `repository_dispatch` の `collect-pvp-data` にも対応しています。GitHub外のタイマーから同じ品質ゲート付き集計を起動でき、外部側の認証情報をリポジトリへ保存する必要はありません。
- 各キャラクターには前回比を付与し、個人を特定できるIDを含まない軽量履歴を最大744回（約31日）保持します。履歴が揃っている場合は、順位セルに1日・1週間・1ヶ月の変位を表示します。比較期間の履歴が欠けている場合は推測せず表示しません。
- キャラクターを開くと、軽量履歴から過去24時間の採用率推移を表示します。履歴JSONは必要になった時だけ読み込み、通常のランキング表示を重くしません。
- 成功データには集計全体と200人の詳細取得にかかった時間を記録します。遅延がスケジュール待ちか取得処理の長時間化かを後から区別できます。
- 画面は最新JSONをキャッシュせず最大3回再試行し、10分ごと・タブ復帰時・通信復帰時に自動で再確認します。再取得に失敗しても表示中の正常データを消しません。

## 自動更新の構成

- `.github/workflows/update-character-usage.yml`: 品質テスト、集計、正常データの保存、Pages公開
- `.github/workflows/watch-character-usage.yml`: 更新時刻と完全取得（200/200人・取得エラー0）を独立確認し、異常時に主集計を再起動
- `scripts/check_data_freshness.py`: 両ワークフローで共用する鮮度判定
- `docs/data/character_usage_history.json`: 集計成功時だけ追加される軽量履歴
- `infra/cloudflare-watchdog/`: GitHubの定時イベント停止を補う外部タイマー

GitHub外のタイマーを接続する場合は、外部サービス側からGitHub APIの
`workflow_dispatch` を1時間ごとに送信します。Cloudflare用の実装は
`infra/cloudflare-watchdog/` にあり、JSONが55分以上古い時、または完全取得の品質条件を満たさない時だけ起動します。
トークンは `Actions: write` の最小権限で外部サービスのシークレットに保存し、
コードやPagesには置きません。

## 開発
```bash
pip install -r requirements.txt
pytest -q
node --test tests/test_cloudflare_watchdog.mjs
python scripts/scrape_character_usage.py
```
