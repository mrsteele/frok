import fs from 'node:fs/promises';
import path from 'node:path';

type Tensor = {dtype:string;shape:number[];data_offsets:[number,number]};

/** Small bounded metadata reads; the multi-GB model tensors never enter Node memory. */
export async function tensorFile(filename:string) {
  const file=await fs.open(/* turbopackIgnore: true */ filename,'r');
  try {
    const stat=await file.stat(),size=Buffer.alloc(8);
    if(!stat.isFile()||(await file.read(size,0,8,0)).bytesRead!==8)throw Error('Invalid safetensors file.');
    const length=Number(size.readBigUInt64LE());
    if(!Number.isSafeInteger(length)||length<2||length>16*1024*1024||length+8>=stat.size)throw Error('Invalid safetensors header.');
    const buffer=Buffer.alloc(length);
    if((await file.read(buffer,0,length,8)).bytesRead!==length)throw Error('Incomplete tensor header.');
    const entries=Object.entries(JSON.parse(buffer.toString())).filter(([name])=>name!=='__metadata__') as [string,Tensor][];
    let end=0;
    for(const [,entry]of entries) {
      const offsets=entry.data_offsets;
      if(!Array.isArray(entry.shape)||!entry.shape.every(n=>Number.isSafeInteger(n)&&n>=0)||typeof entry.dtype!=='string'||!Array.isArray(offsets)||offsets.length!==2||!offsets.every(Number.isSafeInteger)||offsets[0]<0||offsets[1]<offsets[0])throw Error('Invalid tensor metadata.');
      end=Math.max(end,offsets[1]);
    }
    if(!entries.length||end+length+8!==stat.size)throw Error('Incomplete tensor file.');
    return {filename,size:stat.size,mtime:stat.mtimeMs,offset:8+length,tensors:Object.fromEntries(entries) as Record<string,Tensor>};
  } finally { await file.close(); }
}

export async function modelTensors(directory:string) {
  const files=(await fs.readdir(directory)).filter(name=>name.endsWith('.safetensors')).sort();
  if(!files.length)throw Error('The model directory has no safetensors files.');
  const result=await Promise.all(files.map(name=>tensorFile(path.join(/* turbopackIgnore: true */ directory,name))));
  const names=new Set<string>();
  for(const file of result)for(const name of Object.keys(file.tensors)){if(names.has(name))throw Error('Duplicate model tensor.');names.add(name);}
  return result;
}
