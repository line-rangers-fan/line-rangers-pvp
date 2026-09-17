import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
function compile(path,require){const source=readFileSync(new URL(path,root),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',code)(exports,require);return exports;}
const rules=compile('lib/rules.ts',()=>({}));

test('public Cloudflare edge ignores client asserted authenticated-user headers',async()=>{
 const env={BOARD_ANON_COOKIE_SECRET:'test-anon-cookie-secret-0123456789012345',BOARD_OWNER_SUBJECT:'owner-subject',BOARD_OWNER_ACCESS_TOKEN:'owner-token'};
 const session=compile('lib/anonymous-session.ts',id=>{if(id==='cloudflare:workers')return {env};if(id==='@/lib/rules')return rules;throw new Error('unexpected '+id);});
 const forged=await session.sessionFromHeaders(new Headers({host:'line-rangers-pvp-community-review.n-yu1791.workers.dev','cf-ray':'test-ray','cf-connecting-ip':'203.0.113.10','oai-authenticated-user-id':'owner-subject'}));
 assert.equal(forged.anonymous,true);
 assert.notEqual(forged.sub,'owner-subject');
 const harness=await session.sessionFromHeaders(new Headers({host:'review.example','oai-authenticated-user-id':'integration-user'}));
 assert.equal(harness.anonymous,false);
 assert.equal(harness.sub,'integration-user');
});

test('Owner cookie is cryptographically bound to the configured Owner subject',async()=>{
 const env={BOARD_ANON_COOKIE_SECRET:'test-anon-cookie-secret-0123456789012345',BOARD_OWNER_SUBJECT:'owner-a',BOARD_OWNER_ACCESS_TOKEN:'owner-token'};
 const session=compile('lib/anonymous-session.ts',id=>{if(id==='cloudflare:workers')return {env};if(id==='@/lib/rules')return rules;throw new Error('unexpected '+id);});
 const activated=await session.activateOwner('owner-token');assert.ok(activated?.setCookie);
 const cookie=activated.setCookie.split(';')[0];
 const verified=await session.sessionFromHeaders(new Headers({cookie}));
 assert.equal(verified.owner,true);assert.equal(verified.sub,'owner-a');
 env.BOARD_OWNER_SUBJECT='owner-b';
 const rotated=await session.sessionFromHeaders(new Headers({cookie}));
 assert.equal(rotated.owner,undefined);assert.equal(rotated.anonymous,true);assert.notEqual(rotated.sub,'owner-b');
});


test('original-production promotion is manual and explicitly gated',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/migrate-original-community-production.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/^  push:/m);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/PROMOTE_COPY_TO_ISOLATED_PRODUCTION/);
 assert.match(workflow,/environment: original-production-promotion/);
});
