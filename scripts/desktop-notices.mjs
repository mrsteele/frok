import fs from 'node:fs/promises';
import path from 'node:path';

// Next's standalone trace omits license files. Keep the supplied notices for
// runtime packages, including dependencies compiled into the client bundles.
export async function desktopNotices(root, destination) {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  await fs.rm(destination, {recursive: true, force: true});
  await fs.mkdir(destination, {recursive: true});
  const packages = [];
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..') || entry.dev) continue;
    const source = path.join(root, relative);
    const pkg = await fs.readFile(path.join(source, 'package.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!pkg) continue; // Platform-specific optional dependency, not installed.
    const prefix = relative.slice('node_modules/'.length), files = [];
    async function visit(folder) {
      for (const item of await fs.readdir(folder, {withFileTypes: true})) {
        if (item.isDirectory() && !['node_modules', '.git'].includes(item.name)) await visit(path.join(folder, item.name));
        else if (item.isFile() && /^(?:licen[cs]es?|copying|copyright|notice)(?:[._-].*)?$/i.test(item.name)) {
          const name = path.relative(source, path.join(folder, item.name));
          const target = path.join(destination, prefix, name);
          await fs.mkdir(path.dirname(target), {recursive: true});
          await fs.copyFile(path.join(folder, item.name), target); files.push(name);
        }
      }
    }
    await visit(source);
    const versions = await fs.readFile(path.join(source, 'versions.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; });
    packages.push({name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository, notices: files, ...(versions ? {components: versions} : {})});
  }
  await fs.writeFile(path.join(destination, 'dependencies.json'), JSON.stringify(packages, null, 2) + '\n');
  await fs.writeFile(path.join(destination, 'README.txt'), 'Licenses and notices supplied by installed production npm packages. dependencies.json identifies their versions, source repositories and any native component versions. Packages without notice files remain listed for release review. Electron/Chromium and the portable Node runtime carry separate bundled notices.\n');
  return packages;
}
