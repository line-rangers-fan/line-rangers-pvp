import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const data=JSON.parse(await readFile(new URL('../public/pvp/data/character_usage.json',import.meta.url),'utf8'));

test('committed PvP snapshot is a complete Legend top-200 sample',()=>{
  assert.equal(data.target_players,200);
  assert.equal(data.sampled_players,200);
  assert.equal(data.complete_target,true);
  assert.equal(data.collection_quality?.sample_coverage,100);
  assert.equal(data.collection_quality?.detail_fetch_failures,0);
  assert.ok(data.character_slots>=1500&&data.character_slots<=2000);
  assert.ok(data.characters.length>=10);
});

test('snapshot contains the exact ultimate Sally target and trusted images',()=>{
  const sally=data.characters.find(row=>row.unit_code==='u1631e-sally');
  assert.ok(sally,'u1631e-sally must be present in the current Legend sample');
  assert.equal(sally.image,'https://rangers.lerico.net/res/u1631e-sally/u1631e-sally-thum.png');
  for(const row of data.characters){
    assert.match(row.image,/^https:\/\/rangers\.lerico\.net\/res\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+-thum\.png$/);
    for(const type of ['WEAPON','ARMOR','ACC']){
      for(const item of row.equipment_rankings?.[type]?.items||[]){
        assert.match(item.image,/^https:\/\/rangers\.lerico\.net\/res\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+-icon\.png$/);
      }
    }
  }
});

test('browser-facing snapshot contains no private repository dependency',()=>{
  const serialized=JSON.stringify(data);
  assert.doesNotMatch(serialized,/raw\.githubusercontent\.com/);
  assert.doesNotMatch(serialized,/line-rangers-fan\.github\.io/);
  assert.match(serialized,/rangers\.lerico\.net/);
});
