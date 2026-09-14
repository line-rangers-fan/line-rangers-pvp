import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../infra/cloudflare-owner-preview/src/index.js', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../infra/cloudflare-owner-preview/wrangler.toml', import.meta.url), 'utf8');

assert.match(source, /application\/javascript; charset=utf-8/);
assert.match(source, /text\/css; charset=utf-8/);
assert.match(source, /application\/json; charset=utf-8/);
assert.match(source, /headers\.delete\("content-length"\)/);
assert.match(source, /headers\.delete\("content-encoding"\)/);
assert.match(source, /"x-content-type-options": "nosniff"/);
assert.match(source, /"x-robots-tag": "noindex, nofollow, noarchive, nosnippet"/);

assert.match(source, /env\?\.ASSETS\?\.fetch/);
assert.match(source, /env\.ASSETS\.fetch/);
assert.match(source, /data-repo-preview="true"/);
assert.match(source, /\["GET", "HEAD"\]/);
assert.match(source, /stripMaintenance/);
assert.doesNotMatch(source, /OWNER_TOKEN/);
assert.doesNotMatch(source, /COOKIE_NAME/);
assert.doesNotMatch(source, /loginPage/);
assert.doesNotMatch(source, /tokenMatches/);
assert.doesNotMatch(source, /raw\.githubusercontent\.com/);
assert.doesNotMatch(source, /chatgpt\.site/);

assert.match(wrangler, /directory = "\.\.\/\.\.\/docs"/);
assert.match(wrangler, /binding = "ASSETS"/);
assert.match(wrangler, /run_worker_first = true/);

console.log('no-login private-repo preview, security, and MIME guards: ok');
