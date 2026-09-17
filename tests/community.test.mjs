import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
function compile(path,require){const source=readFileSync(new URL(path,root),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',code)(exports,require);return exports;}
const rules=compile('lib/rules.ts',()=>{});
const {mediaRange}=compile('lib/media-range.ts',()=>{});
const communitySource=readFileSync(new URL('app/community.tsx',root),'utf8');
const communityCss=readFileSync(new URL('app/community.css',root),'utf8');
const pageSource=readFileSync(new URL('app/page.tsx',root),'utf8');
const lazyImageSource=readFileSync(new URL('app/lazy-image.tsx',root),'utf8');
const videoPlayerSource=readFileSync(new URL('app/video-player.tsx',root),'utf8');
const videoThumbnailSource=readFileSync(new URL('app/video-thumbnail.tsx',root),'utf8');
const activitySource=readFileSync(new URL('lib/community-activity.ts',root),'utf8');
const uploadSessionSource=readFileSync(new URL('lib/upload-session.ts',root),'utf8');
const labelsSource=readFileSync(new URL('lib/labels.ts',root),'utf8');
test('media byte ranges support suffixes and reject malformed requests',()=>{
 assert.deepEqual(mediaRange('bytes=-3',10),{start:7,end:9});
 assert.deepEqual(mediaRange('bytes=3-',10),{start:3,end:9});
 assert.deepEqual(mediaRange('bytes=0-99',10),{start:0,end:9});
 assert.deepEqual(mediaRange('bytes=-99',10),{start:0,end:9});
 assert.equal(mediaRange(null,10),null);
 for(const range of ['bytes=-','bytes=-0','bytes=10-','bytes=4-3','bytes=0-1,3-4','bytes=0-999999999999999999999'])assert.throws(()=>mediaRange(range,10));
});
test('comment UI keeps reactions private, opens replies on demand, and marks a selected reply target',()=>{
 assert.doesNotMatch(communitySource,/openReactors|setLikers|translate\.google\.com/);
 assert.match(communitySource,/replyTarget/);assert.match(communitySource,/toggleReplies/);assert.match(communitySource,/t\.showReplies\.replace/);assert.doesNotMatch(communitySource,/translatePost|<Languages/);assert.match(communitySource,/replyingTo/);assert.match(communitySource,/post-meta.*badges\.map/s);assert.match(communitySource,/data-badge=\{badge\}/);assert.match(communitySource,/post-author-line/);assert.match(communitySource,/contribution-title/);assert.match(communitySource,/post-badge-mark/);assert.match(communitySource,/data-badge=\{badge\}/);assert.match(communityCss,/\.post-badge-mark/);
 assert.match(communitySource,/media-picker-title/);assert.match(communitySource,/mediaLimitHint/);assert.match(communitySource,/multiple type="file"/);assert.match(communitySource,/maxVideosPerPost/);assert.match(communitySource,/maxImagesPerPost/);assert.match(communitySource,/t\.newCharacterNote/);assert.doesNotMatch(communitySource,/media-picker.*<small>/s);
 assert.match(communitySource,/mine/);assert.match(communitySource,/composer-reply/);assert.match(communitySource,/t\.replyTargetLabel/);assert.match(communitySource,/t\.badgeManagementTitle/);assert.match(communitySource,/t\.videoContributor/);assert.match(communitySource,/t\.helpfulContributor/);assert.match(communitySource,/ownerDisplayName/);assert.doesNotMatch(communitySource,/運営バッジ/);assert.match(communitySource,/data\?\.me\?\.role==='owner'/);
 assert.match(communitySource,/line-rangers-display-name/);assert.match(communitySource,/function uiName/);assert.match(communitySource,/匿名ユーザー/);assert.match(communitySource,/uiName\(replyTarget\.name,t\.anonymousUser\)/);assert.match(communitySource,/profileRestoreSubject/);assert.match(communitySource,/profileRestoreInFlight/);assert.doesNotMatch(communitySource,/profileRestoreAttempted/);assert.match(communitySource,/t\.ownerAccess/);assert.match(labelsSource,/ownerAccessDescription/);assert.match(communitySource,/one-time-code/);
 assert.match(communitySource,/\.\.\.\(p\.mine\?\[\]:\['delete'\]\)/);assert.ok(communitySource.indexOf('<p className="post-body">')<communitySource.indexOf('{detail&&videoItems.length>0'));
 assert.doesNotMatch(communitySource,/value=\{month\}.*onChange/);
 assert.match(communitySource,/VideoThumbnail id=\{item\.id\}/);assert.match(videoThumbnailSource,/<video/);assert.match(videoThumbnailSource,/\/api\/media/);assert.match(videoThumbnailSource,/IntersectionObserver/);assert.match(videoThumbnailSource,/preload="metadata"/);assert.doesNotMatch(videoThumbnailSource,/autoPlay/);assert.match(videoThumbnailSource,/labels\(lang\)/);assert.match(videoThumbnailSource,/t\.playVideo/);assert.match(videoPlayerSource,/labels\(lang\)/);assert.match(videoPlayerSource,/t\.videoUnavailable/);assert.match(labelsSource,/playVideo:'Tap to play'/);assert.match(labelsSource,/videoUnavailable:'The video is currently unavailable/);assert.match(videoPlayerSource,/onLoadedData/);assert.match(videoPlayerSource,/onError=\{reportFailure\}/);
 assert.match(communityCss,/\.composer\.composer-reply\{position:fixed!important/);assert.match(communityCss,/\.role-owner/);assert.match(communityCss,/border:0!important/);assert.doesNotMatch(pageSource,/\/boards(?:\?|["'])/);assert.doesNotMatch(pageSource,/line-rangers-fan\.github\.io\/line-rangers-pvp/);assert.doesNotMatch(communitySource,/entry-actions|ranking-link|line-rangers-fan\.github\.io\/line-rangers-pvp/);assert.doesNotMatch(communitySource,/raw\.githubusercontent\.com\/line-rangers-fan\/line-rangers-pvp/);
});
test('comment draft is cleared only after the server confirms the post',()=>{
 const publish=communitySource.slice(communitySource.indexOf('async function publish()'));
 const request=publish.indexOf('await boardRequest');
 const clear=publish.indexOf("if(bodyRef.current.trim()===content)setDraft('')");
 assert.ok(request>=0&&clear>request,'successful draft clear must follow the awaited server request');
 assert.doesNotMatch(publish.slice(0,request),/setDraft\(''\)/,'failed or pending posts must retain the draft');
});
test('video contributor badges are manual only',()=>{
 assert.doesNotMatch(activitySource,/videoAuthors|video_contributor/);
 assert.doesNotMatch(communitySource,/title:'video_contributor'/);
});
test('selected reactions use distinct pink and blue states',()=>{
 assert.match(communitySource,/className=\{p\.liked\?'is-liked':''\}/);
 assert.match(communitySource,/fill=\{p\.liked\?'currentColor':'none'\}/);
 assert.match(communitySource,/className=\{p\.helped\?'is-helpful':''\}/);
 assert.match(communitySource,/fill=\{p\.helped\?'currentColor':'none'\}/);
 assert.match(communityCss,/\.post-actions \.is-liked\{color:#f472b6!important\}/);
 assert.match(communityCss,/\.post-actions \.is-helpful\{color:#60a5fa!important\}/);assert.match(communityCss,/\.video-carousel\{display:flex/);
});
test('interaction UI uses local updates, resumable uploads, and does not reload the board after each action',()=>{
 assert.doesNotMatch(communitySource,/window\.location\.reload|await\s+reload\s*\(/);
 for(const feature of ['toggleLike','toggleHelpful','chooseVote','rollbackLocalPost','resumeForReselectedFile'])assert.match(communitySource,new RegExp(feature));
 assert.doesNotMatch(communitySource,/const \[loading,/);assert.match(communitySource,/initialLoading/);assert.doesNotMatch(communitySource,/translationVersions/);
 assert.match(videoPlayerSource,/preload="metadata"/);assert.doesNotMatch(videoPlayerSource,/preload="auto"/);assert.match(videoPlayerSource,/onLoadedData/);assert.match(videoPlayerSource,/onError={reportFailure}/);
 assert.match(lazyImageSource,/IntersectionObserver/);
});
test('new-character switching requires an explicitly confirmed month and identity',()=>{
 assert.deepEqual(rules.confirmedCharactersForMonth('2026-09').map(character=>character.id),['u1631e-sally']);
 assert.deepEqual(rules.confirmedCharactersForMonth('2026-10'),[]);
 assert.equal(rules.isConfirmedCharacterForMonth('u1631e-sally','2026-09'),true);
 assert.equal(rules.isConfirmedCharacterForMonth('u1631e-sally','2026-10'),false);
 assert.equal(rules.isKnownCharacter('unverified-character'),false);
});
test('abandoned multipart sessions expire after a bounded lifetime',()=>{
 const upload=compile('lib/upload-session.ts',id=>{
  if(id==='@/db/raw')return {};
  if(id==='@/lib/rules')return rules;
  if(id==='@/lib/anonymous-session')return {};
  throw new Error('Unexpected upload-session import '+id);
 });
 assert.equal(upload.uploadSessionExpired({created:1000},1000+24*60*60*1000),false);
 assert.equal(upload.uploadSessionExpired({created:1000},1001+24*60*60*1000),true);
 assert.equal(upload.uploadSessionExpired({created:Number.NaN},1000),true);
 assert.match(uploadSessionSource,/uploadSessionMaxAgeMs/);
});
function setup(){
 const deletedObjects=[];const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('drizzle/0000_clumsy_penance.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0001_talented_gabe_jones.sql',root),'utf8'));
 const db={prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};},async batch(statements){sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 sql.exec(readFileSync(new URL('drizzle/0002_true_purifiers.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0003_thankful_firestar.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0004_yummy_warbird.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0005_bumpy_hellcat.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0006_quick_zuras.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0007_overjoyed_scorpion.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0008_free_phalanx.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0009_horizontal_media_groups.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0010_media_cleanup_queue.sql',root),'utf8'));sql.exec(readFileSync(new URL('drizzle/0012_character_name_en.sql',root),'utf8'));
 const activity=compile('lib/community-activity.ts',()=>({database:()=>db}));
 const featureTypes=compile('lib/community-features.ts',()=>{});
 const flags=compile('lib/community-flags.ts',id=>{
  if(id==='@/db/raw')return {database:()=>db,bucket:()=>({async delete(keys){deletedObjects.push(...(Array.isArray(keys)?keys:[keys]));}})};
  if(id==='@/lib/community-features')return featureTypes;
  throw new Error('Unexpected flag import '+id);
 });
 const requestContext=new AsyncLocalStorage();
 const anonymous=compile('lib/anonymous-session.ts',id=>{
  if(id==='cloudflare:workers')return {env:{BOARD_ANON_COOKIE_SECRET:'test-anon-cookie-secret-0123456789012345',BOARD_OWNER_SUBJECT:'owner-subject',BOARD_OWNER_ACCESS_TOKEN:'test-owner-access-token'}};
  if(id==='@/lib/rules')return rules;
  throw new Error('Unexpected anonymous import '+id);
 });
 const api=compile('app/api/board/route.ts',id=>{
  if(id==='next/headers')return {headers:async()=>requestContext.getStore().headers};
  if(id==='cloudflare:workers')return {env:{BOARD_OWNER_EMAIL:'owner@example.invalid',BOARD_OWNER_SUBJECT:'owner-subject',BOARD_OWNER_ACCESS_TOKEN:'test-owner-access-token',BOARD_ANON_COOKIE_SECRET:'test-anon-cookie-secret-0123456789012345'}};
  if(id==='@/db/raw')return {database:()=>db,bucket:()=>({async delete(keys){deletedObjects.push(...(Array.isArray(keys)?keys:[keys]));}})};
  if(id==='@/lib/rules')return rules;
  if(id==='@/lib/community-activity')return activity;
  if(id==='@/lib/community-flags')return flags;
  if(id==='@/lib/community-features')return featureTypes;
 if(id==='@/lib/anonymous-session')return anonymous;
 throw new Error('Unexpected import '+id);
 });
 const activityApi=compile('app/api/activity/route.ts',id=>{
  if(id==='next/headers')return {headers:async()=>requestContext.getStore().headers};
  if(id==='@/db/raw')return {database:()=>db,bucket:()=>({async delete(keys){deletedObjects.push(...(Array.isArray(keys)?keys:[keys]));}})};
  if(id==='@/lib/community-activity')return activity;
  if(id==='@/lib/rules')return rules;
  if(id==='@/lib/anonymous-session')return anonymous;
  throw new Error('Unexpected activity import '+id);
 });
 const call=async(body=null,who='test-a',path='',email='test@example.invalid',origin='https://review.example',cookie='')=>{
  const request=new Request('https://review.example/api/board'+path,{method:body?'POST':'GET',headers:{...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':email}:{}),...(cookie?{cookie}:{}),origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return requestContext.run(request,async()=>{const r=await (body?api.POST(request):api.GET(request));return {status:r.status,data:await r.json(),headers:r.headers};});};
 const activityCall=async(who='test-a',cookie='')=>{
  const request=new Request('https://review.example/api/activity',{headers:{...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':'test@example.invalid'}:{}),...(cookie?{cookie}:{}),origin:'https://review.example'}});
  return requestContext.run(request,async()=>{const r=await activityApi.GET();return {status:r.status,data:await r.json(),headers:r.headers};});
 };
 return {sql,call,activityCall,anonymous,deletedObjects,clearLimits(){sql.exec('DELETE FROM limits');}};
}
test('JST month boundaries and leap/year transitions',()=>{
 assert.equal(rules.monthJST(new Date('2026-09-30T14:59:59Z')),'2026-09');assert.equal(rules.monthJST(new Date('2026-09-30T15:00:00Z')),'2026-10');assert.equal(rules.monthJST(new Date('2026-12-31T15:00:00Z')),'2027-01');assert.equal(rules.monthJST(new Date('2028-02-29T15:00:00Z')),'2028-03');assert.equal(rules.validMonth('2026-13'),false);
});
test('media types are explicitly allowlisted and video type is preserved',()=>{
 assert.equal(rules.mediaExtension('image/jpeg'),'jpg');assert.equal(rules.mediaExtension('video/mp4'),'mp4');assert.equal(rules.mediaExtension('image/svg+xml'),null);assert.equal(rules.isVideoMedia('video/quicktime'),true);assert.equal(rules.isVideoMedia('image/png'),false);
 assert.equal(rules.maxMediaBytes,200*1024*1024);assert.equal(rules.mediaPartBytes,8*1024*1024);assert.equal(rules.mediaPartCount(8*1024*1024),1);assert.equal(rules.mediaPartCount(8*1024*1024+1),2);assert.equal(rules.mediaPartCount(rules.maxMediaBytes),25);assert.ok(rules.mediaPartCount(rules.maxMediaBytes)*rules.mediaPartAttempts<=rules.uploadPartLimit);assert.equal(rules.uploadPartWindowSeconds,10*60);
});
test('video replies reject URLs, media, embeds; plain text remains valid',()=>{
 for(const text of ['https://example.com','www.example.com','<img src=x>','[x](video)','youtu.be/abcdefghijk','watch.example.xyz/path'])assert.throws(()=>rules.validateReply(text,null));assert.throws(()=>rules.validateReply('Hello','https://youtu.be/abcdefghijk'));assert.doesNotThrow(()=>rules.validateReply('とても参考になりました。',null));
});
test('permission matrix does not grant management based on a name',()=>{
 assert.equal(rules.mayModerate('user','pin',false),false);assert.equal(rules.mayModerate('moderator','moderator',false),false);assert.equal(rules.mayModerate('moderator','delete',true),true);assert.equal(rules.mayModerate('moderator','delete',false),true);assert.equal(rules.mayModerate('owner','delete',true),true);
});
test('public browsing and anonymous mutations work while cross-origin writes fail closed',async()=>{
 const {call}=setup();const guest=await call(null,'');assert.equal(guest.status,200);assert.equal(guest.data.me.role,'user');assert.match(guest.data.me.name,/^ゲスト-/);const cookie=guest.headers.get('set-cookie');assert.match(cookie??'',/^__Host-lr_guest=v1\./);const same=await call(null,'','','test@example.invalid','https://review.example',cookie);assert.equal(same.data.me.id,guest.data.me.id);const forged=cookie.replace(/(v1\.[^;]+\.)[^;]+/,'$1x');const rotated=await call(null,'','','test@example.invalid','https://review.example',forged);assert.equal(rotated.status,200);assert.notEqual(rotated.data.me.id,guest.data.me.id);assert.match(rotated.headers.get('set-cookie')??'',/^__Host-lr_guest=v1\./);const profile=await call({action:'profile',name:'hello'},'','','test@example.invalid','https://review.example',cookie);assert.equal(profile.status,200);const profileCookie=profile.headers.get('set-cookie')??'';assert.match(profileCookie,/__Host-lr_display_name=hello/);const savedNameCookie=(profileCookie.match(/__Host-lr_display_name=[^,]+/)||[''])[0];const restored=await call(null,'','','test@example.invalid','https://review.example',savedNameCookie);assert.equal(restored.data.me.name,'hello');assert.equal((await call({action:'profile',name:'hello'},'a','','x','https://evil.example')).status,403);assert.equal((await call({action:'profile',name:'hello'},'')).status,200);
});
test('owner activation exchanges a private access key for a signed cookie without login',async()=>{
 const {call,anonymous,sql}=setup();const activated=await anonymous.activateOwner('test-owner-access-token');assert.ok(activated);assert.match(activated.setCookie,/^__Host-lr_owner=o1\.[0-9]+\./);assert.ok(activated.setCookies?.some(cookie=>cookie.includes('__Host-lr_display_name=')));
 assert.match(activated.setCookie,/Max-Age=31536000/);const session=await anonymous.sessionFromHeaders(new Headers({cookie:activated.setCookie}));assert.equal(session.owner,true);assert.equal(session.sub,'owner-subject');assert.equal(session.displayName,'LINEレンジャーは神ゲー');assert.match(session.setCookie||'',/^__Host-lr_owner=o1\.[0-9]+\./);
 const owner=await call(null,'','','owner@example.invalid','https://review.example',activated.setCookie);assert.equal(owner.status,200);assert.equal(owner.data.me.role,'owner');assert.equal(owner.data.me.display_name_set,1);assert.equal(owner.data.me.name,'LINEレンジャーは神ゲー');
 const named=await call({action:'profile',name:'別の名前'},'','','owner@example.invalid','https://review.example',activated.setCookie);assert.equal(named.status,200);assert.equal(named.data.me.role,'owner');assert.equal(named.data.me.name,'LINEレンジャーは神ゲー');const savedCookie=named.headers.get('set-cookie')||'';assert.match(savedCookie,/__Host-lr_display_name=LINE%E3%83%AC%E3%83%B3%E3%82%B8%E3%83%A3%E3%83%BC%E3%81%AF%E7%A5%9E%E3%82%B2%E3%83%BC/);assert.match(savedCookie,/HttpOnly/);
 const displayCookie=(savedCookie.match(/__Host-lr_display_name=[^;]+/)||[''])[0];const restoredSession=await anonymous.sessionFromHeaders(new Headers({cookie:`${activated.setCookie}; ${displayCookie}`}));assert.equal(restoredSession.owner,true);assert.equal(restoredSession.displayName,'LINEレンジャーは神ゲー');
 const restored=await call(null,'','','owner@example.invalid','https://review.example',activated.setCookie);assert.equal(restored.data.me.role,'owner');assert.equal(restored.data.me.name,'LINEレンジャーは神ゲー');assert.equal(restored.data.me.display_name_set,1);const ownerRow=sql.prepare("SELECT name,display_name_set,role FROM users WHERE subject='owner-subject'").get();assert.equal(ownerRow.name,'LINEレンジャーは神ゲー');assert.equal(ownerRow.display_name_set,1);assert.equal(ownerRow.role,'owner');
 assert.equal(await anonymous.activateOwner('wrong-token'),null);
});
test('profile rename preserves identity and never grants owner via display name or payload',async()=>{
 const {call}=setup();await call({action:'profile',name:'運営',role:'owner'});const first=(await call()).data.me;assert.equal(first.role,'user');await call({action:'profile',name:'new name'});const second=(await call()).data.me;assert.equal(first.id,second.id);assert.equal(second.name,'new name');
});
test('only the first verified owner subject is bound as Owner',async()=>{
 const {call}=setup();await call({action:'profile',name:'Owner'},'owner-subject','', 'owner@example.invalid');await call({action:'profile',name:'Impersonator'},'owner-b','', 'owner@example.invalid');
 assert.equal((await call(null,'owner-subject','', 'owner@example.invalid')).data.me.role,'owner');
 assert.equal((await call(null,'owner-b','', 'owner@example.invalid')).data.me.role,'user');
});
test('opaque owner subject can bootstrap the Owner without exposing an email',async()=>{
 const {call}=setup();await call({action:'profile',name:'Owner'},'owner-subject','','different@example.invalid');assert.equal((await call(null,'owner-subject','','different@example.invalid')).data.me.role,'owner');
});
test('adding the owner secret later safely promotes only the verified subject',async()=>{
 const {call}=setup();await call({action:'profile',name:'Owner'},'owner-later','','different@example.invalid');
 const spoofed=(await call({action:'profile',name:'Owner renamed'},'owner-later','','owner@example.invalid')).data.me;
 assert.equal(spoofed.role,'user');assert.equal(spoofed.name,'Owner renamed');
 const other=(await call({action:'profile',name:'Other'},'owner-b','','owner@example.invalid')).data.me;assert.equal(other.role,'user');
});
test('a verified owner is promoted on read without requiring a profile edit',async()=>{
 const {call,sql}=setup();sql.prepare('INSERT INTO users(id,subject,name,role,created) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),'owner-subject','Existing Owner','user',Date.now());
 const result=await call(null,'owner-subject','','different@example.invalid');assert.equal(result.status,200);assert.equal(result.data.me.role,'owner');
});
test('Owner-only feature-flag permissions persist while reads stay available',async()=>{
 const {call,sql}=setup();await call({action:'profile',name:'Owner'},'owner-subject','','owner@example.invalid');await call({action:'profile',name:'Member'},'member','','member@example.invalid');
 const initial=(await call(null,'owner-subject','','owner@example.invalid')).data;assert.deepEqual(initial.flags,{commentsEnabled:true,videoUploadEnabled:true,translationEnabled:true,votingEnabled:true,readOnly:false});
 const memberState=(await call(null,'member','','member@example.invalid')).data;
 assert.equal((await call({action:'moderate',operation:'moderator',target:memberState.me.id},'owner-subject','','owner@example.invalid')).status,200);
 const memberToggle=await call({action:'feature_flag',name:'commentsEnabled',enabled:false},'member','','member@example.invalid');assert.equal(memberToggle.status,403);assert.equal(memberToggle.data.error,'forbidden');
 const disabled=await call({action:'feature_flag',name:'commentsEnabled',enabled:false},'owner-subject','','owner@example.invalid');assert.equal(disabled.status,200);assert.deepEqual(disabled.data,{ok:true,name:'commentsEnabled',enabled:false});
 const stoppedPost=await call({action:'post',board:initial.board,body:'Blocked while comments are disabled',request:crypto.randomUUID()},'owner-subject','','owner@example.invalid');assert.equal(stoppedPost.status,503);assert.equal(stoppedPost.data.error,'feature_disabled');
 assert.equal((await call({action:'feature_flag',name:'commentsEnabled',enabled:true},'owner-subject','','owner@example.invalid')).status,200);
 const posted=await call({action:'post',board:initial.board,body:'Existing content remains readable',request:crypto.randomUUID()},'owner-subject','','owner@example.invalid');assert.equal(posted.status,200);
 const memberReadOnly=await call({action:'feature_flag',name:'readOnly',enabled:true},'member','','member@example.invalid');assert.equal(memberReadOnly.status,403);assert.equal(memberReadOnly.data.error,'forbidden');
 assert.equal((await call({action:'feature_flag',name:'readOnly',enabled:true},'owner-subject','','owner@example.invalid')).status,200);
 const readable=await call(null,'owner-subject','','owner@example.invalid');assert.equal(readable.status,200);assert.equal(readable.data.posts.length,1);assert.equal(readable.data.flags.readOnly,true);
 for(const action of [
  {action:'post',board:initial.board,body:'Blocked by read only',request:crypto.randomUUID()},
  {action:'like',post:posted.data.id,liked:true},
  {action:'helpful',post:posted.data.id,selected:true},
  {action:'vote',board:initial.board,poll:'strength',choice:0},
 ]){const result=await call(action,'owner-subject','','owner@example.invalid');assert.equal(result.status,503);assert.equal(result.data.error,'read_only');}
 assert.equal((await call({action:'feature_flag',name:'readOnly',enabled:false},'owner-subject','','owner@example.invalid')).status,200);
 assert.throws(()=>sql.prepare('INSERT INTO feature_flags(name,enabled,updated) VALUES(?,?,?)').run('commentsEnabled',1,Date.now()));
 assert.ok(sql.prepare("SELECT COUNT(*) n FROM audit WHERE action='feature_flag'").get().n>=4);
});
test('archived month boards remain visible even when not in the current confirmed topic list',async()=>{
 const {call,sql}=setup();sql.prepare('INSERT INTO boards(id,month,character,name,image) VALUES(?,?,?,?,?)').run('2026-08:archived-character','2026-08','archived-character','Archived Ranger','https://example.invalid/archived.png');await call({action:'profile',name:'Archive reader'},'archive-reader','','archive@example.invalid');
 const result=await call(null,'archive-reader','', 'archive@example.invalid');
 const archived=await call(null,'archive-reader','?month=2026-08','archive@example.invalid');
 assert.equal(result.status,200);assert.deepEqual(archived.data.boards.map(b=>b.id),['2026-08:archived-character']);
 const blockedPost=await call({action:'post',board:'2026-08:archived-character',body:'Archived write',request:crypto.randomUUID()},'archive-reader','','archive@example.invalid');assert.equal(blockedPost.status,409);assert.equal(blockedPost.data.error,'archive_readonly');
 const blockedVote=await call({action:'vote',board:'2026-08:archived-character',poll:'strength',choice:0},'archive-reader','','archive@example.invalid');assert.equal(blockedVote.status,409);assert.equal(blockedVote.data.error,'archive_readonly');
 const archivedPost=crypto.randomUUID();sql.prepare("INSERT INTO posts(id,board,author,parent,body,status,pinned,created,request) VALUES(?,?,?,NULL,?,'visible',0,?,?)").run(archivedPost,'2026-08:archived-character',result.data.me.id,'Archived existing post',Date.now(),crypto.randomUUID());
 for(const action of [{action:'like',post:archivedPost,liked:true},{action:'helpful',post:archivedPost,selected:true},{action:'post',board:'2026-08:archived-character',parent:archivedPost,body:'Archived reply',request:crypto.randomUUID()}]){const blocked=await call(action,'archive-reader','','archive@example.invalid');assert.equal(blocked.status,409);assert.equal(blocked.data.error,'archive_readonly');}
 sql.prepare('INSERT INTO boards(id,month,character,name,image) VALUES(?,?,?,?,?)').run('2026-09:unconfirmed-character','2026-09','unconfirmed-character','Unconfirmed Ranger','https://example.invalid/unconfirmed.png');
 const unconfirmedVote=await call({action:'vote',board:'2026-09:unconfirmed-character',poll:'strength',choice:0},'archive-reader','','archive@example.invalid');assert.equal(unconfirmedVote.status,404);assert.equal(unconfirmedVote.data.error,'not_found');
});
test('poll upsert keeps a single vote per user on the selected evolution board',async()=>{
 const {call}=setup();await call({action:'profile',name:'Tester'});const data=(await call()).data;assert.equal(data.boards.length,1);const id=data.boards[0].id;
 for(const choice of [0,1,2])assert.equal((await call({action:'vote',board:id,poll:'strength',choice})).status,200);
 const result=(await call()).data;assert.equal(result.poll.reduce((n,r)=>n+r.count,0),1);assert.equal(result.mine[0].choice,2);assert.equal((await call({action:'vote',board:id,poll:'strength',choice:8})).status,400);
});
test('posts persist, idempotent retry does not duplicate, and reaction names are private',async()=>{
 const {call}=setup();await call({action:'profile',name:'Tester'});const board=(await call()).data.board;const p={action:'post',board,body:'<script>alert(1)</script> is stored as text',request:crypto.randomUUID()};const first=await call(p);assert.equal(first.status,200);assert.equal((await call(p)).data.id,first.data.id);
 for(let i=0;i<2;i++)assert.equal((await call({action:'like',post:first.data.id,liked:true})).status,200);
 const result=(await call()).data;assert.equal(result.posts.length,1);assert.equal(result.posts[0].likes,1);assert.equal(result.posts[0].body,p.body);assert.equal((await call(null,'test-a','?likers='+first.data.id)).status,404);
});
test('users can delete only their own posts while moderation rules remain server-side',async()=>{
 const {call}=setup();await call({action:'profile',name:'Tester'});const board=(await call()).data.board;const own=(await call({action:'post',board,body:'自分で削除する投稿',request:crypto.randomUUID()})).data.id;
 assert.equal((await call({action:'moderate',operation:'delete',target:own})).status,200);assert.equal((await call()).data.posts.length,0);
});
test('deleting a grouped media post removes every R2 object in the group',async()=>{
 const {call,sql,deletedObjects}=setup();await call({action:'profile',name:'Media owner'});const state=(await call()).data;const group=crypto.randomUUID();const imageKey='uploads/test/image.jpg';const videoKey='uploads/test/video.mp4';const image=crypto.randomUUID();const video=crypto.randomUUID();
 sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(image,state.board,state.me.id,'Grouped media',imageKey,'image/jpeg','image.jpg',10,group,Date.now(),crypto.randomUUID());
 sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(video,state.board,state.me.id,'Grouped media',videoKey,'video/mp4','video.mp4',20,group,Date.now()+1,crypto.randomUUID());
 assert.equal((await call({action:'moderate',operation:'delete',target:image})).status,200);
 assert.deepEqual(new Set(deletedObjects),new Set([imageKey,videoKey]));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM media_cleanup').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM posts WHERE media_group=? AND status=\'deleted\'').get(group).n,2);
});
test('JSON posts reject legacy video URLs and cap video comment replies at one nested level',async()=>{
 const {call,sql,clearLimits}=setup();await call({action:'profile',name:'Tester'});const state=(await call()).data;const parent=crypto.randomUUID();
 sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?, 'visible',0,?,?)").run(parent,state.board,state.me.id,'Attached video','media/test.mp4','video/mp4','test.mp4',10,Date.now(),crypto.randomUUID());
 assert.equal((await call({action:'post',board:state.board,body:'Legacy URL',video:'https://youtu.be/abcdefghijk',request:crypto.randomUUID()})).data.error,'invalid_request');clearLimits();
 const reply=await call({action:'post',board:state.board,parent,body:'Thanks for sharing',request:crypto.randomUUID()});assert.equal(reply.status,200);clearLimits();
 const nested=await call({action:'post',board:state.board,parent:reply.data.id,body:'I agree',request:crypto.randomUUID()});assert.equal(nested.status,200);clearLimits();
 assert.equal((await call({action:'post',board:state.board,parent:nested.data.id,body:'Fourth layer',request:crypto.randomUUID()})).data.error,'text_only');
 assert.deepEqual((await call(null,'test-a','?replies='+parent)).data.posts.map(p=>p.id),[reply.data.id]);assert.deepEqual((await call(null,'test-a','?replies='+reply.data.id)).data.posts.map(p=>p.id),[nested.data.id]);
});
test('server moderation, owner-only role changes and audit records',async()=>{
 const {call,sql,clearLimits}=setup();await call({action:'profile',name:'Owner'},'owner-subject','','owner@example.invalid');await call({action:'profile',name:'Member'},'member','','member@example.invalid');const member=(await call(null,'member','','member@example.invalid')).data.me;const board=(await call()).data.board;const post=(await call({action:'post',board,body:'Review',request:crypto.randomUUID()})).data.id;
 assert.equal((await call({action:'moderate',operation:'pin',target:post})).status,403);
 assert.equal((await call({action:'moderate',operation:'moderator',target:member.id},'owner-subject')).status,200);const memberAfterReload=(await call(null,'member','','member@example.invalid')).data;assert.equal(memberAfterReload.me.role,'moderator');const ownerView=(await call(null,'owner-subject','?admin=1','owner@example.invalid')).data;assert.equal(ownerView.users.find(user=>user.id===member.id).role,'moderator');assert.equal((await call({action:'moderate',operation:'pin',target:post},'member','','member@example.invalid')).status,200);
 assert.equal((await call({action:'moderate',operation:'moderator',target:member.id})).status,403);
 assert.equal((await call({action:'moderate',operation:'hide',target:post},'member','','member@example.invalid')).status,200);assert.equal((await call()).data.posts.length,0);assert.equal((await call(null,'test-a','?likers='+post)).status,404);
 clearLimits();assert.equal((await call({action:'moderate',operation:'restore',target:post},'member','','member@example.invalid')).status,200);assert.equal((await call()).data.posts.length,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM audit').get().n,4);
});
test('badges are manageable by Owner and moderators while roles stay protected',async()=>{
 const {call,sql,clearLimits}=setup();await call({action:'profile',name:'Owner'},'owner-subject','','owner@example.invalid');await call({action:'profile',name:'Member'},'member','','member@example.invalid');await call({action:'profile',name:'Target'},'target','','target@example.invalid');
 const ownerState=(await call(null,'owner-subject','','owner@example.invalid')).data;const memberState=(await call(null,'member','','member@example.invalid')).data;const targetState=(await call(null,'target','','target@example.invalid')).data;
 assert.equal((await call({action:'badge',target:memberState.me.id,badge:'helpful_contributor',enabled:true},'member','','member@example.invalid')).status,403);
 assert.equal((await call({action:'badge',target:memberState.me.id,badge:'helpful_contributor',enabled:true},'owner-subject','','owner@example.invalid')).status,200);
 assert.equal((await call({action:'badge',target:ownerState.me.id,badge:'helpful_contributor',enabled:true},'owner-subject','','owner@example.invalid')).status,200);
 const ownerWithBadge=(await call(null,'owner-subject','','owner@example.invalid')).data;assert.deepEqual(ownerWithBadge.me.badges,['helpful_contributor']);
 const ownerPost=(await call({action:'post',board:ownerState.board,body:'Owner contribution',request:crypto.randomUUID()},'owner-subject','','owner@example.invalid')).data.id;
 assert.deepEqual((await call(null,'owner-subject','','owner@example.invalid')).data.posts.find(post=>post.id===ownerPost).badges,['helpful_contributor']);
 const textPost=(await call({action:'post',board:ownerState.board,body:'Useful information',request:crypto.randomUUID()},'member','','member@example.invalid')).data.id;
 const listed=(await call(null,'member','','member@example.invalid')).data.posts.find(p=>p.id===textPost);assert.deepEqual(listed.badges,['helpful_contributor']);
 const admin=(await call(null,'owner-subject','?admin=1','owner@example.invalid')).data;assert.deepEqual(admin.users.find(u=>u.id===memberState.me.id).badges,['helpful_contributor']);
 clearLimits();assert.equal((await call({action:'moderate',operation:'moderator',target:memberState.me.id},'owner-subject','','owner@example.invalid')).status,200);
 assert.equal((await call({action:'badge',target:targetState.me.id,badge:'video_contributor',enabled:true},'member','','member@example.invalid')).status,200);
 assert.equal((await call({action:'badge',target:ownerState.me.id,badge:'video_contributor',enabled:true},'member','','member@example.invalid')).status,403);
 const moderatorAdmin=(await call(null,'member','?admin=1','member@example.invalid')).data;assert.deepEqual(moderatorAdmin.users.find(u=>u.id===targetState.me.id).badges,['video_contributor']);
 assert.equal((await call({action:'badge',target:targetState.me.id,badge:'video_contributor',enabled:false},'member','','member@example.invalid')).status,200);
 clearLimits();const video=crypto.randomUUID();sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?, 'visible',0,?,?)").run(video,ownerState.board,memberState.me.id,'Uploaded video',`media/${video}`,'video/mp4','clip.mp4',100,Date.now(),crypto.randomUUID());
 clearLimits();assert.equal((await call({action:'moderate',operation:'delete',target:video},'member','','member@example.invalid')).status,200);assert.equal(sql.prepare("SELECT status FROM posts WHERE id=?").get(video).status,'deleted');
});
test('Owner permission list includes named loginless users but excludes anonymous sessions',async()=>{
 const {call}=setup();
 const owner=await call({action:'profile',name:'Owner'},'owner-subject','','owner@example.invalid');assert.equal(owner.status,200);
 const named=await call({action:'profile',name:'名前ありユーザー'},'');assert.equal(named.status,200);
 const anonymous=await call(null,'');assert.equal(anonymous.status,200);assert.match(anonymous.data.me.name,/^ゲスト-/);
 const admin=(await call(null,'owner-subject','?admin=1','owner@example.invalid')).data;
 assert.ok(admin.users.some(u=>u.name==='名前ありユーザー'));
 assert.ok(!admin.users.some(u=>/^ゲスト-/.test(u.name)));
});
test('legacy named profiles remain manageable without exposing generated guest labels',async()=>{
 const {call,sql}=setup();
 await call({action:'profile',name:'Owner'},'owner-subject','','owner@example.invalid');
 const legacyNamed=crypto.randomUUID();const legacyGuest=crypto.randomUUID();
 sql.prepare('INSERT INTO users(id,subject,name,role,created) VALUES(?,?,?,?,?)').run(legacyNamed,'legacy-named','保存済みの名前','user',Date.now());
 sql.prepare('INSERT INTO users(id,subject,name,role,created) VALUES(?,?,?,?,?)').run(legacyGuest,'legacy-guest','ゲスト-ABCD','user',Date.now());
 const admin=(await call(null,'owner-subject','?admin=1','owner@example.invalid')).data;
 assert.ok(admin.users.some(u=>u.id===legacyNamed));assert.ok(!admin.users.some(u=>u.id===legacyGuest));
});
test('server enforces bounded burst limits',async()=>{
 const {call}=setup();for(let i=0;i<3;i++)assert.equal((await call({action:'profile',name:'A'})).status,200);assert.equal((await call({action:'profile',name:'A'})).status,429);
});
test('helpful reactions are unique, removable, separate from likes, and names stay private',async()=>{
 const {call}=setup();await call({action:'profile',name:'Reader'});const board=(await call()).data.board;
 const post=(await call({action:'post',board,body:'A useful review',request:crypto.randomUUID()})).data.id;
 for(let i=0;i<2;i++)assert.equal((await call({action:'helpful',post,selected:true})).status,200);
 const row=(await call(null,'test-a','?sort=helpful')).data.posts[0];assert.equal(row.helpful,1);assert.equal(row.helped,true);assert.equal(row.likes,0);assert.equal('author' in row,false);
 assert.equal((await call(null,'test-a','?helpers='+post)).status,404);
 assert.equal((await call({action:'helpful',post,selected:false})).status,200);assert.equal((await call()).data.posts[0].helpful,0);
});
test('root comments can receive one direct text reply',async()=>{
 const {call,clearLimits}=setup();await call({action:'profile',name:'Author'});const board=(await call()).data.board;const root=(await call({action:'post',board,body:'Top-level review',request:crypto.randomUUID()})).data.id;
 clearLimits();const reply=await call({action:'post',board,parent:root,body:'Direct reply',request:crypto.randomUUID()});assert.equal(reply.status,200);
 assert.deepEqual((await call(null,'test-a','?replies='+root)).data.posts.map(p=>p.body),['Direct reply']);
});
test('initial board page uses a stable cursor after twenty posts and keeps offset only for ranked sorts',async()=>{
 const {call,sql}=setup();await call({action:'profile',name:'Author'});const state=(await call()).data;const now=Date.now();
 for(let i=0;i<21;i++)sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,'visible',0,?,?)").run(crypto.randomUUID(),state.board,state.me.id,'Post '+i,now+i,crypto.randomUUID());
 const first=(await call()).data;assert.equal(first.posts.length,20);assert.equal(first.stats.comments,21);assert.match(first.nextCursor,/^[01]:\d+:[a-f0-9-]{36}$/);
 const second=(await call(null,'test-a','?cursor='+encodeURIComponent(first.nextCursor))).data;assert.equal(second.posts.length,1);assert.equal(second.nextCursor,null);
 assert.equal((await call(null,'test-a','?cursor=2:1:'+crypto.randomUUID())).status,400);
 assert.equal((await call(null,'test-a','?sort=likes&offset=20')).data.posts.length,1);
});
test('new-post checks return only records after the caller cursor and preserve exact board activity',async()=>{
 const {call,sql}=setup();await call({action:'profile',name:'Author'});const initial=(await call()).data;const created=Date.now();
 sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,'visible',0,?,?)").run(crypto.randomUUID(),initial.board,initial.me.id,'Fresh board comment',created,crypto.randomUUID());
 const newer=(await call(null,'test-a','?newerThan='+initial.stats.latestCreated)).data;
 assert.equal(newer.posts.length,1);assert.equal(newer.count,1);assert.equal(newer.posts[0].body,'Fresh board comment');assert.equal(newer.latestCreated,created);
});
test('new-post cursor keeps same-timestamp records addressable by id',async()=>{
 const {call,sql}=setup();await call({action:'profile',name:'Author'});const initial=(await call()).data;const created=Date.now();
 const firstId='00000000-0000-4000-8000-000000000001';sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,'visible',0,?,?)").run(firstId,initial.board,initial.me.id,'Same-time first',created,crypto.randomUUID());
 const state=(await call()).data;const cursor=`${state.stats.latestCreated}.${state.stats.latestId}`;const secondId='00000000-0000-4000-8000-000000000002';sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,'visible',0,?,?)").run(secondId,initial.board,initial.me.id,'Same-time second',created,crypto.randomUUID());
 const newer=(await call(null,'test-a','?after='+encodeURIComponent(cursor))).data;assert.equal(newer.posts.length,1);assert.equal(newer.posts[0].body,'Same-time second');
});
test('read marker is persistent, monotonic and rejects future timestamps',async()=>{
 const {call}=setup();const before=(await call()).data;assert.equal(before.previousSeen,0);
 assert.equal((await call({action:'seen',until:before.viewUntil})).status,200);
 assert.equal((await call({action:'seen',until:before.viewUntil-1000})).status,200);
 assert.equal((await call()).data.previousSeen,before.viewUntil);
 assert.equal((await call({action:'seen',until:Date.now()+60000})).status,400);
});



test('badge administration persists and refreshes both owner state and admin rows',()=>{
  const source=readFileSync(new URL('app/community.tsx',root),'utf8');
  assert.match(source,/credentials:'same-origin'/);
  assert.ok(source.includes('await Promise.all([reload(),loadAdmin()])'));
});

test('community board is Japanese-English only with ten-image five-video media caps', () => {
  const source = readFileSync(new URL('app/community.tsx', root), 'utf8');
  const labelsSource = readFileSync(new URL('lib/labels.ts', root), 'utf8');
  const characterConfig = JSON.parse(readFileSync(new URL('config/community-characters.json', root), 'utf8'));
  const activitySource = readFileSync(new URL('lib/activity-labels.ts', root), 'utf8');
  const translationSource = readFileSync(new URL('app/api/translate/route.ts', root), 'utf8');
  const directUpload = readFileSync(new URL('app/api/upload/route.ts', root), 'utf8');
  const videoSession = readFileSync(new URL('app/api/upload/session/route.ts', root), 'utf8');
  assert.deepEqual(rules.languages, ['ja','en']);
  assert.equal(rules.maxImagesPerPost, 10);
  assert.equal(rules.maxVideosPerPost, 5);
  assert.match(labelsSource, /localeNames=\{ja:'🇯🇵 日本語',en:'🇺🇸 English'\}/);
  assert.doesNotMatch(labelsSource, /🇹🇼|🇰🇷|🇹🇭|🇮🇩|🇻🇳/);
  assert.doesNotMatch(activitySource, /zh:|ko:|th:|id:|vi:/);
  assert.match(translationSource, /googleLanguage:Record<Language,string>=\{ja:'ja',en:'en'\}/);
  assert.match(source, /media-picker-hint\">\{t\.mediaLimitHint\}/);
  assert.match(labelsSource, /ここをタップ（1投稿につき動画5本・画像10枚まで）/);
  assert.match(labelsSource, /Tap here \(up to 5 videos and 10 images per post\)/);
  assert.match(labelsSource, /openImage:'Open image'/);
  assert.match(labelsSource, /owner:'Owner'/);
  assert.match(source, /function boardName\(board:Board,lang:Language\)/);
  assert.match(source, /boardName\(b,lang\)/);
  assert.equal(characterConfig.characters.find(character=>character.id==='u1631e-sally').nameEn, 'Cancer Sally');
  assert.match(source, /videoCount>maxVideosPerPost/);
  assert.match(source, /imageCount>maxImagesPerPost/);
  assert.match(source, /else void uploadImage\(fileToSend,description,request,uploadBoard,group\)/);
  assert.match(directUpload, /groupLimit=video\?maxVideosPerPost:maxImagesPerPost/);
  assert.match(videoSession, /maxVideosPerPost/);
});


test('public board chrome localizes Japanese-English status and interaction copy', () => {
  const source = readFileSync(new URL('app/community.tsx', root), 'utf8');
  const labelsSource = readFileSync(new URL('lib/labels.ts', root), 'utf8');
  assert.match(labelsSource, /staleData:'Could not refresh the latest data/);
  assert.match(labelsSource, /newCharacterNote:'Share impressions or useful information/);
  assert.match(labelsSource, /showReplies:'Show \{count\} replies'/);
  assert.match(labelsSource, /reportReceived:'Report received\. The moderation team will review it\.'/);
  assert.match(source, /t\.staleData/);
  assert.match(source, /t\.offlineNotice/);
  assert.match(source, /t\.newCharacterNote/);
  assert.match(source, /t\.showReplies\.replace/);
  assert.match(source, /t\.videoContributor/);
  assert.match(source, /t\.reportReceived/);
  assert.match(source, /uiName\(replyTarget\.name,t\.anonymousUser\)/);
  assert.doesNotMatch(source, /新キャラに関する感想・情報を投稿してください。/);
  assert.doesNotMatch(source, /現在オフラインです。入力内容はこの端末に保存されます。/);
  assert.doesNotMatch(source, /最新データを取得できません。前回の表示を続けています。/);
});


test('media images open one selected item in an accessible lightbox',()=>{
 assert.match(communitySource,/media-image-button/);
 assert.match(communitySource,/setLightbox\(\{src,alt\}\)/);
 assert.match(communitySource,/role="dialog" aria-modal="true"/);
 assert.match(communitySource,/event\.key==='Escape'/);
 assert.match(communityCss,/\.media-lightbox-image/);
 assert.match(communityCss,/\.media-image-button:focus-visible/);
});

test('media groups render as one mixed post and open a shared comparison page',()=>{
 assert.match(communitySource,/media-image-grid/);
 assert.match(communitySource,/media-video-grid/);
 assert.match(communitySource,/media-video-compare-grid/);
 assert.match(communitySource,/group:p\.mediaGroup/);
 assert.match(communitySource,/data\?\.video\?\.id\|\|video/);
 assert.match(communityCss,/\.media-image-grid\.media-count-3\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
 assert.match(communityCss,/\.media-video-compare-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('group detail returns every sibling media item and group moderation stays atomic',async()=>{
 const {call,sql,clearLimits}=setup();await call({action:'profile',name:'Group Tester'});const state=(await call()).data;const group=crypto.randomUUID();let now=Date.now();
 const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 const rows=[[ids[0],'image/jpeg','a.jpg'],[ids[1],'image/png','b.png'],[ids[2],'image/webp','c.webp'],[ids[3],'video/mp4','clip.mp4']];
 for(const [id,type,name] of rows)sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(id,state.board,state.me.id,'Grouped media',`media/${id}`,type,name,100,group,now++,crypto.randomUUID());
 const detail=await call(null,'test-a','?board='+encodeURIComponent(state.board)+'&group='+group);assert.equal(detail.status,200);assert.equal(detail.data.mediaGroup,group);assert.equal(detail.data.mediaItems.length,4);assert.equal(detail.data.video.id,ids[3]);
 const listed=await call();const anchor=listed.data.posts.find(post=>post.id===ids[3]);assert.equal(anchor.mediaItems.length,4);
 clearLimits();assert.equal((await call({action:'moderate',operation:'delete',target:ids[3]})).status,200);assert.deepEqual(sql.prepare('SELECT DISTINCT status FROM posts WHERE media_group=?').all(group).map(row=>row.status),['deleted']);
});


test('grouped media count as one logical post across listing stats, activity, reactions, and replies',async()=>{
 const {call,sql,activityCall}=setup();
 await call({action:'profile',name:'Logical Group Tester'});
 const state=(await call()).data;
 const group=crypto.randomUUID();const start=Date.now();let created=start;
 const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 const rows=[[ids[0],'image/jpeg','a.jpg'],[ids[1],'image/png','b.png'],[ids[2],'image/webp','c.webp'],[ids[3],'video/mp4','one.mp4'],[ids[4],'video/webm','two.webm']];
 for(const [id,type,name] of rows)sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(id,state.board,state.me.id,'One logical post',`media/${id}`,type,name,100,group,created++,crypto.randomUUID());
 const legacyUser=crypto.randomUUID();sql.prepare('INSERT INTO users(id,subject,name,display_name_set,role,created) VALUES(?,?,?,?,?,?)').run(legacyUser,'legacy-reactor','Legacy Reactor',1,'user',Date.now());sql.prepare('INSERT INTO likes(post,user,created) VALUES(?,?,?)').run(ids[0],legacyUser,Date.now());sql.prepare('INSERT INTO helpful(post,user,created) VALUES(?,?,?)').run(ids[0],legacyUser,Date.now());sql.prepare('INSERT INTO visits(subject,seen) VALUES(?,?)').run('test-a',start-1);
 const activity=await activityCall();assert.equal(activity.status,200);assert.equal(activity.data.unread,1);assert.equal(activity.data.featured.id,ids[3]);assert.equal(Number(activity.data.featured.likes),1);assert.equal(Number(activity.data.featured.helpful),1);
 const listed=await call();const grouped=listed.data.posts.filter(post=>post.mediaGroup===group);
 assert.equal(grouped.length,1);assert.equal(grouped[0].mediaItems.length,5);
 assert.equal(listed.data.stats.comments,1);assert.equal(listed.data.stats.todayComments,1);assert.equal(listed.data.stats.videos,2);
 const counted=await call(null,'test-a','?board='+encodeURIComponent(state.board)+'&newerThan='+(start-1)+'&countOnly=1');
 assert.equal(counted.status,200);assert.equal(counted.data.count,1);
 const directLike=await call({action:'like',post:ids[0],liked:true});assert.equal(directLike.status,200);const directHelpful=await call({action:'helpful',post:ids[0],selected:true});assert.equal(directHelpful.status,200);
 assert.deepEqual(sql.prepare('SELECT post FROM likes ORDER BY user').all().map(row=>row.post).sort(),[ids[0],ids[3]].sort());assert.deepEqual(sql.prepare('SELECT post FROM helpful ORDER BY user').all().map(row=>row.post).sort(),[ids[0],ids[3]].sort());
 const afterReactions=(await call()).data.posts.find(post=>post.id===ids[3]);assert.equal(afterReactions.likes,2);assert.equal(afterReactions.helpful,2);
 const reply=await call({action:'post',board:state.board,parent:ids[0],body:'Reply to the grouped post',request:crypto.randomUUID()});assert.equal(reply.status,200);assert.equal(sql.prepare('SELECT parent FROM posts WHERE id=?').get(reply.data.id).parent,ids[3]);assert.deepEqual((await call(null,'test-a','?replies='+ids[0])).data.posts.map(post=>post.id),[reply.data.id]);
 assert.equal((await call({action:'moderate',operation:'delete',target:ids[0]})).status,200);const afterDelete=(await call()).data;assert.equal(afterDelete.posts.some(post=>post.mediaGroup===group),false);assert.equal(afterDelete.stats.comments,0);assert.equal((await call(null,'test-a','?replies='+ids[0])).status,404);
});


test('media groups stay isolated by board and author even if a UUID is reused',async()=>{
 const {call,sql}=setup();await call({action:'profile',name:'Scoped Group Owner'});const state=(await call()).data;const group=crypto.randomUUID();const now=Date.now();const other=crypto.randomUUID();
 sql.prepare("INSERT INTO users(id,subject,name,display_name_set,role,created) VALUES(?,?,?,?,?,?)").run(other,'other:'+other,'Other uploader',1,'user',now);
 const mine=[crypto.randomUUID(),crypto.randomUUID()];for(let i=0;i<mine.length;i++)sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(mine[i],state.board,state.me.id,'mine',`media/${mine[i]}`,'image/jpeg',`mine-${i}.jpg`,100,group,now+i,crypto.randomUUID());
 const otherId=crypto.randomUUID();sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(otherId,state.board,other,'other',`media/${otherId}`,'image/jpeg','other.jpg',100,group,now+10,crypto.randomUUID());
 const listed=(await call()).data.posts.filter(post=>post.mediaGroup===group);assert.equal(listed.length,2);const minePost=listed.find(post=>post.mine);const otherPost=listed.find(post=>!post.mine);assert.ok(minePost);assert.ok(otherPost);assert.deepEqual(minePost.mediaItems.map(item=>item.id),mine);assert.deepEqual(otherPost.mediaItems.map(item=>item.id),[otherId]);
});

test('grouped-media optimistic accounting and scope indexes stay aligned with server semantics',()=>{
 const communitySource=readFileSync(new URL('app/community.tsx',root),'utf8');const boardSource=readFileSync(new URL('app/api/board/route.ts',root),'utf8');const direct=readFileSync(new URL('app/api/upload/route.ts',root),'utf8');const session=readFileSync(new URL('app/api/upload/session/route.ts',root),'utf8');const schemaSource=readFileSync(new URL('db/schema.ts',root),'utf8');const migration=readFileSync(new URL('drizzle/0011_grouped_media_scope_indexes.sql',root),'utf8');
 assert.match(communitySource,/function applyLocalMediaPost/);assert.match(communitySource,/item=>item.mediaGroup===post.mediaGroup/);assert.doesNotMatch(communitySource,/comments:current.stats.comments+1,todayComments:current.stats.todayComments+1/);
 assert.match(boardSource,/SELECT id,board,author,parent,video/);assert.match(boardSource,/byScope/);assert.match(direct,/SELECT author,board FROM posts WHERE media_group=?/);assert.match(session,/SELECT user,board FROM upload_sessions WHERE media_group=?/);
 assert.match(schemaSource,/posts_media_group_scope/);assert.match(schemaSource,/upload_sessions_media_group_scope/);assert.match(migration,/posts_media_group_scope/);assert.match(migration,/upload_sessions_media_group_scope/);
});
