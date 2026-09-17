'use client';
import {useEffect,useRef,useState} from 'react';
import {Video} from 'lucide-react';
import {labels} from '@/lib/labels';
import type {Language} from '@/lib/rules';

type Props={id:string;name:string;lang:Language};

/**
 * Decode only the first frame for cards near the viewport. The media endpoint
 * bounds each response to a small byte range, so a list never buffers the
 * complete upload. The full player is mounted only on the detail route.
 */
export default function VideoThumbnail({id,name,lang}:Props){
 const t=labels(lang);const ref=useRef<HTMLSpanElement|null>(null);const [visible,setVisible]=useState(false);const [failed,setFailed]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;if(!('IntersectionObserver' in window)){const timer=setTimeout(()=>setVisible(true),0);return()=>clearTimeout(timer);}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'240px'});observer.observe(node);return()=>observer.disconnect();},[]);
 return <span ref={ref} className="video-thumbnail-shell">{visible&&!failed?<video className="video-thumb-video" src={'/api/media?id='+encodeURIComponent(id)} muted playsInline preload="metadata" aria-label={`${name} · ${t.playVideo}`} onLoadedMetadata={event=>{event.currentTarget.currentTime=0;}} onLoadedData={event=>{event.currentTarget.pause();}} onError={()=>setFailed(true)}/>:<span className="video-placeholder" aria-label={`${name} · ${t.playVideo}`}><Video size={34}/><span>{name}</span><small>{t.playVideo}</small></span>}</span>;
}
