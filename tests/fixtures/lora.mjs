import fs from 'node:fs/promises';
import path from 'node:path';
export async function writeLora(file) {
  const metadata=JSON.stringify({'blocks.0.attn.lora_A.weight':{dtype:'U8',shape:[1,1],data_offsets:[0,1]},'blocks.0.attn.lora_B.weight':{dtype:'U8',shape:[1,1],data_offsets:[1,2]}});
  const size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(Buffer.byteLength(metadata)));
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.concat([size,Buffer.from(metadata),Buffer.alloc(2)]));
}
export async function writeReferenceTurbo(workspace) {
  await writeLora(path.join(workspace,'models/lightx2v/Minimax-h3-Turbo/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors'));
}
