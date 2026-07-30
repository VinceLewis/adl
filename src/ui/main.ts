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
import { readBrowserAuthorityConfiguration } from "./authority-sync.js";
import { IndexedDbSessionIdentityStorage } from "./offline-session.js";
import { connectAuthority } from "./session-startup.js";
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
    await connectAuthority(
      app,
      runtime,
      withIdentityStorage(authority, GIGGLE_BAND_EXAMPLE_DATABASE_NAME),
    );
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
    await connectAuthority(
      app,
      runtime,
      withIdentityStorage(authority, BAND_REFERENCE_DATABASE_NAME),
    );
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
 * Gives the connection somewhere to remember who the authority said this
 * device is, so a reload with no connection keeps that identity instead of
 * falling back to the local demo one. Only reached when an authority is
 * configured: a purely local demo has no identity to cache.
 */
function withIdentityStorage(
  authority: BrowserAuthorityConfiguration | null,
  databaseName: string,
): BrowserAuthorityConfiguration | null {
  return authority === null
    ? null
    : { ...authority, identityStorage: new IndexedDbSessionIdentityStorage({ databaseName }) };
}
