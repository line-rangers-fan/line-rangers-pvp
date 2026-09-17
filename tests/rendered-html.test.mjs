import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { File } from "node:buffer";

test("Workers runtime keeps the PvP shell free of the obsolete community entry and supports anonymous browsing", async () => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../dist/server/index.js", import.meta.url)),
    modulesRules: [{type:"ESModule", include:["**/*.js"]}],
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {BOARD_ANON_COOKIE_SECRET:"test-anon-cookie-secret-0123456789012345"},
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
  });
  try {
    const response = await mf.dispatchFetch("https://review.example/", {headers:{accept:"text/html"}});
    assert.equal(response.status,200);
    assert.match(response.headers.get("content-type")??"",/^text\/html/);
    const html=await response.text();
    assert.match(html,/LINEレンジャー/);
    assert.doesNotMatch(html,/href="\/boards(?:\?|\")/);
    assert.doesNotMatch(html,/line-rangers-fan\.github\.io\/line-rangers-pvp/);
    assert.doesNotMatch(html,/codex-preview/);
    const db=await mf.getD1Database('DB');
    const migrations=['../drizzle/0000_clumsy_penance.sql','../drizzle/0001_talented_gabe_jones.sql','../drizzle/0002_true_purifiers.sql','../drizzle/0003_thankful_firestar.sql','../drizzle/0004_yummy_warbird.sql','../drizzle/0005_bumpy_hellcat.sql','../drizzle/0006_quick_zuras.sql','../drizzle/0007_overjoyed_scorpion.sql','../drizzle/0008_free_phalanx.sql','../drizzle/0009_horizontal_media_groups.sql','../drizzle/0012_character_name_en.sql'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8'));
    await db.batch(migrations.flatMap(migration=>migration.split(';').map(s=>s.replaceAll('--> statement-breakpoint','').trim()).filter(Boolean).map(s=>db.prepare(s))));
    const api=await mf.dispatchFetch("https://review.example/api/board");
    assert.equal(api.status,200);
    const publicBoard=await api.json();assert.equal(publicBoard.me.role,'user');assert.match(api.headers.get('set-cookie')??'',/^__Host-lr_guest=v1\./);
    const publicActivity=await mf.dispatchFetch('https://review.example/api/activity');
    assert.equal(publicActivity.status,200);
    const activityPayload=await publicActivity.json();
    assert.equal(activityPayload.unread,0);
    assert.equal(activityPayload.featured,null);
    assert.ok(Array.isArray(activityPayload.topics));
    assert.deepEqual(activityPayload.topics.map(topic=>({id:topic.id,character:topic.character,month:topic.month})),[
      {id:'2026-09:u1631e-sally',character:'u1631e-sally',month:'2026-09'},
    ]);
    const headers={'oai-authenticated-user-id':'isolated-worker-test','oai-authenticated-user-email':'test@example.invalid',origin:'https://review.example','Content-Type':'application/json'};
    const call=async(body)=>{const r=await mf.dispatchFetch('https://review.example/api/board'+(body?'':'?month=2026-09'),{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
    await call({action:'profile',name:'Local D1 test'});
    const before=await call();
    const anonymousSession=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers:{origin:'https://review.example','Content-Type':'application/json'},body:JSON.stringify({board:before.board,body:'Anonymous upload',request:crypto.randomUUID(),name:'anonymous.mp4',type:'video/mp4',size:32})});assert.equal(anonymousSession.status,200,await anonymousSession.text());
    const posted=await call({action:'post',board:before.board,body:'Local D1 persistence check',request:crypto.randomUUID()});
    const translationUnavailable=await mf.dispatchFetch('https://review.example/api/translate',{method:'POST',headers,body:JSON.stringify({post:posted.id,target:'en'})});assert.equal(translationUnavailable.status,503);assert.equal((await translationUnavailable.json()).error,'translation_unavailable');
    await db.prepare('INSERT INTO translations(post,language,body) VALUES(?,?,?)').bind(posted.id,'en','Cached English translation').run();
    const cachedTranslation=await mf.dispatchFetch('https://review.example/api/translate',{method:'POST',headers,body:JSON.stringify({post:posted.id,target:'en'})});assert.equal(cachedTranslation.status,200);assert.deepEqual(await cachedTranslation.json(),{body:'Cached English translation',cached:true});
    await db.prepare('INSERT INTO feature_flags(name,enabled,updated) VALUES(?,?,?)').bind('translationEnabled',0,Date.now()).run();
    const disabledTranslation=await mf.dispatchFetch('https://review.example/api/translate',{method:'POST',headers,body:JSON.stringify({post:posted.id,target:'en'})});assert.equal(disabledTranslation.status,503);assert.equal((await disabledTranslation.json()).error,'feature_disabled');
    await db.prepare('UPDATE feature_flags SET enabled=1 WHERE name=?').bind('translationEnabled').run();
    await call({action:'like',post:posted.id,liked:true});
    await call({action:'vote',board:before.board,poll:'strength',choice:0});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
    const form=new FormData();form.set('board',before.board);form.set('body','Local media upload');form.set('request',crypto.randomUUID());form.set('file',new File([png],'check.png',{type:'image/png'}));
    const uploadRequest=new Request('https://review.example/api/upload',{method:'PUT',headers:{'oai-authenticated-user-id':'isolated-worker-test','oai-authenticated-user-email':'test@example.invalid',origin:'https://review.example'},body:form});const upload=await mf.dispatchFetch(uploadRequest.url,{method:'PUT',headers:Object.fromEntries(uploadRequest.headers),body:new Uint8Array(await uploadRequest.arrayBuffer())});const uploaded=await upload.json();assert.equal(upload.status,200,JSON.stringify(uploaded));
    const media=await mf.dispatchFetch('https://review.example/api/media?id='+uploaded.id);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');assert.match(media.headers.get('cache-control')??'',/^private, max-age=300/);assert.equal(media.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal((await media.arrayBuffer()).byteLength,png.byteLength);
    const suffix=await mf.dispatchFetch('https://review.example/api/media?id='+uploaded.id,{headers:{'oai-authenticated-user-id':'isolated-worker-test',range:'bytes=-3'}});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),png.subarray(-3));
    const invalid=await mf.dispatchFetch('https://review.example/api/media?id='+uploaded.id,{headers:{'oai-authenticated-user-id':'isolated-worker-test',range:'bytes=-'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */'+png.byteLength);
    const videoRequest=crypto.randomUUID();
    const videoSessionBody={board:before.board,body:'Long video persistence check',request:videoRequest,name:'long-check.mp4',type:'video/mp4',size:8*1024*1024+32};
    const videoSessionResponse=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify(videoSessionBody)});const videoSession=await videoSessionResponse.json();assert.equal(videoSessionResponse.status,200,JSON.stringify(videoSession));assert.equal(videoSession.parts,2);assert.equal(videoSession.partSize,8*1024*1024);assert.equal(videoSession.maxBytes,200*1024*1024);
    const videoSessionRetry=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify(videoSessionBody)});assert.equal(videoSessionRetry.status,200);const retriedSession=await videoSessionRetry.json();assert.equal(retriedSession.id,videoSession.id);assert.deepEqual(retriedSession.uploadedParts,[]);
    await db.prepare("DELETE FROM limits WHERE key LIKE 'upload-session:%'").run();
    const maxSizeSession=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify({...videoSessionBody,request:crypto.randomUUID(),name:'max-size-check.mp4',size:200*1024*1024})});assert.equal(maxSizeSession.status,200);assert.equal((await maxSizeSession.json()).parts,25);
    const oversizedSession=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify({...videoSessionBody,request:crypto.randomUUID(),size:200*1024*1024+1})});assert.equal(oversizedSession.status,400);assert.equal((await oversizedSession.json()).error,'invalid_media');
    const video=Buffer.alloc(videoSessionBody.size,0x11);Buffer.from('ftyp').copy(video,4);
    const firstChunk=video.subarray(0,videoSession.partSize);const firstPartResponse=await mf.dispatchFetch('https://review.example/api/upload/part?id='+videoSession.id+'&part=1',{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(firstChunk.byteLength)},body:firstChunk});const firstPartResult=await firstPartResponse.json();assert.equal(firstPartResponse.status,200,JSON.stringify(firstPartResult));
    const resumableSession=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify(videoSessionBody)});assert.equal(resumableSession.status,200);assert.deepEqual((await resumableSession.json()).uploadedParts,[1]);
    const incomplete=await mf.dispatchFetch('https://review.example/api/upload/complete',{method:'POST',headers,body:JSON.stringify({id:videoSession.id})});assert.equal(incomplete.status,400);assert.equal((await incomplete.json()).error,'upload_incomplete');
    const partRetry=await mf.dispatchFetch('https://review.example/api/upload/part?id='+videoSession.id+'&part=1',{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(firstChunk.byteLength)},body:firstChunk});assert.equal(partRetry.status,200);assert.equal((await partRetry.json()).already,true);
    const finalChunk=video.subarray(videoSession.partSize);const finalPartResponse=await mf.dispatchFetch('https://review.example/api/upload/part?id='+videoSession.id+'&part=2',{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(finalChunk.byteLength)},body:finalChunk});const finalPartResult=await finalPartResponse.json();assert.equal(finalPartResponse.status,200,JSON.stringify(finalPartResult));
    const completeResponses=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://review.example/api/upload/complete',{method:'POST',headers,body:JSON.stringify({id:videoSession.id})})));const completeBodies=await Promise.all(completeResponses.map(r=>r.json()));for(const response of completeResponses)assert.equal(response.status,200);const completeResult=completeBodies[0];assert.equal(completeResult.status,'completed');assert.equal(completeBodies[1].id,completeResult.id);
    const completeRetry=await mf.dispatchFetch('https://review.example/api/upload/complete',{method:'POST',headers,body:JSON.stringify({id:videoSession.id})});assert.equal(completeRetry.status,200);assert.equal((await completeRetry.json()).id,completeResult.id);
    const videoMedia=await mf.dispatchFetch('https://review.example/api/media?id='+completeResult.id,{headers:{'oai-authenticated-user-id':'isolated-worker-test'}});assert.equal(videoMedia.status,206);assert.equal(videoMedia.headers.get('content-type'),'video/mp4');assert.match(videoMedia.headers.get('cache-control')??'',/^private, max-age=600/);assert.equal(videoMedia.headers.get('accept-ranges'),'bytes');assert.equal(videoMedia.headers.get('content-range'),`bytes 0-${Math.min(video.length,4*1024*1024)-1}/${video.length}`);assert.equal((await videoMedia.arrayBuffer()).byteLength,Math.min(video.length,4*1024*1024));
    const boundedOpenEnded=await mf.dispatchFetch('https://review.example/api/media?id='+completeResult.id,{headers:{'oai-authenticated-user-id':'isolated-worker-test',range:'bytes=0-'}});assert.equal(boundedOpenEnded.status,206);assert.equal(boundedOpenEnded.headers.get('content-range'),`bytes 0-${4*1024*1024-1}/${video.length}`);assert.equal((await boundedOpenEnded.arrayBuffer()).byteLength,4*1024*1024);
    await db.prepare('INSERT INTO feature_flags(name,enabled,updated) VALUES(?,?,?)').bind('videoUploadEnabled',0,Date.now()).run();
    const disabledVideoSession=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify({...videoSessionBody,request:crypto.randomUUID()})});assert.equal(disabledVideoSession.status,503);assert.equal((await disabledVideoSession.json()).error,'feature_disabled');
    await db.prepare('UPDATE feature_flags SET enabled=1 WHERE name=?').bind('videoUploadEnabled').run();
    await db.prepare("DELETE FROM limits WHERE key LIKE 'upload-session:%'").run();
    const badSessionBody={...videoSessionBody,request:crypto.randomUUID(),name:'bad.mp4',size:32};const badSessionResponse=await mf.dispatchFetch('https://review.example/api/upload/session',{method:'POST',headers,body:JSON.stringify(badSessionBody)});assert.equal(badSessionResponse.status,200);const badSession=await badSessionResponse.json();const badPart=await mf.dispatchFetch('https://review.example/api/upload/part?id='+badSession.id+'&part=1',{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':'32'},body:Buffer.alloc(32,0x22)});assert.equal(badPart.status,400);assert.equal((await badPart.json()).error,'invalid_media');
    await call({action:'helpful',post:posted.id,selected:true});
    const activity=await mf.dispatchFetch('https://review.example/api/activity',{headers});assert.equal(activity.status,200);assert.equal((await activity.json()).featured.id,posted.id);
    const after=await call();
    assert.equal(after.me.name,'Local D1 test');
    assert.equal(after.posts.find(p=>p.id===posted.id).body,'Local D1 persistence check');
    assert.equal(after.posts.find(p=>p.id===posted.id).likes,1);
    assert.equal(after.mine[0].choice,0);
    assert.equal(after.posts.some(post=>post.mediaType==='image/png'),true);
  } finally {await mf.dispose();}
});
