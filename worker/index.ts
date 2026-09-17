/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  BOARD_ANON_COOKIE_SECRET?: string;
  BOARD_OWNER_ACCESS_TOKEN?: string;
  BOARD_OWNER_SUBJECT?: string;
  PRIVATE_PREVIEW_MODE?: string;
  PRIVATE_PREVIEW_COOKIE_SECRET?: string;
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

const PRIVATE_PREVIEW_COOKIE = "__Host-lr_private_preview";
const PRIVATE_PREVIEW_TTL_SECONDS = 8 * 60 * 60;
const OWNER_COOKIE = "__Host-lr_owner";
const DISPLAY_NAME_COOKIE = "__Host-lr_display_name";
const OWNER_DISPLAY_NAME = "LINEレンジャーは神ゲー";

function privatePreviewEnabled(env: Env) {
  return env.PRIVATE_PREVIEW_MODE === "1";
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  if (header.length > 8192) return "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

async function digestBytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function signBase64url(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function sameSecret(candidate: string, expected: string) {
  const [a, b] = await Promise.all([digestBytes(candidate), digestBytes(expected)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function privateSecurityHeaders(extra: Record<string, string> = {}) {
  return new Headers({
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000",
    ...extra,
  });
}

function privateRedirect() {
  return new Response(null, {
    status: 303,
    headers: privateSecurityHeaders({ location: "/__private/login" }),
  });
}

function privateCookie(value: string, maxAge: number) {
  return PRIVATE_PREVIEW_COOKIE + "=" + value +
    "; Max-Age=" + maxAge + "; Path=/; HttpOnly; Secure; SameSite=Strict";
}

function ownerCookie(value: string, maxAge: number) {
  return OWNER_COOKIE + "=" + value +
    "; Max-Age=" + maxAge + "; Path=/; HttpOnly; Secure; SameSite=Strict";
}

function displayNameCookie(value: string, maxAge: number) {
  return DISPLAY_NAME_COOKIE + "=" + encodeURIComponent(value) +
    "; Max-Age=" + maxAge + "; Path=/; HttpOnly; Secure; SameSite=Lax";
}

async function createPrivateSession(secret: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + PRIVATE_PREVIEW_TTL_SECONDS;
  const payload = "v1|" + issuedAt + "|" + expiresAt + "|" + randomHex();
  return payload.replaceAll("|", ".") + "." + await signBase64url(secret, payload);
}

async function hasPrivateSession(request: Request, env: Env) {
  const secret = env.PRIVATE_PREVIEW_COOKIE_SECRET;
  const raw = readCookie(request, PRIVATE_PREVIEW_COOKIE);
  if (typeof secret !== "string" || secret.length < 32 || !raw || raw.length > 512) return false;
  const parts = raw.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return false;
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt < now ||
    expiresAt - issuedAt > PRIVATE_PREVIEW_TTL_SECONDS
  ) return false;
  const payload = parts.slice(0, 4).join("|");
  const expected = await signBase64url(secret, payload);
  return await sameSecret(parts[4], expected);
}

async function createOwnerCookie(secret: string, subject: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const subjectHash = base64url(await digestBytes(subject));
  const payload = "o1|" + subjectHash + "|" + issuedAt;
  const signature = await signBase64url(secret, payload);
  return "o1." + issuedAt + "." + signature;
}

function privateLoginPage() {
  return [
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Private Owner Preview</title></head><body>",
    "<main><h1>非公開Owner Preview / Private Owner Preview</h1>",
    "<p>運営専用の非公開確認環境です。/ Private owner-only review.</p>",
    "<form method=\"post\" action=\"/__private/activate\" autocomplete=\"off\">",
    "<label>運営アクセス / Owner access ",
    "<input type=\"password\" name=\"access_token\" required minlength=\"1\" autocomplete=\"current-password\"></label>",
    "<button type=\"submit\">入る / Enter</button></form></main>",
    "</body></html>",
  ].join("");
}

async function privateLogin(request: Request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateSecurityHeaders({ allow: "GET, HEAD" }),
    });
  }
  return new Response(request.method === "HEAD" ? null : privateLoginPage(), {
    status: 200,
    headers: privateSecurityHeaders({ "content-type": "text/html; charset=utf-8" }),
  });
}

async function readPrivateAccessToken(request: Request) {
  const raw = await request.text();
  if (raw.length > 4096) return "";
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    try {
      const body = JSON.parse(raw) as { access_token?: unknown };
      return typeof body.access_token === "string" ? body.access_token : "";
    } catch {
      return "";
    }
  }
  return new URLSearchParams(raw).get("access_token") || "";
}

async function privateActivate(request: Request, env: Env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateSecurityHeaders({ allow: "POST" }),
    });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("Forbidden", { status: 403, headers: privateSecurityHeaders() });
  }
  const token = env.BOARD_OWNER_ACCESS_TOKEN || "";
  const subject = env.BOARD_OWNER_SUBJECT || "";
  const anonymousSecret = env.BOARD_ANON_COOKIE_SECRET || "";
  const privateSecret = env.PRIVATE_PREVIEW_COOKIE_SECRET || "";
  if (!token || !subject || anonymousSecret.length < 32 || privateSecret.length < 32) {
    return new Response("Private preview authentication is unavailable", {
      status: 503,
      headers: privateSecurityHeaders(),
    });
  }
  const supplied = await readPrivateAccessToken(request);
  if (!await sameSecret(supplied, token)) {
    return new Response("Unauthorized", { status: 401, headers: privateSecurityHeaders() });
  }
  const privateValue = await createPrivateSession(privateSecret);
  const ownerValue = await createOwnerCookie(anonymousSecret, subject);
  const headers = privateSecurityHeaders({ location: "/" });
  headers.append("set-cookie", privateCookie(privateValue, PRIVATE_PREVIEW_TTL_SECONDS));
  headers.append("set-cookie", ownerCookie(ownerValue, 60 * 60 * 24 * 365));
  headers.append("set-cookie", displayNameCookie(OWNER_DISPLAY_NAME, 60 * 60 * 24 * 365));
  return new Response(null, { status: 303, headers });
}

function privateLogout(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: privateSecurityHeaders({ allow: "POST" }),
    });
  }
  const headers = privateSecurityHeaders({ location: "/__private/login" });
  headers.append("set-cookie", privateCookie("", 0));
  headers.append("set-cookie", ownerCookie("", 0));
  headers.append("set-cookie", displayNameCookie("", 0));
  return new Response(null, { status: 303, headers });
}

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
    if (privatePreviewEnabled(env)) {
      if (url.pathname === "/__private/login") {
        return secureResponse(await privateLogin(request), env);
      }
      if (url.pathname === "/__private/activate") {
        return secureResponse(await privateActivate(request, env), env);
      }
      if (url.pathname === "/__private/logout") {
        return secureResponse(privateLogout(request), env);
      }
      if (!await hasPrivateSession(request, env)) {
        return secureResponse(privateRedirect(), env);
      }
    }
    if (url.pathname === "/_vinext/image") {
      return secureResponse(new Response("image_optimization_disabled", { status: 404 }), env);
    }
    try{
      if(!(await allowMutation(request,env,url.pathname))){
        return secureResponse(Response.json({error:"rate_limited"},{status:429,headers:{"Cache-Control":"no-store","Retry-After":"60"}}), env);
      }
    }catch{
      // The edge limiter is defense in depth. A D1 limiter fault must not take
      // down PvP or bypass the route's own signed-session authorization rules.
      console.error("edge_rate_limit_unavailable");
    }
    return secureResponse(await handler.fetch(request, env, ctx), env);
  },
  scheduled(event:ScheduledControllerLike,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(housekeeping(env,Number.isFinite(event.scheduledTime)?event.scheduledTime:Date.now()).catch(()=>console.error("housekeeping_failed")));
  },
};

// Keep browser-wide protections in the Worker boundary so static assets and
// route handlers receive the same safe defaults without coupling UI code to
// a framework-specific middleware. These headers do not alter API bodies,
// media range responses, or the site's public no-login access model.
function secureResponse(response: Response, env?: Env) {
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  if (env && privatePreviewEnabled(env)) {
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    headers.set("X-Frame-Options", "DENY");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
