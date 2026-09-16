import { createHash } from 'node:crypto';
import { aggregateDownloadAccess, huggingFaceRepository, type DownloadAccess, type DownloadRepository } from '../pipelines/download-access';

const cache = new Map<string, { expires: number; result: DownloadRepository }>();
export const accessCacheLifetime = 5 * 60 * 1000;
function cacheKey(repository: string, token: string) {
  return `${createHash('sha256').update(token).digest('hex')}:${repository}`;
}

// Reading readiness never contacts Hugging Face. Results are temporary and scoped
// to the token used by the backend, rather than renderer credential preferences.
export function cachedDownloadAccess(access: DownloadAccess): DownloadAccess {
  if (!access.repositories.length) return access;
  const token = process.env.HF_TOKEN?.trim();
  return aggregateDownloadAccess(access.repositories.map(repository => {
    if (repository.state === 'unknown' || !repository.repository) return repository;
    if (!token) return { ...repository, state: 'token-required', checkedAt: undefined };
    const key = cacheKey(repository.repository, token), cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return { ...repository, state: cached.result.state, checkedAt: cached.result.checkedAt };
    cache.delete(key);
    return { ...repository, state: 'unchecked', checkedAt: undefined };
  }));
}

export async function checkDownloadAccess(access: DownloadAccess, signal: AbortSignal): Promise<DownloadAccess> {
  const token = process.env.HF_TOKEN?.trim();
  if (!token || !access.repositories.length) return cachedDownloadAccess(access);
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  const repositories = await Promise.all(access.repositories.map(async repository => {
    if (repository.state === 'unknown' || !repository.repository) return repository;
    const repo = repository.repository;
    // Defense in depth: never use a metadata URL as the authenticated destination.
    if (huggingFaceRepository(`https://huggingface.co/${repo}`) !== repo) return { ...repository, state: 'unknown' as const };
    let state: DownloadRepository['state'] = 'unavailable';
    try {
      timeout.throwIfAborted();
      const response = await fetch(`https://huggingface.co/api/models/${repo}/auth-check`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', cache: 'no-store', signal: timeout,
      });
      if (response.status === 200) state = 'granted';
      else if (response.status === 401 || response.status === 403) state = 'denied';
      await response.body?.cancel();
    } catch { /* Never expose a credential-bearing request or remote error body. */ }
    const result = { ...repository, state, checkedAt: new Date().toISOString() };
    if (cache.size >= 256) cache.clear();
    cache.set(cacheKey(repo, token), { expires: Date.now() + accessCacheLifetime, result });
    return result;
  }));
  signal.throwIfAborted();
  return aggregateDownloadAccess(repositories);
}
