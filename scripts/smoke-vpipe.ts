// Optional native CLI check. Creates only a tiny test image; no models or network.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {dataDir,vpipeBin} from '../src/lib/config';
import {runProcess} from '../src/lib/process';
const dir=path.join(dataDir,`native-smoke-${process.pid}`);await fs.mkdir(dir,{recursive:true});
try {
  const input=path.join(dir,'input.jpg'),output=path.join(dir,'output.jpg');
  await sharp({create:{width:64,height:64,channels:3,background:'#64864a'}}).jpeg().toFile(input);
  const spec={id:'frok-native-file-smoke',stages:[{id:'load',type:'load-image',iports:[],config:{url:[input]}},{id:'save',type:'save-image',iports:[{src:'load',oport:0}],config:{path:output,quality:95}}]};
  const file=path.join(dir,'check.vpipeline');await fs.writeFile(file,JSON.stringify(spec));
  await runProcess(vpipeBin(),['--launch',file],{cwd:dir,timeout:30000});
  const result=await sharp(output).metadata();if(result.width!==64||result.height!==64)throw new Error('Native Vpipe file round-trip failed');
  console.log('Native Vpipe CLI passed: load-image → save-image, 64×64. No models downloaded or used.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
