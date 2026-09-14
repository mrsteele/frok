import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const docs=fileURLToPath(new URL('../',import.meta.url));
const factory=path.resolve(docs,'../resources/pipelines');
// Public distribution examples only. Never scan the user's working pipelines.
export const examples={
  krea:['image/krea-2-turbo',['run.vpipeline','prepare.vpipeline','meta.json']],
  comfyui:['image/sdxl-turbo',['run.json','meta.json']],
  minimax:['video/minimax-h3-turbo',['run.vpipeline','prepare.vpipeline','meta.json']],
  reference:['reference/minimax-h3-reference',['run.vpipeline','prepare.vpipeline','meta.json']],
};
export async function syncExamples(source=factory,output=path.join(docs,'public/examples')) {
  for(const [name,[folder,files]] of Object.entries(examples)){
    const destination=path.join(output,name);await mkdir(destination,{recursive:true});
    const copies=files.map(file=>[path.join(source,folder,file),file]);
    if(files.includes('run.vpipeline'))copies.push([path.join(source,'VPIPE-LICENSE'),'VPIPE-LICENSE.txt'],[path.join(source,'VPIPE-NOTICE'),'NOTICE.txt']);
    for(const [input,name] of copies){
      const content=await readFile(input),target=path.join(destination,name);
      const previous=await readFile(target).catch(error=>{if(error.code!=='ENOENT')throw error;});
      if(!previous?.equals(content))await writeFile(target,content);
    }
    // Retire old generated workflow formats without touching unrelated files.
    const expected=new Set(copies.map(([,name])=>name));
    for(const name of ['run.vpipeline','prepare.vpipeline','run.json','prepare.json','meta.json','VPIPE-LICENSE.txt','NOTICE.txt'])if(!expected.has(name))await rm(path.join(destination,name),{force:true});
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){await syncExamples();console.log(`Updated ${Object.keys(examples).length} public factory workflow examples.`);}
