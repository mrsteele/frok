import { useSyncExternalStore } from 'react';

// Only the isolated preview uses this router. Every destination retains fixtures.
function navigate(href: string, replace = false) {
  const url = new URL(href, location.origin);
  url.searchParams.set('view', 'studio');
  url.searchParams.set('state', new URLSearchParams(location.search).get('state') || 'connected');
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => history.back(),
};
export function useRouter() { return router; }
export function usePathname() {
  return useSyncExternalStore(
    (callback) => { window.addEventListener('popstate', callback); return () => window.removeEventListener('popstate', callback); },
    () => location.pathname,
  );
}
export function useSearchParams() {
  return new URLSearchParams(window.location.search);
}
