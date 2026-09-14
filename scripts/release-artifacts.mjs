import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { load, dump } from 'js-yaml';

// Matrix builds produce identically named macOS manifests. Merge their files
// instead of allowing the last downloaded artifact to erase an architecture.
export async function collectReleaseArtifacts(input, output) {
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
        if (!/\.(dmg|zip|exe|AppImage|blockmap)$/.test(name)) throw Error(`Unexpected release artifact: ${name}`);
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
