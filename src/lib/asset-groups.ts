import type { Media } from './types';

export type AssetMember = Pick<Media, 'id' | 'kind' | 'sourceId' | 'rootId'>;
export const assetId = (item: AssetMember) => item.rootId || (item.kind === 'video' ? item.sourceId : undefined) || item.id;

// Resolve older records whose HD copies only point to an SD video.
export function resolveAssetRoots(items: AssetMember[]) {
  const byId = new Map(items.map(item => [item.id, item])), roots = new Map<string, string>();
  function resolve(item: AssetMember, seen = new Set<string>()): string {
    const known = roots.get(item.id); if (known) return known;
    if (seen.has(item.id)) return [...seen].sort()[0];
    seen.add(item.id);
    const parentId = item.kind === 'video' ? item.rootId || item.sourceId : undefined;
    const parent = parentId && parentId !== item.id ? byId.get(parentId) : undefined;
    const root = parent ? resolve(parent, seen) : parentId || item.id;
    roots.set(item.id, root); return root;
  }
  items.forEach(item => resolve(item)); return roots;
}

export function newestMedia(a: Media, b: Media) {
  return b.createdAt.localeCompare(a.createdAt) || Number(b.kind === 'video') - Number(a.kind === 'video') || Number(b.origin === 'upscale') - Number(a.origin === 'upscale') || b.id.localeCompare(a.id);
}

export function groupAssets(items: Media[]): Media[] {
  const roots = resolveAssetRoots(items), groups = new Map<string, Media>();
  for (const item of items) {
    if(item.referenceOnly)continue;
    const id = roots.get(item.id)!, previous = groups.get(id);
    if (!previous || newestMedia(item, previous) < 0) groups.set(id, { ...item, rootId: id });
  }
  return [...groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
