# Phase 84 — Startup Failure Recovery UI

> Commissioned directly by the user, from a real failure hit twice in one
> session: a browser holding persisted data the current resolved model
> cannot read throws `RuntimeStartupError`, and today that becomes a
> genuinely uncaught promise rejection — a blank white page and a raw
> console stack trace, with the only real fix being a developer opening
> DevTools and deleting an IndexedDB database by hand. Per
> `learnings/process/phase-execution.md`'s standing rule for
> user-commissioned phases, this does not need to justify itself as the
> next item in a rolling handoff.
>
> **This document is written to be executed by a lower-effort model than
> the one that authored it.** The architecture trace below (exactly where
> the rejection becomes unhandled, and why) is the hard part and is
> already done. What's left is building one small, dependency-light
> fallback UI and wiring it into one call site.

## Objective

When the browser app shell fails to start — most importantly (but not
only) a `RuntimeStartupError` from persisted data the current model
cannot read — show a real, human-usable recovery screen instead of an
uncaught exception and a blank page. For the specific, actionable case
(persisted data incompatible with the resolved model), offer a "Reset
local data and reload" action that does exactly what a developer
currently has to do by hand in DevTools.

## Evidence and Dependency

Re-verify against current code before executing.

- **The exact point the rejection becomes unhandled**: `src/ui/main.ts`
  calls `void mountDemo();` at module scope (line 17) — fire-and-forget,
  no `.catch()` anywhere in the file (confirmed: zero `try`/`catch` blocks
  in `main.ts` at all). `mountDemo()` calls `await mountReferenceDemo(...)`,
  which calls `await demo.createModel()`, `createDemoRuntime(...)`,
  `app.context = await startingContext(...)`, and
  `await connectAuthority(...)` — a failure anywhere in that chain
  propagates all the way back to the unobserved `void mountDemo()` and
  becomes an unhandled promise rejection. This is not specific to
  `RuntimeStartupError`: a failure in `demo.createModel()` (a compile
  error) or `connectAuthority(...)` (a network failure) hits the exact
  same unhandled path today.
- **Why `RuntimeStartupError` specifically reaches here**:
  `ApplicationRuntime`'s constructor (`src/runtime/application-runtime.ts:140`)
  deliberately does `this.startupPromise = this.runStartupCompatibilityChecks(...)`
  then immediately `void this.startupPromise.catch(() => undefined);` — the
  constructor itself is already safe and does not crash. The rejection
  resurfaces through `whenReady()` (line 319, re-exposing
  `this.startupPromise`), which nearly every public method
  (`search`, `create`, ...) awaits before doing anything
  (`await this.whenReady();`, confirmed at ~25 call sites). `main.ts`'s
  `startingContext` calls `seedIfEmpty(runtime)` for a local demo, which
  calls a runtime method, which awaits `whenReady()`, which re-throws —
  and that throw is what the user's console trace shows
  (`application-runtime.ts:828` → `startup-compatibility.ts:214`).
- **`main.ts` is the one browser entry point**, not a demo-only path —
  `vite.config.ts`'s `indexEntry` is `index.html`, which loads this file.
  Every reference app (Giggle Band, Jointly Care, the generic persistent
  browser demo) and any authority-connected deployment mounts through
  `mountDemo()`/`mountReferenceDemo()`. This is a real startup-resilience
  gap, not a demo-only nicety.
- **No existing reusable fallback component applies**: `AdlMessageAreaElement`
  (`src/ui/components/adl-message-area.ts`) is a sub-element rendered by
  `<adl-app>` itself once it has successfully initialized — unusable here,
  since the failure this phase handles happens *before* `<adl-app>` ever
  reaches a working state, and `<adl-app>` may not even be attached to
  `document.body` yet (`mountDemo` only does `document.body.append(app)`
  as its last line, after everything else has already succeeded).
- **The three IndexedDB databases per app**, confirmed by their exact
  naming logic: `<databaseName>` (records + `__adl_application_metadata`,
  `IndexedDbObjectStorageBackend`), `` `${databaseName}-sync-state` ``
  (`src/runtime/sync-state-storage.ts:47`, `IndexedDbSyncStateStorage`),
  and `` `${databaseName}-session-identity` ``
  (`src/ui/offline-session.ts:164`, `IndexedDbSessionIdentityStorage`).
  `databaseName` per app is `demo.databaseName` from its
  `ReferenceDemoDefinition` (e.g. `GIGGLE_BAND_EXAMPLE_DATABASE_NAME =
  "adl-giggle-band-example"`, `src/reference/band-app.ts`).
- **Session identity is documented elsewhere as the sharpest-edged of the
  three** (`tests/browser-model-migration.test.ts`'s own comment: "it is
  what stops a signed-in user losing their own data on an offline
  reload... a migration must never touch it"). That rule is about
  *migration* specifically continuing to work without silently signing
  someone out. A user-initiated "reset, I'm stuck" action is a different
  thing entirely — see Decision below for why this phase clears it anyway.
- **`RuntimeStartupError`** is exported from `src/runtime/runtime-types.ts`
  and carries `diagnostics: RuntimeStartupDiagnostic[]`
  (`RUNTIME_STARTUP_COMPATIBILITY_CODES`, confirm exact members at
  execution time) — the specific code seen in practice is
  `ADL_PERSISTED_MODEL_FINGERPRINT_STALE`-shaped (confirm exact code
  constant in `startup-compatibility.ts`).

## Decision

### Catch at the one call site, render a standalone fallback, not a fixed-up `<adl-app>`

Change `void mountDemo();` to `void mountDemo().catch((error) => { ... });`
(or an equivalent top-level `try`/`catch` inside an async IIFE — pick
whichever reads more naturally against the file's existing style). On
catch, render a **new, small, dependency-light fallback element**
directly into `document.body` — do not attempt to recover `<adl-app>`
into a working state; it may never have been given a model or runtime,
or may be mid-failed-initialization, and is not a safe surface to render
error UI through. Name it something like `<adl-startup-error>`
(`src/ui/components/adl-startup-error.ts`), following this file's
existing custom-element conventions (see any small element in
`src/ui/components/` for the pattern — `connectedCallback`, `innerHTML`
template, `escapeHtml` on any interpolated text).

### Two tiers of message, one actionable

- **`RuntimeStartupError` specifically**: show a clear, specific message
  ("This app's locally saved data doesn't match the version currently
  running and can't be automatically updated.") plus a **"Reset local
  data and reload"** button. Clearing local data is the one thing known
  to fix this exact failure — it's what a developer already does by hand
  today, and it's mechanically the correct action.
- **Any other error** (network failure connecting to an authority, a
  model compile failure, an unexpected exception): show a generic
  "Something went wrong starting the app" message with the raw error
  message/stack visible (this is a browser app with no server-side error
  reporting today — surfacing the raw error is more useful than hiding
  it) and a plain **"Reload"** button, with **no** "reset local data"
  action offered — clearing IndexedDB does nothing for a compile or
  network failure, and offering a button that doesn't fix the problem is
  worse than offering nothing.

### Reset clears all three databases, including session identity

The "Reset local data and reload" action deletes all three IndexedDB
databases for the affected app: `<databaseName>`,
`<databaseName>-sync-state`, `<databaseName>-session-identity`. This
includes session identity, deliberately, despite the sharp-edged warning
about it elsewhere in this codebase (Evidence, above) — that warning is
about an *automatic migration* silently discarding a signed-in user's
identity as a side effect of something else. This is the opposite: an
explicit, user-initiated "start completely fresh" action, taken *because*
the app is unrecoverable otherwise. A partial reset that wipes records
but leaves a cached identity pointing at data that no longer matches
would be a worse, more confusing state than a clean one requiring
sign-in again. Flagged here explicitly as the phase's one real judgment
call, in case execution turns up a reason this repo's own
`learnings/implementation/storage-backend.md` or
`model-versioning-guard.md` would object to it — re-read both before
implementing this specific piece.

### Determine `databaseName` from what's actually reachable at failure time

`mountReferenceDemo`'s `demo` parameter (a `ReferenceDemoDefinition`) is
in scope wherever the catch is placed if the catch wraps
`mountReferenceDemo` specifically rather than only the outermost
`mountDemo`; confirm the actual call shape needed to reach
`demo.databaseName` from the catch handler when implementing — it is
already resolved earlier in `mountDemo` (`findReferenceDemo(...)`) before
any of the failure-prone `await`s run, so it should always be available
to thread through. If `demo` is `undefined` (no matching `?demo=`), there
is no app-specific database to offer resetting — show only the generic
fallback with a plain reload action in that case.

## Scope

- New `src/ui/components/adl-startup-error.ts` (or similar name matching
  repo convention): the fallback custom element, taking the caught error
  and (when available) the failing app's `databaseName` as inputs.
- `src/ui/main.ts`: catch at the `mountDemo()` call site (or wherever
  Decision above lands after re-verifying the exact call shape), render
  the fallback on failure.
- A small helper to delete the three IndexedDB databases for a given
  `databaseName` — check whether `src/runtime/indexeddb-object-storage.ts`,
  `sync-state-storage.ts`, or `offline-session.ts` already expose a
  `deleteDatabase`/`clear` style method before writing a new one; reuse
  over reimplementing raw `indexedDB.deleteDatabase` calls three times if
  a shared path already exists.
- Tests: a unit test constructing the fallback element directly with a
  synthetic `RuntimeStartupError` and a synthetic generic error, asserting
  the right message/button combination renders for each. A real-browser
  Playwright test that reproduces the exact failure (seed stale
  same-version-different-fingerprint metadata — the unrecoverable case
  from earlier this session, not the recoverable prior-version case
  Phase 83's tests already cover) against a real app URL, confirms the
  fallback renders instead of a blank page, clicks "Reset local data and
  reload", and confirms the app then starts cleanly and re-seeds.
- `learnings/` note if this phase's investigation into exactly where the
  rejection becomes unhandled (Evidence, above) is reusable knowledge —
  likely yes, given how easy it would be for a future change to
  reintroduce an unobserved `await` in this same chain.

## Constraints

- Do not attempt to make `<adl-app>` itself recover into a working state
  after a startup failure — render the standalone fallback instead, per
  Decision above.
- Do not offer "reset local data" for a non-`RuntimeStartupError` failure.
- Do not silently swallow the error — always show the raw error message
  (or a "details" disclosure) for the generic-failure case; this is a
  browser app with no other error-reporting channel today.
- No change to the migration mechanism, `ApplicationRuntime`'s
  constructor-level `void this.startupPromise.catch(() => undefined);`
  (that suppression is correct and load-bearing — it's what stops the
  constructor itself from crashing; don't touch it), or the fail-closed
  fingerprint guard's own logic.

## Deliverables

- `adl-startup-error` element (or equivalent name).
- `main.ts`'s catch wiring.
- The IndexedDB-clearing helper (new or reused).
- Unit test for the fallback element's two message/action tiers.
- Real-browser Playwright test proving the recovery flow end to end for
  the specific unrecoverable case (same version, mismatched fingerprint —
  today's actual failure, distinct from the prior-version case Phase 83
  already covers).
- `learnings/` note, if warranted.

## Acceptance Criteria

- Seeding a real IndexedDB with the same `modelVersion` as the currently
  running model but a mismatched `modelFingerprint` (the unrecoverable
  case — no migration step can reach this) and loading the real app URL
  shows the fallback UI, not a blank page and an uncaught exception in
  the console.
- The fallback's "Reset local data and reload" button, when clicked,
  deletes all three of the app's IndexedDB databases and reloads; the app
  then starts cleanly and reseeds itself (matching existing
  `seedIfEmpty` behavior).
- A synthetic non-`RuntimeStartupError` failure (for example, force
  `demo.createModel()` to reject in a test) shows the generic fallback
  with no "reset local data" button.
- `npm run typecheck`, `npm test`, and `npm run format:check` pass.
- `npm run verify:push` passes; the new fallback UI's screenshot is
  inspected, in both the `RuntimeStartupError` state and the generic
  failure state.
- Per this repo's own newly-added rule (`AGENTS.md`, "Persisted-state
  upgrade testing" and "Design/UX review before a UI-affecting change is
  done"): this phase changes rendered UI, so both apply — run
  `/impeccable audit` on the new element before considering this done,
  and confirm this phase itself does **not** change any resolved-model
  content or `modelVersion` (it shouldn't; if it turns out to, that is a
  sign the phase's scope crept and needs re-examining, not a reason to
  skip a version bump).

## Testing

- `npm test` — unit test for the fallback element.
- `npm run verify:push` — the new real-browser recovery-flow test, plus
  full visual inspection.
- `/impeccable audit src/ui/components/adl-startup-error.ts` (and
  whatever CSS it needs) before considering the phase done.

## Non-goals

- A generic client-side error-reporting/telemetry pipeline — this phase
  surfaces the error to the person looking at the screen, it does not
  send it anywhere.
- Retry/backoff logic for a transient network failure connecting to an
  authority — "Reload" already covers that; no need for automatic retry.
- Any change to how `RuntimeStartupError` is thrown, diagnosed, or
  categorized inside the runtime — this phase is purely about the UI's
  reaction to it, not the runtime's detection of it.
- Extending this to non-browser runtimes or the authority server — this
  is `src/ui/`-scoped.

## Dependencies

- `src/ui/main.ts` (the catch site).
- `src/runtime/application-runtime.ts`, `src/runtime/startup-compatibility.ts`,
  `src/runtime/runtime-types.ts` (`RuntimeStartupError`, read-only
  reference — not modified).
- `src/runtime/indexeddb-object-storage.ts`, `src/runtime/sync-state-storage.ts`,
  `src/ui/offline-session.ts` (the three databases' naming and any
  existing delete/clear helpers).
- `src/reference/*/band-app.ts`/`jointly-app.ts`/`demo-fixture.ts`
  (`databaseName` constants, for the Playwright test's setup).
- `tests/visual/support/persisted-upgrade.ts` (Phase 83's helper — likely
  reusable for seeding the stale-metadata state this phase's Playwright
  test needs, even though the assertion differs: this phase expects the
  *fallback UI*, not a successful migration).

## Tasks

1. Re-verify the evidence above against current code — in particular,
   confirm the exact current call shape around `mountDemo()`/
   `mountReferenceDemo()` and whether `demo`/`databaseName` is reachable
   at the chosen catch site without restructuring more than necessary.
2. Re-read `learnings/implementation/storage-backend.md` and
   `learnings/implementation/model-versioning-guard.md` before
   implementing the reset action, per the Decision section's flagged
   judgment call.
3. Build `adl-startup-error` (or equivalent), covering both message/action
   tiers.
4. Build or locate the three-database clear helper.
5. Wire the catch into `main.ts`.
6. Unit test for the fallback element.
7. Real-browser Playwright test for the full recovery flow.
8. `npm run verify:push`; inspect screenshots.
9. `/impeccable audit` on the new UI; address or record findings.
10. `learnings/` note if warranted.
11. Commit and push.

## Planning Handoff

- **Client-side error reporting/telemetry candidate** (Non-goals, above):
  today the generic-failure fallback surfaces the raw error only to
  whoever is looking at the screen. A real deployment likely wants this
  reported somewhere. Not attempted here.
- **The same unhandled-rejection shape may exist elsewhere** in the
  browser runtime wherever a top-level `void somePromise()` has no
  `.catch()` — this phase fixes the one call site that produced a real
  user-facing failure; a broader sweep for the same pattern elsewhere is
  a separate, not-yet-scoped candidate. Confirmed at least one other
  instance while re-verifying `main.ts` for this phase:
  `void registerAdlServiceWorker(model.modelVersion);` inside
  `mountReferenceDemo` has the same shape (fire-and-forget, no `.catch()`).
  Left as-is here — it fires without being awaited, so `mountReferenceDemo`
  returns and `mountDemo` appends `<adl-app>` to the DOM regardless of how
  it settles, meaning a failure there would not reach this phase's new
  catch and would not blank the page the way the fixed call site did. It is
  still an unobserved rejection, just a lower-stakes one (the app is
  already working by the time it could fire), and worth a deliberate look
  rather than an assumption that it is harmless.

## Closing Note

Executed in full against `main`. The working tree held a second, unrelated,
uncommitted session's changes throughout (`src/reference/band-app.ts`,
`src/reference/giggle-band/{domain,ui}.adlj`,
`tests/band-reference-app.test.ts`, `tests/browser-model-migration.test.ts`,
`tests/compile-adl.test.ts`, `tests/visual/giggle-band.visual.spec.ts`); none
of those files were read for anything but confirming they were out of scope,
none were edited, and the commit below stages only this phase's own files by
explicit path.

**Re-verification (Task 1).** The doc's evidence held with one cosmetic
drift: `void mountDemo();` was at line 19, not line 17 (an unrelated earlier
edit), with the same zero-`try`/`catch`, unbroken-`await`-chain shape the
doc traced. `demo` (a `ReferenceDemoDefinition`) is resolved by
`findReferenceDemo(...)` before any failure-prone `await` in `mountDemo`,
confirmed reachable from a catch attached to the outer `mountDemo()` call by
re-deriving it with the same lookup rather than threading it out of the
function — cheap, synchronous, and deterministic, so duplicating it beats
restructuring `mountDemo`'s signature. One thing the doc's evidence did not
call out: the generic ("no `?demo=`") browser demo does **not** go through
this unhandled path at all — its model/runtime/seeding all happen inside
`<adl-app>`'s own `connectedCallback`/`initialize()`, which already has a
`try`/`catch` that renders a message via the existing message area. The gap
this phase closes is specific to the `mountReferenceDemo` path (every
`?demo=` reference app), which is also every case Jointly Care, Giggle Band,
and Band cover — confirmed by tracing `initialize()` and the `runtime`
getter in `adl-app.ts`, not assumed.

**Learnings review (Task 2).** `storage-backend.md` and
`model-versioning-guard.md` were re-read as instructed. Neither gives a
reason to reconsider clearing session identity as part of an explicit,
user-initiated reset — both are about protecting session identity from an
*automatic* process (a migration) silently discarding it as a side effect,
which is not what this action is. Reasoning recorded in both
`browser-ui-runtime.md` (new section) and this document's Decision section
above; execution proceeded as decided.

**Built (Tasks 3–5).** `src/ui/components/adl-startup-error.ts` (new custom
element, following `adl-sync-recovery.ts`'s conventions: `connectedCallback`,
`innerHTML` template, `escapeHtml` on interpolated text, `data-*` hooks for
tests) plus its `styles.css` block. `src/runtime/local-data-reset.ts` (new;
none of the three storage classes exposed a delete method to reuse, per the
doc's own instruction to check first). `src/ui/main.ts`'s `mountDemo()` call
site now catches and renders the fallback straight into `document.body`,
re-deriving `databaseName` from the URL rather than threading it through.
`register.ts` registers the new element alongside the others.

**Tests (Tasks 6–7).** `tests/ui-startup-error.test.ts`: six cases covering
both tiers (`RuntimeStartupError` with/without a `databaseName`, a plain
`Error`, a thrown non-`Error`), the plain-Reload click, and — using
`fake-indexeddb` — the reset action actually deleting all three databases and
reloading. `tests/visual/startup-failure-recovery.visual.spec.ts` (new,
registered in `playwright.config.ts`'s `desktop`/`mobile` projects): two
real-browser cases against Jointly Care. First, the deliberate target
failure — same live `modelVersion`, mismatched `modelFingerprint`, seeded via
Phase 83's `downgradePersistedApplicationMetadata` helper reused for the
opposite direction (current version, not a prior one) — confirms the
fallback renders (not a blank page), clicks "Reset local data and reload",
and confirms the app restarts clean and re-seeds a non-empty dataset at the
same live version. Second, a synthetic non-`RuntimeStartupError` failure (an
`addInitScript`-installed `indexedDB.open` override that throws for the
app's database name, standing in for any unexpected startup exception)
confirms the generic tier renders with the raw error visible and no reset
button. Both passed on first run, on both `desktop` and `mobile` projects,
inside a full `npm run verify:push` alongside the rest of the suite (54
Playwright tests total, 1069 unit tests, clean typecheck/format).

**Screenshots inspected (Task 8).** All four new PNGs
(`startup-failure-{desktop,mobile}-runtime-startup.png`,
`startup-failure-{desktop,mobile}-generic.png`, plus the `-recovered.png`
pair) show a centered card with readable red-accented heading, correct
message copy, correctly-present/absent buttons, and no layout overflow on
either viewport — not a blank page in any of the four failure screenshots.

**`/impeccable audit` (Task 9).** No `PRODUCT.md` exists for this
repository, so the audit proceeded scoped to the two changed/added files
rather than diverting into `init`, per the skill's own routing rule for a
scoped request against existing code. `detect.mjs` against `styles.css`
found only 3 pre-existing `side-tab` findings, all outside this phase's
diff (`.adl-presentation-row`/`.adl-matrix-cell`/`.adl-calendar-cell`, a
functional status-color convention in the calendar/matrix presentation
views, not a decorative accent) — recorded here as false positives for this
phase: real findings, but pre-existing and out of this phase's scope, not
touched. The new `.adl-startup-error*` rules introduced zero new findings.
Manual review against the audit's five dimensions: real `<button>`
elements and a native `<details>` disclosure (full keyboard access with no
custom handling needed), `role="alert"`/`aria-busy` on the container,
heading/body/muted-detail text all at or above 4.5:1 contrast against the
surface token, full design-token usage throughout (one hardcoded shadow
tint normalized to the repo's existing `rgba(16, 24, 40, ...)` convention
during this pass), no side-stripe border (full `border` around the panel,
not a `border-left` accent), no other anti-pattern from the shared bans
list. Control height (34px) and no dark-mode variant both match this
app's existing, repository-wide convention (`--adl-control-height`, no
`prefers-color-scheme`/`data-theme` anywhere in `styles.css`) rather than
being a gap specific to this file.

**Learnings (Task 10).** Added a "Key decisions from Phase 84" section to
`learnings/implementation/browser-ui-runtime.md` recording the exact
unhandled-rejection trace, why the fallback renders outside `<adl-app>`,
the two-tier design, the session-identity reasoning, and the real-browser
reproduction recipe — plus one `Practical guidance` bullet flagging that
any future top-level `void somePromise();` in this codebase's browser entry
point needs the same scrutiny (`registerAdlServiceWorker(...)` in `main.ts`
is one remaining example, left as-is per this phase's Non-goals and
recorded in the Planning Handoff below).

**Verification.** `npm run typecheck`, `npm run format:check`, `npm test`
(1069 tests), `npm run build`, and `npm run test:visual` (54 tests across
`desktop`/`mobile`/`offline-shell`/`passkey`/`administration`) all passed
via one full `npm run verify:push` run. No resolved-model content or
`modelVersion` changed anywhere in this phase's diff — confirmed by the
diff itself touching only `src/ui/`, `src/runtime/local-data-reset.ts`,
`playwright.config.ts`, and test/learnings/doc files.

**Commit scope.** Given the concurrent, unrelated, uncommitted work present
in the working tree throughout execution (see the note at the top of this
section), the commit for this phase stages only the files this phase
actually owns, via explicit paths — never `git add -A` or a wildcard —
leaving the other session's in-progress work exactly as it was found.
