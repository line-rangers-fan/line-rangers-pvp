# LINEレンジャーPvP統計 運用・復旧手順

このサイトは通常、人手なしで動作します。編成データ、キャラ名、画像は役割を分離しているため、名前や画像の配信障害だけで200人集計を止めません。

## 通常時の自動動作

1. Cloudflare Workerが15分ごとに公開品質と更新時刻を確認します。
2. GitHub側の独立監視も毎時7分・37分に確認します。
3. 主集計は上位200人全員の編成詳細を取得し、構造・件数・採用率・装備・比較を検証します。
4. 正常な場合だけJSONと履歴を更新します。不完全な場合は前回の正常データを残します。
5. キャラ名APIが停止している場合は前回の正常名を保持し、新キャラだけコード表示で集計を継続します。
6. 正規画像が取得できたキャラはPNGをサイト内へ自動保存します。未配信画像は集計を止めず、次回以降に再試行します。
7. 主集計がすでに待機中・実行中なら、Workerと独立監視は同じ復旧要求を重ねません。実行状態を確認できない場合は、復旧を止めないため要求を継続します。
8. 主集計が2回連続で失敗すると、GitHubに障害Issueを1件だけ自動作成します。正常な200人集計が成功すると、復旧記録を残して自動で閉じます。

## 最初に見る場所

- 公開サイト: https://line-rangers-fan.github.io/line-rangers-pvp/
- 軽量品質情報: https://line-rangers-fan.github.io/line-rangers-pvp/data/character_usage_health.json
- 主集計: https://github.com/line-rangers-fan/line-rangers-pvp/actions/workflows/update-character-usage.yml
- 独立監視: https://github.com/line-rangers-fan/line-rangers-pvp/actions/workflows/watch-character-usage.yml
- 連続障害の監視: https://github.com/line-rangers-fan/line-rangers-pvp/actions/workflows/guard-collection-incidents.yml
- Worker配備: https://github.com/line-rangers-fan/line-rangers-pvp/actions/workflows/deploy-cloudflare-watchdog.yml

正常な品質情報の目安は、sampled_players: 200、complete_target: true、validated_full_sample: true、detail_fetch_failures: 0、equipment_fill_rateが0より大きいことです。装備1枠ごとの未装備は正常として許容しますが、装備全消失・カテゴリ全消失・前回から80%以上の急落は情報源の構造異常として前回データを維持します。character_assets.pending_imagesやcharacter_metadata.pending_namesが残っていても、編成集計が正常なら公開を続けます。

## 更新が遅れた場合

1. 主集計ページを開き、直近の実行結果を確認します。
2. 実行中または待機中なら完了を待ちます。監視処理は重複する復旧要求を追加しません。
3. 実行が無い、または失敗している場合は「Run workflow」を押します。
4. Branchはmain、force_collectionは有効のまま実行します。
5. 約1〜20分後、主集計が成功し、公開サイトの更新時刻が進んだことを確認します。

失敗時にはActionsのdebug-artifactsへ、個人IDを含まないcollection_failure.jsonが保存されます。stageは停止段階、previous_data_retained: trueは前回データを守れたことを示します。

## 自動で復旧しない場合

1. 「自動集計の連続障害を検出しました」というIssueを開き、記載された直近2回の実行を確認します。
2. 主集計が実行中・待機中なら、Run workflowを繰り返し押さず完了を待ちます。
3. 実行中の主集計が無い場合だけ、main・force_collection有効で1回手動実行します。
4. 同じstageで再び失敗した場合は、情報源の応答またはコード変更を確認します。品質条件を緩めて公開を通してはいけません。

単発の失敗は既存の複数監視経路が自動再試行するためIssueを作りません。連続失敗中も前回の正常公開データは維持されます。

## 新キャラの名前・画像が無い場合

- キャラ数は画像ではなくAPIのunitCodeで集計するため、新キャラも自動で数えます。
- 正規名が未配信ならコードまたは既知の暫定名を表示し、毎回の集計で正規名を再確認します。
- 正規PNGが未配信なら「画像準備中」または確認済み暫定画像を表示します。
- 正規PNGが配信されると次回集計で自動保存され、サイトは自動的に正規画像へ切り替わります。
- 新キャラごとのコード修正や画像URLの手入力は原則不要です。

## 変更してはいけない基準

- 200人全員を取得できない結果を公開しない。
- キャラの編成数は実際の体数、採用人数はプレイヤー単位で数える。
- 装備は武器・防具・アクセサリーを分け、装備された体数分を数える。
- 1時間比較の30〜90分範囲を狭めない。
- JST締めの23時台優先・22時台フォールバックを変えない。
- 履歴の6時間・40日・最大96件を減らさない。
- 個人ID、トークン、シークレットをログ・履歴・公開JSONへ追加しない。

復旧のために品質条件を外したり、公開JSONを直接編集したりしないでください。正常な前回データを残したまま、主集計を手動実行するのが安全な復旧方法です。
