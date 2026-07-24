import path from "node:path";
import { defineConfig } from "vite";

const TEST_MARKER_PATH = "/__simulacrum_test_marker";
const IS_TEST_SERVER = Boolean(process.env.SIMULACRUM_TEST_MARKER);
const installTestMarker = (server) => {
  const marker = process.env.SIMULACRUM_TEST_MARKER;
  if (!marker) return;
  server.middlewares.use(TEST_MARKER_PATH, (_request, response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify({ marker }));
  });
};

export default defineConfig({
  root: process.env.SIMULACRUM_TEST_ROOT || undefined,
  resolve: {
    alias: {
      "@yaniv-golan/simulacrum-core": path.resolve(
        import.meta.dirname,
        "src/core/index.js",
      ),
    },
  },
  server: {
    // A verification run owns an immutable source snapshot. HMR can only
    // invalidate a browser proof mid-transaction, so the isolated test server
    // deliberately serves that snapshot without a reload channel.
    hmr: IS_TEST_SERVER ? false : undefined,
    // Browser verification writes traces, clean-install fixtures, and package
    // bundles beneath the repository while the dev server is running. Those
    // outputs are never application inputs and must not trigger delayed HMR
    // reloads in an unrelated suite.
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/packages/core/dist/**",
        "**/packages/core/.api-types/**",
        "**/packages/core/temp/**",
      ],
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes("/node_modules/typescript/"))
            return "typescript-compiler";
          if (id.includes("/node_modules/wabt/")) return "wabt-runtime";
          if (
            id.includes("/src/application/local-field-feature.js") ||
            id.includes("/src/application/test-site-fixture-feature.js") ||
            id.includes("/src/presentation/test-site-")
          )
            return "test-site-presentation";
          return undefined;
        },
      },
    },
  },
  plugins: [
    {
      name: "simulacrum-test-marker",
      configureServer: installTestMarker,
      configurePreviewServer: installTestMarker,
    },
  ],
});
