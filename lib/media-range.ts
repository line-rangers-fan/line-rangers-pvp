export function mediaRange(value:string|null,size:number){
 if(!value)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!match||(!match[1]&&!match[2]))throw new Error('range');
 let start:number,end:number;
 if(!match[1]){
  const suffix=Number(match[2]);
  if(!Number.isSafeInteger(suffix)||suffix<=0)throw new Error('range');
  start=Math.max(0,size-suffix);end=size-1;
 }else{
  start=Number(match[1]);const requested=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(requested))throw new Error('range');
  end=Math.min(requested,size-1);
 }
 if(!Number.isSafeInteger(start)||start<0||end<start||start>=size)throw new Error('range');
 return {start,end};
}
