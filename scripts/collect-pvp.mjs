import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const TARGET=200;
const API='https://rangers.lerico.net';
const RANK_URL=`${API}/api/v2/pvp/league/rank/LEGEND`;
const TRANSLATE_URL=`${API}/api/v2/translate?keys=ja%3AUNIT`;
const OUTPUT=resolve('public/pvp/data/character_usage.json');
const HISTORY=resolve('public/pvp/data/character_usage_history.json');
const TYPES=['WEAPON','ARMOR','ACC'];
const SAFE=/^[A-Za-z0-9_-]+$/;
const started=Date.now();

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function trusted(url){const u=new URL(url);return u.protocol==='https:'&&u.hostname==='rangers.lerico.net'&&!u.username&&!u.password;}
async function fetchJson(url,label,{attempts=5,timeout=15000}={}){
  if(!trusted(url))throw new Error(`untrusted ${label} URL`);
  let last;
  for(let i=0;i<attempts;i++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'line-rangers-owner-copy/1.0'},redirect:'error',signal:controller.signal});
      if(!r.ok)throw new Error(`${label} HTTP ${r.status}`);
      const text=await r.text();
      if(text.length>4*1024*1024)throw new Error(`${label} too large`);
      return JSON.parse(text);
    }catch(e){last=e;if(i+1<attempts)await sleep(Math.min(5000,750*2**i));}
    finally{clearTimeout(timer)}
  }
  throw last||new Error(`${label} failed`);
}
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch{return fallback}}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n','utf8');await rename(temp,path)}
function imageFor(code){if(!SAFE.test(code))throw new Error('unsafe unit code');return `${API}/res/${code}/${code}-thum.png`}
function gearImage(code){if(!SAFE.test(code))throw new Error('unsafe gear code');return `${API}/res/gear_icon/${code}_icon.png`}
function sortGroups(a,b){const [ak]=a,[bk]=b;return /^\d+$/.test(ak)&&/^\d+$/.test(bk)?Number(ak)-Number(bk):ak.localeCompare(bk)}
function competitionRanks(rows){let previous=null,rank=0;rows.forEach((row,index)=>{const key=`${row.occurrence_count}:${row.player_count}`;if(key!==previous)rank=index+1;row.rank=rank;previous=key})}
function equipmentRanks(items){items.sort((a,b)=>b.occurrence_count-a.occurrence_count||b.player_count-a.player_count||a.item_code.localeCompare(b.item_code));let prev=null,rank=0;items.forEach((x,i)=>{const key=`${x.occurrence_count}:${x.player_count}`;if(key!==prev)rank=i+1;x.rank=rank;prev=key});return items}

const rankPayload=await fetchJson(RANK_URL,'ranking');
if(!rankPayload||!Array.isArray(rankPayload.top100))throw new Error('ranking payload missing top100');
const mids=[];const seen=new Set();
for(const row of rankPayload.top100){const mid=String(row?.mid||'').trim();if(SAFE.test(mid)&&!seen.has(mid)){seen.add(mid);mids.push(mid)}if(mids.length===TARGET)break}
if(mids.length!==TARGET)throw new Error(`refusing partial ranking: ${mids.length}/${TARGET}`);

const details=new Map();const failures=[];let cursor=0;
async function worker(){while(true){const i=cursor++;if(i>=mids.length)return;const mid=mids[i];try{const value=await fetchJson(`${API}/api/getPlayer/${encodeURIComponent(mid)}`,'player',{attempts:5});if(value&&typeof value==='object')details.set(mid,value);else throw new Error('invalid player root')}catch(e){failures.push({mid,error:e?.name||'Error'})}}}
await Promise.all(Array.from({length:4},()=>worker()));
if(failures.length||details.size!==TARGET)throw new Error(`refusing incomplete player details: ${details.size}/${TARGET}`);

const players=[];let missingEquipment=0;
for(const mid of mids){const info=details.get(mid);const pvp=info?.playerUnitTeamGroupMap?.pvpteam;if(!pvp||typeof pvp!=='object'||Array.isArray(pvp))throw new Error('invalid pvpteam map');const records=[];for(const [,group] of Object.entries(pvp).sort(sortGroups)){if(!Array.isArray(group))throw new Error('invalid pvp group');for(const unit of group){const unitCode=String(unit?.unitCode||'').trim();if(!SAFE.test(unitCode))throw new Error('invalid unit code');const equipment={};const map=unit?.equipMap;if(map&&typeof map==='object'){for(const type of TYPES){const code=String(map?.[type]?.itemCode||'').trim();if(code){if(!SAFE.test(code))throw new Error('invalid equipment code');equipment[type]=code}else missingEquipment++}}else missingEquipment+=TYPES.length;records.push({unit_code:unitCode,equipment})}}
  if(records.length<1||records.length>10)throw new Error(`invalid team size ${records.length}`);players.push({mid,records});
}
if(players.length!==TARGET)throw new Error('player validation failed');

let names={};
try{const translations=await fetchJson(TRANSLATE_URL,'translation',{attempts:2,timeout:8000});const catalog=translations?.['ja:UNIT'];if(catalog&&typeof catalog==='object'){for(const p of players)for(const r of p.records){const raw=catalog[`${r.unit_code}_snm`]||catalog[`${r.unit_code}_nm`];if(typeof raw==='string'&&raw.trim())names[r.unit_code]=raw.replace(/\s+/g,' ').trim()}}}catch{console.warn('translation metadata unavailable; unit codes will be used')}

const chars=new Map();
for(const player of players){const seenUnits=new Set();for(const rec of player.records){if(!chars.has(rec.unit_code))chars.set(rec.unit_code,{unit_code:rec.unit_code,occurrence_count:0,players:new Set(),equipment:Object.fromEntries(TYPES.map(t=>[t,new Map()]))});const c=chars.get(rec.unit_code);c.occurrence_count++;seenUnits.add(rec.unit_code);for(const type of TYPES){const code=rec.equipment[type];if(!code)continue;const map=c.equipment[type];if(!map.has(code))map.set(code,{item_code:code,occurrence_count:0,players:new Set()});const item=map.get(code);item.occurrence_count++;item.players.add(player.mid)}}for(const code of seenUnits)chars.get(code).players.add(player.mid)}
const totalSlots=players.reduce((n,p)=>n+p.records.length,0);
const rows=[];
for(const c of chars.values()){const playerCount=c.players.size;const rankings={};for(const type of TYPES){const items=equipmentRanks([...c.equipment[type].values()].map(item=>({item_code:item.item_code,image:gearImage(item.item_code),occurrence_count:item.occurrence_count,player_count:item.players.size,adoption_rate:Number((item.players.size/playerCount*100).toFixed(1))})));rankings[type]={equipped_occurrence_count:items.reduce((n,x)=>n+x.occurrence_count,0),equipped_player_count:new Set([...c.equipment[type].values()].flatMap(x=>[...x.players])).size,items}}
 rows.push({unit_code:c.unit_code,name:names[c.unit_code]||c.unit_code,image:imageFor(c.unit_code),occurrence_count:c.occurrence_count,player_count:playerCount,adoption_rate:Number((playerCount/TARGET*100).toFixed(1)),slot_rate:Number((c.occurrence_count/totalSlots*100).toFixed(2)),equipment_rankings:rankings})}
rows.sort((a,b)=>b.occurrence_count-a.occurrence_count||b.player_count-a.player_count||a.unit_code.localeCompare(b.unit_code));competitionRanks(rows);

const now=new Date();
const oldHistory=await readJson(HISTORY,{schema_version:1,snapshots:[]});
const snapshots=Array.isArray(oldHistory?.snapshots)?oldHistory.snapshots.filter(x=>x&&typeof x==='object'&&Number.isFinite(Date.parse(x.updated_at))):[];
function jstParts(date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]))}
function dayKey(date){const p=jstParts(date);return `${p.year}-${p.month}-${p.day}`}
function targetDay(offsetDays){return dayKey(new Date(now.getTime()-offsetDays*86400000))}
function previousMonthCloseKey(){const p=jstParts(now);let y=Number(p.year),m=Number(p.month)-1;if(m===0){m=12;y--}const last=new Date(Date.UTC(y,m,0,14,0,0));return dayKey(last)}
function closeFor(key){return snapshots.filter(s=>dayKey(new Date(s.updated_at))===key&&['22','23'].includes(jstParts(new Date(s.updated_at)).hour)).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))[0]||null}
function nearestHour(){const target=now.getTime()-3600000;let best=null,delta=Infinity;for(const s of snapshots){const d=Math.abs(Date.parse(s.updated_at)-target);if(d<delta){best=s;delta=d}}return delta<=90*60000?best:null}
const baselines={hour:nearestHour(),day:closeFor(targetDay(1)),week:closeFor(targetDay(7)),month:closeFor(previousMonthCloseKey())};
function charMap(snapshot){return new Map((snapshot?.characters||[]).map(x=>[x.unit_code,x]))}
const baselineMaps=Object.fromEntries(Object.entries(baselines).map(([k,v])=>[k,charMap(v)]));
for(const row of rows){row.change={new:false,rank:0,occurrence_count:0,periods:{}};for(const period of ['hour','day','week','month']){const base=baselineMaps[period].get(row.unit_code);const source=baselines[period];row.change.periods[period]=base?{comparable:true,rank:Number(base.rank||0)-row.rank,occurrence_count:row.occurrence_count-Number(base.occurrence_count||0),from_updated_at:source.updated_at,interval_minutes:Number(((now-Date.parse(source.updated_at))/60000).toFixed(1))}:{comparable:false,rank:0,occurrence_count:0,from_updated_at:null,interval_minutes:null}}
 for(const type of TYPES){for(const item of row.equipment_rankings[type].items){item.change={periods:{}};for(const period of ['hour','day','week','month']){const baseChar=baselineMaps[period].get(row.unit_code);const baseItems=baseChar?.equipment?.[type]||[];const baseItem=baseItems.find(x=>x.item_code===item.item_code);const source=baselines[period];item.change.periods[period]=baseItem?{comparable:true,rank:Number(baseItem.rank||0)-item.rank,occurrence_count:item.occurrence_count-Number(baseItem.occurrence_count||0),from_updated_at:source.updated_at}:{comparable:false,rank:0,occurrence_count:0,from_updated_at:null}}}}}

const updatedAt=now.toISOString();
const output={schema_version:11,updated_at:updatedAt,source:{name:'LINE Rangers Handbook PvP Tracker',url:'https://rangers.lerico.net/ja/pvp-tracker'},league:'レジェンド',target_players:TARGET,sampled_players:TARGET,character_slots:totalSlots,unique_characters:rows.length,complete_target:true,collection_quality:{sample_coverage:100,equipment_slots_expected:totalSlots*TYPES.length,equipment_slots_missing:missingEquipment,detail_fetch_failures:0,invalid_player_records:0,collection_started_at:new Date(started).toISOString(),collection_duration_seconds:Number(((Date.now()-started)/1000).toFixed(2))},characters:rows};
if(output.character_slots<1500||output.character_slots>TARGET*10||output.unique_characters<10)throw new Error('quality gate rejected implausible aggregate');

const compact={updated_at:updatedAt,characters:rows.map(row=>({unit_code:row.unit_code,rank:row.rank,occurrence_count:row.occurrence_count,equipment:Object.fromEntries(TYPES.map(type=>[type,row.equipment_rankings[type].items.map(x=>({item_code:x.item_code,rank:x.rank,occurrence_count:x.occurrence_count}))]))}))};
const combined=[...snapshots,compact].sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at));
const recentCutoff=now.getTime()-6*3600000;const closeCutoff=now.getTime()-40*86400000;const closeByDay=new Map();for(const s of combined){const time=Date.parse(s.updated_at);const parts=jstParts(new Date(time));if(time>=closeCutoff&&['22','23'].includes(parts.hour))closeByDay.set(dayKey(new Date(time)),s)}
const keep=new Map();for(const s of combined){if(Date.parse(s.updated_at)>=recentCutoff)keep.set(s.updated_at,s)}for(const s of closeByDay.values())keep.set(s.updated_at,s);const pruned=[...keep.values()].sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at)).slice(-96);
await atomicJson(OUTPUT,output);await atomicJson(HISTORY,{schema_version:1,reference_mode:'jst_calendar_close_v1',snapshots:pruned});
console.log(`Published validated PvP snapshot: ${TARGET}/${TARGET}, ${rows.length} characters, ${totalSlots} slots.`);
