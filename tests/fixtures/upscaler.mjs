#!/usr/bin/env node
// Synthetic frame upscaler for integration tests ONLY; this is not neural inference.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(args.includes('-h')){console.log('Synthetic upscaler fixture');process.exit(0);}
if(value('-n')!=='realesrgan-x4plus'||value('-s')!=='4')throw new Error('Unexpected neural workflow arguments');
const source=value('-i'),destination=value('-o');
await fs.mkdir(destination,{recursive:true});
for(const name of (await fs.readdir(source)).sort()){
  const file=path.join(source,name),metadata=await sharp(file).metadata();
  await sharp(file).resize(metadata.width*4,metadata.height*4).png().toFile(path.join(destination,name));
}
