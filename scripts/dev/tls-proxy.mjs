#!/usr/bin/env node
/**
 * A TLS-terminating reverse proxy for local development. Developer tooling, not
 * production code: it is deliberately small enough to read in one sitting, it
 * has no dependencies, and nothing in `src/` imports it.
 *
 * It exists to reproduce the deployment topology on a laptop. The authority is
 * a plain `node:http` server on purpose (`src/server/authority-node.ts`): TLS
 * terminates ahead of it at a trusted proxy that forwards
 * `x-forwarded-proto: https`. Running that same shape locally is what lets the
 * authority start through its real entry point, with real HTTPS origins and
 * real `__Host-` cookies, without a single production check being relaxed for
 * development.
 *
 * What "trusted proxy" means here, and why it is a header overwrite rather than
 * an append: the authority reads the FIRST hop of `x-forwarded-for` as the rate
 * limit key and treats `x-forwarded-proto` as the truth about the scheme. A
 * proxy that passed a client-supplied value through would let any caller choose
 * both. This one sets them from what it actually observed and drops whatever
 * the client sent. `Host` is passed through unchanged, because the authority
 * builds its Request URL from it.
 *
 * Environment:
 *   ADL_DEV_PROXY_PORT     listen port                (default 8443)
 *   ADL_DEV_PROXY_HOST     listen interface           (default localhost)
 *   ADL_DEV_PROXY_TARGET   plain-HTTP authority origin (default http://127.0.0.1:8787)
 *   ADL_DEV_TLS_DIR        certificate directory      (default <repo>/.dev-tls)
 *   ADL_DEV_TLS_CERT       leaf certificate           (default <dir>/localhost.pem)
 *   ADL_DEV_TLS_KEY        leaf private key           (default <dir>/localhost-key.pem)
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { fileURLToPath } from "node:url";

const defaultTlsDir = fileURLToPath(new URL("../../.dev-tls", import.meta.url));
const tlsDir = process.env.ADL_DEV_TLS_DIR ?? defaultTlsDir;
const certPath = process.env.ADL_DEV_TLS_CERT ?? `${tlsDir}/localhost.pem`;
const keyPath = process.env.ADL_DEV_TLS_KEY ?? `${tlsDir}/localhost-key.pem`;
const port = Number(process.env.ADL_DEV_PROXY_PORT ?? 8443);
const host = process.env.ADL_DEV_PROXY_HOST ?? "localhost";
const target = new URL(process.env.ADL_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787");

let credentials;
try {
  credentials = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
} catch {
  console.error(
    `No development certificate at ${certPath}. Run: scripts/dev/generate-local-tls.sh`,
  );
  process.exit(1);
}

/** Headers a downstream hop must never be able to dictate. */
const FORWARDED = ["x-forwarded-proto", "x-forwarded-for", "x-forwarded-host", "forwarded"];

const server = createServer(credentials, (incoming, outgoing) => {
  const headers = { ...incoming.headers };
  for (const name of FORWARDED) delete headers[name];
  // Set from what this proxy actually observed, never from the client.
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-for"] = incoming.socket.remoteAddress ?? "127.0.0.1";
  // `Host` is passed through untouched: the authority builds its Request URL
  // from it, so rewriting it would change the origin the edge sees.

  const upstream = request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: incoming.method,
      path: incoming.url,
      headers,
    },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    },
  );

  upstream.on("error", (error) => {
    console.error(`[tls-proxy] ${target.origin} is unreachable: ${error.message}`);
    if (!outgoing.headersSent)
      outgoing.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
    outgoing.end('{"error":"bad_gateway"}');
  });

  incoming.pipe(upstream);
});

server.on("tlsClientError", (error) => {
  // A browser that has not been told to trust the development CA fails here,
  // which is otherwise a silent connection reset with no explanation anywhere.
  console.error(`[tls-proxy] TLS handshake failed: ${error.message}`);
});

server.listen(port, host, () => {
  console.log(`[tls-proxy] https://${host}:${port} -> ${target.origin} (x-forwarded-proto: https)`);
});
