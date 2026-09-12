import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expandPath } from './config';
import { settings } from './db';
import { download } from './download';
import { assertComfyPrivateBackend } from './comfyui';
import { zImageFiles, zImageUrl } from './image-model-files';

export async function prepareZImage(signal: AbortSignal, log: (text: string) => void) {
  assertComfyPrivateBackend();
  const configured=settings().comfyDir;
  if(!configured)throw new Error('Choose your ComfyUI folder in Settings → Generate before downloading image models.');
  const directory=path.join(expandPath(configured),'models');
  await fs.mkdir(/* turbopackIgnore: true */ directory,{recursive:true});
  let needed=1024**3;
  for(const file of zImageFiles) {
    const destination=path.join(/* turbopackIgnore: true */ directory,file.directory,file.name);
    const existing=await fs.stat(destination).catch(()=>undefined);
    if(existing && (!existing.isFile()||existing.size!==file.size))throw new Error(`${file.name} already exists with a different size. Ask your administrator to move it aside before preparing Z-Image-Turbo; no existing model was replaced.`);
    if(!existing){const partial=await fs.stat(destination+'.part').catch(()=>undefined);needed+=Math.max(0,file.size-(partial?.size||0));}
  }
  const disk=await fs.statfs(directory);
  if(disk.bavail*disk.bsize<needed)throw new Error(`Z-Image-Turbo needs about ${Math.ceil(needed/1024**3)} GB more free space for its model pack.`);
  for(const file of zImageFiles) {
    signal.throwIfAborted();
    const destination=path.join(/* turbopackIgnore: true */ directory,file.directory,file.name);
    const existed=!!await fs.stat(destination).catch(()=>undefined);
    await download(zImageUrl(file),destination,signal,log);
    log(`Verifying ${file.name}…\n`);
    const hash=createHash('sha256');
    try {
      const stream=createReadStream(destination,{signal});
      for await(const chunk of stream){signal.throwIfAborted();hash.update(chunk);}
      if((await fs.stat(destination)).size!==file.size||hash.digest('hex')!==file.sha256)throw new Error(`${file.name} failed verification. ${existed?'The existing file was kept; ask your administrator to check it.':'Retry the model download.'}`);
    } catch(error) { if(!existed)await fs.rm(destination,{force:true});throw error; }
  }
  log('Z-Image-Turbo, Qwen3 encoder and VAE verified. Refresh or restart ComfyUI if it has not refreshed its model list.\n');
}
