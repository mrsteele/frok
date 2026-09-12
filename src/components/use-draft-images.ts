'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateDraftImage, type DraftImage } from '@/lib/draft-images';

export function useDraftImages(sourceId:string|undefined, referenceIds:string[]) {
  const drafts=useRef<DraftImage[]>([]);
  const [items,setItems]=useState<DraftImage[]>([]);
  const selected=JSON.stringify([...(sourceId?[sourceId]:[]),...referenceIds]);
  useEffect(()=>{
    const ids=new Set<string>(JSON.parse(selected));
    const removed=drafts.current.filter(item=>!ids.has(item.id));
    if(!removed.length)return;
    removed.forEach(item=>URL.revokeObjectURL(item.previewUrl));
    drafts.current=drafts.current.filter(item=>ids.has(item.id));setItems(drafts.current);
  },[selected]);
  useEffect(()=>()=>{drafts.current.forEach(item=>URL.revokeObjectURL(item.previewUrl));drafts.current=[];},[]);
  const stage=useCallback((files:File[])=>{
    files.forEach(validateDraftImage);
    const added:DraftImage[]=[];
    try{for(const file of files)added.push({id:crypto.randomUUID(),file,previewUrl:URL.createObjectURL(file),uploaded:{}});}
    catch(error){added.forEach(item=>URL.revokeObjectURL(item.previewUrl));throw error;}
    drafts.current=[...drafts.current,...added];setItems(drafts.current);return added;
  },[]);
  return {items,stage};
}
