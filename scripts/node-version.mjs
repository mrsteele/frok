import { readFileSync } from 'node:fs';

export const nodeVersion = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw Error('.node-version must pin an exact Node release.');

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minimum = /^>=(\d+\.\d+\.\d+)$/.exec(engines.node)?.[1];
if (!minimum) throw Error('Declare engines.node as >=major.minor.patch.');
export const nodeTarget = `node${minimum}`;
export function requireSupportedNode(version = process.versions.node) {
  const actual = version.split('.').map(Number), required = minimum.split('.').map(Number);
  const difference = actual.map((part, index) => part - required[index]).find(part => part !== 0) || 0;
  if (difference < 0) throw Error(`Frok requires Node.js ${engines.node}.`);
}
requireSupportedNode(nodeVersion);
