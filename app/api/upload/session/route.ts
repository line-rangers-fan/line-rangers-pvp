import {headers} from 'next/headers';
import {bucket,database} from '@/db/raw';
import {loadCommunityFeatureFlags,requireCommunityFeature} from '@/lib/community-flags';
import {isConfirmedCharacterForMonth,isVideoMedia,maxVideosPerPost,mediaExtension,mediaPartBytes,mediaPartCount,maxMediaBytes,monthJST,optionalTextInput} from '@/lib/rules';
import {assertSameOrigin,currentUser,enforceLimit,fail,json,readJson,requestId,safeMediaName,uploadSessionExpired,type UploadSession} from '@/lib/upload-session';

export const dynamic='force-dynamic';

async function cleanupExpiredForUser(userId:string,now=Date.now()){
 const db=database();const cutoff=now-24*60*60*1000;
 const stale=(await db.prepare("SELECT id,media_key,upload_id FROM upload_sessions WHERE user=? AND status='uploading' AND created<? ORDER BY created ASC LIMIT 3").bind(userId,cutoff).all()).results as {id:string;media_key:string;upload_id:string}[];
 for(const row of stale){
  const changed=await db.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status='uploading'").bind(now,row.id).run();
  if(Number((changed as {meta?:{changes?:number}}).meta?.changes||0)!==1)continue;
  try{await bucket().resumeMultipartUpload(row.media_key,row.upload_id).abort();}catch{console.error('expired_upload_cleanup_failed');}
 }
}

export async function POST(request:Request){try{
 const h=await headers();assertSameOrigin(request,h);const {sub,user,setCookie}=await currentUser(h);if(!user)throw new Error('profile_required');const reply=(data:unknown,status=200)=>json(data,status,setCookie);requireCommunityFeature(await loadCommunityFeatureFlags(database()),'videoUploadEnabled');
 // A valid grouped post may start five video sessions at once. Keep one spare
 // request for a recovery retry while retaining the global write ceiling.
 await enforceLimit('write:'+sub,30);await enforceLimit('upload-session:'+user.id,6,60);
 const body=await readJson(request);const board=String(body.board||'');const mediaType=String(body.type||'');const extension=mediaExtension(mediaType);
 const size=Number(body.size);if(!extension||!isVideoMedia(mediaType)||!Number.isSafeInteger(size)||size<32||size>maxMediaBytes)throw new Error('invalid_media');
 const mediaGroup=body.group===undefined||body.group===null||body.group===''?null:requestId(body.group);
 const name=safeMediaName(body.name);const requestValue=requestId(body.request);const text=optionalTextInput(body.body===undefined?'':body.body,2000);
 const topic=await database().prepare('SELECT character,month FROM boards WHERE id=?').bind(board).first<{character:string;month:string}>();if(!topic)throw new Error('not_found');if(topic.month!==monthJST())throw new Error('archive_readonly');if(!isConfirmedCharacterForMonth(topic.character,topic.month))throw new Error('not_found');
 const db=database();const existingPost=await db.prepare('SELECT id FROM posts WHERE author=? AND request=?').bind(user.id,requestValue).first<{id:string}>();if(existingPost)return reply({ok:true,status:'completed',id:existingPost.id});
 const existing=await db.prepare('SELECT * FROM upload_sessions WHERE user=? AND request=?').bind(user.id,requestValue).first<UploadSession>();
 if(existing){
  if(existing.status==='completed'&&existing.post)return json({ok:true,status:'completed',id:existing.post,uploadedParts:[]});
  if(uploadSessionExpired(existing)){await db.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status='uploading'").bind(Date.now(),existing.id).run();throw new Error('upload_expired');}
  if(existing.status!=='uploading'||existing.board!==board||existing.media_type!==mediaType||existing.media_size!==size||existing.media_name!==name||existing.body!==text||existing.media_group!==mediaGroup)throw new Error('upload_busy');
  // Returning durable part numbers lets a selected file resume from the first
  // missing chunk after a timeout, retry, or page reload. The browser never
  // needs to retransmit chunks already accepted by R2 and recorded in D1.
  const uploadedParts=(await db.prepare('SELECT part_number FROM upload_parts WHERE session=? ORDER BY part_number').bind(existing.id).all()).results.map(row=>Number((row as {part_number:number}).part_number));
  return reply({ok:true,status:'uploading',id:existing.id,partSize:existing.part_size,parts:mediaPartCount(existing.media_size),uploadedParts,maxBytes:maxMediaBytes});
 }
 if(mediaGroup){const groupPost=await db.prepare("SELECT author,board FROM posts WHERE media_group=? AND status='visible' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{author:string;board:string}>();const groupSession=await db.prepare("SELECT user,board FROM upload_sessions WHERE media_group=? AND status='uploading' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{user:string;board:string}>();if(groupPost&&(groupPost.author!==user.id||groupPost.board!==board))throw new Error('forbidden');if(groupSession&&(groupSession.user!==user.id||groupSession.board!==board))throw new Error('forbidden');const grouped=await db.prepare("SELECT (SELECT COUNT(*) FROM posts WHERE author=? AND media_group=? AND status='visible' AND media_type LIKE 'video/%')+(SELECT COUNT(*) FROM upload_sessions WHERE user=? AND media_group=? AND status='uploading' AND media_type LIKE 'video/%') count").bind(user.id,mediaGroup,user.id,mediaGroup).first<{count:number}>();if(Number(grouped?.count||0)>=maxVideosPerPost)throw new Error('media_group_full');}
 await cleanupExpiredForUser(user.id);
 const id=crypto.randomUUID();const key=`uploads/${user.id}/${id}.${extension}`;const now=Date.now();
 const upload=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:mediaType,contentDisposition:`inline; filename="attachment.${extension}"`}});
 try{
  let inserted;
  if(mediaGroup){inserted=await db.prepare("INSERT INTO upload_sessions(id,user,board,body,request,media_key,media_type,media_name,media_size,media_group,upload_id,part_size,status,post,created,updated) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'uploading',NULL,?,? WHERE (SELECT COUNT(*) FROM posts WHERE author=? AND media_group=? AND status='visible' AND media_type LIKE 'video/%')+(SELECT COUNT(*) FROM upload_sessions WHERE user=? AND media_group=? AND status='uploading' AND media_type LIKE 'video/%') < ?").bind(id,user.id,board,text,requestValue,key,mediaType,name,size,mediaGroup,upload.uploadId,mediaPartBytes,now,now,user.id,mediaGroup,user.id,mediaGroup,maxVideosPerPost).run();}
  else inserted=await db.prepare("INSERT INTO upload_sessions(id,user,board,body,request,media_key,media_type,media_name,media_size,media_group,upload_id,part_size,status,post,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'uploading',NULL,?,?)").bind(id,user.id,board,text,requestValue,key,mediaType,name,size,null,upload.uploadId,mediaPartBytes,now,now).run();
  if(Number((inserted as {meta?:{changes?:number}}).meta?.changes||0)!==1){await upload.abort();throw new Error('media_group_full');}
 }
 catch(e){try{await upload.abort();}catch{}throw e;}
 return reply({ok:true,status:'uploading',id,partSize:mediaPartBytes,parts:mediaPartCount(size),uploadedParts:[],maxBytes:maxMediaBytes});
}catch(e){return fail(e);}}