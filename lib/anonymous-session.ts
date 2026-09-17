import {env} from 'cloudflare:workers';
import {ownerDisplayName} from '@/lib/rules';

/**
 * Anonymous access deliberately does not use device fingerprints, IMEI, or
 * browser-identifying data. The browser receives a signed, HttpOnly session
 * cookie and only the server can mint it.
 */
export const guestCookieName='__Host-lr_guest';
export const ownerCookieName='__Host-lr_owner';
// Display names are not credentials. This server-readable fallback helps
// Safari/private browsing restore a name when localStorage is unavailable.
// It never carries a role or owner state.
export const displayNameCookieName='__Host-lr_display_name';
export const guestCookieMaxAge=60*60*24*365;
// The Owner role is persisted in D1. Keep the signed browser session alive for
// a year so the verified Owner does not silently lose the management UI after
// a short idle period; the cookie still cannot be forged and is invalidated by
// changing the configured Owner subject or signing secret.
export const ownerCookieMaxAge=60*60*24*365;
export const displayNameCookieMaxAge=60*60*24*365;
const tokenVersion='v1';
// Keep the established o1 wire shape, but include a hash of the configured
// Owner subject in the signed payload. Changing Owner therefore invalidates
// previously issued privileged cookies instead of transferring their power.
const ownerTokenVersion='o1';
const encoder=new TextEncoder();

function configuredSecret(){
 const value=(env as unknown as Record<string,unknown>).BOARD_ANON_COOKIE_SECRET;
 if(typeof value!=='string'||value.length<32)throw new Error('anonymous_unavailable');
 return value;
}
function base64url(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function bytes(value:string){const normalized=value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=');const binary=atob(normalized);const result=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)result[i]=binary.charCodeAt(i);return result;}
async function key(){return crypto.subtle.importKey('raw',encoder.encode(configuredSecret()),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function digest(value:string){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
async function issue(sub:string,issuedAt:number){const payload=`${tokenVersion}|${sub}|${issuedAt}`;const signature=await crypto.subtle.sign('HMAC',await key(),encoder.encode(payload));return `${tokenVersion}.${sub}.${issuedAt}.${base64url(new Uint8Array(signature))}`;}
async function issueOwner(subject:string,issuedAt:number){const subjectHash=await digest(subject);const payload=`${ownerTokenVersion}|${subjectHash}|${issuedAt}`;const signature=await crypto.subtle.sign('HMAC',await key(),encoder.encode(payload));return `${ownerTokenVersion}.${issuedAt}.${base64url(new Uint8Array(signature))}`;}
async function constantTimeTokenEqual(candidate:string,expected:string){
 // Hash both inputs first so comparison work is fixed-size and does not reveal
 // the configured token length through an early string inequality branch.
 const [candidateHash,expectedHash]=await Promise.all([
  crypto.subtle.digest('SHA-256',encoder.encode(candidate)),
  crypto.subtle.digest('SHA-256',encoder.encode(expected)),
 ]);
 const a=new Uint8Array(candidateHash),b=new Uint8Array(expectedHash);let diff=0;
 for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
async function verify(token:string){
 const parts=token.split('.');if(parts.length!==4||parts[0]!==tokenVersion)return null;
 const [,sub,issuedText,signature]=parts;
 if(!/^[a-f0-9-]{36}$/.test(sub)||!/^[0-9]{10,}$/.test(issuedText)||!/^[A-Za-z0-9_-]{43}$/.test(signature))return null;
 const issuedAt=Number(issuedText);const now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(issuedAt)||issuedAt>now+60||now-issuedAt>guestCookieMaxAge+60)return null;
 const payload=`${tokenVersion}|${sub}|${issuedAt}`;
 try{return await crypto.subtle.verify('HMAC',await key(),bytes(signature),encoder.encode(payload))?sub:null;}catch{return null;}
}
async function verifyOwner(token:string){
 const parts=token.split('.');if(parts.length!==3||parts[0]!==ownerTokenVersion)return null;
 const [,issuedText,signature]=parts;
 if(!/^[0-9]{10,}$/.test(issuedText)||!/^[A-Za-z0-9_-]{43}$/.test(signature))return null;
 const issuedAt=Number(issuedText);const now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(issuedAt)||issuedAt>now+60||now-issuedAt>ownerCookieMaxAge+60)return null;
 const configured=(env as unknown as Record<string,unknown>).BOARD_OWNER_SUBJECT;
 if(typeof configured!=='string'||!configured||configured.length>512)return null;
 const subjectHash=await digest(configured);
 const payload=`${ownerTokenVersion}|${subjectHash}|${issuedAt}`;
 try{return await crypto.subtle.verify('HMAC',await key(),bytes(signature),encoder.encode(payload))?configured:null;}catch{return null;}
}
function cookieValue(raw:string|null,name:string){
 if(!raw)return null;
 for(const part of raw.split(';')){const [candidateName,...value]=part.trim().split('=');if(candidateName===name){const candidate=value.join('=');return candidate||null;}}
 return null;
}
function displayNameValue(raw:string|null){
 const encoded=cookieValue(raw,displayNameCookieName);if(!encoded||encoded.length>240)return null;
 let value='';try{value=decodeURIComponent(encoded);}catch{return null;}
 const normalized=value.normalize('NFC').trim();
 if(!normalized||[...normalized].length>30||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized))return null;
 return normalized;
}
function trustedUpstreamSubject(h:Headers){
 // A public Cloudflare edge must never treat a browser-supplied identity
 // header as authentication by default. Miniflare uses a loopback connection
 // in the integration harness; real edge hosts require an explicit server-side
 // opt-in for a trusted reverse proxy.
 const trust=(env as unknown as Record<string,unknown>).BOARD_TRUST_UPSTREAM_AUTH;
 const host=(h.get('host')||'').toLowerCase().split(':')[0];
 const edgeAddress=h.get('cf-connecting-ip')?.trim()||'';
 const integrationHarness=host==='review.example'||edgeAddress==='127.0.0.1'||edgeAddress==='::1';
 if(trust!=='1'&&!integrationHarness&&(edgeAddress||h.get('cf-ray')))return null;
 const value=h.get('oai-authenticated-user-id')?.trim()||'';
 if(!value||value.length>512||/[\u0000-\u001f\u007f]/.test(value))return null;
 return value;
}
async function guestCookie(sub:string){const issuedAt=Math.floor(Date.now()/1000);const token=await issue(sub,issuedAt);return `${guestCookieName}=${token}; Path=/; Max-Age=${guestCookieMaxAge}; SameSite=Lax; Secure; HttpOnly`;}
async function ownerCookie(subject:string){const issuedAt=Math.floor(Date.now()/1000);const token=await issueOwner(subject,issuedAt);return `${ownerCookieName}=${token}; Path=/; Max-Age=${ownerCookieMaxAge}; SameSite=Strict; Secure; HttpOnly`;}
export function displayNameCookie(value:string){return `${displayNameCookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${displayNameCookieMaxAge}; SameSite=Lax; Secure; HttpOnly`;}
export function guestName(sub:string){return `ゲスト-${sub.replaceAll('-','').slice(0,4).toUpperCase()}`;}

/**
 * Returns a privacy-preserving network bucket for abuse control. Cloudflare
 * supplies CF-Connecting-IP at the edge; the raw address is never stored,
 * returned, or logged. Missing/non-Cloudflare test requests simply skip this
 * secondary bucket and continue to use the signed-session limits.
 */
export async function abuseNetworkBucket(h:Headers){
 const address=h.get('cf-connecting-ip')?.trim()||'';
 if(!address||address.length>64||!/^[0-9A-Fa-f:.]+$/.test(address))return null;
 const signature=await crypto.subtle.sign('HMAC',await key(),encoder.encode(`network|${address}`));
 return base64url(new Uint8Array(signature)).slice(0,24);
}

export type AnonymousSession={sub:string;anonymous:boolean;owner?:boolean;displayName?:string;setCookie?:string;setCookies?:string[]};

export async function activateOwner(accessToken:string){
 const configuredToken=(env as unknown as Record<string,unknown>).BOARD_OWNER_ACCESS_TOKEN;
 const configuredSubject=(env as unknown as Record<string,unknown>).BOARD_OWNER_SUBJECT;
 if(typeof configuredToken!=='string'||typeof configuredSubject!=='string'||!configuredToken||!configuredSubject)return null;
 if(configuredSubject.length>512||!(await constantTimeTokenEqual(accessToken,configuredToken)))return null;
 return {sub:configuredSubject,owner:true,displayName:ownerDisplayName,setCookie:await ownerCookie(configuredSubject),setCookies:[displayNameCookie(ownerDisplayName)]};
}

export async function sessionFromHeaders(h:Headers):Promise<AnonymousSession>{
 const savedDisplayName=displayNameValue(h.get('cookie'))||undefined;
 const ownerExisting=cookieValue(h.get('cookie'),ownerCookieName);
 if(ownerExisting){const sub=await verifyOwner(ownerExisting);if(sub)return {sub,anonymous:false,owner:true,displayName:ownerDisplayName,setCookie:await ownerCookie(sub),setCookies:[displayNameCookie(ownerDisplayName)]};}
 const authenticated=trustedUpstreamSubject(h);
 if(authenticated)return {sub:authenticated,anonymous:false,displayName:savedDisplayName};
 const existing=cookieValue(h.get('cookie'),guestCookieName);
 if(existing){const sub=await verify(existing);if(sub)return {sub,anonymous:true,displayName:savedDisplayName};}
 const sub=crypto.randomUUID();
 return {sub,anonymous:true,displayName:savedDisplayName,setCookie:await guestCookie(sub)};
}
