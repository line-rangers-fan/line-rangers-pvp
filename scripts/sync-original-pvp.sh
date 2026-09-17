#!/usr/bin/env bash
set -euo pipefail

# Pin the last complete pre-maintenance PvP UI. The live repository's current
# index intentionally contains the maintenance shell, so copying main would
# reproduce the broken/closed page instead of the original ranking site.
SOURCE_REPO="line-rangers-fan/line-rangers-pvp"
SOURCE_COMMIT="517291dfa3f9eeaecd8b6c6f1d445da52f0480ac"
PROJECT_ROOT="${SITES_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST="${PROJECT_ROOT}/public/pvp"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

command -v curl >/dev/null || { echo 'curl is required to sync the original PvP site.' >&2; exit 69; }
command -v tar >/dev/null || { echo 'tar is required to sync the original PvP site.' >&2; exit 69; }

ARCHIVE="${TMP}/source.tar.gz"
EXTRACT="${TMP}/extract"
mkdir -p "${EXTRACT}"

echo "Syncing original PvP UI from ${SOURCE_REPO}@${SOURCE_COMMIT}..."
curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 90 \
  "https://codeload.github.com/${SOURCE_REPO}/tar.gz/${SOURCE_COMMIT}" \
  --output "${ARCHIVE}"
tar -xzf "${ARCHIVE}" -C "${EXTRACT}"
SOURCE_ROOT="$(find "${EXTRACT}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "${SOURCE_ROOT}" && -d "${SOURCE_ROOT}/docs" ]] || { echo 'Original PvP docs directory was not found.' >&2; exit 70; }

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp -a "${SOURCE_ROOT}/docs/." "${DEST}/"

# Current data is served through same-origin route handlers instead of freezing
# a build-time snapshot. Keep the copied UI/assets exact while the ranking data
# remains the canonical live source.
rm -f \
  "${DEST}/data/character_usage.json" \
  "${DEST}/data/character_usage_history.json"

INDEX="${DEST}/index.html"
node --input-type=module - "${INDEX}" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const path=process.argv[2];
let html=readFileSync(path,'utf8');

// This is an Owner review copy, not the public production site. Remove only the
// maintenance overlay; keep noindex/nofollow and all original ranking markup.
html=html.replace(/\s*<link rel="stylesheet" href="\.\/assets\/maintenance\.css[^>]*>/,'');
html=html.replace('<body class="maintenance-mode">','<body>');
html=html.replace(/\s*<section class="maintenance-screen"[\s\S]*?<\/section>/,'');
html=html.replace("frame-ancestors 'none';","frame-ancestors 'self';");

// Replace the old external-board loader with a same-site board entry. The
// original PvP ranking remains untouched below this slot.
html=html.replace(/\s*<script src="\.\/assets\/community-entry\.js[^>]*><\/script>/,'');
const card=`<div id="community-board-entry-slot" class="community-board-entry-slot">
  <section class="community-board-entry-card" aria-labelledby="community-board-entry-title">
    <div class="community-board-entry-heading"><span class="community-board-entry-marker" aria-hidden="true">●</span><div class="community-board-entry-heading-text"><h2 id="community-board-entry-title" class="community-board-entry-title">新キャラ情報掲示板</h2><p class="community-board-entry-description">投票・コメント・写真・動画で、新キャラについて話そう。</p></div></div>
    <div class="community-board-entry-character" data-unit-code="u1631e-sally"><img class="community-board-entry-character-image" src="./assets/characters/crab-sally-ultimate-fallback.jpg" alt="かに座 サリーのキャラクター画像" width="88" height="88"><div class="community-board-entry-character-copy"><span class="community-board-entry-character-badge">NEW CHARACTER</span><strong class="community-board-entry-character-name">かに座 サリー</strong></div></div>
    <div class="community-board-entry-featured"><strong class="community-board-entry-featured-label">新キャラ情報コミュニティ</strong><p class="community-board-entry-featured-text">評価投票、コメント、写真・動画投稿を同じサイト内で確認できます。</p></div>
    <a class="community-board-entry-button" href="/boards" target="_top" aria-label="新キャラ情報掲示板を開く">掲示板を開く →</a>
  </section>
</div>`;
html=html.replace(/<div id="community-board-entry-slot" class="community-board-entry-slot" hidden><\/div>/,card);
if(!html.includes('id="ranking-section"')||!html.includes('href="/boards"'))throw new Error('PvP copy patch contract failed');
writeFileSync(path,html);
NODE

echo "Original PvP site copied to public/pvp with the local board attached."
