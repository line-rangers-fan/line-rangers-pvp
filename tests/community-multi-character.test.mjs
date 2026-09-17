import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {updateCommunityCharacters} from '../scripts/update-community-characters.mjs';

function snapshot(updatedAt,rows,{complete=true,sampled=200}={}){
 return {
  complete_target:complete,
  target_players:200,
  sampled_players:sampled,
  updated_at:updatedAt,
  characters:rows,
 };
}

const rows=[
 {unit_code:'u2000e-alpha',name:'新キャラ Alpha',image:'https://rangers.lerico.net/res/u2000e-alpha/u2000e-alpha-thum.png',rank:4,adoption_rate:24.5},
 {unit_code:'u2001e-beta',name:'新キャラ Beta',image:'https://rangers.lerico.net/res/u2001e-beta/u2001e-beta-thum.png',rank:11,adoption_rate:12.0},
 {unit_code:'u2002e-gamma',name:'新キャラ Gamma',image:'https://rangers.lerico.net/res/u2002e-gamma/u2002e-gamma-thum.png',rank:null,adoption_rate:null},
];
const noLegacy={ids:[]};
function initialState(){return {schemaVersion:1,initialized:true,initializedAt:'2026-09-30T14:00:00.000Z',lastSnapshotAt:'2026-09-30T14:00:00.000Z',knownIds:['u1000e-old'],candidates:{}};}

async function threeConfirmedSnapshots({candidateRows=rows,legacyKnown=noLegacy,probe=async()=>true}={}){
 let registry={schemaVersion:1,characters:[]};
 let state=initialState();
 let result;
 for(const updatedAt of ['2026-10-01T00:00:00+09:00','2026-10-01T01:00:00+09:00','2026-10-01T02:00:00+09:00']){
  result=await updateCommunityCharacters({snapshot:snapshot(updatedAt,candidateRows),history:{snapshots:[]},registry,state,legacyKnown,probe});
  registry=result.registry;state=result.state;
 }
 return result;
}

test('multiple new characters are confirmed together without replacing each other',async()=>{
 const final=await threeConfirmedSnapshots();
 assert.deepEqual(final.promoted.map(topic=>topic.id),['u2000e-alpha','u2001e-beta','u2002e-gamma']);
 assert.deepEqual(final.registry.characters.map(topic=>topic.id),['u2000e-alpha','u2001e-beta','u2002e-gamma']);
 assert.equal(new Set(final.registry.characters.map(topic=>topic.id)).size,3);
 assert.ok(final.registry.characters.every(topic=>topic.releaseMonth==='2026-10'&&topic.confirmed===true));
 assert.equal(final.registry.characters.at(-1).pvpRank,null,'confirmed character without PvP rank stays last');
});

test('historical character IDs cannot be promoted again when they reappear in PvP',async()=>{
 const legacyRow={unit_code:'u1630e-sally',name:'過去キャラ',image:'https://rangers.lerico.net/res/u1630e-sally/u1630e-sally-thum.png',rank:1,adoption_rate:50};
 const final=await threeConfirmedSnapshots({candidateRows:[legacyRow],legacyKnown:{ids:['u1630e-sally']}});
 assert.deepEqual(final.promoted,[]);
 assert.deepEqual(final.registry.characters,[]);
 assert.equal(final.state.candidates['u1630e-sally'],undefined);
 assert.ok(final.state.knownIds.includes('u1630e-sally'));
});

test('automatic topic promotion fails closed on partial PvP samples',async()=>{
 await assert.rejects(()=>updateCommunityCharacters({
  snapshot:snapshot('2026-10-01T00:00:00+09:00',rows,{sampled:199}),
  history:{snapshots:[]},registry:{schemaVersion:1,characters:[]},state:initialState(),legacyKnown:noLegacy,probe:async()=>true,
 }),/refusing incomplete PvP snapshot/);
});

test('unverified character images never accumulate a promotion streak',async()=>{
 const final=await threeConfirmedSnapshots({candidateRows:[rows[0]],probe:async()=>false});
 assert.deepEqual(final.promoted,[]);
 assert.equal(final.registry.characters.length,0);
 assert.equal(final.state.candidates['u2000e-alpha'].imageVerified,false);
 assert.equal(final.state.candidates['u2000e-alpha'].consecutive,0);
});

test('board API backfills later confirmed topics and preserves PvP topic order',()=>{
 const source=readFileSync(new URL('../app/api/board/route.ts',import.meta.url),'utf8');
 assert.match(source,/const missingTopics=confirmedTopics\.filter\(c=>!existingCharacters\.has\(c\.id\)\)/);
 assert.match(source,/db\.batch\(missingTopics\.map\(/);
 assert.match(source,/boards=confirmedTopics\.flatMap\(/);
 assert.doesNotMatch(source,/requested===current&&!boards\.length&&confirmedTopics\.length/);
});
