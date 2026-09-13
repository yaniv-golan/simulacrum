import { defineConfig } from 'vite';
import { sourceIdentity } from './scripts/source-identity.mjs';
import { appFingerprint } from './scripts/app-fingerprint.mjs';
export default defineConfig({
  cacheDir: process.env.SIMULACRUM_VITE_CACHE_DIR,
  server: { host: '127.0.0.1', hmr: false },
  preview: { host: '127.0.0.1' },
  plugins: [
    {
      name: 'served-build-identity',
      transformIndexHtml() {
        const source = sourceIdentity();
        return [
          ['build-id', appFingerprint()],
          ['source-head', source.head],
          ['source-digest', source.workingTreeDigest],
        ].map(([name, content]) => ({
          tag: 'meta',
          attrs: { name, content },
          injectTo: 'head-prepend',
        }));
      },
    },
  ],
});
