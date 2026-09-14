import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../infra/cloudflare-owner-preview/src/index.js', import.meta.url), 'utf8');

assert.match(source, /application\/javascript; charset=utf-8/);
assert.match(source, /text\/css; charset=utf-8/);
assert.match(source, /application\/json; charset=utf-8/);
assert.match(source, /headers\.delete\("content-length"\)/);
assert.match(source, /headers\.delete\("content-encoding"\)/);
assert.match(source, /"x-content-type-options": "nosniff"/);

assert.match(source, /__Host-lr_owner_preview_v2/);
assert.match(source, /SESSION_MAX_AGE_SECONDS = 3600/);
assert.match(source, /HttpOnly; Secure; SameSite=Strict/);
assert.match(source, /MAX_FAILED_ATTEMPTS = 5/);
assert.match(source, /LOCKOUT_MS = 15 \* 60 \* 1000/);
assert.match(source, /constantTimeEqualHex/);
assert.doesNotMatch(source, /3e422c299a6cae56999f3cc01b0c96bafeb7b880701ab048c1e96198067416e3/);
assert.doesNotMatch(source, /line-rangers-community-dev/);
assert.doesNotMatch(source, /chatgpt\.site/);

console.log('owner preview security and MIME guards: ok');
