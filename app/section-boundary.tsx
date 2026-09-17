'use client';

import {Component,type ReactNode} from 'react';
import {RotateCcw,Video} from 'lucide-react';
import {Button} from '@/components/ui/button';

type Props={children:ReactNode;name:string};
type State={failed:boolean};

// A rendering fault in an optional section must never blank the board page.
// The metric intentionally contains no content, user name, or media URL.
export default class SectionBoundary extends Component<Props,State>{
 state:State={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){
  void fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'render_error',durationMs:0,success:false,errorType:this.props.name}),keepalive:true}).catch(()=>{});
 }
 render(){
  if(this.state.failed)return <div className="section-unavailable" role="alert"><Video size={20}/><span>{this.props.name}を現在表示できません。ほかの掲示板機能はそのまま利用できます。</span><Button variant="outline" onClick={()=>this.setState({failed:false})}><RotateCcw size={15}/>再試行</Button></div>;
  return this.props.children;
 }
}
