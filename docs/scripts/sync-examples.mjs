import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const docs=fileURLToPath(new URL('../',import.meta.url));
const factory=path.resolve(docs,'../resources/pipelines');
// Public distribution examples only. Never scan the user's working pipelines.
const examples={
  krea:['image/krea-2-turbo',['run.vpipeline','prepare.vpipeline','meta.json']],
  comfyui:['image/sdxl-turbo',['run.json','meta.json']],
  minimax:['video/minimax-h3-turbo',['run.vpipeline','prepare.vpipeline','meta.json']],
  reference:['reference/minimax-h3-reference',['run.vpipeline','prepare.vpipeline','meta.json']],
};
for(const [name,[folder,files]] of Object.entries(examples)){
  const destination=path.join(docs,'public/examples',name);await mkdir(destination,{recursive:true});
  for(const file of files)await copyFile(path.join(factory,folder,file),path.join(destination,file));
  if(files.includes('run.vpipeline')) {
    await copyFile(path.join(factory,'VPIPE-LICENSE'),path.join(destination,'VPIPE-LICENSE.txt'));
    await writeFile(path.join(destination,'NOTICE.txt'),'Frok workflow example, adapted from tgo-app-dev/vpipe pipeline definitions.\nUpstream revision: 27af0cb6b6a4584da6a7dce02b5ceb188aaeca83\nhttps://github.com/tgo-app-dev/vpipe\nFrok adds application bindings, preparation metadata and workflow adjustments.\nRetain the accompanying VPIPE-LICENSE.txt when redistributing this example.\nAI model weights are not included and have separate license terms.\n');
  }
}
console.log('Updated four public factory workflow examples.');
