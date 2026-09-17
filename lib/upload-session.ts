import {database} from '@/db/raw';
import {mediaPartBytes,mediaPartCount,validMediaHeader,ownerDisplayName} from '@/lib/rules';
import {guestName,sessionFromHeaders} from '@/lib/anonymous-session';

export type UploadUser={id:string;name?:string;display_name_set?:number;role?:string};
export type UploadSession={id:string;user:string;board:string;body:string;request:string;media_key:string;media_type:string;media_name:string;media_size:number;media_group:string|null;upload_id:string;part_size:number;status:string;post:string|null;created:number;updated:number};

// A resumable upload should survive a short connection loss, but it must not
// remain writable indefinitely.  Keeping the check in the request path means
// an old tab cannot complete an abandoned multipart upload months later.
export const uploadSessionMaxAgeMs=24*60*60*1000;
export function uploadSessionExpired(session:Pick<UploadSession,'created'>,now=Date.now()){
 return !Number.isSafeInteger(session.created)||now-session.created>uploadSessionMaxAgeMs;
}

export function json(data:unknown,status=200,setCookie?:string){const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(setCookie)responseHeaders.set('Set-Cookie',setCookie);return Response.json(data,{status,headers:responseHeaders});}
export function fail(e:unknown){
 const code=e instanceof Error?e.message:'';
 const known=['signin_required','profile_required','invalid_text','invalid_media','text_only','rate_limited','not_found','forbidden','invalid_request','upload_incomplete','upload_expired','upload_busy','media_group_full','feature_disabled','read_only','archive_readonly','anonymous_unavailable'];
 if(!known.includes(code)){console.error('media_upload_failed');return json({error:'unavailable'},503);}
 const status=code==='signin_required'?401:code==='forbidden'?403:code==='rate_limited'?429:code==='not_found'?404:code==='upload_busy'||code==='media_group_full'||code==='archive_readonly'?409:['feature_disabled','read_only','anonymous_unavailable'].includes(code)?503:400;
 return json({error:code},status);
}
export function assertSameOrigin(request:Request,h:Headers){
 const origin=h.get('origin');
 if(!origin||origin!==new URL(request.url).origin||h.get('sec-fetch-site')==='cross-site')throw new Error('forbidden');
}
export async function currentUser(h:Headers){
 const session=await sessionFromHeaders(h);const {sub}=session;const db=database();let user=await db.prepare('SELECT id,name,display_name_set,role FROM users WHERE subject=?').bind(sub).first<UploadUser>();
 const fallbackName=session.owner?ownerDisplayName:session.anonymous?session.displayName||guestName(sub):guestName(sub);
 if(!user){await db.prepare("INSERT OR IGNORE INTO users(id,subject,name,display_name_set,role,created) VALUES(?,?,?, ?,CASE WHEN ? AND NOT EXISTS(SELECT 1 FROM users WHERE role='owner') THEN 'owner' ELSE 'user' END,?)").bind(crypto.randomUUID(),sub,fallbackName,session.owner||!!session.displayName?1:0,session.owner?1:0,Date.now()).run();user=await db.prepare('SELECT id,name,display_name_set,role FROM users WHERE subject=?').bind(sub).first<UploadUser>();}
 else if(session.owner){await db.prepare("UPDATE users SET name=?,display_name_set=1,role=CASE WHEN role='user' AND NOT EXISTS(SELECT 1 FROM users WHERE role='owner' AND subject<>?) THEN 'owner' ELSE role END WHERE subject=?").bind(ownerDisplayName,sub,sub).run();user=await db.prepare('SELECT id,name,display_name_set,role FROM users WHERE subject=?').bind(sub).first<UploadUser>();}
 else if(user.role==='owner'){await db.prepare("UPDATE users SET name=?,display_name_set=1 WHERE subject=?").bind(ownerDisplayName,sub).run();user=await db.prepare('SELECT id,name,display_name_set,role FROM users WHERE subject=?').bind(sub).first<UploadUser>();}
 else if((session.anonymous&&session.displayName&&user.name===guestName(sub))||session.displayName&&!user.display_name_set){await db.prepare("UPDATE users SET name=CASE WHEN ? IS NOT NULL AND name=? THEN ? ELSE name END,display_name_set=CASE WHEN ? THEN 1 ELSE display_name_set END WHERE subject=?").bind(session.displayName||null,guestName(sub),session.displayName||user.name,1,sub).run();user=await db.prepare('SELECT id,name,display_name_set,role FROM users WHERE subject=?').bind(sub).first<UploadUser>();}
 return {sub,user,setCookie:session.setCookie};
}
export async function enforceLimit(key:string,max:number,seconds=60){
 const now=Date.now();
 const result=await database().prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count').bind(key,now+seconds*1000,now,now,now,max).first();
 if(!result)throw new Error('rate_limited');
}
export async function readJson(request:Request,maxBytes=16000){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('invalid_request');
 const declared=Number(request.headers.get('content-length')||0);if(declared&&declared>maxBytes)throw new Error('invalid_request');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');let raw='';let size=0;const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('invalid_request');}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();try{const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('invalid_request');return value as Record<string,unknown>;}catch(e){if(e instanceof Error&&e.message==='invalid_request')throw e;throw new Error('invalid_request');}
}
export function safeMediaName(value:unknown){
 if(typeof value!=='string')throw new Error('invalid_media');
 const name=value.normalize('NFC').replace(/[\\/]/g,'_').trim();
 if(!name||[...name].length>120||/[\u0000-\u001f\u007f]/.test(name))throw new Error('invalid_media');
 return name;
}
export function requestId(value:unknown){
 const id=String(value||'');if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('invalid_request');return id;
}
export function expectedPartSize(part:number,total:number){
 const count=mediaPartCount(total);if(!Number.isSafeInteger(part)||part<1||part>count)throw new Error('invalid_media');
 return part<count?mediaPartBytes:total-mediaPartBytes*(count-1);
}
export function captureAndCount(input:ReadableStream<Uint8Array>,expected:number,captureBytes=16){
 let size=0;let prefix=new Uint8Array(0);
 const stream=new ReadableStream<Uint8Array>({start(controller){
  const reader=input.getReader();
  const pump=async()=>{try{for(;;){const {done,value}=await reader.read();if(done){if(size!==expected){controller.error(new Error('invalid_media'));return;}controller.close();return;}size+=value.byteLength;if(size>expected){await reader.cancel();controller.error(new Error('invalid_media'));return;}if(prefix.length<captureBytes){const take=Math.min(captureBytes-prefix.length,value.byteLength);const next=new Uint8Array(prefix.length+take);next.set(prefix);next.set(value.subarray(0,take),prefix.length);prefix=next;}controller.enqueue(value);}}catch(e){controller.error(e);}};
  void pump();
 }});
 return {stream,getSize:()=>size,getPrefix:()=>prefix};
}
export function headerMatches(type:string,prefix:Uint8Array){return prefix.length>=16&&validMediaHeader(type,prefix);}
