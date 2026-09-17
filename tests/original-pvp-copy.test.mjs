import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const build=readFileSync(new URL('scripts/build-verified.sh',root),'utf8');
const home=readFileSync(new URL('app/page.tsx',root),'utf8');
const launcher=readFileSync(new URL('app/original-pvp-launcher.tsx',root),'utf8');
const handoff=readFileSync(new URL('WORK_OWNER_PREVIEW_HANDOFF.md',root),'utf8');
const board=readFileSync(new URL('app/community.tsx',root),'utf8');
const sourceProxy=readFileSync(new URL('lib/pvp-source-proxy.ts',root),'utf8');
const draftGuard=readFileSync(new URL('app/comment-draft-success-guard.tsx',root),'utf8');
const pvpHtml=readFileSync(new URL('public/pvp/index.html',root),'utf8');
const pvpApp=readFileSync(new URL('public/pvp/assets/app.js',root),'utf8');
const communityEntry=readFileSync(new URL('public/pvp/assets/community-entry.js',root),'utf8');

test('review build never uses unauthenticated private-repository codeload',()=>{
 assert.doesNotMatch(build,/sync-original-pvp\.sh/);
 assert.doesNotMatch(build,/codeload\.github\.com/);
 assert.match(build,/vinext.*build/s);
});

test('PvP ranking remains home and the copy is the improvement staging surface',()=>{
 assert.match(home,/OriginalPvpLauncher/);
 assert.doesNotMatch(home,/<Community\s+boardPage/);
 assert.match(launcher,/\/pvp\/index\.html/);
 assert.match(handoff,/09f829c0f136230f3839f243e69ced93fccac6bc/);
 assert.match(handoff,/元サイトは、改修内容がレビュー完了するまで\*\*読み取り専用\*\*/);
 assert.match(handoff,/ユーザー承認後、元サイトへ差分を適用/);
 assert.match(handoff,/\/boards/);
 assert.match(pvpHtml,/レジェンド帯 キャラ集計/);
 assert.match(pvpHtml,/community-board-entry-slot/);
 assert.match(pvpApp,/\.\/data\/character_usage\.json/);
 assert.match(communityEntry,/url: "\/boards"/);
});

test('board remains available, does not fetch hidden PvP ranking data, and cannot write canonical PvP',()=>{
 assert.match(board,/u1631e-sally/);
 assert.match(board,/t\.newCharacterNote/);
 assert.doesNotMatch(board,/\/api\/pvp/);
 assert.doesNotMatch(board,/pvpRankingCard|PvpData|pvpSequence/);
 assert.match(sourceProxy,/raw\.githubusercontent\.com\/line-rangers-fan\/line-rangers-pvp\/main\/docs\/data/);
 assert.match(sourceProxy,/cache:'no-store'/);
 assert.doesNotMatch(sourceProxy,/method:\s*['"]POST['"]/);
});

test('successful comment posts clear persisted drafts while failures preserve them',()=>{
 assert.match(draftGuard,/response\.ok/);
 assert.match(draftGuard,/action==='post'/);
 assert.match(draftGuard,/localStorage\.removeItem/);
 assert.doesNotMatch(draftGuard,/finally[\s\S]*removeItem/);
});
