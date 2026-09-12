import fs from 'node:fs/promises';
import path from 'node:path';

// Metadata-only stand-ins, never actual model weights or generated media.
export async function writeReferencePack(workspace:string) {
  const directory=path.join(workspace,'models/local/MiniMax-H3-Ref2VA-8bit');
  const header=Buffer.from(JSON.stringify({synthetic:{dtype:'U8',shape:[1],data_offsets:[0,1]}}));
  const size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(header.length));
  const tensor=Buffer.concat([size,header,Buffer.from([0])]);
  for(const component of ['diffusion_models','text_encoders']) {
    const folder=path.join(directory,component);await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,'model-00001-of-00001.safetensors'),tensor);
    await fs.writeFile(path.join(folder,'model.safetensors.index.json'),JSON.stringify({weight_map:{synthetic:'model-00001-of-00001.safetensors'}}));
  }
  await fs.mkdir(path.join(directory,'vae'),{recursive:true});
  for(const name of ['minimax_h3_video_vae_fp16.safetensors','minimax_h3_audio_vae_fp32.safetensors'])await fs.writeFile(path.join(directory,'vae',name),tensor);
  await fs.mkdir(path.join(directory,'tokenizer'),{recursive:true});
  for(const name of ['tokenizer.json','tokenizer_config.json'])await fs.writeFile(path.join(directory,'tokenizer',name),'{}');
  return directory;
}
