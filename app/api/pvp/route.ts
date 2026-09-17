import {confirmedCharactersForMonth,monthJST,validMonth} from '@/lib/rules';

export const dynamic='force-dynamic';

// Read the same published snapshot used by the original PvP ranking. The raw
// GitHub URL is retained only as a secondary source for environments where it
// is reachable. Community failures never mutate the canonical PvP data.
const SOURCE_URLS=[
 'https://line-rangers-fan.github.io/line-rangers-pvp/data/character_usage.json',
 'https://raw.githubusercontent.com/line-rangers-fan/line-rangers-pvp/main/docs/data/character_usage.json'
];
const CACHE_TTL_MS=60_000;
const STALE_TTL_MS=5*60_000;
const LEGEND_TARGET=200;
const MAX_COMPOSITION_OCCURRENCES=4000;
const UPSTREAM_MAX_BYTES=4*1024*1024;
const cache=new Map<string,{data:PvpResponse;expires:number;staleUntil:number}>();

type EquipmentItem={itemCode:string;image:string|null;rank:number;occurrenceCount:number;playerCount:number;adoptionRate:number};
type EquipmentGroup={equippedOccurrenceCount:number;equippedPlayerCount:number;items:EquipmentItem[]};
type PvpResponse={status:'fresh'|'stale';source:'pvp_character_usage';month:string;character:{unitCode:string;name:string;image:string;rank:number;occurrenceCount:number;playerCount:number;adoptionRate:number;slotRate:number;equipmentRankings:Record<string,EquipmentGroup>};snapshot:{updatedAt:string;targetPlayers:number;sampledPlayers:number;completeTarget:boolean;collectionQuality:number|null}};
type JsonRecord=Record<string,unknown>;

const COPIED_SALLY_SNAPSHOT:PvpResponse={
 status:'stale',source:'pvp_character_usage',month:'2026-09',
 character:{
  unitCode:'u1631e-sally',name:'かに座 サリー',
  image:'https://rangers.lerico.net/res/u1631e-sally/u1631e-sally-thum.png',
  rank:0,occurrenceCount:64,playerCount:64,adoptionRate:32.0,slotRate:3.22,equipmentRankings:{}
 },
 snapshot:{updatedAt:'2026-09-15T03:01:07.466207+00:00',targetPlayers:200,sampledPlayers:200,completeTarget:true,collectionQuality:100.0}
};

function strictInteger(value:unknown,min:number,max:number){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max?value:null;}
function strictRate(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;}
function optionalCoverage(value:unknown){return value===undefined||value===null?null:strictRate(value);}
function safeHttpsImage(value:unknown){if(typeof value!=='string')return null;try{const url=new URL(value);if(url.protocol!=='https:')return null;if(!['rangers.lerico.net','line-rangers-fan.github.io'].includes(url.hostname))return null;return url.toString();}catch{return null;}}
function compactEquipment(value:unknown):Record<string,EquipmentGroup>|null{
 if(value===undefined||value===null)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const output:Record<string,EquipmentGroup>={};
 for(const [slot,raw] of Object.entries(value as JsonRecord)){
  if(!/^[A-Z_]{2,24}$/.test(slot)||!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const group=raw as JsonRecord;
  const equippedOccurrenceCount=strictInteger(group.equipped_occurrence_count,0,MAX_COMPOSITION_OCCURRENCES);
  const equippedPlayerCount=strictInteger(group.equipped_player_count,0,LEGEND_TARGET);
  if(equippedOccurrenceCount===null||equippedPlayerCount===null||equippedPlayerCount>equippedOccurrenceCount)return null;
  if(group.items!==undefined&&!Array.isArray(group.items))return null;
  const items:EquipmentItem[]=[];
  for(const item of (Array.isArray(group.items)?group.items.slice(0,5):[])){
   if(!item||typeof item!=='object'||Array.isArray(item))return null;
   const row=item as JsonRecord;const itemCode=typeof row.item_code==='string'?row.item_code.trim():'';
   const rank=strictInteger(row.rank,0,10000);const occurrenceCount=strictInteger(row.occurrence_count,0,MAX_COMPOSITION_OCCURRENCES);const playerCount=strictInteger(row.player_count,0,LEGEND_TARGET);const adoptionRate=strictRate(row.adoption_rate);
   if(!itemCode||itemCode.length>128||rank===null||occurrenceCount===null||playerCount===null||playerCount>occurrenceCount||adoptionRate===null)return null;
   items.push({itemCode,image:safeHttpsImage(row.image),rank,occurrenceCount,playerCount,adoptionRate});
  }
  output[slot]={equippedOccurrenceCount,equippedPlayerCount,items};
 }
 return output;
}
function compactSnapshot(raw:unknown,month:string,topic:{id:string;name:string;image:string}) : PvpResponse|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const root=raw as JsonRecord;
 // This adapter is intentionally stricter than the display layer. An upstream
 // partial collection must never look like a valid 200-player snapshot.
 const targetPlayers=strictInteger(root.target_players,0,LEGEND_TARGET);
 const sampledPlayers=strictInteger(root.sampled_players,0,LEGEND_TARGET);
 if(targetPlayers!==LEGEND_TARGET||sampledPlayers!==LEGEND_TARGET||root.complete_target!==true)return null;
 const updatedAt=typeof root.updated_at==='string'?root.updated_at:'';
 if(!updatedAt||!Number.isFinite(Date.parse(updatedAt)))return null;
 const characters=Array.isArray(root.characters)?root.characters:[];if(!characters.length)return null;
 const record=characters.find(item=>item&&typeof item==='object'&&!Array.isArray(item)&&(item as JsonRecord).unit_code===topic.id) as JsonRecord|undefined;
 if(!record)return null;
 const occurrenceCount=strictInteger(record.occurrence_count,0,MAX_COMPOSITION_OCCURRENCES);
 const playerCount=strictInteger(record.player_count,0,LEGEND_TARGET);
 const adoptionRate=strictRate(record.adoption_rate);const slotRate=strictRate(record.slot_rate);
 if(occurrenceCount===null||playerCount===null||playerCount>occurrenceCount||adoptionRate===null||slotRate===null)return null;
 const qualityObject=root.collection_quality&&typeof root.collection_quality==='object'&&!Array.isArray(root.collection_quality)?root.collection_quality as JsonRecord:null;
 const collectionQuality=optionalCoverage(qualityObject?.sample_coverage);if(qualityObject?.sample_coverage!==undefined&&collectionQuality===null)return null;
 const rowIndex=characters.findIndex(item=>item===record);const explicitRank=strictInteger(record.rank,1,10000);const rank=explicitRank??(rowIndex>=0?rowIndex+1:0);
 const equipmentRankings=compactEquipment(record.equipment_rankings);if(equipmentRankings===null)return null;
 return {status:'fresh',source:'pvp_character_usage',month,character:{unitCode:topic.id,name:topic.name,image:safeHttpsImage(record.image)||topic.image,rank,occurrenceCount,playerCount,adoptionRate,slotRate,equipmentRankings},snapshot:{updatedAt,targetPlayers,sampledPlayers,completeTarget:true,collectionQuality}};
}
function json(data:unknown,status=200,cacheControl='private, no-store'){
 return Response.json(data,{status,headers:{'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','Vary':'Accept-Encoding'}});
}
function copiedFallback(month:string,character:string){
 if(month===COPIED_SALLY_SNAPSHOT.month&&character===COPIED_SALLY_SNAPSHOT.character.unitCode)return COPIED_SALLY_SNAPSHOT;
 return null;
}
async function readUpstreamJson(response:Response){
 const declared=Number(response.headers.get('content-length')||0);
 if(declared&&!Number.isSafeInteger(declared)||declared>UPSTREAM_MAX_BYTES)throw new Error('upstream_too_large');
 if(!response.body)throw new Error('upstream_empty');
 const reader=response.body.getReader();let raw='';let size=0;const decoder=new TextDecoder();
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>UPSTREAM_MAX_BYTES){await reader.cancel();throw new Error('upstream_too_large');}raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();return JSON.parse(raw) as unknown;
 }finally{reader.releaseLock();}
}
async function loadSnapshot(month:string,topic:{id:string;name:string;image:string}){
 for(const source of SOURCE_URLS){
  try{const upstream=await fetch(source,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(2500)});if(!upstream.ok)continue;const result=compactSnapshot(await readUpstreamJson(upstream),month,topic);if(result)return result;}catch{}
 }
 return null;
}
export async function GET(request:Request){
 const url=new URL(request.url);const current=monthJST();const month=url.searchParams.get('month')||current;const character=url.searchParams.get('character')||'';
 if(!validMonth(month)||month>current)return json({error:'invalid_request'},400,'no-store');
 const topic=confirmedCharactersForMonth(month).find(item=>item.id===character);
 if(!topic)return json({error:'not_found'},404,'no-store');
 const key=`${month}:${topic.id}`;const now=Date.now();const existing=cache.get(key);
 if(existing&&existing.expires>now)return json(existing.data);
 const result=await loadSnapshot(month,topic);
 if(result){const fresh={data:result,expires:now+CACHE_TTL_MS,staleUntil:now+STALE_TTL_MS};cache.set(key,fresh);return json(result);}
 if(existing&&existing.staleUntil>now)return json({...existing.data,status:'stale'});
 const copied=copiedFallback(month,topic.id);
 if(copied)return json(copied,200,'private, no-store');
 return json({status:'unavailable',error:'unavailable'},503,'no-store');
}
