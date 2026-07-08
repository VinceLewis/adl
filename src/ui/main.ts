import { defineAdlComponents } from "./components/register.js";
import type { AdlAppElement } from "./components/adl-app.js";
import {
  createBandReferenceModel,
  createPersistentBandReferenceRuntime,
  seedBandReferenceRuntimeIfEmpty,
} from "./demo-fixture.js";

defineAdlComponents();

void mountDemo();

async function mountDemo(): Promise<void> {
  const app = document.createElement("adl-app") as AdlAppElement;
  const demo = new URLSearchParams(globalThis.location?.search ?? "").get("demo");

  if (demo === "band") {
    const model = createBandReferenceModel();
    const runtime = createPersistentBandReferenceRuntime(model);
    const seeded = await seedBandReferenceRuntimeIfEmpty(runtime);

    app.model = model;
    app.runtime = runtime;
    app.context = seeded.musicianContext;
  }

  document.body.append(app);
}
