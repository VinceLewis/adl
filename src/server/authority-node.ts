import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AuthorityHttpDependencies } from "./authority-http.js";
import { createAuthorityHttpHandler } from "./authority-http.js";

/**
 * Minimal Node deployment adapter. TLS must terminate before this process only
 * at a trusted HTTPS proxy which forwards `x-forwarded-proto: https`; otherwise
 * run it behind a direct TLS listener that constructs HTTPS Request URLs.
 */
export function createAuthorityNodeServer(dependencies: AuthorityHttpDependencies): Server {
  const handle = createAuthorityHttpHandler(dependencies);
  return createServer(async (incoming, outgoing) => {
    const protocol = incoming.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const host = incoming.headers.host ?? "localhost";
    const request = new Request(`${protocol}://${host}${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers: headers(incoming),
      ...(incoming.method === "GET" || incoming.method === "HEAD" ? {} : { body: incoming }),
      // Node streams require this when used as a web Request body.
      duplex: "half",
    } as unknown as RequestInit);
    try {
      write(outgoing, await handle(request));
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      outgoing.end('{"error":"internal_error"}');
    }
  });
}

function headers(request: IncomingMessage): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    result.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}
async function write(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string | string[]> = Object.fromEntries(result.headers.entries());
  const setCookies = (
    result.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (setCookies !== undefined) headers["set-cookie"] = setCookies;
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}
