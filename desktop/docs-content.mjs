import fs from 'node:fs/promises';
import path from 'node:path';

export const docsOrigin = 'frok-docs://help';
export function isDocsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'frok-docs:' && url.host === 'help' && !url.username && !url.password; } catch { return false; }
}
export function docsPage(value = '/') {
  if (typeof value !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]*(?:\.html)?(?:#[a-zA-Z0-9_-]+)?$/.test(value)) throw Error('Invalid documentation page.');
  const [pathname, hash] = value.split('#');
  return (pathname.endsWith('/') ? `${pathname}index.html` : pathname.endsWith('.html') ? pathname : `${pathname}.html`) + (hash ? `#${hash}` : '');
}
export function onlineDocsUrl(base, page) {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return new URL(docsPage(page).slice(1), url).href;
  } catch { return undefined; }
}
const types = { '.txt':'text/plain; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.mp4':'video/mp4', '.ico':'image/x-icon', '.woff2':'font/woff2', '.vpipeline':'application/octet-stream' };
// The handler can read only the bundled static site, never workspace files.
export function docsResponse(root) {
  return async request => {
    if (!isDocsUrl(request.url)) return new Response('Forbidden', { status:403 });
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status:405 });
    try {
      let relative = decodeURIComponent(new URL(request.url).pathname).slice(1);
      if (relative.includes('\\') || relative.split('/').some(part => part === '..' || part.startsWith('.')) || /[\x00-\x1f]/.test(relative)) return new Response('Forbidden', { status:403 });
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      if (!path.extname(relative)) relative += '.html';
      const extension = path.extname(relative);
      if (!types[extension]) return new Response('Not found', { status:404 });
      const base = await fs.realpath(root), file = await fs.realpath(path.join(base, relative));
      const resolved = path.relative(base, file);
      if (resolved.startsWith('..') || path.isAbsolute(resolved)) return new Response('Forbidden', { status:403 });
      const headers = {
        'Content-Type': types[extension], 'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
      };
      if (extension === '.vpipeline' || relative.startsWith('examples/') && ['.json','.txt'].includes(extension)) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
      if (extension === '.mp4') {
        const size = (await fs.stat(file)).size;
        headers['Accept-Ranges'] = 'bytes'; headers['Content-Length'] = String(size);
        if (request.method === 'HEAD') return new Response(null, { headers });
        const range = request.headers?.get('range');
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, size - Number(match[2])) : NaN;
          const end = match?.[1] && match?.[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status:416, headers:{'Content-Range':`bytes */${size}`} });
          headers['Content-Range'] = `bytes ${start}-${end}/${size}`; headers['Content-Length'] = String(end - start + 1);
          return new Response((await fs.readFile(file)).subarray(start, end + 1), { status:206, headers });
        }
      }
      return new Response(request.method === 'HEAD' ? null : await fs.readFile(file), { headers });
    } catch { return new Response('Documentation page not found.', { status:404 }); }
  };
}
