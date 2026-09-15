import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readDefinition(file:string):Promise<Record<string,unknown>> {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error('Pipeline definitions must be regular JSON files under 2 MB.');
  const value=JSON.parse(await fs.readFile(file,'utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Expected a JSON object.');return value;
}
