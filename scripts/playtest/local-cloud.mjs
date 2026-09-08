import { readFile, realpath } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { resolve } from 'node:path';
export async function createLocalCloud({ token, adminToken }) {
  const bundled = await build({
    entryPoints: [resolve('scripts/playtest/worker.mjs')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const options = {
    workers: [
      {
        name: 'capture',
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: '2026-09-07',
        bindings: {
          ALLOWED_ORIGIN: 'http://localhost',
          INVITATION_GENERATION: '1',
          INVITATION_TOKEN: token,
          COOKIE_SECRET: 'local-only-cookie-secret-'.repeat(3),
          ADMIN_TOKEN: adminToken,
        },
        durableObjects: { CAPTURE: { className: 'CaptureStore', useSQLite: true } },
        r2Buckets: ['RECORDINGS'],
        serviceBindings: {
          ASSETS: async (request) => {
            const root = await realpath('dist'),
              pathname = decodeURIComponent(new URL(request.url).pathname);
            const candidate = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
            try {
              const actual = await realpath(candidate);
              if (relative(root, actual).startsWith('..'))
                return new Response(null, { status: 404 });
              const types = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.wasm': 'application/wasm',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
              };
              if (!types[extname(actual)]) return new Response(null, { status: 404 });
              return new Response(await readFile(actual), {
                headers: { 'content-type': types[extname(actual)] },
              });
            } catch {
              return new Response(null, { status: 404 });
            }
          },
        },
      },
    ],
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  const url = await mf.ready;
  options.port = Number(url.port);
  options.host = url.hostname;
  options.workers[0].bindings.ALLOWED_ORIGIN = url.origin;
  await mf.setOptions(convertV4MiniflareOptions(options));
  await mf.ready;
  return { origin: url.origin, close: () => mf.dispose() };
}
