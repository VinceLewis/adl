import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const indexEntry = fileURLToPath(new URL("./index.html", import.meta.url));
const serviceWorkerEntry = fileURLToPath(new URL("./src/ui/service-worker.ts", import.meta.url));

/**
 * Development HTTPS is **opt-in**, and deliberately so.
 *
 * The authority refuses a non-HTTPS allowed origin in every environment, and
 * its session cookie is `__Host-` Secure, so a browser talking to a local
 * authority has to be served over HTTPS (see
 * `docs/development/local-https-development.md`). But every Playwright web
 * server in `playwright.config.ts` — desktop/mobile on 5173, the `vite preview`
 * offline-shell build on 4173, passkey on 5273 and administration on 5373 —
 * speaks plain HTTP through `npm run dev` and `vite preview`. Turning TLS on
 * unconditionally here would break all four at once, and would also make the
 * default `npm run dev` fail outright on a checkout that has never generated a
 * certificate, since the key material is gitignored.
 *
 * So the switch is one environment variable that nothing else sets, and with it
 * unset this file resolves to exactly the configuration it had before local TLS
 * existed. `npm run dev:authority` is the command that sets it.
 */
const devHttpsEnabled = process.env.ADL_DEV_HTTPS === "true";

function developmentHttps(): { https: { key: Buffer; cert: Buffer } } | Record<string, never> {
  if (!devHttpsEnabled) return {};
  const directory =
    process.env.ADL_DEV_TLS_DIR ?? fileURLToPath(new URL("./.dev-tls", import.meta.url));
  const key = process.env.ADL_DEV_TLS_KEY ?? `${directory}/localhost-key.pem`;
  const cert = process.env.ADL_DEV_TLS_CERT ?? `${directory}/localhost.pem`;
  try {
    return { https: { key: readFileSync(key), cert: readFileSync(cert) } };
  } catch {
    throw new Error(
      `ADL_DEV_HTTPS=true but no development certificate was found at ${cert}. Run scripts/dev/generate-local-tls.sh first.`,
    );
  }
}

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
    // Bind on all interfaces (not just loopback) so the dev server is
    // reachable from other devices on the LAN, e.g. testing on a phone.
    host: "0.0.0.0",
    port: 5173,
    ...developmentHttps(),
  },
  // `vite preview` serves the built app; it gets the same opt-in so a
  // production build can be exercised against a local authority too.
  preview: {
    ...developmentHttps(),
  },
});
