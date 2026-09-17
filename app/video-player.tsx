'use client';

import {useState} from 'react';
import {RotateCcw,Video} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {labels} from '@/lib/labels';
import type {Language} from '@/lib/rules';

type Props={id:string;youtube:string|null;lang:Language};

// The list never mounts a media element. This component exists only on the
// detail page, keeps native range seeking available, and has its own failure
// state so a bad media response cannot affect the surrounding comments.
export default function VideoPlayer({id,youtube,lang}:Props){
 const t=labels(lang);const [failed,setFailed]=useState(false);
 const [attempt,setAttempt]=useState(0);
 function reportFailure(){
  setFailed(true);
  void fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'video_playback',durationMs:0,success:false,errorType:'media_error'}),keepalive:true}).catch(()=>{});
 }
 if(youtube)return <iframe src={'https://www.youtube-nocookie.com/embed/'+youtube} title="YouTube video" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/>;
 if(failed)return <div className="video-unavailable" role="alert"><Video size={24}/><p>{t.videoUnavailable}</p><Button variant="outline" onClick={()=>{setFailed(false);setAttempt(current=>current+1);}}><RotateCcw size={15}/>{t.retryVideo}</Button></div>;
 // Detail view has only one video. `metadata` lets the browser request the
 // small header/frame ranges it needs; playback and seeking then request only
 // the ranges around the current position. Never ask the browser to eagerly
 // buffer a 200 MB object before the viewer presses play.
 return <video key={id+':'+attempt} src={'/api/media?id='+encodeURIComponent(id)} controls playsInline preload="metadata" onLoadedMetadata={event=>{event.currentTarget.currentTime=0;}} onLoadedData={event=>{event.currentTarget.pause();}} onError={reportFailure}/>;
}
