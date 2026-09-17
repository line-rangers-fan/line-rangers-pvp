import {readFile,writeFile} from 'node:fs/promises';

await import('./apply-media-group-post-fix-v2.mjs?run='+Date.now());

const testsPath='tests/community.test.mjs';
let tests=await readFile(testsPath,'utf8');
const oldAssertion="assert.ok(communitySource.indexOf('<p className=\"post-body\">')<communitySource.indexOf('{detail&&(p.video||p.mediaType?.startsWith(\\'video/\\'))'));";
const newAssertion="assert.ok(communitySource.indexOf('<p className=\"post-body\">')<communitySource.indexOf('{detail&&videoItems.length>0'));";
if(!tests.includes(oldAssertion))throw new Error('Legacy video ordering assertion was not found.');
tests=tests.replace(oldAssertion,newAssertion);
const badNow="const group=crypto.randomUUID();const now=Date.now();";
const goodNow="const group=crypto.randomUUID();let now=Date.now();";
if(!tests.includes(badNow))throw new Error('Grouped-media test timestamp declaration was not found.');
tests=tests.replace(badNow,goodNow);
await writeFile(testsPath,tests,'utf8');
console.log('Grouped media v3 test alignment applied.');
