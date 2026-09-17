'use client';
import {useEffect,useState} from 'react';
import {Heart,ThumbsUp} from 'lucide-react';
import {activityLabels} from '@/lib/activity-labels';
import {languages,type Language} from '@/lib/rules';
type Activity={unread:number;featured:{id:string;board:string;body:string;name:string;likes:number;helpful:number}|null};
export default function CommunityTeaser(){
 const [data,setData]=useState<Activity|null>(null),[failed,setFailed]=useState(false),[lang,setLang]=useState<Language>('ja');
 useEffect(()=>{
  const frame=requestAnimationFrame(()=>{try{const saved=localStorage.getItem('line-rangers-language')||navigator.language.split('-')[0];if(languages.includes(saved as Language))setLang(saved as Language);}catch{}});
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);let active=true;
  // Keep the compact teaser off the critical first paint. The board link and
  // ranking link are immediately usable while this optional activity loads.
  const start=setTimeout(()=>{void fetch('/api/activity',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('unavailable');const j=await r.json() as Activity;if(active)setData(j);}).catch(()=>{if(active)setFailed(true);}).finally(()=>clearTimeout(timeout));},120);
  return()=>{cancelAnimationFrame(frame);active=false;clearTimeout(start);clearTimeout(timeout);controller.abort();};
 },[]);
 if(failed)return <p role="status">{lang==='ja'?'現在コミュニティを一時的に読み込めません。':'Community activity is temporarily unavailable.'}</p>;
 if(!data)return null;
 const a=activityLabels(lang);
 return <div className="community-teaser">{data.featured&&<a href={'/boards?'+new URLSearchParams({board:data.featured.board,month:data.featured.board.slice(0,7),lang})}><strong>{a.featured}</strong><p className="featured-body">{data.featured.body}</p><div className="teaser-reactions"><span><Heart size={16}/>{data.featured.likes}</span><span><ThumbsUp size={16}/>{a.helpful} {data.featured.helpful}</span></div></a>}{data.unread>0&&<span className="new-badge">NEW {data.unread}</span>}</div>;
}
