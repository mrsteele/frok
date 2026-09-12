import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export type ArchiveEntry={name:string;file:string;size:number;mtimeMs:number;dev:number;ino:number};
const block=512;
function octal(header:Buffer,offset:number,length:number,value:number) {
  const digits=Math.floor(value).toString(8);
  if(digits.length>=length)throw Error('Archive header value is too large.');
  header.write(digits.padStart(length-1,'0')+'\0',offset,length,'ascii');
}
function header(name:string,size:number,mtime:number,type='0') {
  const data=Buffer.alloc(block);
  data.write(name,0,100,'ascii');octal(data,100,8,0o600);octal(data,108,8,0);octal(data,116,8,0);
  octal(data,124,12,size);octal(data,136,12,Math.max(0,Math.floor(mtime/1000)));
  data.fill(32,148,156);data.write(type,156,1);data.write('ustar\0',257,6);data.write('00',263,2);
  const checksum=data.reduce((sum,byte)=>sum+byte,0);
  data.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  return data;
}
function pax(key:string,value:string) {
  const body=' '+key+'='+value+'\n';
  let size=Buffer.byteLength(body)+1;
  while(String(size).length+Buffer.byteLength(body)!==size)size=String(size).length+Buffer.byteLength(body);
  return Buffer.from(String(size)+body);
}
function padding(size:number){return Buffer.alloc((block-size%block)%block);}

// POSIX pax headers preserve Unicode/long names and files larger than 8 GiB.
// Media payloads flow in bounded chunks; no archive-sized buffer is allocated.
async function* contents(entries:ArchiveEntry[],signal:AbortSignal) {
  const seen=new Set<string>();
  for(const [index,entry] of entries.entries()) {
    signal.throwIfAborted();
    if(!entry.name||entry.name.startsWith('/')||entry.name.includes('\\')||/[\x00-\x1f]/.test(entry.name)||entry.name.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(entry.name))throw Error('Invalid or duplicate archive path.');
    seen.add(entry.name);
    const file=await fs.open(/* turbopackIgnore: true */entry.file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try {
      const stat=await file.stat();
      if(!stat.isFile()||stat.size!==entry.size||stat.mtimeMs!==entry.mtimeMs||stat.dev!==entry.dev||stat.ino!==entry.ino)throw Error('A file changed during export. Please try again.');
      const extended=Buffer.concat([pax('path',entry.name),pax('size',String(entry.size))]);
      yield header('PaxHeaders/'+index,extended.length,entry.mtimeMs,'x');yield extended;yield padding(extended.length);
      yield header('file-'+index,entry.size<8**11?entry.size:0,entry.mtimeMs);
      let bytes=0;
      for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:256*1024,signal})) {
        bytes+=chunk.length;if(bytes>entry.size)throw Error('A file changed during export. Please try again.');yield chunk;
      }
      const after=await file.stat();
      if(bytes!==entry.size||after.size!==entry.size||after.mtimeMs!==entry.mtimeMs)throw Error('A file changed during export. Please try again.');
      yield padding(entry.size);
    }finally{await file.close();}
  }
  yield Buffer.alloc(block*2);
}
export async function writeArchive(entries:ArchiveEntry[],destination:string,signal:AbortSignal) {
  await pipeline(Readable.from(contents(entries,signal)),createGzip({level:1}),createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
}
