import type { Generation, Media } from './types';

export type DraftImage = { id:string; file:File; previewUrl:string; uploaded:Partial<Record<'image'|'reference',Media>> };

export function validateDraftImage(file:File) {
  if(!file.size||file.size>20*1024**2||!(/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type)||(!file.type&&/\.(png|jpe?g|webp)$/i.test(file.name))))
    throw Error('Choose a PNG, JPEG, or WebP image under 20 MB.');
}

export function draftModeSelection(request:Generation, mode:Generation['mode'], drafts:DraftImage[]) {
  const ids=[...(request.sourceId?[request.sourceId]:[]),...request.referenceIds].filter(id=>drafts.some(draft=>draft.id===id));
  return {sourceId:mode==='video'?ids[0]:undefined,referenceIds:mode==='reference'?ids.slice(0,9):[]};
}

// Called only when submitting. Successful uploads survive a failed job request
// so retrying does not create duplicate assets. Purpose is chosen at submission.
export async function resolveDraftImages(request:Generation, drafts:DraftImage[], upload:(file:File,purpose:'image'|'reference')=>Promise<Media>, available?:(media:Media)=>Promise<boolean>) {
  const replacements=new Map<string,Media>();
  async function resolve(id:string,purpose:'image'|'reference') {
    const draft=drafts.find(item=>item.id===id);
    if(!draft)return id;
    const cached=draft.uploaded[purpose];
    if(cached&&available&&!await available(cached))delete draft.uploaded[purpose];
    const media=draft.uploaded[purpose]??await upload(draft.file,purpose);
    draft.uploaded[purpose]=media;replacements.set(id,media);return media.id;
  }
  const sourceId=request.mode==='video'&&request.sourceId?await resolve(request.sourceId,'image'):request.sourceId;
  const referenceIds=[];
  for(const id of request.referenceIds)referenceIds.push(request.mode==='reference'?await resolve(id,'reference'):id);
  return {request:{...request,sourceId,referenceIds},replacements};
}
