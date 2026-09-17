'use client';
import {useEffect} from 'react';

/**
 * Compatibility guard for the copied board.
 * The board intentionally debounces draft writes. On a successful post the
 * controlled textarea is cleared, but the old persisted draft can otherwise be
 * restored during that debounce window. Remove the persisted draft as soon as
 * the successful POST response arrives; failed requests keep the draft.
 */
export default function CommentDraftSuccessGuard(){
 useEffect(()=>{
  const original=window.fetch.bind(window);
  const guarded:typeof window.fetch=async(input,init)=>{
   let post:{action?:string;board?:string;parent?:string|null}|null=null;
   try{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    if((init?.method||'GET').toUpperCase()==='POST'&&new URL(url,location.href).pathname==='/api/board'&&typeof init?.body==='string'){
     const parsed=JSON.parse(init.body) as typeof post;
     if(parsed?.action==='post'&&parsed.board)post=parsed;
    }
   }catch{}
   const response=await original(input,init);
   if(response.ok&&post?.board){
    const target=post.parent||'root';
    try{localStorage.removeItem(`line-rangers-community-draft:${post.board}:${target}`);}catch{}
   }
   return response;
  };
  window.fetch=guarded;
  return()=>{if(window.fetch===guarded)window.fetch=original;};
 },[]);
 return null;
}
