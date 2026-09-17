import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const root=new URL('../',import.meta.url);
function compile(path,require){
  const source=readFileSync(new URL(path,root),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  new Function('exports','require',code)(exports,require);
  return exports;
}

const rules=compile('lib/rules.ts',()=>({}));
const upload=compile('lib/upload-session.ts',id=>{
  if(id==='@/db/raw')return {database:()=>{throw new Error('database should not be used in pure upload helper tests');}};
  if(id==='@/lib/rules')return rules;
  if(id==='@/lib/anonymous-session')return {guestName:()=> 'ゲスト-TEST',sessionFromHeaders:async()=>({sub:'test'})};
  throw new Error('Unexpected upload-session import '+id);
});

const legacySource=readFileSync(new URL('app/api/upload/route.ts',root),'utf8');
const sessionSource=readFileSync(new URL('app/api/upload/session/route.ts',root),'utf8');
const partSource=readFileSync(new URL('app/api/upload/part/route.ts',root),'utf8');
const completeSource=readFileSync(new URL('app/api/upload/complete/route.ts',root),'utf8');
const workerSource=readFileSync(new URL('worker/index.ts',root),'utf8');

async function drain(stream){
  const reader=stream.getReader();
  try{for(;;){const {done}=await reader.read();if(done)return;}}
  finally{reader.releaseLock();}
}

test('upload request identifiers, filenames and part boundaries are bounded',()=>{
  const request='01234567-89ab-4cde-8fab-0123456789ab';
  assert.equal(upload.requestId(request),request);
  for(const value of ['', 'not-a-request-id', '../'.repeat(20), 'g'.repeat(36)])assert.throws(()=>upload.requestId(value),/invalid_request/);

  assert.equal(upload.safeMediaName(' folder/clip.mp4 '),'folder_clip.mp4');
  assert.equal(upload.safeMediaName('写真\\sample.png'),'写真_sample.png');
  for(const value of ['', ' '.repeat(4), 'x'.repeat(121), 'bad\u0000name.mp4'])assert.throws(()=>upload.safeMediaName(value),/invalid_media/);

  assert.equal(upload.expectedPartSize(1,rules.mediaPartBytes),rules.mediaPartBytes);
  assert.equal(upload.expectedPartSize(1,rules.mediaPartBytes+1),rules.mediaPartBytes);
  assert.equal(upload.expectedPartSize(2,rules.mediaPartBytes+1),1);
  assert.equal(upload.expectedPartSize(25,rules.maxMediaBytes),rules.mediaPartBytes);
  for(const part of [0,-1,2.5,26])assert.throws(()=>upload.expectedPartSize(part,rules.maxMediaBytes),/invalid_media/);
});

test('stream monitor rejects short and oversized chunks and preserves the media prefix',async()=>{
  const bytes=Uint8Array.from({length:32},(_,i)=>i);
  const exact=upload.captureAndCount(new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),32,16);
  await drain(exact.stream);
  assert.equal(exact.getSize(),32);
  assert.deepEqual([...exact.getPrefix()],[...bytes.slice(0,16)]);

  const tooLong=upload.captureAndCount(new ReadableStream({start(controller){controller.enqueue(Uint8Array.from({length:33},(_,i)=>i));controller.close();}}),32,16);
  await assert.rejects(()=>drain(tooLong.stream),/invalid_media/);

  const tooShort=upload.captureAndCount(new ReadableStream({start(controller){controller.enqueue(Uint8Array.from({length:31},(_,i)=>i));controller.close();}}),32,16);
  await assert.rejects(()=>drain(tooShort.stream),/invalid_media/);
});

test('first chunk header validation recognizes supported image and video signatures',()=>{
  const png=new Uint8Array(16);png.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  assert.equal(upload.headerMatches('image/png',png),true);
  assert.equal(upload.headerMatches('image/jpeg',png),false);

  const mp4=new Uint8Array(16);mp4.set([0x66,0x74,0x79,0x70],4);
  assert.equal(upload.headerMatches('video/mp4',mp4),true);
  assert.equal(upload.headerMatches('video/quicktime',mp4),true);
});

test('resumable upload routes keep same-origin, expiry, size and completion gates',()=>{
  assert.match(sessionSource,/assertSameOrigin\(request,h\)/);
  assert.match(partSource,/assertSameOrigin\(request,h\)/);
  assert.match(completeSource,/assertSameOrigin\(request,h\)/);
  assert.match(legacySource,/origin!==new URL\(request\.url\)\.origin/);

  assert.match(sessionSource,/uploadSessionExpired\(existing\)/);
  assert.match(sessionSource,/createMultipartUpload/);
  assert.match(sessionSource,/resumeMultipartUpload\(row\.media_key,row\.upload_id\)\.abort\(\)/);
  assert.match(workerSource,/SELECT 1 FROM posts WHERE media_key=\?/);assert.match(workerSource,/BUCKET\.delete\(row\.media_key\)/);
  assert.match(partSource,/expectedPartSize\(part,session\.media_size\)/);
  assert.match(partSource,/captureAndCount\(request\.body,expected,16\)/);
  assert.match(partSource,/headerMatches\(session\.media_type,monitored\.getPrefix\(\)\)/);
  assert.match(partSource,/await upload\.abort\(\)/);
  assert.match(partSource,/status='failed'/);assert.match(partSource,/e\.message==='invalid_media'/);

  assert.match(completeSource,/rows\.length!==count/);
  assert.match(completeSource,/row\.part_number!==index\+1/);
  assert.match(completeSource,/bucket\(\)\.head\(session\.media_key\)/);
  assert.match(completeSource,/multipart\.complete/);
  assert.match(completeSource,/db\.batch\(/);
  assert.match(completeSource,/SELECT id FROM posts WHERE author=\? AND request=\?/);
});

test('legacy upload rejects a sixth grouped attachment before writing an R2 object',()=>{
  const groupGuard=legacySource.indexOf('if(mediaGroup){const grouped=');
  const bucketWrite=legacySource.indexOf('await bucket().put');
  assert.ok(groupGuard>=0,'media group guard must exist');
  assert.ok(bucketWrite>groupGuard,'R2 write must happen only after the group-limit guard');
  assert.match(legacySource,/await bucket\(\)\.delete\(key\)/);
});
