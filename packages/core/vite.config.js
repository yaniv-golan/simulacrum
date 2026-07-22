import path from "node:path";
import { defineConfig } from "vite";

const externalPackages = new Set(["cannon-es", "three", "typescript", "wabt"]);

export default defineConfig({
  build: {
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: path.resolve(import.meta.dirname, "../../src/core/index.js"),
      formats: ["es"],
      fileName: "index",
    },
    outDir: path.resolve(import.meta.dirname, "dist"),
    rollupOptions: {
      external(id) {
        return [...externalPackages].some(
          (dependency) => id === dependency || id.startsWith(`${dependency}/`),
        );
      },
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
