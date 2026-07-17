import { defineAdlComponents } from "./components/register.js";
import type { AdlAppElement } from "./components/adl-app.js";
import {
  createBandReferenceModel,
  createGiggleBandExampleModel,
  createPersistentBandReferenceRuntime,
  createPersistentGiggleBandExampleRuntime,
  seedBandReferenceRuntimeIfEmpty,
} from "./demo-fixture.js";

defineAdlComponents();

void mountDemo();

async function mountDemo(): Promise<void> {
  const app = document.createElement("adl-app") as AdlAppElement;
  const demo = new URLSearchParams(globalThis.location?.search ?? "").get("demo");

  if (demo === "giggle-band") {
    const model = createGiggleBandExampleModel();
    const runtime = createPersistentGiggleBandExampleRuntime(model);
    const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);

    document.title = model.app.name;
    app.model = model;
    app.runtime = runtime;
    app.context = seeded.musicianContext;
  } else if (demo === "band") {
    const model = createBandReferenceModel();
    const runtime = createPersistentBandReferenceRuntime(model);
    const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);

    document.title = model.app.name;
    app.model = model;
    app.runtime = runtime;
    app.context = seeded.musicianContext;
  }

  document.body.append(app);
}
