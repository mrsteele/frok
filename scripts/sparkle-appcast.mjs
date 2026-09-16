import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { publicUpdateKey } from './update-key.mjs';
import { product } from '../desktop/product.mjs';

const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const { publicEdKey } = JSON.parse(await fs.readFile('desktop/sparkle-key.json', 'utf8'));
const seed = process.env.SPARKLE_PRIVATE_KEY?.trim();
if (!seed || publicUpdateKey(seed) !== publicEdKey) throw Error('SPARKLE_PRIVATE_KEY is missing or does not match desktop/sparkle-key.json.');
const repository = process.env.GITHUB_REPOSITORY || new URL(product.githubUrl).pathname.slice(1);
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Invalid release repository.');
const tag = process.env.GITHUB_REF_NAME || `v${version}`;
if (tag !== `v${version}`) throw Error('The release tag must match package.json.');
const arch = process.arch;
if (!['arm64', 'x64'].includes(arch)) throw Error('Unsupported macOS release architecture.');
const filename = `Frok-${version}-mac-${arch}.zip`;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-appcast-'));
try {
  await fs.copyFile(path.join('release', filename), path.join(directory, filename));
  const env = { ...process.env }; delete env.SPARKLE_PRIVATE_KEY;
  await new Promise((resolve, reject) => {
    const child = spawn(path.resolve('node_modules/electron-sparkle-updater/native/vendor/bin/generate_appcast'), [
      '--ed-key-file', '-', '--download-url-prefix', `https://github.com/${repository}/releases/download/${tag}/`,
      '--full-release-notes-url', `https://github.com/${repository}/releases/tag/${tag}`,
      '-o', path.resolve(`release/appcast-${arch}.xml`), directory,
    ], { env, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.on('error', () => {}); child.stdin.end(seed + '\n');
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('Sparkle appcast generation failed.')));
  });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
