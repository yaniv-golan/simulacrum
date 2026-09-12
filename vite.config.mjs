import { defineConfig } from 'vite';
import { appFingerprint } from './scripts/app-fingerprint.mjs';
export default defineConfig({
 cacheDir: process.env.SIMULACRUM_VITE_CACHE_DIR,
 server:{host:'127.0.0.1',hmr:false},
 preview:{host:'127.0.0.1'},
 plugins:[{name:'served-build-identity',transformIndexHtml(){return [{tag:'meta',attrs:{name:'build-id',content:appFingerprint()},injectTo:'head-prepend'}];}}],
});
