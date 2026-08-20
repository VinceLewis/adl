import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ResolvedApplicationModel } from "../model/resolved-model.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";

/**
 * What a reference demo's seed-if-empty function produced, normalized across
 * every reference app so `src/ui/main.ts` never has to know each app's own
 * seed shape (Giggle Band/Band return `musicianContext`, Jointly Care returns
 * `carerContext`, and a future app will return something else again).
 */
export interface ReferenceDemoSeedOutcome {
  context: RuntimeContext;
  seeded: boolean;
}

/**
 * Everything the generic browser demo dispatch (`mountDemo` in
 * `src/ui/main.ts`) needs to mount one reference app, gathered in one place so
 * adding a reference app to the `?demo=` picker means adding one of these
 * (colocated with the app's own integration module) rather than editing an
 * `if`/`else if` chain in shared dispatch code.
 */
export interface ReferenceDemoDefinition {
  /** Matches the `?demo=` query value that selects this app. */
  id: string;
  /**
   * Async so a demo whose source is `.adlj` can compile it behind a dynamic
   * `import()` — `.adlj` compilation pulls in `ajv` and the generated JSON
   * Schema, dead weight for every demo that doesn't need it, so nothing
   * `.adlj`-adjacent may be reachable through a *static* import from this
   * module or anything it imports. A demo whose source is plain `.adl` text
   * has no such cost and can simply resolve immediately.
   */
  createModel: () => Promise<ResolvedApplicationModel>;
  /** Database name for this demo's IndexedDB-backed persistent runtime. */
  databaseName: string;
  /**
   * Browser-tab favicon URL for this demo, set on `index.html`'s
   * `#adl-app-favicon` link by `mountReferenceDemo()`. Optional: a demo that
   * omits it falls back to the generic `/adl-icon.svg` already declared in
   * `index.html`.
   */
  iconUrl?: string;
  /**
   * Always called with the model `createModel()` already produced — never
   * relied on to resolve one itself, which is what lets it stay synchronous
   * even for a `.adlj`-sourced demo.
   */
  createPersistentRuntime: (model: ResolvedApplicationModel) => ApplicationRuntime;
  seedIfEmpty: (runtime: ApplicationRuntime) => Promise<ReferenceDemoSeedOutcome>;
}
