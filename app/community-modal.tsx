'use client';
import type {ReactNode} from 'react';
import {Dialog,DialogContent,DialogTitle} from '@/components/ui/dialog';
export default function CommunityModal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent showCloseButton={false} className="community-dialog" aria-describedby={undefined}><DialogTitle className="sr-only">{title}</DialogTitle>{children}</DialogContent></Dialog>;
}
