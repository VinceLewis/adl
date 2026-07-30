import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const indexEntry = fileURLToPath(new URL("./index.html", import.meta.url));
const serviceWorkerEntry = fileURLToPath(new URL("./src/ui/service-worker.ts", import.meta.url));

/**
 * The service worker is a second rollup entry so it is emitted unhashed at the
 * build root as `dist/sw.js`. A service worker may only control the scope it is
 * served from, and the page registers `/sw.js?v=<modelVersion>`, so its file
 * name must be stable while every other chunk keeps Vite's hashed asset names.
 */
export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: indexEntry,
        sw: serviceWorkerEntry,
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
