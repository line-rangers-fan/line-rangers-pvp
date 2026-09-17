import { bucket,database } from '@/db/raw';
import {mediaRange} from '@/lib/media-range';
import {videoInitialRangeBytes} from '@/lib/rules';
export const dynamic='force-dynamic';
type Media={media_key:string;media_type:string;media_size:number};
export async function GET(request:Request){try{
 const id=new URL(request.url).searchParams.get('id')||'';if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'not_found'},{status:404});
 const media=await database().prepare("SELECT p.media_key,p.media_type,p.media_size FROM posts p WHERE p.id=? AND p.status='visible' AND p.media_key IS NOT NULL AND (p.parent IS NULL OR EXISTS(SELECT 1 FROM posts parent WHERE parent.id=p.parent AND parent.status='visible'))").bind(id).first<Media>();if(!media)return Response.json({error:'not_found'},{status:404});
 let range;try{
  range=mediaRange(request.headers.get('range'),media.media_size);
  // Images may still be fetched as a complete small object. Video is always
  // bounded, even for a hand-written URL with no Range header or an open-ended
  // `bytes=0-` request. The browser can request later ranges as it buffers or
  // seeks, so one response can never stream the whole 200 MB object.
  if(media.media_type.startsWith('video/')){
   if(!range)range={start:0,end:Math.min(media.media_size,videoInitialRangeBytes)-1};
   else if(range.end-range.start+1>videoInitialRangeBytes)range={start:range.start,end:Math.min(media.media_size-1,range.start+videoInitialRangeBytes-1)};
  }
 }catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${media.media_size}`,'Cache-Control':'no-store'}});}
 const object=await bucket().get(media.media_key,range?{range:{offset:range.start,length:range.end-range.start+1}}:undefined);if(!object)return Response.json({error:'not_found'},{status:404});
 // Native video players make several byte-range requests while starting and
 // seeking. `no-store` forced every range back through the Worker and R2, so
 // keep this authenticated response browser-private but reusable for a short
 // period. Shared/CDN caches still must not retain viewer-specific media.
 const cacheControl=media.media_type.startsWith('video/')?'private, max-age=600, stale-while-revalidate=120':'private, max-age=300, stale-while-revalidate=60';
 const length=range?range.end-range.start+1:media.media_size;return new Response(object.body,{status:range?206:200,headers:{'Content-Type':media.media_type,'Content-Length':String(length),'Content-Disposition':'inline','Accept-Ranges':'bytes','Cache-Control':cacheControl,'Cross-Origin-Resource-Policy':'same-origin','X-Content-Type-Options':'nosniff',...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${media.media_size}`}:{})}});
 }catch(e){if(e instanceof Error&&e.message==='range')return new Response(null,{status:416,headers:{'Content-Range':'bytes */0'}});console.error('media_read_failed');return Response.json({error:'unavailable'},{status:503});}}
