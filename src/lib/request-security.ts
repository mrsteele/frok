export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
export function publicOrigin(request:Request){
  const url=new URL(request.url),host=request.headers.get('host')||url.host;
  const origin=new URL(process.env.FROK_ORIGIN||`${url.protocol}//${host}`);
  if(!loopback.has(origin.hostname))throw new HttpError(403,'Frok accepts only local connections.');
  if(process.env.FROK_ORIGIN&&origin.origin!==process.env.FROK_ORIGIN.replace(/\/$/,''))throw new HttpError(503,'Configure FROK_ORIGIN without a path.');
  if(host!==origin.host)throw new HttpError(403,'Unrecognized app host.');
  if(!process.env.FROK_ORIGIN&&(origin.port!==String(process.env.PORT||3000)||origin.protocol!=='http:'))throw new HttpError(403,'Use the configured local app address.');
  return origin;
}
export function assertAppRequest(request:Request){
  const origin=publicOrigin(request),supplied=request.headers.get('origin');
  if(supplied!==null&&supplied!==origin.origin)throw new HttpError(403,'Cross-origin requests are not allowed.');
  const site=request.headers.get('sec-fetch-site');
  if(site&&!['same-origin','none'].includes(site))throw new HttpError(403,'Cross-origin requests are not allowed.');
  if(!['GET','HEAD'].includes(request.method)&&(supplied!==origin.origin||request.headers.get('x-frok-request')!=='1'))throw new HttpError(403,'A same-origin app request is required.');
}
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','Vary':'Origin','Cross-Origin-Resource-Policy':'same-origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function privateResponse(response:Response){for(const [key,value] of Object.entries(privateHeaders))response.headers.set(key,value);return response;}
export function expireBrowserKeys(request:Request,response:Response){
  const names=(request.headers.get('cookie')||'').split(';').map(value=>value.trim().split('=')[0]);
  for(const name of names)if(/^(?:__Host-)?frok_session(?:_\d+)?$/.test(name))response.headers.append('Set-Cookie',`${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${name.startsWith('__Host-')?'; Secure':''}`);
  return response;
}
