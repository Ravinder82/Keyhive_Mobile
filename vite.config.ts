import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { cpSync, mkdirSync } from "node:fs";

const here = dirname(new URL(import.meta.url).pathname);

// Plain MV3 build: two entries (popup page + module service worker).
// Entry filenames are unhashed so manifest.json references stay stable.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "copy-static",
      closeBundle() {
        mkdirSync("dist/icons", { recursive: true });
        cpSync("public/manifest.json", "dist/manifest.json");
        cpSync("public/icons", "dist/icons", { recursive: true });
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116", // matches manifest minimum_chrome_version
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(here, "popup.html"),
        dashboard: resolve(here, "dashboard.html"),
        background: resolve(here, "src/background/main.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks: undefined,
      },
    },
  },
});
