/**
 * ADL offline application shell worker.
 *
 * This file is intentionally thin. Every decision worth asserting lives in
 * `service-worker-policy.ts`, which is pure and unit-tested; here we only bind
 * those decisions to the worker lifecycle and to `fetch`/`caches`.
 *
 * Update and model-version invalidation path
 * ------------------------------------------
 * 1. The page registers `/sw.js?v=<modelVersion>`, where `modelVersion` is the
 *    resolved model's version — the same notion of version the runtime startup
 *    compatibility guard uses for persisted local data. There is deliberately
 *    no second versioning scheme.
 * 2. A model version change therefore changes the worker script URL, so the
 *    browser treats it as a new worker and installs it.
 * 3. `install` calls `skipWaiting()`, so the new worker activates immediately
 *    rather than waiting for every tab to close.
 * 4. `activate` deletes every `adl-shell-*` cache that is not the current
 *    version's cache and then calls `clients.claim()`. A stale worker can
 *    therefore never keep serving assets that are incompatible with the
 *    persisted local state guarded by the startup compatibility check.
 *
 * Caching strategy: runtime cache-on-fetch, no precache manifest (Vite asset
 * names are content-hashed). Navigations are network-first with the cached
 * shell as the offline fallback; same-origin static assets are
 * stale-while-revalidate; everything else passes through untouched and is never
 * cached. Authority responses (`/v1/...`), JSON bodies, cookie-bearing
 * responses and cross-origin responses are refused by the policy module.
 */

import {
  classifyRequest,
  readModelVersionFromWorkerUrl,
  selectStaleCacheNames,
  shellCacheName,
  shouldCacheResponse,
} from "./service-worker-policy.js";

/*
 * The project's `tsconfig.json` does not include the `WebWorker` lib (it is a
 * DOM project), so the worker global surface this file actually uses is
 * declared locally and narrowly rather than widening the whole project's libs.
 */

interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface ServiceWorkerClientsLike {
  claim(): Promise<void>;
}

interface ServiceWorkerGlobalScopeLike {
  readonly location: { readonly href: string; readonly origin: string };
  readonly clients: ServiceWorkerClientsLike;
  readonly caches: CacheStorage;
  skipWaiting(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEventLike) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
}

declare const self: ServiceWorkerGlobalScopeLike;

const MODEL_VERSION = readModelVersionFromWorkerUrl(self.location.href);
const CACHE_NAME = shellCacheName(MODEL_VERSION);
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

self.addEventListener("fetch", (event) => {
  const handling = classifyRequest(event.request, self.location.origin);

  if (handling === "navigate") {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  if (handling === "asset") {
    event.respondWith(handleAsset(event.request));
  }

  // `passthrough`: no `respondWith`, so the browser performs its default fetch
  // and nothing is cached.
});

async function activate(): Promise<void> {
  const existing = await self.caches.keys();

  await Promise.all(
    selectStaleCacheNames(existing, MODEL_VERSION).map((name) => self.caches.delete(name)),
  );

  await self.clients.claim();
}

/** Network first, cached shell second: a reload with no network still boots. */
async function handleNavigation(request: Request): Promise<Response> {
  try {
    const response = await self.fetch(request);

    await storeIfPermitted(request, response);

    return response;
  } catch (error) {
    const cached = await matchShell(request);

    if (cached !== undefined) {
      return cached;
    }

    throw error;
  }
}

/** Stale-while-revalidate for hashed static assets and the manifest. */
async function handleAsset(request: Request): Promise<Response> {
  const cache = await self.caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const revalidated = self
    .fetch(request)
    .then(async (response) => {
      await storeIfPermitted(request, response);

      return response;
    })
    .catch(() => undefined);

  if (cached !== undefined) {
    return cached;
  }

  const response = await revalidated;

  if (response === undefined) {
    throw new Error(`Offline and no cached response for ${request.url}`);
  }

  return response;
}

async function matchShell(request: Request): Promise<Response | undefined> {
  const cache = await self.caches.open(CACHE_NAME);

  return (await cache.match(request)) ?? (await cache.match(SHELL_URL));
}

/**
 * Single write point into the cache. Every store goes through the policy
 * predicate, so there is exactly one place where the security boundary can be
 * broken and it is the one covered by tests.
 */
async function storeIfPermitted(request: Request, response: Response): Promise<void> {
  if (!shouldCacheResponse(request, response, self.location.origin)) {
    return;
  }

  const cache = await self.caches.open(CACHE_NAME);

  await cache.put(request, response.clone());
}
