import { headers } from 'next/headers';
import { bucket,database } from '@/db/raw';
import {loadCommunityFeatureFlags,requireCommunityFeature} from '@/lib/community-flags';
import { isConfirmedCharacterForMonth,isVideoMedia,legacyMultipartMediaBytes,maxImagesPerPost,maxVideosPerPost,monthJST,optionalTextInput,validateMedia } from '@/lib/rules';
import {currentUser} from '@/lib/upload-session';
export const dynamic='force-dynamic';
function reply(data:unknown,status=200,setCookie?:string){const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(setCookie)responseHeaders.set('Set-Cookie',setCookie);return Response.json(data,{status,headers:responseHeaders});}
function fail(e:unknown){const code=e instanceof Error?e.message:'';const known=['signin_required','profile_required','invalid_text','invalid_media','text_only','rate_limited','not_found','forbidden','invalid_request','media_group_full','feature_disabled','read_only','archive_readonly'];if(!known.includes(code)){console.error('media_upload_failed');return reply({error:'unavailable'},503);}return reply({error:code},code==='signin_required'?401:code==='forbidden'?403:code==='rate_limited'?429:code==='not_found'?404:code==='media_group_full'||code==='archive_readonly'?409:['feature_disabled','read_only'].includes(code)?503:400);}
async function limit(key:string,max:number,seconds:number){const now=Date.now();const result=await database().prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count').bind(key,now+seconds*1000,now,now,now,max).first();if(!result)throw new Error('rate_limited');}
// PUT is an idempotent media operation, not a framework multipart server action.
export async function PUT(request:Request){try{
 const h=await headers();const origin=h.get('origin');
 if(!origin||origin!==new URL(request.url).origin||h.get('sec-fetch-site')==='cross-site')throw new Error('forbidden');
 // Compatibility endpoint for already-deployed clients. New clients use the
 // chunked session/part/complete flow so long videos never enter this buffer.
 const length=Number(request.headers.get('content-length')||0);if(length&&length>legacyMultipartMediaBytes+16000)throw new Error('invalid_media');
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))throw new Error('invalid_request');
 const db=database();const session=await currentUser(h);const sub=session.sub;const me=session.user;if(!me)throw new Error('profile_required');const send=(data:unknown,status=200)=>reply(data,status,session.setCookie);const flags=await loadCommunityFeatureFlags(db);requireCommunityFeature(flags,'commentsEnabled');
 // One legitimate image post may contain ten images. Keep the per-minute bound
 // slightly above that so one retry is possible without allowing unbounded use.
 await limit('write:'+sub,30,60);await limit('upload:'+me.id,12,60);
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>legacyMultipartMediaBytes+16000){await reader.cancel();throw new Error('invalid_media');}chunks.push(value);}
 const form=await new Response(new Blob(chunks as BlobPart[]),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();const file=form.get('file');if(!(file instanceof File))throw new Error('invalid_media');
 if(form.has('parent')||form.has('video'))throw new Error('text_only');
 const board=String(form.get('board')||'');const body=optionalTextInput(form.get('body')||'',2000);const requestId=String(form.get('request')||'');const groupValue=form.get('group');const mediaGroup=groupValue?String(groupValue):null;if(mediaGroup&&!/^[a-f0-9-]{36}$/.test(mediaGroup))throw new Error('invalid_request');
 if(!/^[a-f0-9-]{36}$/.test(requestId))throw new Error('invalid_request');
 const topic=await db.prepare('SELECT character,month FROM boards WHERE id=?').bind(board).first<{character:string;month:string}>();
 if(!topic)throw new Error('not_found');if(topic.month!==monthJST())throw new Error('archive_readonly');if(!isConfirmedCharacterForMonth(topic.character,topic.month))throw new Error('not_found');
 const existing=await db.prepare('SELECT id FROM posts WHERE author=? AND request=?').bind(me.id,requestId).first<{id:string}>();if(existing)return send({ok:true,id:existing.id});
 if(mediaGroup){const groupPost=await db.prepare("SELECT author,board FROM posts WHERE media_group=? AND status='visible' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{author:string;board:string}>();const groupSession=await db.prepare("SELECT user,board FROM upload_sessions WHERE media_group=? AND status='uploading' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{user:string;board:string}>();if(groupPost&&(groupPost.author!==me.id||groupPost.board!==board))throw new Error('forbidden');if(groupSession&&(groupSession.user!==me.id||groupSession.board!==board))throw new Error('forbidden');}
 const extension=await validateMedia(file,legacyMultipartMediaBytes);const video=isVideoMedia(file.type);if(video)requireCommunityFeature(flags,'videoUploadEnabled');
 const groupLimit=video?maxVideosPerPost:maxImagesPerPost;const groupFilter=video?"media_type LIKE 'video/%'":"media_type LIKE 'image/%'";
 if(mediaGroup){const grouped=await db.prepare(`SELECT COUNT(*) count FROM posts WHERE author=? AND media_group=? AND status='visible' AND ${groupFilter}`).bind(me.id,mediaGroup).first<{count:number}>();if(Number(grouped?.count||0)>=groupLimit)throw new Error('media_group_full');}
 const key=`uploads/${me.id}/${crypto.randomUUID()}.${extension}`;const now=Date.now();
 // Check before writing to object storage, then enforce the same limit again in
 // the INSERT below so concurrent requests cannot all pass the first count.
 await bucket().put(key,file.stream(),{httpMetadata:{contentType:file.type,contentDisposition:`inline; filename="attachment.${extension}"`}});
 try{
  const id=crypto.randomUUID();let inserted;
  if(mediaGroup){inserted=await db.prepare(`INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) SELECT ?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,? WHERE (SELECT COUNT(*) FROM posts WHERE author=? AND media_group=? AND status='visible' AND ${groupFilter}) < ?`).bind(id,board,me.id,body,key,file.type,file.name.slice(0,120),file.size,mediaGroup,now,requestId,me.id,mediaGroup,groupLimit).run();}
  else inserted=await db.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,'visible',0,?,?)").bind(id,board,me.id,null,body,key,file.type,file.name.slice(0,120),file.size,null,now,requestId).run();
  const changes=Number((inserted as {meta?:{changes?:number}}).meta?.changes||0);if(changes!==1){const saved=await db.prepare('SELECT id,media_key FROM posts WHERE author=? AND request=?').bind(me.id,requestId).first<{id:string;media_key:string}>();if(saved){if(saved.media_key!==key)await bucket().delete(key);return send({ok:true,id:saved.id});}await bucket().delete(key);throw new Error('media_group_full');}
  return send({ok:true,id});
 }
 catch(e){const saved=await db.prepare('SELECT id,media_key FROM posts WHERE author=? AND request=?').bind(me.id,requestId).first<{id:string;media_key:string}>();if(saved){if(saved.media_key!==key)await bucket().delete(key);return send({ok:true,id:saved.id});}await bucket().delete(key);throw e;}
 }catch(e){return fail(e);}}