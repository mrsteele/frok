import fs from "node:fs/promises";
import path from "node:path";
export async function download(url:string,destination:string,signal:AbortSignal,log:(s:string)=>void) {
  await fs.mkdir(path.dirname(destination),{recursive:true});
  if((await fs.stat(destination).catch(()=>null))?.size){log(`Already downloaded: ${path.basename(destination)}\n`);return;}
  const partial=destination+".part";const size=(await fs.stat(partial).catch(()=>null))?.size||0;
  const headers:Record<string,string>={};if(size)headers.Range=`bytes=${size}-`;
  if(process.env.HF_TOKEN&&new URL(url).hostname==="huggingface.co")headers.Authorization=`Bearer ${process.env.HF_TOKEN}`;
  const response=await fetch(url,{headers,signal});
  if(!response.ok)throw new Error(`Download failed (${response.status}) for ${path.basename(destination)}. For gated models, accept the license, save your Hugging Face token in Settings → Generate → API tokens, and quit and reopen Frok.`);
  const {Readable}=await import("node:stream");const {pipeline}=await import("node:stream/promises");const {createWriteStream}=await import("node:fs");
  let bytes=response.status===206?size:0;let last=0;
  const stream=Readable.fromWeb(response.body as never);
  stream.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(Date.now()-last>2000){log(`${path.basename(destination)} · ${(bytes/1024**3).toFixed(2)} GB downloaded\n`);last=Date.now();}});
  await pipeline(stream,createWriteStream(partial,{flags:response.status===206?"a":"w"}),{signal});
  await fs.rename(partial,destination);
}
