import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import { docsResponse } from '../desktop/docs-content.mjs';

export async function startUIGallery({ port = 4178, watch = true } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const parent = path.join(root, '.data');
  await fs.mkdir(parent, { recursive: true });
  const output = await fs.mkdtemp(path.join(parent, 'ui-gallery-'));
  const build = await context({
    absWorkingDir: root,
    entryPoints: ['dev/ui/gallery.tsx'],
    outdir: output,
    bundle: true,
    platform: 'browser',
    alias: {
      'next/link': path.join(root, 'dev/ui/link.tsx'),
      'next/navigation': path.join(root, 'dev/ui/navigation.ts'),
    },
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    metafile: true,
  });
  const result = await build.rebuild();
  if (
    Object.keys(result.metafile.inputs).some((file) =>
      /^src\/lib\/(?:db|registry|library|config|paths)\.[jt]s$/.test(file),
    )
  ) {
    await build.dispose();
    throw Error('The UI gallery must not include backend storage modules.');
  }
  if (watch) await build.watch();
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frok UI gallery</title><link rel="stylesheet" href="/gallery.css"></head><body><div id="root"></div><script type="module" src="/gallery.js"></script></body></html>';
  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/brand/mark.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(await fs.readFile(path.join(root, 'public/brand/mark.svg')));
      return;
    }
    if (route.startsWith('/docs/')) {
      const response = await docsResponse(path.join(root, 'public/docs'))(new Request('frok-docs://help' + route.slice(5), {headers:req.headers}));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (route.startsWith('/api/media/')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#345849"/><stop offset="1" stop-color="#aec7a4"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h640v480H0z"/><circle cx="440" cy="130" r="46" fill="#e8daac"/><path d="M0 290L180 110l160 210L490 195l150 110v175H0" fill="#233e39"/><path d="M0 325q190-35 320 0t320 0v155H0" fill="#497568"/><text x="24" y="450" fill="#d5e6d4" font-family="sans-serif" font-size="16">Synthetic UI preview · no generated media</text></svg>');
      return;
    }
    if (route === '/' || !path.extname(route)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }
    if (!['/gallery.js', '/gallery.css'].includes(route)) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : 'text/javascript');
      res.end(await fs.readFile(path.join(output, route.slice(1))));
    } catch {
      res.writeHead(500).end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await build.dispose();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await build.dispose();
      await fs.rm(output, { recursive: true, force: true });
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gallery = await startUIGallery();
  console.log(`Frok UI gallery: ${gallery.url} — synthetic data, no app services`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void gallery.close();
    });
}
