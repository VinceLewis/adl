/**
 * Service worker caching policy.
 *
 * This module is deliberately pure: it takes plain request/response shapes and
 * returns decisions. The worker itself (`service-worker.ts`) only wires these
 * decisions to `fetch`/`caches`, so every rule that matters is unit-testable in
 * the hermetic suite without a browser.
 *
 * The cache boundary here is a security boundary, not an optimisation. A
 * service worker cache is readable by any script running in the origin and
 * survives sign-out, so an authority response body carrying records, or any
 * response that carries a session cookie, must never enter it. Records stay in
 * IndexedDB under the existing runtime persistence boundary.
 */

/** Prefix for every cache this application owns. */
export const SHELL_CACHE_PREFIX = "adl-shell-";

/** Search parameter carrying the resolved model version on the worker URL. */
export const MODEL_VERSION_SEARCH_PARAM = "v";

/** Cache name used when a worker URL carries no model version at all. */
export const UNVERSIONED_MODEL_VERSION = "unversioned";

/** Every authority endpoint lives under this path prefix. */
export const AUTHORITY_PATH_PREFIX = "/v1/";

/**
 * Minimal structural view of a `Request`. Real `Request` objects satisfy it,
 * and tests can construct one literally (a `Request` with
 * `mode: "navigate"` cannot be constructed by script at all).
 */
export interface CacheableRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly destination: string;
}

/** Minimal structural view of the response fields the policy inspects. */
export interface CacheableResponse {
  readonly ok: boolean;
  readonly type: string;
  readonly headers: { get(name: string): string | null };
}

/**
 * How the worker should treat a request.
 *
 * - `navigate`: network first, cached shell as the offline fallback.
 * - `asset`: stale-while-revalidate for hashed static assets and the manifest.
 * - `passthrough`: straight to the network, never cached.
 */
export type RequestHandling = "navigate" | "asset" | "passthrough";

const STATIC_DESTINATIONS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "font",
  "image",
  "manifest",
]);

const UNCACHEABLE_RESPONSE_TYPES: ReadonlySet<string> = new Set([
  "opaque",
  "opaqueredirect",
  "error",
]);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when `url` is served by the same origin as the worker. */
export function isSameOriginUrl(url: string, workerOrigin: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.origin === workerOrigin;
}

/** True when `url` addresses an authority endpoint (`/v1/...`). */
export function isAuthorityUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.pathname.startsWith(AUTHORITY_PATH_PREFIX);
}

function isManifestUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.pathname.endsWith(".webmanifest");
}

/**
 * The web app manifest is the one shell asset that is legitimately served as
 * JSON (`application/manifest+json`). It is a build artefact with no records and
 * no credentials in it, and it is identified structurally — a same-origin,
 * non-authority GET whose destination is `manifest` or whose path ends in
 * `.webmanifest`. Nothing an authority serves can match, because `/v1/` is
 * refused before this is consulted.
 */
function isManifestRequest(request: CacheableRequest): boolean {
  return request.destination === "manifest" || isManifestUrl(request.url);
}

function headerContains(response: CacheableResponse, header: string, needle: string): boolean {
  const value = response.headers.get(header);
  return value !== null && value.toLowerCase().includes(needle);
}

function isJsonContentType(response: CacheableResponse): boolean {
  const contentType = response.headers.get("content-type");

  if (contentType === null) {
    return false;
  }

  const normalized = contentType.toLowerCase();

  return (
    normalized.includes("application/json") ||
    normalized.includes("text/json") ||
    normalized.includes("+json")
  );
}

/**
 * Decide how a request is handled. Anything that is not a same-origin,
 * non-authority GET for the shell or a static asset passes straight through.
 */
export function classifyRequest(request: CacheableRequest, workerOrigin: string): RequestHandling {
  if (request.method.toUpperCase() !== "GET") {
    return "passthrough";
  }

  if (!isSameOriginUrl(request.url, workerOrigin)) {
    return "passthrough";
  }

  if (isAuthorityUrl(request.url)) {
    return "passthrough";
  }

  if (request.mode === "navigate") {
    return "navigate";
  }

  if (STATIC_DESTINATIONS.has(request.destination) || isManifestRequest(request)) {
    return "asset";
  }

  return "passthrough";
}

/** True when the worker should intercept this request at all. */
export function shouldHandleRequest(request: CacheableRequest, workerOrigin: string): boolean {
  return classifyRequest(request, workerOrigin) !== "passthrough";
}

/**
 * The hard cache boundary. A response may only be stored when every one of
 * these holds: the request is one we handle (same-origin GET, not `/v1/`), the
 * response is a readable success, it carries no cookie, it is not marked
 * private or no-store, and it is not a JSON body (an authority payload
 * carrying records must never be written to a cache).
 */
export function shouldCacheResponse(
  request: CacheableRequest,
  response: CacheableResponse,
  workerOrigin: string,
): boolean {
  if (!shouldHandleRequest(request, workerOrigin)) {
    return false;
  }

  if (!response.ok || UNCACHEABLE_RESPONSE_TYPES.has(response.type)) {
    return false;
  }

  if (response.headers.get("set-cookie") !== null) {
    return false;
  }

  if (
    headerContains(response, "cache-control", "no-store") ||
    headerContains(response, "cache-control", "private")
  ) {
    return false;
  }

  if (isJsonContentType(response) && !isManifestRequest(request)) {
    return false;
  }

  return true;
}

/** Cache name for a resolved model version. */
export function shellCacheName(modelVersion: string): string {
  return `${SHELL_CACHE_PREFIX}${modelVersion}`;
}

/** True when `cacheName` is one of this application's shell caches. */
export function isShellCacheName(cacheName: string): boolean {
  return cacheName.startsWith(SHELL_CACHE_PREFIX);
}

/**
 * Caches to delete on activation: every shell cache from another model version,
 * and nothing else. Caches owned by other code in the origin are left alone.
 */
export function selectStaleCacheNames(
  existingCacheNames: readonly string[],
  modelVersion: string,
): string[] {
  const current = shellCacheName(modelVersion);

  return existingCacheNames.filter((name) => isShellCacheName(name) && name !== current);
}

/**
 * The worker script URL for a model version. A model version change changes
 * this URL, which is what makes the browser install a new worker.
 *
 * `register-service-worker.ts` deliberately does not import this module (that
 * would make the policy a shared chunk between the page bundle and the worker
 * bundle); `tests/service-worker.test.ts` asserts the two stay in agreement.
 */
export function serviceWorkerScriptUrl(modelVersion: string): string {
  return `/sw.js?${MODEL_VERSION_SEARCH_PARAM}=${encodeURIComponent(modelVersion)}`;
}

/** Read the model version back out of the worker's own URL. */
export function readModelVersionFromWorkerUrl(workerUrl: string): string {
  const parsed = parseUrl(workerUrl);
  const version = parsed?.searchParams.get(MODEL_VERSION_SEARCH_PARAM) ?? null;

  return version === null || version === "" ? UNVERSIONED_MODEL_VERSION : version;
}
