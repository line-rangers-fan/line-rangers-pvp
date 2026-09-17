import {headers} from 'next/headers';
import {bucket,database} from '@/db/raw';
import {loadCommunityFeatureFlags,requireCommunityFeature} from '@/lib/community-flags';
import {mediaPartCount} from '@/lib/rules';
import {assertSameOrigin,currentUser,enforceLimit,expectedPartSize,fail,json,readJson,uploadSessionExpired,type UploadSession} from '@/lib/upload-session';

export const dynamic='force-dynamic';

export async function POST(request:Request){try{
 const h=await headers();assertSameOrigin(request,h);const {sub,user,setCookie}=await currentUser(h);if(!user)throw new Error('profile_required');const reply=(data:unknown,status=200)=>json(data,status,setCookie);requireCommunityFeature(await loadCommunityFeatureFlags(database()),'videoUploadEnabled');
 await enforceLimit('write:'+sub,30);await enforceLimit('upload-complete:'+user.id,6,60);
 const body=await readJson(request);const id=String(body.id||'');if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('invalid_request');
 const db=database();const session=await db.prepare('SELECT * FROM upload_sessions WHERE id=? AND user=?').bind(id,user.id).first<UploadSession>();if(!session)throw new Error('not_found');
 if(session.status==='completed'&&session.post)return reply({ok:true,status:'completed',id:session.post});if(session.status!=='uploading')throw new Error('upload_busy');
 if(uploadSessionExpired(session)){await db.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status='uploading'").bind(Date.now(),id).run();throw new Error('upload_expired');}
 const count=mediaPartCount(session.media_size);const rows=(await db.prepare('SELECT part_number,etag,size FROM upload_parts WHERE session=? ORDER BY part_number').bind(id).all()).results as {part_number:number;etag:string;size:number}[];
 if(rows.length!==count||rows.some((row,index)=>row.part_number!==index+1||row.size!==expectedPartSize(row.part_number,session.media_size)))throw new Error('upload_incomplete');
 const multipart=bucket().resumeMultipartUpload(session.media_key,session.upload_id);
 // A lost response can leave R2 complete while the D1 finalization was still
 // pending. HEAD makes completion safe to retry without completing twice.
 const stored=await bucket().head(session.media_key);if(!stored){try{await multipart.complete(rows.map(row=>({partNumber:row.part_number,etag:row.etag})));}catch(e){
  // Another retry may have completed the same R2 upload between HEAD and
  // complete. Accept that race only when the object is now present; transient
  // failures without an object remain errors and leave the session retryable.
  if(!await bucket().head(session.media_key))throw e;
 }}
 const existingPost=await db.prepare('SELECT id FROM posts WHERE author=? AND request=?').bind(user.id,session.request).first<{id:string}>();if(existingPost){await db.prepare("UPDATE upload_sessions SET status='completed',post=?,updated=? WHERE id=?").bind(existingPost.id,Date.now(),id).run();return reply({ok:true,status:'completed',id:existingPost.id});}
 const postId=crypto.randomUUID();const now=Date.now();
 try{await db.batch([
  db.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,'visible',0,?,?)").bind(postId,session.board,user.id,null,session.body,session.media_key,session.media_type,session.media_name,session.media_size,session.media_group,now,session.request),
  db.prepare("UPDATE upload_sessions SET status='completed',post=?,updated=? WHERE id=? AND status='uploading'").bind(postId,now,id),
 ]);}catch(e){const saved=await db.prepare('SELECT id FROM posts WHERE author=? AND request=?').bind(user.id,session.request).first<{id:string}>();if(saved){await db.prepare("UPDATE upload_sessions SET status='completed',post=?,updated=? WHERE id=?").bind(saved.id,Date.now(),id).run();return reply({ok:true,status:'completed',id:saved.id});}throw e;}
 return reply({ok:true,status:'completed',id:postId});
}catch(e){return fail(e);}}
