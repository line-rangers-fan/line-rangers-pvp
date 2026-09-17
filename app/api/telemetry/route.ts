import {headers} from 'next/headers';
import {database} from '@/db/raw';

export const dynamic='force-dynamic';

const actions=new Set(['board_load','comment_post','comment_like','comment_helpful','comment_reply','vote','translate','upload_start','upload_complete','upload_part','video_playback','render_error']);

function response(status=204){return new Response(null,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

export async function POST(request:Request){try{
 const h=await headers();const origin=h.get('origin');const sub=h.get('oai-authenticated-user-id');
 if(!sub||!origin||origin!==new URL(request.url).origin||h.get('sec-fetch-site')==='cross-site')return response(204);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return response(204);
 const declared=Number(request.headers.get('content-length')||0);if(declared&&declared>512)return response(204);
 const raw=await request.text();if(raw.length>512)return response(204);const body=JSON.parse(raw) as {action?:unknown;durationMs?:unknown;success?:unknown;errorType?:unknown};
 const action=typeof body.action==='string'&&actions.has(body.action)?body.action:null;const durationMs=typeof body.durationMs==='number'&&Number.isFinite(body.durationMs)?Math.max(0,Math.min(120000,Math.round(body.durationMs))):null;
 if(!action||durationMs===null||typeof body.success!=='boolean')return response(204);
 const now=Date.now();const admitted=await database().prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count').bind('telemetry:'+sub,now+60000,now,now,now,30).first();
 if(admitted)console.info('community_metric',JSON.stringify({action,durationMs,success:body.success,errorType:typeof body.errorType==='string'?body.errorType.slice(0,40):undefined}));
 }catch{console.error('community_metric_rejected');}
 return response();
}
