# line-rangers-pvp

LINE Rangers Handbook の PvP Tracker を参照し、レジェンド帯の防衛チームを集計する非公式ファンサイトです。

## 仕様
- データ取得元: https://rangers.lerico.net/ja/pvp-tracker
- GitHub Actions は毎時実行し、取得人数・編成枠数・重複・異常な急減を検証してからJSONを公開します。
- キャラクターは編成数、採用人数、採用率でランキングします。同一プレイヤー内の同一キャラクター重複は編成数では加算し、採用人数では1人にまとめます。
- 装備はキャラクターごとに `WEAPON` / `ARMOR` / `ACC` を分け、装着回数、使用プレイヤー数、装備IDの順で順位を決めます。
- 前回データと比較して集計人数または総編成枠数が50%以上減った場合は、壊れたデータを公開しません。

## 開発
```bash
pip install -r requirements.txt
pytest -q
python scripts/scrape_character_usage.py
```
