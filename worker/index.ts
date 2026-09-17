/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  BOARD_ANON_COOKIE_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ScheduledControllerLike {scheduledTime:number;cron:string;noRetry():void;}

type MutationBudget={max:number;seconds:number};
const encoder=new TextEncoder();
const DAY_MS=24*60*60*1000;

function mutationBudget(request:Request,path:string):MutationBudget|null{
  const method=request.method.toUpperCase();
  if(path==="/api/board"&&method==="POST")return {max:120,seconds:600};
  if(path==="/api/owner"&&method==="POST")return {max:30,seconds:600};
  if(path==="/api/translate"&&method==="POST")return {max:60,seconds:600};
  if(path==="/api/telemetry"&&method==="POST")return {max:240,seconds:600};
  if(path==="/api/upload"&&method==="PUT")return {max:12,seconds:600};
  if(path==="/api/upload/session"&&method==="POST")return {max:15,seconds:600};
  if(path==="/api/upload/complete"&&method==="POST")return {max:30,seconds:600};
  if(path==="/api/upload/part"&&method==="PUT")return {max:180,seconds:600};
  return null;
}

function base64url(bytes:Uint8Array){let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");}
async function networkBucket(request:Request,env:Env){
  const ip=request.headers.get("cf-connecting-ip")?.trim()||"";
  const secret=env.BOARD_ANON_COOKIE_SECRET;
  if(!ip||ip.length>64||!/^[0-9A-Fa-f:.]+$/.test(ip)||typeof secret!=="string"||secret.length<32)return null;
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=await crypto.subtle.sign("HMAC",key,encoder.encode(`edge-network|${ip}`));
  return base64url(new Uint8Array(signed)).slice(0,24);
}
async function allowMutation(request:Request,env:Env,path:string){
  const budget=mutationBudget(request,path);if(!budget)return true;
  const bucket=await networkBucket(request,env);if(!bucket)return true;
  const now=Date.now();const key=`edge:${path}:${request.method}:${bucket}`;
  const result=await env.DB.prepare("INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count")
    .bind(key,now+budget.seconds*1000,now,now,now,budget.max).first();
  return !!result;
}

async function housekeeping(env:Env,now:number){
  // Abort only bounded, expired multipart sessions. If a multipart complete
  // succeeded but D1 finalization failed, also remove the key only when no post
  // owns it. Deleted post media is handled by the durable cleanup queue below.
  const expired=(await env.DB.prepare("SELECT id,media_key,upload_id FROM upload_sessions WHERE status IN ('uploading','failed') AND created<? ORDER BY created ASC LIMIT 50").bind(now-DAY_MS).all()).results as {id:string;media_key:string;upload_id:string}[];
  for(const row of expired){
    try{await env.BUCKET.resumeMultipartUpload(row.media_key,row.upload_id).abort();}catch{}
    const owner=await env.DB.prepare('SELECT 1 FROM posts WHERE media_key=? LIMIT 1').bind(row.media_key).first();
    if(!owner){try{await env.BUCKET.delete(row.media_key);}catch{}}
    await env.DB.prepare("UPDATE upload_sessions SET status='failed',updated=? WHERE id=? AND status<>'completed'").bind(now,row.id).run();
  }
  const pendingMedia=(await env.DB.prepare("SELECT media_key FROM media_cleanup ORDER BY created ASC LIMIT 50").all()).results as {media_key:string}[];
  for(const row of pendingMedia){
    try{await env.BUCKET.delete(row.media_key);await env.DB.prepare("DELETE FROM media_cleanup WHERE media_key=?").bind(row.media_key).run();}catch{}
  }
  const sessionCutoff=now-7*DAY_MS;
  const limitCutoff=now-DAY_MS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upload_parts WHERE session IN (SELECT id FROM upload_sessions WHERE status IN ('failed','completed') AND updated<?)").bind(sessionCutoff),
    env.DB.prepare("DELETE FROM upload_sessions WHERE status IN ('failed','completed') AND updated<?").bind(sessionCutoff),
    env.DB.prepare("DELETE FROM limits WHERE until<?").bind(limitCutoff),
  ]);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url=new URL(request.url);
    // This review deployment intentionally does not bind Cloudflare Images.
    // Character/media assets are served directly, avoiding a paid image-
    // transformation dependency while the site is still under development.
    if (url.pathname === "/_vinext/image") {
      return secureResponse(new Response("image_optimization_disabled", { status: 404 }));
    }
    try{
      if(!(await allowMutation(request,env,url.pathname))){
        return secureResponse(Response.json({error:"rate_limited"},{status:429,headers:{"Cache-Control":"no-store","Retry-After":"60"}}));
      }
    }catch{
      // The edge limiter is defense in depth. A D1 limiter fault must not take
      // down PvP or bypass the route's own signed-session authorization rules.
      console.error("edge_rate_limit_unavailable");
    }
    return secureResponse(await handler.fetch(request, env, ctx));
  },
  scheduled(event:ScheduledControllerLike,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(housekeeping(env,Number.isFinite(event.scheduledTime)?event.scheduledTime:Date.now()).catch(()=>console.error("housekeeping_failed")));
  },
};

// Keep browser-wide protections in the Worker boundary so static assets and
// route handlers receive the same safe defaults without coupling UI code to
// a framework-specific middleware. These headers do not alter API bodies,
// media range responses, or the site's public no-login access model.
function secureResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
