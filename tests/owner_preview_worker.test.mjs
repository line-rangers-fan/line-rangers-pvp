import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../infra/cloudflare-owner-preview/src/index.js', import.meta.url), 'utf8');

assert.match(source, /application\/javascript; charset=utf-8/);
assert.match(source, /text\/css; charset=utf-8/);
assert.match(source, /application\/json; charset=utf-8/);
assert.match(source, /headers\.delete\("content-length"\)/);
assert.match(source, /headers\.delete\("content-encoding"\)/);
assert.match(source, /x-content-type-options", "nosniff"/);

console.log('owner preview worker MIME guard: ok');
