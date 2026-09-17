import {headers} from 'next/headers';
import {abuseNetworkBucket,activateOwner} from '@/lib/anonymous-session';
import {enforceLimit} from '@/lib/upload-session';

export const dynamic='force-dynamic';

async function readAccessKey(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('invalid_request');
 const declared=Number(request.headers.get('content-length')||0);if(!Number.isSafeInteger(declared)||declared>512)throw new Error('invalid_request');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_request');
 const decoder=new TextDecoder();let raw='';let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();throw new Error('invalid_request');}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();let body:{key?:unknown};try{body=JSON.parse(raw) as {key?:unknown};}catch{throw new Error('invalid_request');}
 const key=typeof body?.key==='string'?body.key.trim():'';
 if(!key||key.length>256)throw new Error('forbidden');return key;
}

/**
 * Owner activation is deliberately a separate, non-indexed entry point.
 * The access token is exchanged once for an HttpOnly signed cookie and is
 * never echoed back to the browser. Normal visitors continue to use the
 * anonymous session path and cannot elevate themselves by changing a name.
 */
export async function POST(request:Request){
 const h=await headers();const origin=h.get('origin');
 const common={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
 if(!origin||origin!==new URL(request.url).origin||h.get('sec-fetch-site')==='cross-site')return Response.json({error:'forbidden'},{status:403,headers:common});
 try{
  // Bound guesses by a privacy-preserving HMAC of Cloudflare's network source,
  // never by a raw IP. The global ceiling is deliberately much looser than
  // the per-network ceiling so distributed noise cannot cheaply lock out the
  // legitimate Owner while still bounding pathological aggregate traffic.
  const network=await abuseNetworkBucket(h);
  if(network)await enforceLimit('owner-net:'+network,10,600);else await enforceLimit('owner-activation',10,600);
  await enforceLimit('owner-global',600,600);
  const key=await readAccessKey(request);
  const activated=await activateOwner(key);
  if(!activated)return Response.json({error:'forbidden'},{status:403,headers:common});
  const responseHeaders=new Headers(common);responseHeaders.append('Set-Cookie',activated.setCookie);for(const cookie of activated.setCookies||[])responseHeaders.append('Set-Cookie',cookie);return Response.json({ok:true},{status:200,headers:responseHeaders});
 }catch(e){const status=e instanceof Error&&e.message==='rate_limited'?429:403;return Response.json({error:status===429?'rate_limited':'forbidden'},{status,headers:common});}
}

export async function GET(){return Response.json({error:'method_not_allowed'},{status:405,headers:{'Cache-Control':'no-store','Allow':'POST','X-Content-Type-Options':'nosniff'}});}
