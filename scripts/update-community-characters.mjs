import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SNAPSHOT=resolve('public/pvp/data/character_usage.json');
const HISTORY=resolve('public/pvp/data/character_usage_history.json');
const REGISTRY=resolve('config/community-characters.json');
const LEGACY_KNOWN=resolve('config/community-known-legacy-ids.json');
const STATE=resolve('data/community-character-discovery.json');
const TARGET=200;
const REQUIRED_CONSECUTIVE=3;
const MAX_GAP_MS=3*60*60*1000;
const SAFE_ID=/^u\d+e-[a-z0-9_-]+$/i;
const IMAGE_HOST='rangers.lerico.net';

async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n','utf8');await rename(temp,path);}
function monthJST(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('invalid snapshot date');const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).formatToParts(date);const values=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${values.year}-${values.month}`;}
function safeImage(value,id){if(typeof value!=='string')return null;try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!==IMAGE_HOST)return null;if(!url.pathname.includes(`/${id}/`))return null;return url.toString();}catch{return null;}}
function currentRows(snapshot){if(!snapshot||snapshot.complete_target!==true||snapshot.target_players!==TARGET||snapshot.sampled_players!==TARGET||!Array.isArray(snapshot.characters))throw new Error('refusing incomplete PvP snapshot');return snapshot.characters.filter(row=>row&&typeof row==='object'&&typeof row.unit_code==='string');}
function historyIds(history){const output=new Set();for(const snapshot of Array.isArray(history?.snapshots)?history.snapshots:[]){for(const row of Array.isArray(snapshot?.characters)?snapshot.characters:[]){if(row&&typeof row.unit_code==='string')output.add(row.unit_code);}}return output;}
function knownLegacyIds(raw){return new Set((Array.isArray(raw?.ids)?raw.ids:[]).filter(id=>typeof id==='string'&&/^u\d+[a-z]?-[a-z0-9_-]+$/i.test(id)));}
function normalizeRegistry(raw){const rows=Array.isArray(raw?.characters)?raw.characters:[];const seen=new Set();const clean=[];for(const row of rows){if(!row||typeof row!=='object'||typeof row.id!=='string'||typeof row.name!=='string'||typeof row.image!=='string'||typeof row.releaseMonth!=='string'||row.confirmed!==true)continue;const key=`${row.releaseMonth}:${row.id}`;if(seen.has(key))continue;seen.add(key);clean.push({...row});}return {schemaVersion:1,characters:clean};}
function candidateName(row){const value=typeof row.name==='string'?row.name.normalize('NFC').replace(/\s+/g,' ').trim():'';return value&&value!==row.unit_code&&[...value].length<=80?value:null;}
function snapshotRank(row){return Number.isSafeInteger(row.rank)&&row.rank>0?row.rank:null;}
function adoptionRate(row){return typeof row.adoption_rate==='number'&&Number.isFinite(row.adoption_rate)&&row.adoption_rate>=0&&row.adoption_rate<=100?row.adoption_rate:null;}

export async function probeImage(url,fetchImpl=fetch){try{const response=await fetchImpl(url,{headers:{Range:'bytes=0-31','User-Agent':'line-rangers-community-discovery/1.0'},redirect:'error',signal:AbortSignal.timeout(6000)});const type=response.headers.get('content-type')||'';await response.body?.cancel();return (response.ok||response.status===206)&&type.toLowerCase().startsWith('image/');}catch{return false;}}

export async function updateCommunityCharacters({snapshot,history,registry,state,legacyKnown,probe=probeImage}={}){
 const currentSnapshot=snapshot??await readJson(SNAPSHOT,null);const oldHistory=history??await readJson(HISTORY,{snapshots:[]});const currentRegistry=normalizeRegistry(registry??await readJson(REGISTRY,{schemaVersion:1,characters:[]}));const legacy=knownLegacyIds(legacyKnown??await readJson(LEGACY_KNOWN,{ids:[]}));const currentState=state??await readJson(STATE,{schemaVersion:1,initialized:false,initializedAt:null,knownIds:[],candidates:{}});
 const rows=currentRows(currentSnapshot);const updatedAt=String(currentSnapshot.updated_at||'');if(!Number.isFinite(Date.parse(updatedAt)))throw new Error('invalid snapshot timestamp');const releaseMonth=monthJST(updatedAt);
 const rowMap=new Map(rows.map(row=>[row.unit_code,row]));const registeredIds=new Set(currentRegistry.characters.map(row=>row.id));
 const nextState={schemaVersion:1,initialized:currentState.initialized===true,initializedAt:currentState.initializedAt||null,lastSnapshotAt:updatedAt,knownIds:Array.isArray(currentState.knownIds)?[...new Set(currentState.knownIds.filter(x=>typeof x==='string'))]:[],candidates:currentState.candidates&&typeof currentState.candidates==='object'&&!Array.isArray(currentState.candidates)?structuredClone(currentState.candidates):{}};
 const known=new Set(nextState.knownIds);for(const id of registeredIds)known.add(id);for(const id of legacy)known.add(id);
 // If the historical catalog expands later, immediately discard stale
 // candidates for those IDs instead of allowing a previous streak to promote.
 for(const id of known)delete nextState.candidates[id];
 if(!nextState.initialized){for(const id of historyIds(oldHistory))known.add(id);for(const row of rows)known.add(row.unit_code);nextState.initialized=true;nextState.initializedAt=updatedAt;nextState.knownIds=[...known].sort();return {registry:currentRegistry,state:nextState,promoted:[],initialized:true};}
 const previousSnapshotAt=typeof currentState.lastSnapshotAt==='string'&&Number.isFinite(Date.parse(currentState.lastSnapshotAt))?currentState.lastSnapshotAt:null;
 const promoted=[];
 for(const [id,candidate] of Object.entries(nextState.candidates)){if(!rowMap.has(id)&&candidate&&typeof candidate==='object')candidate.consecutive=0;}
 for(const row of rows){const id=row.unit_code;if(known.has(id)||registeredIds.has(id))continue;const name=candidateName(row);const image=safeImage(row.image,id);const eligible=SAFE_ID.test(id)&&!!name&&!!image;
  const prior=nextState.candidates[id]&&typeof nextState.candidates[id]==='object'?nextState.candidates[id]:{};const sameSnapshot=prior.lastSeenAt===updatedAt;const gapOk=prior.lastSeenAt&&Number.isFinite(Date.parse(prior.lastSeenAt))?Date.parse(updatedAt)-Date.parse(prior.lastSeenAt)<=MAX_GAP_MS:false;
  let consecutive=Number.isSafeInteger(prior.consecutive)?prior.consecutive:0;let imageVerified=prior.imageVerified===true;
  if(eligible&&!sameSnapshot){if(!imageVerified)imageVerified=await probe(image);if(imageVerified){const followsPrevious=previousSnapshotAt&&prior.lastSeenAt===previousSnapshotAt&&gapOk;consecutive=followsPrevious?consecutive+1:1;}else consecutive=0;}
  const record={id,name:name||String(row.name||id),image:image||String(row.image||''),firstSeenAt:prior.firstSeenAt||updatedAt,firstSeenMonth:prior.firstSeenMonth||releaseMonth,lastSeenAt:updatedAt,consecutive,eligible,imageVerified,pvpRank:snapshotRank(row),adoptionRate:adoptionRate(row)};nextState.candidates[id]=record;
  if(eligible&&imageVerified&&consecutive>=REQUIRED_CONSECUTIVE&&record.firstSeenMonth===releaseMonth){const topic={id,name,image,releaseMonth,confirmed:true,source:'pvp-auto',confirmedAt:updatedAt,pvpRank:snapshotRank(row),adoptionRate:adoptionRate(row)};currentRegistry.characters.push(topic);registeredIds.add(id);known.add(id);promoted.push(topic);delete nextState.candidates[id];}
 }
 // Refresh ordering metadata only for the active month. Missing PvP data becomes
 // null so a confirmed character naturally moves behind characters with data.
 for(const topic of currentRegistry.characters){if(topic.releaseMonth!==releaseMonth)continue;const row=rowMap.get(topic.id);topic.pvpRank=row?snapshotRank(row):null;topic.adoptionRate=row?adoptionRate(row):null;}
 currentRegistry.characters.sort((a,b)=>a.releaseMonth.localeCompare(b.releaseMonth)||((a.pvpRank??Number.MAX_SAFE_INTEGER)-(b.pvpRank??Number.MAX_SAFE_INTEGER))||((b.adoptionRate??-1)-(a.adoptionRate??-1))||a.id.localeCompare(b.id));
 nextState.knownIds=[...known].sort();return {registry:currentRegistry,state:nextState,promoted,initialized:false};
}

async function main(){const result=await updateCommunityCharacters();await atomicJson(REGISTRY,result.registry);await atomicJson(STATE,result.state);if(result.initialized)console.log('Initialized community character baseline; no automatic topics promoted on the first run.');else if(result.promoted.length)console.log(`Confirmed ${result.promoted.length} new community topic(s): ${result.promoted.map(x=>x.id).join(', ')}`);else console.log('Community character discovery checked; no newly confirmed topics.');}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});}
