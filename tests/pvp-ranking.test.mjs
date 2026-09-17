import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
function compile(path, require) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, require);
  return exports;
}

test('PvP adapter only exposes the confirmed Sally ranking projection', async () => {
  const rules = compile('lib/rules.ts', () => ({}));
  const route = compile('app/api/pvp/route.ts', id => {
    if (id === '@/lib/rules') return rules;
    throw new Error(`unexpected import ${id}`);
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    updated_at: '2026-09-15T00:00:00.000Z', target_players: 200, sampled_players: 200,
    complete_target: true, collection_quality: { sample_coverage: 100 },
    characters: [{ unit_code: 'u1631e-sally', name: 'サリー', rank: 12, occurrence_count: 62,
      player_count: 62, adoption_rate: 31, slot_rate: 3.12,
      equipment_rankings: { WEAPON: { equipped_occurrence_count: 62, equipped_player_count: 62,
        items: [{ item_code: 'eq_1', image: 'https://rangers.lerico.net/res/gear_icon/eq_1.png', rank: 1, occurrence_count: 10, player_count: 10, adoption_rate: 16.1 }]
      } }
    }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const response = await route.GET(new Request('https://review.example/api/pvp?month=2026-09&character=u1631e-sally'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const data = await response.json();
    assert.equal(data.character.unitCode, 'u1631e-sally');
    assert.equal(data.character.name, 'かに座 サリー');
    assert.equal(data.character.rank, 12);
    assert.equal(data.character.equipmentRankings.WEAPON.items[0].itemCode, 'eq_1');
    assert.equal('characters' in data, false);
    const wrong = await route.GET(new Request('https://review.example/api/pvp?month=2026-09&character=spoof'));
    assert.equal(wrong.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('PvP upstream JSON is bounded before parsing',()=>{
 const routeSource=readFileSync(new URL('../app/api/pvp/route.ts',import.meta.url),'utf8');
 assert.match(routeSource,/UPSTREAM_MAX_BYTES=4\*1024\*1024/);
 assert.match(routeSource,/response\.body\.getReader\(\)/);
 assert.match(routeSource,/size>UPSTREAM_MAX_BYTES/);
});
