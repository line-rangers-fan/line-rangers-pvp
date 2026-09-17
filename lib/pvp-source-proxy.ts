const SOURCE_BASE='https://raw.githubusercontent.com/line-rangers-fan/line-rangers-pvp/main/docs/data/';
const FALLBACK_BASE='https://line-rangers-fan.github.io/line-rangers-pvp/data/';

type Cached={body:string;expires:number;staleUntil:number};
const cache=new Map<string,Cached>();

export async function pvpSourceJson(file:string,maxBytes:number){
 const now=Date.now();const existing=cache.get(file);
 if(existing&&existing.expires>now)return json(existing.body,'fresh');
 for(const base of [SOURCE_BASE,FALLBACK_BASE]){
  try{
   const response=await fetch(base+file,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(!response.ok)continue;
   const length=Number(response.headers.get('content-length')||0);if(length>maxBytes)continue;
   const body=await response.text();if(body.length>maxBytes)continue;
   JSON.parse(body);
   cache.set(file,{body,expires:now+60_000,staleUntil:now+10*60_000});
   return json(body,'fresh');
  }catch{}
 }
 if(existing&&existing.staleUntil>now)return json(existing.body,'stale');
 return Response.json({error:'pvp_source_unavailable'},{status:503,headers:headers('unavailable')});
}
function headers(state:string){return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','X-PvP-Source-State':state};}
function json(body:string,state:string){return new Response(body,{status:200,headers:headers(state)});}
