export type SettingsSection = 'generate' | 'pipelines' | 'recipes' | 'welcome';
export type StudioRoute =
  | { view: 'envision' | 'about' | 'utils' }
  | { view: 'favorites'; filter: 'all' | 'image' | 'video' }
  | { view: 'settings'; section: SettingsSection }
  | { view: 'media'; id: string; renderNumber: number; legacy?: boolean }
  | { view: 'queue'; id?: string };

export function studioRoute(pathname: string): StudioRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return { view: 'envision' };
  const [area, value] = parts;
  if (parts.length === 1 && (area === 'about'||area==='utils')) return { view: area as 'about'|'utils' };
  if (parts.length <= 2 && area === 'history' && (!value || value === 'images' || value === 'videos')) return { view: 'envision' };
  if (parts.length <= 2 && area === 'favorites' && (!value || value === 'images' || value === 'videos')) {
    return { view: area, filter: value === 'videos' ? 'video' : value === 'images' ? 'image' : 'all' };
  }
  if (parts.length <= 2 && area === 'settings' && (!value || ['generate', 'overview', 'connection', 'models', 'pipelines', 'recipes', 'video', 'welcome'].includes(value))) {
    // Keep old settings links working while Generate becomes the default page.
    return { view: 'settings', section: (!value||['generate','overview','connection'].includes(value)?'generate':value==='models'||value==='video'?'pipelines':value) as SettingsSection };
  }
  // IDs are single, opaque URL segments; never pass an arbitrary URL to the router or API.
  if (area === 'asset' && parts.length >= 2 && parts.length <= 3 && /^[a-zA-Z0-9_-]+$/.test(value)) {
    const number=parts[2]===undefined?1:Number(parts[2]);
    if((parts[2]===undefined||/^[1-9]\d*$/.test(parts[2]))&&Number.isSafeInteger(number))return {view:'media',id:value,renderNumber:number};
  }
  if (parts.length === 2 && ['images','videos','image','video'].includes(area) && /^[a-zA-Z0-9_-]+$/.test(value)) {
    return { view: 'media', id: value, renderNumber:1, legacy:true };
  }
  if (parts.length <= 2 && area === 'queue' && (!value || /^[a-zA-Z0-9_-]+$/.test(value))) return { view: 'queue', id: value };
  return null;
}

export const settingsPath = (section: SettingsSection) => section === 'generate' ? '/settings' : `/settings/${section}`;
export const assetPath = (rootId:string, number=1) => `/asset/${encodeURIComponent(rootId)}${number>1?`/${number}`:''}`;
export const mediaPath = (item: { id: string; kind: 'image' | 'video'; rootId?: string; assetNumber?: number }) =>
  item.assetNumber ? assetPath(item.rootId||item.id,item.assetNumber) : `/${item.kind==='image'?'images':'videos'}/${encodeURIComponent(item.id)}`;

const historyKey = 'frokNavigationDepth';
const assetOriginKey = 'frokAssetOrigin';
type AssetOrigin = { path: string; depth: number | null };
export function navigationDepth(state: Record<string, unknown> | null): number {
  const value = state?.[historyKey];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assetOrigin(state: Record<string, unknown> | null): AssetOrigin | undefined {
  const value = state?.[assetOriginKey] as Partial<AssetOrigin> | undefined;
  if (!value || typeof value.path !== 'string' || !value.path.startsWith('/') || value.path.startsWith('//') || value.path.includes('\\')) return;
  let url: URL;
  try { url = new URL(value.path, 'http://frok.local'); } catch { return; }
  if (url.origin !== 'http://frok.local') return;
  const route = studioRoute(url.pathname);
  if (!route || route.view === 'media') return;
  if (value.depth !== null && (typeof value.depth !== 'number' || !Number.isSafeInteger(value.depth) || value.depth < 0)) return;
  return { path: url.pathname + url.search + url.hash, depth: value.depth };
}

export function assetBackTarget(state: Record<string, unknown> | null, fallback = '/'): { steps: number } | { href: string } {
  const origin = assetOrigin(state);
  const depth = navigationDepth(state);
  return origin?.depth != null && origin.depth < depth
    ? { steps: origin.depth - depth }
    : { href: origin?.path ?? fallback };
}

// Mark our own entries, preserving Next's history data. history.length alone also
// counts unrelated sites, so it cannot provide a safe Back on a direct visit.
export function trackBrowserNavigation(browser: Pick<Window, 'history' | 'location'>): () => void {
  const { history, location } = browser;
  const push = history.pushState, replace = history.replaceState;
  replace.call(history, { ...history.state, [historyKey]: navigationDepth(history.state) }, '', location.href);
  function trackedState(data: Record<string, unknown> | null, url: string | URL | null | undefined, pushing: boolean) {
    const current = new URL(location.href), next = new URL(url == null ? current.href : String(url), current);
    const sameOrigin = next.origin === current.origin;
    const state: Record<string, unknown> = { ...data, [historyKey]: sameOrigin ? navigationDepth(history.state) + Number(pushing) : 0 };
    delete state[assetOriginKey];
    if (sameOrigin && studioRoute(next.pathname)?.view === 'media') {
      const currentRoute = studioRoute(current.pathname);
      // A whole viewer visit shares one source, even across roots, redirects,
      // reloads and browser Back/Forward. A replace has no entry to jump back to.
      const origin = currentRoute?.view === 'media' ? assetOrigin(history.state) : currentRoute ? {
        path: current.pathname + current.search + current.hash,
        depth: pushing ? navigationDepth(history.state) : null,
      } : undefined;
      if (origin) state[assetOriginKey] = origin;
    }
    return state;
  }
  const trackedPush: History['pushState'] = function (data, unused, url) {
    push.call(history, trackedState(data, url, true), unused, url);
  };
  const trackedReplace: History['replaceState'] = function (data, unused, url) {
    replace.call(history, trackedState(data, url, false), unused, url);
  };
  history.pushState = trackedPush;
  history.replaceState = trackedReplace;
  return () => {
    if (history.pushState === trackedPush) history.pushState = push;
    if (history.replaceState === trackedReplace) history.replaceState = replace;
  };
}
