import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { nodeVersion } from './node-version.mjs';

// Use the official portable runtime, not a Homebrew/system binary that may
// depend on libraries installed only on the developer's machine.
export async function desktopNode(destination) {
  const { platform, arch } = process;
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw Error('Build on a supported target platform and architecture.');
  const name = `node-v${nodeVersion}-${platform === 'win32' ? 'win' : platform}-${arch}`;
  const archiveName = `${name}.${platform==='win32'?'zip':'tar.gz'}`;
  const base = `https://nodejs.org/dist/v${nodeVersion}/`;
  const checksums = await fetch(base + 'SHASUMS256.txt').then(response => { if (!response.ok) throw Error('Could not fetch Node checksums.'); return response.text(); });
  const checksum = checksums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === archiveName)?.[0];
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw Error('Official Node checksum not found for this platform.');
  const cache = path.resolve('.data/desktop-build-cache'); await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, archiveName.replaceAll('/', '-'));
  let data = await fs.readFile(archive).catch(() => undefined);
  if (!data || createHash('sha256').update(data).digest('hex') !== checksum) {
    const response = await fetch(base + archiveName); if (!response.ok) throw Error('Could not download the portable Node runtime.');
    data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== checksum) throw Error('Node download checksum mismatch.');
    await fs.writeFile(archive, data);
  }
  await fs.mkdir(destination, { recursive: true });
  const binary = path.join(destination, platform === 'win32' ? 'node.exe' : 'node');
  {
    const unpack = await fs.mkdtemp(path.join(cache, 'unpack-'));
    try {
      const member=platform==='win32'?'node.exe':'bin/node';
      const result = spawnSync('tar', ['-xf', archive, '-C', unpack, `${name}/${member}`, `${name}/LICENSE`], { stdio: 'inherit' });
      if (result.status !== 0) throw Error('Could not unpack the Node runtime.');
      await fs.copyFile(path.join(unpack, name, member), binary);
      await fs.copyFile(path.join(unpack, name, 'LICENSE'), path.join(destination, 'NODE-LICENSE'));
      if(platform!=='win32')await fs.chmod(binary, 0o755);
    } finally { await fs.rm(unpack, { recursive: true, force: true }); }
  }
  const verify = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (verify.status !== 0 || verify.stdout.trim() !== `v${nodeVersion}`) throw Error('The bundled Node runtime did not start.');
}
