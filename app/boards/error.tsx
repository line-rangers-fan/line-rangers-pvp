'use client';
import {useEffect} from 'react';
import {Button} from '@/components/ui/button';

export default function BoardError({reset}:{error:Error&{digest?:string};reset:()=>void}){
 useEffect(()=>{console.error('community_render_failed');},[]);
 return <main className="shell"><section className="error" role="alert"><p>掲示板の一部を読み込めませんでした。PvP集計には影響していません。</p><Button onClick={reset}>掲示板を再試行</Button></section></main>;
}
