import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function publicUpdateKey(seed) {
  const bytes = Buffer.from(seed.trim(), 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== seed.trim()) throw Error('SPARKLE_PRIVATE_KEY must contain a base64-encoded 32-byte Ed25519 seed.');
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), bytes]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ format: 'jwk' }).x.replace(/-/g, '+').replace(/_/g, '/') + '=';
}

export async function generateUpdateKey(root = process.cwd()) {
  const publicFile = path.join(root, 'desktop/sparkle-key.json');
  if (await fs.stat(publicFile).catch(() => undefined)) throw Error('An update public key already exists. Restore its private key from your backup; do not regenerate it for existing installations.');
  const directory = path.join(root, '.data/update-signing');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
  const privateFile = path.join(directory, 'sparkle-private-key');
  await fs.writeFile(privateFile, seed + '\n', { flag: 'wx', mode: 0o600 });
  await fs.writeFile(publicFile, JSON.stringify({ publicEdKey: publicUpdateKey(seed) }, null, 2) + '\n', { flag: 'wx' });
  return privateFile;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = await generateUpdateKey();
  console.log(`Update key created. Back up ${file} securely and set its contents as the GitHub Actions secret SPARKLE_PRIVATE_KEY. Only desktop/sparkle-key.json belongs in source control.`);
}
