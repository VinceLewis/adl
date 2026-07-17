import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostingSource = resolve(root, ".openai", "hosting.json");
const hostingTarget = resolve(root, "dist", ".openai", "hosting.json");
const serverTarget = resolve(root, "dist", "server", "index.js");

const serverEntrypoint = `const INDEX_PATH = "/index.html";

function acceptsHtml(request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

export default {
  async fetch(request, env) {
    if (env?.ASSETS === undefined) {
      return new Response("Sites static asset binding is unavailable.", { status: 500 });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || request.method !== "GET" || !acceptsHtml(request)) {
      return assetResponse;
    }

    const url = new URL(request.url);
    const indexUrl = new URL(INDEX_PATH, url.origin);
    return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
  },
};
`;

await mkdir(dirname(hostingTarget), { recursive: true });
await mkdir(dirname(serverTarget), { recursive: true });
await copyFile(hostingSource, hostingTarget);
await writeFile(serverTarget, serverEntrypoint, "utf8");
