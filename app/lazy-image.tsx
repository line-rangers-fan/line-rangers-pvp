'use client';
/* eslint-disable @next/next/no-img-element -- These access-checked media URLs
   are intentionally assigned only once their card is near the viewport. */
import {useEffect,useRef,useState} from 'react';

type Props={src:string;alt:string;className?:string;width?:number;height?:number;fallbackSrc?:string};

/** Do not assign a media URL until the card is close to the viewport. */
export default function LazyImage({src,alt,className,width,height,fallbackSrc}:Props){
 const ref=useRef<HTMLImageElement>(null);const [visible,setVisible]=useState(false);
 const [useFallback,setUseFallback]=useState(false);const currentSrc=useFallback&&fallbackSrc?fallbackSrc:src;
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  if(!('IntersectionObserver' in window)){const frame=requestAnimationFrame(()=>setVisible(true));return()=>cancelAnimationFrame(frame);}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'600px 0px'});observer.observe(node);return()=>observer.disconnect();
 },[]);
 return <img ref={ref} className={className} src={visible?currentSrc:undefined} alt={alt} width={width} height={height} loading="lazy" decoding="async" onError={()=>{if(fallbackSrc&&currentSrc!==fallbackSrc)setUseFallback(true);}}/>;
}
