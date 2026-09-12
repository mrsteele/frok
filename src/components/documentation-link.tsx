'use client';
import { BookOpen } from 'lucide-react';

export function DocumentationLink({onError,page='/documentation',label='Documentation'}:{onError:(message:string)=>void;page?:string;label?:string}) {
  return <a href={`/docs${page}.html`} target="_blank" rel="noreferrer" title={label} aria-label={label} onClick={event=>{
    if(!window.frokDesktop?.openDocs)return;
    event.preventDefault();
    void window.frokDesktop?.openDocs(page).catch(()=>onError('Documentation could not be opened.'));
  }}><BookOpen size={17}/><span>{label}</span></a>;
}
