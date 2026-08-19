export * from "./compiler/compile-adl.js";
export * from "./compiler/compile-adl-project.js";
// `compile-adlj.ts`, `print-adl.ts`, `adl-to-adlj.ts`, `compile-adl-project-v2.ts`,
// and `model/adlj-source.ts` are deliberately NOT exported here: this barrel is
// imported by the browser bundle, and `.adlj` compilation/printing/importing is
// all authoring/build-time tooling no browser UI runtime needs. `compile-adlj.ts`
// alone pulls in `ajv` and the generated `adlj-schema.json` (~3600 lines), and it
// has a top-level side effect (`new Ajv(...)`, `ajv.compile(...)`) that Rollup
// cannot tree-shake away even when nothing imports its exports — reaching it
// through ANY static import chain that survives into the bundle keeps the whole
// payload. Reaching it through this barrel grew the production bundle from
// 684 KB to 852 KB gzipped (158 KB -> 203 KB gzip) (Phase 73).
//
// Excluding a module from this barrel is necessary but NOT sufficient: the
// browser entry point (`src/ui/main.ts`) also reaches `compile-adl-project.ts`
// directly (via `src/reference/band-app.ts`, for the Giggle Band demo fixture),
// bypassing this barrel entirely. When Phase 76 added `compileAdlProjectV2` to
// that same file — importing `compile-adlj.ts` to support `.adlj` sources in a
// project — it silently pulled `ajv` back into the real bundle through that
// second path, even after this barrel was fixed. `compileAdlProjectV2` was
// split into its own file (`compile-adl-project-v2.ts`) for exactly this
// reason: `compile-adl-project.ts` must stay reachable from `band-app.ts`
// without ever importing `.adlj` tooling.
//
// **The rule going forward:** before adding or re-exporting anything
// `.adlj`-adjacent, trace its full static import chain against
// `src/ui/main.ts`'s actual reachable set (`npm run build` and inspect
// `dist/assets/index-*.js` size — do not assume barrel exclusion alone is
// proof), not just this barrel file. Import `.adlj` tooling directly from its
// own module path (`./compiler/compile-adlj.js`, `./compiler/print-adl.js`,
// `./compiler/adl-to-adlj.js`, `./compiler/compile-adl-project-v2.js`,
// `./model/adlj-source.js`) instead — the same treatment already applied to
// `simplewebauthn-adapter.ts` below for the same reason.
export * from "./compiler/resolve-model.js";
export * from "./compiler/validate-model.js";
export * from "./conformance/runner.js";
export * from "./inspect.js";
export * from "./model/defaults.js";
export * from "./model/fingerprint.js";
export * from "./model/resolved-model.js";
export * from "./parser/lexer.js";
export * from "./parser/parser.js";
export * from "./runtime/application-runtime.js";
export * from "./runtime/audit-service.js";
export * from "./runtime/command-service.js";
export * from "./runtime/condition-evaluator.js";
export * from "./runtime/decision-table-service.js";
export * from "./runtime/edit-surface-runtime.js";
export * from "./runtime/expression-evaluator.js";
export * from "./runtime/context-membership-index.js";
export * from "./runtime/context-service.js";
export * from "./runtime/hook-registry.js";
export * from "./runtime/indexeddb-object-storage.js";
export * from "./runtime/lifecycle-engine.js";
export * from "./runtime/model-migration.js";
export * from "./runtime/object-storage-backend.js";
export * from "./runtime/object-store.js";
export * from "./runtime/offline-dataset-service.js";
export * from "./runtime/operation-log.js";
export * from "./runtime/policy-engine.js";
export * from "./runtime/presentation-runtime.js";
export * from "./runtime/read-model-service.js";
export * from "./runtime/record-identity.js";
export * from "./runtime/runtime-types.js";
export * from "./runtime/startup-compatibility.js";
export * from "./runtime/sync-policy-service.js";
export * from "./runtime/sync-queue.js";
export * from "./runtime/sync-state-storage.js";
export * from "./runtime/validation-engine.js";
export * from "./server/authority-types.js";
export * from "./server/session-adapter.js";
export * from "./server/opaque-session-adapter.js";
export * from "./server/access-lifecycle.js";
export * from "./server/authority-service.js";
export * from "./server/authority-unit-of-work.js";
export * from "./server/authority-membership-projection.js";
export * from "./server/authority-projection-integrity.js";
export * from "./server/authority-retention.js";
export * from "./server/authority-retention-runner.js";
export * from "./server/sync-client.js";
export * from "./server/postgres-authority-store.js";
export * from "./server/postgres-object-storage.js";
export * from "./server/authority-config.js";
export * from "./server/authority-http.js";
export * from "./server/identity-verification.js";
// `simplewebauthn-adapter.ts` is deliberately NOT exported here: this barrel is
// imported by the browser bundle, and `@simplewebauthn/server` is a Node
// dependency confined to the authority composition root and its tests.
export * from "./server/webauthn-identity.js";
export * from "./server/http-authority-transport.js";
export * from "./server/security-operations.js";
export * from "./server/authoritative-reporting.js";
