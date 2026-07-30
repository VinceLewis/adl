import { defineAdlComponents } from "./components/register.js";
import type { AdlAppElement } from "./components/adl-app.js";
import {
  BAND_REFERENCE_DATABASE_NAME,
  GIGGLE_BAND_EXAMPLE_DATABASE_NAME,
  createBandReferenceModel,
  createGiggleBandExampleModel,
  createPersistentBandReferenceRuntime,
  createPersistentGiggleBandExampleRuntime,
  seedBandReferenceRuntimeIfEmpty,
} from "./demo-fixture.js";
import {
  connectBrowserAuthority,
  describeAuthorityFailure,
  readBrowserAuthorityConfiguration,
  watchAuthorityReconnect,
} from "./authority-sync.js";
import type { BrowserAuthorityConfiguration } from "./authority-sync.js";
import { registerAdlServiceWorker } from "./register-service-worker.js";
import {
  ApplicationRuntime,
  IndexedDbObjectStorageBackend,
  IndexedDbSyncStateStorage,
} from "../index.js";
import type { ResolvedApplicationModel, RuntimeContext } from "../index.js";

defineAdlComponents();

void mountDemo();

async function mountDemo(): Promise<void> {
  const app = document.createElement("adl-app") as AdlAppElement;
  const search = globalThis.location?.search ?? "";
  const demo = new URLSearchParams(search).get("demo");
  // Opt-in: with no configured authority the browser stays a purely local demo.
  const authority = readBrowserAuthorityConfiguration(import.meta.env ?? {});

  if (demo === "giggle-band") {
    const model = createGiggleBandExampleModel();
    const runtime = createDemoRuntime(model, GIGGLE_BAND_EXAMPLE_DATABASE_NAME, authority, () =>
      createPersistentGiggleBandExampleRuntime(model),
    );
    const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);

    document.title = model.app.name;
    app.model = model;
    app.runtime = runtime;
    app.context = seeded.musicianContext;
    await connectAuthority(app, runtime, authority);
    void registerAdlServiceWorker(model.modelVersion);
  } else if (demo === "band") {
    const model = createBandReferenceModel();
    const runtime = createDemoRuntime(model, BAND_REFERENCE_DATABASE_NAME, authority, () =>
      createPersistentBandReferenceRuntime(model),
    );
    const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);

    document.title = model.app.name;
    app.model = model;
    app.runtime = runtime;
    app.context = seeded.musicianContext;
    await connectAuthority(app, runtime, authority);
    void registerAdlServiceWorker(model.modelVersion);
  }

  document.body.append(app);
}

/**
 * The local path is the existing fixture factory, unchanged. Sync state is only
 * persisted when an authority is configured, so no extra IndexedDB database is
 * opened by the local demo.
 */
function createDemoRuntime(
  model: ResolvedApplicationModel,
  databaseName: string,
  authority: BrowserAuthorityConfiguration | null,
  createLocalRuntime: () => ApplicationRuntime,
): ApplicationRuntime {
  if (authority === null) {
    return createLocalRuntime();
  }

  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({ databaseName }),
    syncStateStorage: new IndexedDbSyncStateStorage({ databaseName }),
  });
}

/**
 * Attaches the authority bridge to the shell. The bridge exists even with no
 * session, so the user is shown a sign-in surface rather than a blank page, and
 * the seeded demo identity is replaced by the server-derived one as soon as
 * there is a session. Every failure is a single warning and a fall back to
 * local behaviour: an unreachable authority must never leave a blank page.
 */
async function connectAuthority(
  app: AdlAppElement,
  runtime: ApplicationRuntime,
  authority: BrowserAuthorityConfiguration | null,
): Promise<void> {
  if (authority === null) {
    return;
  }

  try {
    const connection = await connectBrowserAuthority(runtime, authority, {
      getContext: () => app.context,
      onChange: () => {
        applySessionIdentity(app, connection.session.userId);
        app.refreshAuthorityState();
      },
    });
    app.authority = connection;
    applySessionIdentity(app, connection.session.userId);

    try {
      await connection.synchronize(app.context);
    } finally {
      // Registered even when the first sync fails: reconnect is how a browser
      // that started offline recovers its queued work.
      watchAuthorityReconnect(
        connection,
        () => app.context,
        () => app.refreshFromRuntime(),
      );
    }
  } catch (error) {
    console.warn(
      `ADL authority sync is unavailable; continuing with local data: ${describeAuthorityFailure(error)}`,
    );
  }
}

/**
 * Replaces the local demo identity with the server-derived one. The browser
 * never chooses a user id: it only adopts the one the session reported.
 */
function applySessionIdentity(app: AdlAppElement, userId: string | undefined): void {
  if (userId !== undefined && userId !== app.context.userId) {
    app.context = { ...app.context, userId };
  }
}
