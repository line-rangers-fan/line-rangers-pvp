import {headers} from 'next/headers';
import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {loadCommunityFeatureFlags,requireCommunityFeature} from '@/lib/community-flags';
import {communityTimeouts} from '@/lib/community-timeouts';
import {languages,type Language} from '@/lib/rules';
import {currentUser} from '@/lib/upload-session';

export const dynamic='force-dynamic';

const googleLanguage:Record<Language,string>={ja:'ja',en:'en'};

function response(data:unknown,status=200,setCookie?:string){const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(setCookie)responseHeaders.set('Set-Cookie',setCookie);return Response.json(data,{status,headers:responseHeaders});}
function fail(code:string,status=400){return response({error:code},status);}
async function limit(key:string,max:number,seconds=60){
 const now=Date.now();const result=await database().prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count').bind(key,now+seconds*1000,now,now,now,max).first();
 if(!result)throw new Error('rate_limited');
}
async function readBody(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('invalid_request');
 const declared=Number(request.headers.get('content-length')||0);if(declared&&declared>4096)throw new Error('invalid_request');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');let raw='';let size=0;const decoder=new TextDecoder();
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new Error('invalid_request');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let body:unknown;try{body=JSON.parse(raw);}catch{throw new Error('invalid_request');}
 if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('invalid_request');return body as Record<string,unknown>;
}

export async function POST(request:Request){try{
 const h=await headers();const origin=h.get('origin');if(!origin||origin!==new URL(request.url).origin||h.get('sec-fetch-site')==='cross-site')throw new Error('forbidden');
 const {sub,setCookie}=await currentUser(h);const reply=(data:unknown,status=200)=>response(data,status,setCookie);await limit('translate:'+sub,12,60);
 const body=await readBody(request);const postId=String(body.post||'');const target=String(body.target||'');
 if(!/^[a-f0-9-]{36}$/.test(postId)||!languages.includes(target as Language))throw new Error('invalid_request');
 const db=database();requireCommunityFeature(await loadCommunityFeatureFlags(db),'translationEnabled');const post=await db.prepare("SELECT p.body FROM posts p WHERE p.id=? AND p.status='visible' AND (p.parent IS NULL OR EXISTS(SELECT 1 FROM posts parent WHERE parent.id=p.parent AND parent.status='visible'))").bind(postId).first<{body:string}>();if(!post)throw new Error('not_found');
 const cached=await db.prepare('SELECT body FROM translations WHERE post=? AND language=?').bind(postId,target).first<{body:string}>();if(cached)return reply({body:cached.body,cached:true});
 const apiKey=(env as unknown as Record<string,string|undefined>).GOOGLE_TRANSLATE_API_KEY;if(!apiKey)throw new Error('translation_unavailable');
 const upstream=await fetch('https://translation.googleapis.com/language/translate/v2?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:post.body,target:googleLanguage[target as Language],format:'text'}),signal:AbortSignal.timeout(communityTimeouts.translationMs)});
 if(!upstream.ok)throw new Error('translation_unavailable');
 const result=await upstream.json() as {data?:{translations?:{translatedText?:unknown}[]}};const translated=result.data?.translations?.[0]?.translatedText;
 if(typeof translated!=='string'||!translated.trim()||[...translated].length>8000)throw new Error('translation_unavailable');
 await db.prepare('INSERT INTO translations(post,language,body) VALUES(?,?,?) ON CONFLICT(post,language) DO NOTHING').bind(postId,target,translated).run();
 const saved=await db.prepare('SELECT body FROM translations WHERE post=? AND language=?').bind(postId,target).first<{body:string}>();return reply({body:saved?.body||translated,cached:false});
}catch(e){
 const code=e instanceof Error?e.message:'';if(['signin_required','forbidden','invalid_request','not_found','rate_limited','translation_unavailable','feature_disabled','anonymous_unavailable'].includes(code))return fail(code,code==='signin_required'?401:code==='forbidden'?403:code==='not_found'?404:code==='rate_limited'?429:['translation_unavailable','feature_disabled','anonymous_unavailable'].includes(code)?503:400);
 console.error('translation_request_failed');return fail('translation_unavailable',503);
}}
