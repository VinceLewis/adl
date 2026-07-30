/**
 * Registration helper for the ADL offline application shell.
 *
 * Registration is production-only. The Vite dev server and the Playwright
 * visual suite must be completely unaffected by the worker, and a developer
 * must never be served a stale production shell, so a non-production build
 * proactively unregisters any ADL worker that a previous production visit left
 * behind.
 *
 * The worker URL carries the resolved model version (`/sw.js?v=<version>`),
 * which is what makes a model version change install a new worker and purge the
 * previous version's cache. This module deliberately does not import
 * `service-worker-policy.ts`: that module belongs to the worker bundle, and
 * importing it here would make it a chunk shared with the page bundle.
 * `tests/service-worker.test.ts` asserts the URL built here is the URL the
 * policy module parses.
 */

/** Search parameter carrying the model version; must match the policy module. */
const MODEL_VERSION_SEARCH_PARAM = "v";

/** Worker script path; emitted at the build root by `vite.config.ts`. */
const SERVICE_WORKER_PATH = "/sw.js";

/** Why registration did or did not happen. */
export type AdlServiceWorkerOutcome =
  | "registered"
  | "unsupported"
  | "development"
  | "registration-failed";

export interface AdlServiceWorkerResult {
  readonly registered: boolean;
  readonly outcome: AdlServiceWorkerOutcome;
  /** The script URL that was registered, when registration was attempted. */
  readonly scriptUrl?: string | undefined;
}

/** The slice of `ServiceWorkerContainer` this helper uses. */
export interface ServiceWorkerContainerLike {
  register(scriptUrl: string, options?: { scope?: string }): Promise<unknown>;
  getRegistrations?(): Promise<readonly ServiceWorkerRegistrationLike[]>;
}

export interface ServiceWorkerRegistrationLike {
  readonly active?: { readonly scriptURL?: string } | null;
  readonly installing?: { readonly scriptURL?: string } | null;
  readonly waiting?: { readonly scriptURL?: string } | null;
  unregister(): Promise<boolean>;
}

export interface AdlServiceWorkerEnvironment {
  /** Defaults to `navigator.serviceWorker` when present. */
  readonly container?: ServiceWorkerContainerLike | undefined;
  /** Defaults to `import.meta.env.PROD`. */
  readonly isProduction?: boolean | undefined;
}

/** Worker script URL for a resolved model version. */
export function adlServiceWorkerUrl(modelVersion: string): string {
  return `${SERVICE_WORKER_PATH}?${MODEL_VERSION_SEARCH_PARAM}=${encodeURIComponent(modelVersion)}`;
}

/**
 * Register the offline shell worker for a resolved model version.
 *
 * A no-op when the browser has no service worker support. In a non-production
 * build it unregisters previously installed ADL workers instead of registering.
 */
export async function registerAdlServiceWorker(
  modelVersion: string,
  environment: AdlServiceWorkerEnvironment = {},
): Promise<AdlServiceWorkerResult> {
  const container = environment.container ?? defaultContainer();

  if (container === undefined) {
    return { registered: false, outcome: "unsupported" };
  }

  const isProduction = environment.isProduction ?? isProductionBuild();

  if (!isProduction) {
    await unregisterAdlServiceWorkers(container);

    return { registered: false, outcome: "development" };
  }

  const scriptUrl = adlServiceWorkerUrl(modelVersion);

  try {
    await container.register(scriptUrl, { scope: "/" });

    return { registered: true, outcome: "registered", scriptUrl };
  } catch {
    // A failed registration must never break application start-up: the app
    // simply stays online-only for this session.
    return { registered: false, outcome: "registration-failed", scriptUrl };
  }
}

/** Remove any previously installed ADL worker. Safe to call repeatedly. */
export async function unregisterAdlServiceWorkers(
  container: ServiceWorkerContainerLike,
): Promise<number> {
  if (container.getRegistrations === undefined) {
    return 0;
  }

  let removed = 0;

  try {
    const registrations = await container.getRegistrations();

    for (const registration of registrations) {
      if (!isAdlServiceWorkerRegistration(registration)) {
        continue;
      }

      await registration.unregister();
      removed += 1;
    }
  } catch {
    return removed;
  }

  return removed;
}

function isAdlServiceWorkerRegistration(registration: ServiceWorkerRegistrationLike): boolean {
  const scriptUrls = [
    registration.active?.scriptURL,
    registration.waiting?.scriptURL,
    registration.installing?.scriptURL,
  ];

  return scriptUrls.some((url) => typeof url === "string" && url.includes(SERVICE_WORKER_PATH));
}

function defaultContainer(): ServiceWorkerContainerLike | undefined {
  const navigatorLike = (globalThis as { navigator?: { serviceWorker?: unknown } }).navigator;
  const container = navigatorLike?.serviceWorker;

  return typeof container === "object" && container !== null
    ? (container as ServiceWorkerContainerLike)
    : undefined;
}

function isProductionBuild(): boolean {
  // `import.meta.env` is typed as string-valued in `src/vite-env.d.ts`, but
  // Vite defines `PROD` as a real boolean, so accept either shape.
  const env = import.meta.env as Record<string, unknown> | undefined;
  const prod = env?.["PROD"];

  return prod === true || prod === "true";
}
