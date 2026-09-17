import {headers} from 'next/headers';
import {bucket,database} from '@/db/raw';
import {loadCommunityFeatureFlags,requireCommunityFeature} from '@/lib/community-flags';
import {uploadPartLimit,uploadPartWindowSeconds} from '@/lib/rules';
import {headerMatches} from '@/lib/upload-session';
import {assertSameOrigin,captureAndCount,currentUser,enforceLimit,expectedPartSize,fail,json,uploadSessionExpired,type UploadSession} from '@/lib/upload-session';

export const dynamic='force-dynamic';

export async function PUT(request:Request){try{
 const h=await headers();assertSameOrigin(request,h);const {user,setCookie}=await currentUser(h);if(!user)throw new Error('profile_required');const reply=(data:unknown,status=200)=>json(data,status,setCookie);requireCommunityFeature(await loadCommunityFeatureFlags(database()),'videoUploadEnabled');
 // A 200 MiB video has 25 chunks.  Do not consume the general write budget for
 // every chunk; this dedicated, bounded allowance also covers normal retries.
 await enforceLimit('upload-part:'+user.id,uploadPartLimit,uploadPartWindowSeconds);
 const query=new URL(request.url).searchParams;const id=query.get('id')||'';const part=Number(query.get('part'));
 if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(part)||part<1)throw new Error('invalid_request');
 if(request.headers.get('content-type')!=='application/octet-stream')throw new Error('invalid_request');
 const db=database();const session=await db.prepare('SELECT * FROM upload_sessions WHERE id=? AND user=?').bind(id,user.id).first<UploadSession>();if(!session)throw new Error('not_found');
 if(session.status==='completed')return reply({ok:true,status:'completed',part});if(session.status!=='uploading')throw new Error('upload_busy');
 if(uploadSessionExpired(session)){await db.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status='uploading'").bind(Date.now(),id).run();throw new Error('upload_expired');}
 const expected=expectedPartSize(part,session.media_size);const declared=Number(request.headers.get('content-length')||0);if(declared&&declared!==expected)throw new Error('invalid_media');
 const existing=await db.prepare('SELECT part_number,size FROM upload_parts WHERE session=? AND part_number=?').bind(id,part).first<{part_number:number;size:number}>();if(existing){if(existing.size!==expected)throw new Error('invalid_media');return reply({ok:true,part,size:existing.size,already:true});}
 if(!request.body)throw new Error('invalid_media');
 const monitored=captureAndCount(request.body,expected,16);const fixed=new FixedLengthStream(expected);const upload=bucket().resumeMultipartUpload(session.media_key,session.upload_id);
 try{
  const forwarding=monitored.stream.pipeTo(fixed.writable);const [uploaded]=await Promise.all([upload.uploadPart(part,fixed.readable),forwarding]);
  if(part===1&&!headerMatches(session.media_type,monitored.getPrefix()))throw new Error('invalid_media');
  const now=Date.now();await db.prepare('INSERT INTO upload_parts(session,part_number,etag,size,created) VALUES(?,?,?,?,?) ON CONFLICT(session,part_number) DO UPDATE SET etag=excluded.etag,size=excluded.size,created=excluded.created').bind(id,part,uploaded.etag,monitored.getSize(),now).run();await db.prepare('UPDATE upload_sessions SET updated=? WHERE id=? AND status=\'uploading\'').bind(now,id).run();
 }catch(e){
  // Deterministic validation failures must not leave an R2 multipart upload
  // writable or waiting for the daily garbage-collector. Transport failures
  // stay resumable; the client can retry the same part.
  if(e instanceof Error&&e.message==='invalid_media'){
   try{await upload.abort();}catch{}
   await db.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status='uploading'").bind(Date.now(),id).run();
  }
  throw e;
 }
 return reply({ok:true,part,size:monitored.getSize()});
}catch(e){return fail(e);}}
