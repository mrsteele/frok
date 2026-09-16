import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { load, dump } from 'js-yaml';

export async function verifySparkleFeed(xml, assets, publicEdKey) {
  if (xml.length > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Invalid Sparkle feed.');
  const enclosures = [...xml.matchAll(/<enclosure\b([^>]+)\/?\s*>/g)];
  if (enclosures.length !== 1) throw Error('Each architecture feed must contain exactly one release archive.');
  const attributes = Object.fromEntries([...enclosures[0][1].matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
  const url = new URL(attributes.url);
  const name = decodeURIComponent(url.pathname.split('/').at(-1));
  const asset = assets.get(name);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/\/releases\/download\/[^/]+\//.test(url.pathname) || !asset || !name.endsWith('.zip') || Number(attributes.length) !== asset.size) throw Error('Missing or invalid Sparkle update archive.');
  const signature = Buffer.from(attributes['sparkle:edSignature'] || '', 'base64');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicEdKey, 'base64').toString('base64url') }, format: 'jwk' });
  if (signature.length !== 64 || !verify(null, await fs.readFile(asset.filename), key, signature)) throw Error('Sparkle update signature verification failed.');
  return name;
}

// Matrix builds produce identically named macOS manifests. Merge their files
// instead of allowing the last downloaded artifact to erase an architecture.
export async function collectReleaseArtifacts(input, output, { publicEdKey: verificationKey } = {}) {
  await fs.mkdir(output, { recursive: true });
  const manifests = new Map(), assets = new Map();
  for (const folder of await fs.readdir(input, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const entry of await fs.readdir(path.join(input, folder.name), { withFileTypes: true })) {
      if (!entry.isFile()) throw Error('Release artifacts must be regular files.');
      const name = entry.name, filename = path.join(input, folder.name, name);
      if (name.endsWith('.yml')) {
        const info = load(await fs.readFile(filename, 'utf8'));
        if (!info?.version || !Array.isArray(info.files) || !info.files.length) throw Error(`Invalid update manifest: ${name}`);
        const previous = manifests.get(name);
        if (previous && previous.version !== info.version) throw Error(`Conflicting release versions in ${name}`);
        manifests.set(name, previous ? { ...previous, files: [...previous.files, ...info.files] } : info);
      } else {
        if (!/\.(dmg|zip|exe|AppImage|blockmap)$/.test(name) && !/^appcast-(arm64|x64)\.xml$/.test(name)) throw Error(`Unexpected release artifact: ${name}`);
        const hash = createHash('sha512');
        let size = 0;
        for await (const chunk of createReadStream(filename)) { hash.update(chunk); size += chunk.length; }
        const sha512 = hash.digest('base64');
        const existing = assets.get(name);
        if (existing && existing.sha512 !== sha512) throw Error(`Conflicting release artifact: ${name}`);
        assets.set(name, { filename, sha512, size });
      }
    }
  }
  if (!manifests.size) throw Error('Release update manifests are missing.');
  if (new Set([...manifests.values()].map(info => info.version)).size !== 1) throw Error('The platform builds have different release versions.');
  const macArchives = [...assets.keys()].filter(name => /-mac-(arm64|x64)\.zip$/.test(name));
  if (macArchives.length) {
    const publicEdKey = verificationKey || JSON.parse(await fs.readFile(new URL('../desktop/sparkle-key.json', import.meta.url), 'utf8')).publicEdKey;
    for (const archive of macArchives) {
      const arch = /-mac-(arm64|x64)\.zip$/.exec(archive)[1];
      const feed = assets.get(`appcast-${arch}.xml`);
      if (!feed) throw Error(`Missing Sparkle feed for ${arch}.`);
      if (await verifySparkleFeed(await fs.readFile(feed.filename, 'utf8'), assets, publicEdKey) !== archive) throw Error('Sparkle feed targets the wrong architecture.');
    }
  }
  for (const [name, info] of manifests) {
    const files = new Map();
    for (const file of info.files) {
      const asset = assets.get(file.url);
      if (!asset || asset.sha512 !== file.sha512) throw Error(`Missing or mismatched update download: ${file.url}`);
      if (file.size !== undefined && file.size !== asset.size) throw Error(`Incorrect update download size: ${file.url}`);
      files.set(file.url, file);
    }
    info.files = [...files.values()].sort((a, b) => a.url.localeCompare(b.url));
    await fs.writeFile(path.join(output, name), dump(info));
  }
  for (const [name, asset] of assets) await fs.copyFile(asset.filename, path.join(output, name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Provide the downloaded artifacts directory and release output directory.');
  await collectReleaseArtifacts(input, output);
}
