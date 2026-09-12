import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseVersion(tag,version,lockVersion){
  const match=/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag||'');
  if(!match||match[4]?.split('.').some(part=>/^\d+$/.test(part)&&part.length>1&&part[0]==='0'))throw Error('Use a semantic version tag, such as v0.2.0 or v0.2.0-beta.1.');
  if(tag.slice(1)!==version||version!==lockVersion)throw Error('The release tag, package.json version, and package-lock.json version must match.');
  return {version,prerelease:!!match[4]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8')),lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
  const result=releaseVersion(process.env.GITHUB_REF_NAME,pkg.version,lock.version);
  if(lock.packages[''].version!==pkg.version)throw Error('The lockfile root version does not match.');
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`version=${result.version}\nprerelease=${result.prerelease}\n`);
  console.log(`Validated Frok ${result.version}`);
}
