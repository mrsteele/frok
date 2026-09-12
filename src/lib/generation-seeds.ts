import { randomInt } from 'node:crypto';

const seedRange = 2 ** 31;
export function generationSeeds(count: number, first?: number, random = () => randomInt(0, seedRange)): number[] {
  const used = new Set<number>();
  return Array.from({ length: count }, (_, index) => {
    let seed = first === undefined ? random() : (first + index) % seedRange;
    // Even an unlikely random collision must not reuse noise within a batch.
    while (used.has(seed)) seed = (seed + 1) % seedRange;
    used.add(seed);
    return seed;
  });
}
