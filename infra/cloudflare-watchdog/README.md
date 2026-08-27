# Cloudflare external freshness watchdog

GitHubの定時イベント自体が発生しない場合に備える、GitHub外の監視処理です。
毎時27分に公開JSONを確認し、最終更新から55分以上経過した時だけ
`update-character-usage.yml` を起動します。

## 必要なシークレット

Cloudflare Workerのシークレット `GITHUB_ACTIONS_TOKEN` に、対象リポジトリ
だけへアクセスできるGitHub fine-grained personal access tokenを登録します。
必要な権限は `Actions: write` です。トークンを `wrangler.toml`、GitHub、
Pages、ログへ保存しないでください。

## 配置

Cloudflareへ接続した環境で、このディレクトリをWorkerとして配置します。
CLIを使う場合は次の順です。

```bash
npx wrangler secret put GITHUB_ACTIONS_TOKEN
npx wrangler deploy
```

Cloudflare CronはUTC基準です。`27 * * * *` は毎時27分に実行されます。
