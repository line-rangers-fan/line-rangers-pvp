import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const gitBlobSha=text=>createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');

const SOURCE_STYLE_BLOB='60679caa61a9a440856ee068601048df4783ae13';

test('root still launches the restored PvP surface',async()=>{
  const [page,launcher]=await Promise.all([read('app/page.tsx'),read('app/original-pvp-launcher.tsx')]);
  assert.match(page,/OriginalPvpLauncher/);
  assert.match(launcher,/\/pvp\/index\.html/);
});

test('PvP shell mirrors the current Owner Preview while preserving the original stylesheet',async()=>{
  const [html,css,communityCss,communityJs]=await Promise.all([
    read('public/pvp/index.html'),
    read('public/pvp/assets/style.css'),
    read('public/pvp/assets/community-entry.css'),
    read('public/pvp/assets/community-entry.js'),
  ]);
  assert.equal(gitBlobSha(css),SOURCE_STYLE_BLOB,'style.css must remain the original PvP stylesheet');
  assert.match(html,/UNOFFICIAL STATISTICS/);
  assert.match(html,/レジェンド帯 キャラ集計/);
  assert.match(html,/id="community-board-entry-slot"/);
  assert.match(html,/community-entry\.css/);
  assert.match(html,/community-entry\.js/);
  assert.doesNotMatch(html,/maintenance-mode/);
  assert.doesNotMatch(html,/maintenance-screen/);
  assert.doesNotMatch(html,/maintenance\.css/);
  assert.match(html,/id="summary"/);
  assert.match(html,/id="ranking-body"/);
  assert.match(html,/id="equipment-dialog"/);
  assert.match(html,/data-rank-period="hour"/);
  assert.match(html,/data-rank-period="day"/);
  assert.match(html,/data-rank-period="week"/);
  assert.match(html,/data-rank-period="month"/);
  assert.match(communityCss,/community-board-entry-card/);
  assert.match(communityCss,/community-bridge-link\s*\{\s*display:none !important/);
  assert.match(communityJs,/u1631e-sally/);
  assert.match(communityJs,/topicBoardUrl/);
  assert.match(communityJs,/button\.href = firstTopicUrl \|\| url/);
  assert.match(communityJs,/\/boards/);
});

test('review UX keeps the update time and ranking rows compact',async()=>{
  const [html,communityCss]=await Promise.all([
    read('public/pvp/index.html'),
    read('public/pvp/assets/community-entry.css'),
  ]);
  assert.match(html,/community-entry\.css\?v=20260916-ui-2/);
  assert.match(html,/app\.js\?v=20260916-ui-1/);
  assert.match(html,/community-entry\.js\?v=20260916-ui-2/);
  assert.match(communityCss,/\.summary-updated-value\s*\{[\s\S]*?font-size:\s*clamp\(1\.45rem,\s*4vw,\s*2\.1rem\)/);
  assert.match(communityCss,/\.ranking-section \.character-image\s*\{[\s\S]*?width:\s*3rem/);
  assert.match(communityCss,/\.ranking-section \.rate-track\s*\{[\s\S]*?display:\s*none !important/);
});

test('runtime preserves original image-first table and keeps the local board route available',async()=>{
  const js=await read('public/pvp/assets/app.js');
  assert.match(js,/Faithful runtime for the pre-maintenance PvP surface/);
  assert.match(js,/className = "character-button"/);
  assert.match(js,/className = "rank-number"/);
  assert.match(js,/className = "rate-track"/);
  assert.match(js,/className = "rate-bar"/);
  assert.match(js,/showModal\(\)/);
  assert.match(js,/community-bridge-link/);
  assert.match(js,/href = "\/boards"/);
});

test('public review serves built browser assets before dynamic Worker routes',async()=>{
  const config=await read('wrangler.jsonc');
  assert.match(config,/"binding":\s*"ASSETS"/);
  assert.match(config,/"not_found_handling":\s*"none"/);
  assert.doesNotMatch(config,/"run_worker_first":\s*true/);
});

test('ranking browser reads only the isolated local validated snapshot',async()=>{
  const js=await read('public/pvp/assets/app.js');
  assert.match(js,/\.\/data\/character_usage\.json/);
  assert.match(js,/equipment_rankings/);
  assert.match(js,/WEAPON/);
  assert.match(js,/ARMOR/);
  assert.match(js,/ACC/);
  assert.match(js,/TARGET_PLAYERS = 200/);
  assert.match(js,/complete_target !== true/);
  assert.doesNotMatch(js,/raw\.githubusercontent\.com/);
  assert.doesNotMatch(js,/line-rangers-fan\.github\.io/);
});

test('collector fails closed unless all 200 Legend players validate',async()=>{
  const [collector,workflow]=await Promise.all([read('scripts/collect-pvp.mjs'),read('.github/workflows/refresh-pvp-data.yml')]);
  assert.match(collector,/const TARGET=200/);
  assert.match(collector,/api\/v2\/pvp\/league\/rank\/LEGEND/);
  assert.match(collector,/api\/getPlayer/);
  assert.match(collector,/refusing partial ranking/);
  assert.match(collector,/refusing incomplete player details/);
  assert.match(collector,/public\/pvp\/data\/character_usage\.json/);
  assert.match(workflow,/cron: '17 \* \* \* \*'/);
  assert.match(workflow,/permissions:\n  contents: write/);
  for(const path of [
    'public/pvp/data/character_usage.json',
    'public/pvp/data/character_usage_history.json',
    'config/community-characters.json',
    'data/community-character-discovery.json',
  ]) assert.match(workflow,new RegExp(path.replace(/[./-]/g,'\\$&')));
  assert.match(workflow,/git diff --cached --quiet/);
});
