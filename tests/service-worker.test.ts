import { describe, expect, it } from "vitest";
import {
  SHELL_CACHE_PREFIX,
  classifyRequest,
  readModelVersionFromWorkerUrl,
  selectStaleCacheNames,
  shellCacheName,
  shouldCacheResponse,
  shouldHandleRequest,
} from "../src/ui/service-worker-policy.js";
import type { CacheableRequest, CacheableResponse } from "../src/ui/service-worker-policy.js";
import {
  adlServiceWorkerUrl,
  registerAdlServiceWorker,
  unregisterAdlServiceWorkers,
} from "../src/ui/register-service-worker.js";
import type {
  ServiceWorkerContainerLike,
  ServiceWorkerRegistrationLike,
} from "../src/ui/register-service-worker.js";

/**
 * The service worker cache is a security boundary: it is readable by any script
 * in the origin and it outlives sign-out. These tests pin every refusal, so a
 * session token, an authority response body carrying records, or any protected
 * data can never reach it. Records stay in IndexedDB behind the runtime
 * persistence boundary.
 */

const ORIGIN = "https://app.example.test";

function request(overrides: Partial<CacheableRequest> = {}): CacheableRequest {
  return {
    url: `${ORIGIN}/assets/index-a1b2c3d4.js`,
    method: "GET",
    mode: "cors",
    destination: "script",
    ...overrides,
  };
}

function response(
  overrides: Partial<Omit<CacheableResponse, "headers">> & {
    headers?: Record<string, string>;
  } = {},
): CacheableResponse {
  const { headers = {}, ...rest } = overrides;
  const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    ok: true,
    type: "basic",
    headers: {
      get: (name: string) => normalized.get(name.toLowerCase()) ?? null,
    },
    ...rest,
  };
}

describe("service worker request classification", () => {
  it("treats a navigation as a shell request", () => {
    const navigation = request({ url: `${ORIGIN}/`, mode: "navigate", destination: "document" });

    expect(classifyRequest(navigation, ORIGIN)).toBe("navigate");
    expect(shouldHandleRequest(navigation, ORIGIN)).toBe(true);
  });

  it("treats hashed static assets and the manifest as cacheable assets", () => {
    expect(classifyRequest(request(), ORIGIN)).toBe("asset");
    expect(classifyRequest(request({ destination: "style" }), ORIGIN)).toBe("asset");
    expect(classifyRequest(request({ destination: "font" }), ORIGIN)).toBe("asset");
    expect(classifyRequest(request({ destination: "image" }), ORIGIN)).toBe("asset");
    expect(
      classifyRequest(
        request({ url: `${ORIGIN}/manifest.webmanifest`, destination: "manifest" }),
        ORIGIN,
      ),
    ).toBe("asset");
  });

  it("passes anything else straight through to the network", () => {
    expect(classifyRequest(request({ destination: "" }), ORIGIN)).toBe("passthrough");
    expect(
      classifyRequest(request({ url: `${ORIGIN}/v1/sync/bootstrap`, destination: "" }), ORIGIN),
    ).toBe("passthrough");
    expect(classifyRequest(request({ method: "POST" }), ORIGIN)).toBe("passthrough");
  });
});

describe("service worker cache boundary", () => {
  it("caches a same-origin GET of a hashed JavaScript asset", () => {
    expect(
      shouldCacheResponse(
        request(),
        response({ headers: { "content-type": "text/javascript" } }),
        ORIGIN,
      ),
    ).toBe(true);
  });

  it("caches a same-origin GET of the web app manifest", () => {
    // The manifest is the single JSON-typed shell asset that is allowed, and
    // only because it is identified structurally (destination `manifest` or a
    // `.webmanifest` path). It carries no records and no credentials.
    expect(
      shouldCacheResponse(
        request({ url: `${ORIGIN}/manifest.webmanifest`, destination: "manifest" }),
        response({ headers: { "content-type": "application/manifest+json" } }),
        ORIGIN,
      ),
    ).toBe(true);
  });

  it("does not let the manifest exception cache a JSON body from anywhere else", () => {
    expect(
      shouldCacheResponse(
        request({ url: `${ORIGIN}/v1/records/list.webmanifest`, destination: "manifest" }),
        response({ headers: { "content-type": "application/manifest+json" } }),
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      shouldCacheResponse(
        request({ url: `${ORIGIN}/records.json`, destination: "script" }),
        response({ headers: { "content-type": "application/json" } }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("refuses a non-GET request", () => {
    expect(shouldCacheResponse(request({ method: "POST" }), response(), ORIGIN)).toBe(false);
    expect(shouldCacheResponse(request({ method: "DELETE" }), response(), ORIGIN)).toBe(false);
  });

  it("refuses a cross-origin request", () => {
    expect(
      shouldCacheResponse(
        request({ url: "https://cdn.other.test/assets/index-a1b2c3d4.js" }),
        response(),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("refuses every authority endpoint under /v1/", () => {
    expect(
      shouldCacheResponse(request({ url: `${ORIGIN}/v1/sync/bootstrap` }), response(), ORIGIN),
    ).toBe(false);
    expect(
      shouldCacheResponse(request({ url: `${ORIGIN}/v1/session/current` }), response(), ORIGIN),
    ).toBe(false);
  });

  it("refuses a JSON response body", () => {
    expect(
      shouldCacheResponse(
        request(),
        response({ headers: { "content-type": "application/json; charset=utf-8" } }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("refuses a response carrying a cookie", () => {
    expect(
      shouldCacheResponse(
        request(),
        response({ headers: { "set-cookie": "adl_session=opaque; HttpOnly" } }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("refuses a no-store or private response", () => {
    expect(
      shouldCacheResponse(
        request(),
        response({ headers: { "cache-control": "no-store" } }),
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      shouldCacheResponse(
        request(),
        response({ headers: { "cache-control": "private, max-age=0" } }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("refuses a non-ok, opaque or error response", () => {
    expect(shouldCacheResponse(request(), response({ ok: false }), ORIGIN)).toBe(false);
    expect(shouldCacheResponse(request(), response({ type: "opaque" }), ORIGIN)).toBe(false);
    expect(shouldCacheResponse(request(), response({ type: "error" }), ORIGIN)).toBe(false);
  });
});

describe("model-version cache naming and purge", () => {
  it("derives the cache name from the resolved model version", () => {
    expect(shellCacheName("2.0.0")).toBe(`${SHELL_CACHE_PREFIX}2.0.0`);
    expect(shellCacheName("1.0.0")).not.toBe(shellCacheName("2.0.0"));
  });

  it("deletes only shell caches from other model versions", () => {
    const existing = ["adl-shell-1.0.0", "adl-shell-2.0.0", "unrelated-cache"];

    expect(selectStaleCacheNames(existing, "2.0.0")).toEqual(["adl-shell-1.0.0"]);
  });

  it("keeps everything when the current version is the only shell cache", () => {
    expect(selectStaleCacheNames(["adl-shell-2.0.0", "unrelated-cache"], "2.0.0")).toEqual([]);
  });

  it("round-trips the model version through the worker script URL", () => {
    const url = adlServiceWorkerUrl("2.0.0");

    expect(url).toBe("/sw.js?v=2.0.0");
    expect(readModelVersionFromWorkerUrl(new URL(url, ORIGIN).href)).toBe("2.0.0");
  });

  it("falls back to an unversioned cache when the worker URL carries no version", () => {
    expect(readModelVersionFromWorkerUrl(`${ORIGIN}/sw.js`)).toBe("unversioned");
    expect(shellCacheName(readModelVersionFromWorkerUrl(`${ORIGIN}/sw.js`))).toBe(
      "adl-shell-unversioned",
    );
  });
});

interface FakeContainer extends ServiceWorkerContainerLike {
  readonly registered: string[];
  readonly unregistered: string[];
}

function fakeContainer(existingScriptUrls: readonly string[] = []): FakeContainer {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const registrations: ServiceWorkerRegistrationLike[] = existingScriptUrls.map((scriptURL) => ({
    active: { scriptURL },
    unregister: async () => {
      unregistered.push(scriptURL);

      return true;
    },
  }));

  return {
    registered,
    unregistered,
    register: async (scriptUrl: string) => {
      registered.push(scriptUrl);

      return {};
    },
    getRegistrations: async () => registrations,
  };
}

describe("registerAdlServiceWorker", () => {
  it("is a no-op when the browser has no service worker support", async () => {
    const result = await registerAdlServiceWorker("2.0.0", {
      container: undefined,
      isProduction: true,
    });

    expect(result).toEqual({ registered: false, outcome: "unsupported" });
  });

  it("registers the versioned worker URL in a production build", async () => {
    const container = fakeContainer();

    const result = await registerAdlServiceWorker("2.0.0", { container, isProduction: true });

    expect(result.registered).toBe(true);
    expect(result.outcome).toBe("registered");
    expect(container.registered).toEqual(["/sw.js?v=2.0.0"]);
  });

  it("unregisters a stale worker instead of registering outside production", async () => {
    const container = fakeContainer([`${ORIGIN}/sw.js?v=1.0.0`, `${ORIGIN}/other-worker.js`]);

    const result = await registerAdlServiceWorker("2.0.0", { container, isProduction: false });

    expect(result).toEqual({ registered: false, outcome: "development" });
    expect(container.registered).toEqual([]);
    expect(container.unregistered).toEqual([`${ORIGIN}/sw.js?v=1.0.0`]);
  });

  it("reports a failed registration without throwing", async () => {
    const container: ServiceWorkerContainerLike = {
      register: async () => {
        throw new Error("registration blocked");
      },
    };

    const result = await registerAdlServiceWorker("2.0.0", { container, isProduction: true });

    expect(result.registered).toBe(false);
    expect(result.outcome).toBe("registration-failed");
  });

  it("leaves workers owned by other code alone when unregistering", async () => {
    const container = fakeContainer([`${ORIGIN}/other-worker.js`]);

    expect(await unregisterAdlServiceWorkers(container)).toBe(0);
    expect(container.unregistered).toEqual([]);
  });
});
