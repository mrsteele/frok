import { assertAppRequest, privateResponse, HttpError, expireBrowserKeys } from './request-security';
import { libraryDatabase } from './library';
import { beginOperation, endOperation, serviceValue } from './registry';
import { resetLibrary } from './library-reset';
import { readJson } from './request-body';

export { HttpError, privateResponse };
export async function withAppRequest(request:Request,handler:()=>Promise<Response>){
  assertAppRequest(request);
  // A deletion preview can recover staged files, so it also needs the write gate.
  const readOnly=['GET','HEAD'].includes(request.method)&&!new URL(request.url).pathname.startsWith('/api/deletion');
  const operation=beginOperation(readOnly?'read':'request');
  try {
    libraryDatabase();
    const response=privateResponse(await handler());
    response.headers.set('X-Frok-Reset',serviceValue('libraryResetEpoch','initial'));
    return expireBrowserKeys(request,response);
  }finally{endOperation(operation);}
}
export async function handleLibraryReset(request:Request){
  assertAppRequest(request);
  if(request.method!=='DELETE')throw new HttpError(405,'Method not allowed.');
  if((await readJson(request,200)).confirm!=='DELETE ALL DATA')throw new HttpError(400,'Confirm deletion of the entire library.');
  return privateResponse(Response.json(await resetLibrary()));
}
