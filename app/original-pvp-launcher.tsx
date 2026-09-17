'use client';
import {useEffect} from 'react';
export default function OriginalPvpLauncher(){
 useEffect(()=>{window.location.replace('/pvp/index.html');},[]);
 return <a href="/pvp/index.html" style={{color:'#63eba7',fontWeight:800}}>元のPvPランキングを開く</a>;
}
