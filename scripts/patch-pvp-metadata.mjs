import {readFile,writeFile} from 'node:fs/promises';

const PATH='public/pvp/data/character_usage.json';
const API='https://rangers.lerico.net';
const payload=JSON.parse(await readFile(PATH,'utf8'));
let catalog={};
try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  const response=await fetch(`${API}/api/v2/translate`,{
    method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'line-rangers-owner-copy/1.0'},
    body:JSON.stringify({keys:['ja:UNIT']}),
    redirect:'error',
    signal:controller.signal
  });
  clearTimeout(timer);
  if(response.ok){
    const translated=await response.json();
    if(translated?.['ja:UNIT']&&typeof translated['ja:UNIT']==='object')catalog=translated['ja:UNIT'];
  }
}catch{console.warn('Unit translation metadata unavailable; keeping existing names.')}
for(const row of payload.characters||[]){
  const name=catalog[`${row.unit_code}_snm`]||catalog[`${row.unit_code}_nm`];
  if(typeof name==='string'&&name.trim())row.name=name.replace(/\s+/g,' ').trim();
  for(const type of ['WEAPON','ARMOR','ACC']){
    for(const item of row.equipment_rankings?.[type]?.items||[]){
      if(/^[A-Za-z0-9_-]+$/.test(item.item_code))item.image=`${API}/res/${item.item_code}/${item.item_code}-icon.png`;
    }
  }
}
await writeFile(PATH,JSON.stringify(payload,null,2)+'\n','utf8');
console.log(`Applied trusted display metadata to ${payload.characters?.length||0} characters.`);
