import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../app/api/health/route.ts', import.meta.url), 'utf8');

test('health probe checks both D1 and R2 without exposing resource identifiers', () => {
  assert.match(source, /database\(\).*SELECT 1 AS ok/s);
  assert.match(source, /bucket\(\)\.list\(\{ limit: 1 \}\)/);
  assert.match(source, /X-Content-Type-Options/);
  assert.match(source, /Cache-Control/);
  assert.doesNotMatch(source, /line-rangers-copy-review-db/);
  assert.doesNotMatch(source, /line-rangers-copy-review-media/);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN/);
});
