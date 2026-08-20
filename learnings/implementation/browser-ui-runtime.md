# Browser UI Runtime Implementation

Read this before changing browser UI components, runtime/UI policy integration, demo fixtures, or browser verification.

**Where the code is (Phase 89).** `src/ui/components/adl-app.ts` is a barrel
holding only the public surface (`AdlAppElement`, `defineAdlApp`). The class it
used to hold is now a linear chain of shell-area class files under
`src/ui/components/adl-app/` — `state.ts`, `model-lookup.ts`,
`render-chrome.ts`, `render.ts`, `data.ts`, `events-shell.ts`,
`events-record.ts`, `index.ts`. Every member named anywhere below still exists
with the same name and body — see [[adl-app-file-map]] for which file each one
lives in, for the chain-ordering rule you must respect when adding one, and for
the field-initialization-order and accessor-pair rules that make a careless move
fail *silently* rather than at `tsc`.

## Key decisions from Phase 4

- The browser demo uses native Web Components, not Lit, because the repository had no UI framework dependency and the brief asked for a framework-light runtime.
- Vite is the browser dev/build path. The top-level Vite dependency is pinned to the patched 6.x line because the newest major had stricter `@types/node` peer requirements than this repo's current pin.
- The browser entry point is `index.html` with `src/ui/main.ts`. The generic components live under `src/ui/components/`.
- `src/ui/demo-fixture.ts` owns the hardcoded resolved model fixture and seeding helper for `User` and `PurchaseOrder`. UI tests and the browser demo share this fixture.
- `adl-app` coordinates model, runtime, selected object, selected record, messages, and runtime commands. Data operations call `ApplicationRuntime`; components do not write store state directly.
- Field presentation is resolved in `src/ui/policy-presentation.ts` through the shared runtime `policyEngine`. Edit mode combines read policy and write policy so fields can be masked, hidden, or readonly. Create mode does not apply read masking to empty forms, otherwise required masked fields would become impossible to enter.
- Lifecycle action buttons are filtered by both current state and transition policy before rendering.
- Lifecycle action labels are disambiguated in the form action bar when they
  collide with built-in form command labels, so a model action such as
  `cancel` can remain a business lifecycle transition while the form command
  remains a navigation/discard action.
- Lifecycle action clicks from an edit form include pending form values; the app
  saves those values first and then runs the lifecycle transition.
- Form save actions stay enabled when required fields are incomplete. Runtime
  validation remains authoritative; the browser UI preserves draft values and
  renders field-level validation issues after a failed save.
- Existing resolved theme tokens are applied by `adl-app` as CSS custom properties. Phase 5 should extend this foundation rather than replacing the UI styling path.
- Composed presentation views render through `adl-composed-view`. `adl-app`
  detects `ResolvedView.presentation`, calls
  `ApplicationRuntime.evaluatePresentationView`, and passes only the
  renderer-neutral result to the component.
- The generic browser shell uses a hamburger button and off-canvas navigation
  drawer for application view navigation. Business context selectors stay in the
  top bar. Avoid putting the raw object/view selector back into the top bar for
  app-like reference experiences.
- Navigation-item icons are optional shell metadata. The drawer's layout must
  use its two-column icon/content grid only for items that actually have an
  icon (`.has-icon`); iconless generated navigation otherwise puts its label
  in the reserved 22px icon column and overlaps the object-name subtitle.
- Shell chrome is app-level, not presentation-view-specific. The browser uses
  the same app top bar across composed dashboards/calendars and generic CRUD
  list/form pages; only the workspace body switches renderer by view kind.
- The browser shell owns viewport scrolling. Keep document/body scrolling
  disabled for app pages, render workspace content inside `.adl-scroll-region`,
  and keep the app top bar fixed while only the workspace region scrolls.
- Generic CRUD list chrome is sticky inside the app scroll region. List search
  and create controls should stay visible during list scrolling; desktop table
  headings should stick below that list header, while mobile card views should
  not expose a sticky table header.
- View-local presentation controls, such as toggles, dispatch state updates
  back to `adl-app`. The app re-evaluates the presentation view with local
  state updates and does not write object-store records for those interactions.
- UI tests use `happy-dom` with Vitest. They cover rendered workflows and direct runtime bypass enforcement for the same policy used by the UI.
- UI-affecting changes also need Playwright visual smoke coverage. Run
  `npm run test:visual` to capture desktop and mobile screenshots of every
  Giggle Band app page, and run `npm run verify:push` before pushing browser UI,
  CSS, shell chrome, reference screen, or presentation-rendering changes.
- Generic object CRUD views are list-first by default. `adl-app` should not
  auto-select the first row or render a permanent form for normal list views.
  Row clicks and create actions open the resolved view's `editContainer`.
  Non-split containers close back to the originating list after save, cancel,
  delete, close, or lifecycle transition.
- CRUD list rows are the primary open/edit target. Do not render redundant
  row-level Edit buttons when selecting the row opens the same record. Keep
  destructive Delete actions in the opened form/edit surface by default, where
  record context is clearer and policy-shaped form actions already exist.
- On mobile, generic CRUD lists should collapse table rows into labeled,
  card-like records instead of showing a horizontally cramped table with row
  action buttons.
- `editContainer: "splitPane"` is the explicit compatibility path for dense
  back-office workflows. It preserves the old list/form workspace and may
  auto-select the first available row.
- Composed presentation actions render from `RuntimePresentationActionControl`.
  Navigation actions use model view navigation, command actions call
  `ApplicationRuntime.executeCommand`, and disabled/hidden state comes from the
  presentation evaluator. CRUD list row edit/delete buttons are also
  model-driven from view action metadata and gated by the shared policy/sync
  presentation helpers.

## Key decisions from Phase 75: lookup-label display now honours `TARGET_FIELD`

- `adl-list-view.ts`'s `loadLookupLabel` and `adl-form-view.ts`'s
  `loadChildLookupLabel` both resolved a `LOOKUP` field's stored value by
  identity read (`runtime.read(field.lookup.targetObject, storedValue,
  ...)`), which is only correct when the field has no `TARGET_FIELD` — an
  identity `LOOKUP`'s stored value *is* the target record's id. A
  `TARGET_FIELD` lookup stores a natural key instead, so the identity read
  always came back `null` and the label silently fell back to showing the
  raw stored value (Phase 68's "Two identity-only `LOOKUP` consumers" note in
  [[read-model-runtime]]).
- The fix is a new shared helper, `resolveLookupTargetRecord` in
  `src/ui/components/lookup-resolution.ts`, called from both components in
  place of the direct `runtime.read(...)` call: when the field has no
  `targetField`, it does the identical identity read; when it does, it calls
  `runtime.search(targetObject, { text: storedValue, fields: [targetField]
  }, context)` and filters the results for a candidate whose
  `values[targetField] === storedValue` exactly, since `search` is
  fuzzy/substring and its results are not trusted as already-exact. The
  "record not found" fallback (raw stored value, from the existing
  catch/fallback logic in each component) is unchanged for the no-match case.
- A small shared helper was worth extracting here (unlike leaving each
  component's version alone) because the two call sites needed the *exact*
  same non-trivial logic — identity-vs-search branching plus a client-side
  exact-match filter — not just similar shapes. `lookup-resolution.ts` was
  added as a new small file rather than folding into `html.ts`, because
  `html.ts` is pure string formatting with no runtime dependency and this
  helper needs `ApplicationRuntime`/`RuntimeContext`.
- **Not fixed by this phase, closed later:** `adl-field-renderer.ts`'s
  `<select>` lookup editor had the identical identity assumption for
  populating and matching the selected `<option>`, but that was a *write*
  path (choosing an option saved an id into a field meant to hold a
  `TARGET_FIELD` natural key) — a materially different fix than the two
  display-only reads this phase closed, since a `<select>`'s `value`
  attribute has to be right at render time, not resolved lazily like a label.
  The fix, once made: a `lookupOptionValue(field, record)` helper mirroring
  `lookupLabel`'s existing `displayField` fallback pattern — reads
  `record.values[field.lookup.targetField]` when `targetField` is declared,
  falling back to `record.meta.guid` only when it is not — used for both the
  `<option value>` and the "is this option the selected one" comparison
  (previously both compared against `option.meta.guid` unconditionally). No
  shared helper with `lookup-resolution.ts` was worth extracting: that
  module's job is resolving one record from a stored value (a *read*), this
  one's job is picking the right string off an already-loaded candidate list
  (no I/O at all) — different enough shapes that forcing them through one
  abstraction would have been the wrong kind of DRY. See
  [[read-model-runtime]] for the read-side note this mirrors.

## Key decisions from the reference-demo registry refactor

- **`src/ui/main.ts`'s `mountDemo()` used to be a hardcoded
  `if (demo === "giggle-band") … else if (demo === "band") … else if (demo ===
  "jointly-care")` chain**, and `src/ui/demo-fixture.ts` re-exported a
  `createPersistent*Runtime` function, a database-name constant, and a
  seed/seed-if-empty function pair, one full set per reference app. That shape
  is exactly how a demo's specific seeding/model logic bled into shared
  dispatch code once already: before the Jointly Care addition,
  `startingContext()` called `seedBandReferenceRuntimeIfEmpty` — a
  Band-specific function — *unconditionally* for every demo, including
  `giggle-band`; it only happened to "work" there because Giggle Band's model
  reuses Band's own object names.
- **Fixed by a `ReferenceDemoDefinition` registry** (`src/reference/
  reference-demo.ts` for the shared type, `src/reference/reference-demos.ts`
  for the aggregating array `mountDemo()` looks a `?demo=` id up in). Each
  reference app now owns one self-contained definition — id, model factory,
  database name, persistent-runtime factory, and a `seedIfEmpty` normalized to
  `{ context, seeded }` — colocated with that app's own integration module
  (`bandReferenceDemo`/`giggleBandExampleDemo` in `src/reference/band-app.ts`,
  `jointlyReferenceDemo` in `src/reference/jointly-app.ts`). `mountDemo()`
  itself now contains zero app literals: no demo id, no database name, no
  per-app branch. Adding a reference app to the picker means adding one
  definition to its own module plus one array entry in `reference-demos.ts`,
  not editing an `if`/`else if` chain.
- **The normalized `{ context, seeded }` seed shape existed ad hoc in
  `main.ts` before this** (`return { context: seeded.musicianContext }` /
  `... .carerContext`, once per demo). It is now each app's own
  `seedIfEmpty` wrapper (e.g. `seedBandReferenceDemo` in `band-app.ts`) doing
  that translation once, at the source, rather than three near-identical
  inline lambdas in dispatch code.
- **`band` and `giggle-band` deliberately share one seed function.**
  `createGiggleBandExampleModel()` only renames `app.name` on top of
  `createBandReferenceModel()`'s model, so both `ReferenceDemoDefinition`s
  point at the same `seedBandReferenceDemo`. That is a fact about those two
  apps' content, decided in `band-app.ts` by the apps themselves — the
  registry never assumes any two demos share anything; if a future demo
  needs its own seed function, it just writes one.
- **`IndexedDbObjectStorageBackend` moved into `src/reference/*-app.ts`**
  (constructing each app's persistent runtime) rather than staying in
  `src/ui/demo-fixture.ts`. This keeps the dependency direction the codebase
  already had (`src/ui` depends on `src/reference`, never the reverse) while
  still letting each app module be fully self-contained; the class is
  side-effect-free to import (no eager `indexedDB` global touch), so this is
  safe even though `band-app.ts`/`jointly-app.ts` also run under
  `fake-indexeddb` in non-browser tests.
- **`demo-fixture.ts` is now scoped to only the generic "ADL Runtime Demo"
  fixture** (`browserDemoContext`, `browserDemoPartialModel`,
  `LOCAL_DEMO_IDENTITY`, `createBrowserDemoModel`/`Runtime`,
  `seedBrowserDemoRuntime[IfEmpty]`) — a fixture that was never wired to any
  `?demo=` value in the first place. It re-exports nothing from
  `band-app.ts`/`jointly-app.ts` any more; the two tests that imported
  `createGiggleBandExampleModel` through that re-export now import it
  directly from `../src/reference/band-app.js`.

## Key decisions from Phase 84: a startup failure must never be an unobserved rejection

`main.ts`'s module-scope `void mountDemo();` had no `.catch()` anywhere in the
file. `mountDemo()` → `await mountReferenceDemo(...)` → `demo.createModel()` /
`createDemoRuntime(...)` / `app.context = await startingContext(...)` /
`await connectAuthority(...)` is an unbroken `await` chain, so a failure
anywhere in it propagated all the way back to that unobserved `void` and
became a genuinely unhandled promise rejection: a blank page and a raw
console stack trace, not a message. This was not a `RuntimeStartupError`-only
gap — a compile failure from `demo.createModel()` or a network failure from
`connectAuthority(...)` hit the exact same unhandled path.

- **Why `RuntimeStartupError` reached this path so easily.**
  `ApplicationRuntime`'s constructor deliberately does
  `this.startupPromise = this.runStartupCompatibilityChecks(...)` then
  immediately `void this.startupPromise.catch(() => undefined);` — the
  constructor itself never throws. The rejection resurfaces through
  `whenReady()`, which nearly every public runtime method awaits before doing
  anything. `main.ts`'s `startingContext` calls a reference app's
  `seedIfEmpty(runtime)`, which calls a runtime method, which awaits
  `whenReady()`, which re-throws. That constructor-level suppression is
  correct and load-bearing (it is what stops runtime *construction* from
  crashing) — the defect was purely that nothing downstream ever looked at
  the promise it deferred to.
- **The fix is one `.catch()` at the one call site**
  (`void mountDemo().catch((error) => { renderStartupFailure(error, ...) })`
  in `main.ts`), not a change to the runtime's own suppression. Resist the
  urge to "fix" this by making `ApplicationRuntime`'s constructor throw, or by
  threading error state through `whenReady()` differently — the guard's shape
  is fine; the browser entry point's fire-and-forget mount was the actual gap.
- **Why the fallback renders into `document.body` directly, never through
  `<adl-app>`.** `mountDemo()` only calls `document.body.append(app)` as its
  very last line, after every failure-prone `await` has already succeeded. A
  failure caught above that line means `<adl-app>` may never have been
  created, may hold no model/runtime, or may be mid-failed-initialization —
  not a safe surface to render error UI through. `src/ui/components/
  adl-startup-error.ts` is a small, standalone custom element for exactly
  this reason: it depends on nothing `<adl-app>` provides.
- **Two tiers, one actionable.** A `RuntimeStartupError` gets a specific
  message and a "Reset local data and reload" button — the one action known
  to fix persisted local data the running model can no longer read, and
  exactly what a developer already does by hand in DevTools. Anything else
  (compile failure, authority network failure, an unexpected exception) gets
  a generic message, the raw error visible in a `<details>` disclosure (this
  is a browser app with no other error-reporting channel), and a plain
  "Reload" with **no** reset action — clearing IndexedDB does nothing for
  those failures, and offering an action that doesn't fix the problem is
  worse than offering none.
- **The reset action deletes all three of an app's IndexedDB databases,
  including session identity, on purpose** (`src/runtime/
  local-data-reset.ts`): `<databaseName>`, `` `${databaseName}-sync-state` ``,
  and `` `${databaseName}-session-identity` ``. This looks like it might
  contradict `tests/browser-model-migration.test.ts`'s warning that a
  *migration* must never touch session identity — it does not. That warning
  is about an automatic process silently discarding a signed-in user's
  identity as a side effect of something else; this is the opposite, an
  explicit, user-initiated "start completely fresh" action taken *because*
  the app is unrecoverable otherwise. A partial reset that wiped records but
  left a cached identity pointing at data that no longer matches would be a
  worse, more confusing state than a clean one requiring sign-in again.
  Re-check this reasoning (not just re-run the same conclusion) if a future
  phase adds a fourth piece of browser-persisted state to this reset list —
  the same "explicit user action, not an automatic side effect" test should
  be applied fresh each time, not assumed to still hold.
- **None of the three storage classes
  (`IndexedDbObjectStorageBackend`/`IndexedDbSyncStateStorage`/
  `IndexedDbSessionIdentityStorage`) expose a delete/teardown method.** The
  reset helper duplicates their `-sync-state`/`-session-identity` suffix
  literals rather than importing them, because there was nothing to import;
  if one of the three ever grows a real delete method, prefer calling
  through it over the literal list, so the suffix logic has exactly one
  place it can drift from the other two.
- **Reproducing the specific unrecoverable case in a real-browser test**:
  same declared `modelVersion` as the running model, but a different
  `modelFingerprint`. This is deliberately not Phase 83's prior-version case
  (which a declared migration reaches and is recoverable) — same-version,
  different-fingerprint has no migration path by design
  (`RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_STALE`,
  `startup-compatibility.ts`), so it is the one persisted-data failure this
  fallback UI exists for. Phase 83's `downgradePersistedApplicationMetadata`
  helper (`tests/visual/support/persisted-upgrade.ts`) is reusable for the
  seeding half even though its usual callers write a *prior* version: writing
  the *current* live version alongside a mismatched fingerprint reproduces
  this phase's case using the same helper and the same real seeded dataset.

## Practical guidance

- Keep UI behavior generic over `ResolvedObject` and `ResolvedView`; do not add per-object component forks.
- CRUD form container decisions come from `ResolvedView.editContainer`, not raw
  CSS class names or app-specific object checks — and specifically from the
  **form view that opens** (`adl-app.activeEditContainer` reads
  `this.editFormView.editContainer`), not from whichever view is active.
  Behaviour and rendering must read that one value: `renderCrudWorkspace` used to
  render from the view it was handed while every behavioural branch read
  `activeEditContainer`, so moving only the getter produced a workspace that
  painted `data-edit-container="splitPane"` while nothing behaved like a split
  pane. When a value moves, move every reader of it in the same pass.
- Add new UI workflows through `ApplicationRuntime` first, then expose presentation decisions through the same policy engine.
- When policy presentation blocks a field, make the UI skip that field in save patches so masked or readonly display values are not written back accidentally.
- Presentation-language constructs for richer composed screens are documented
  separately in `docs/spec/ui-language-addendum.md`. The initial browser
  renderer supports composed sections, headings, local toggles, compact feed
  rows, inline fragments, bold fragments, semantic icon names, diagnostics, and
  empty states.
- A top-level `void somePromise();` in a browser entry point (`main.ts` or
  anything reachable from it at module scope) needs an explicit `.catch()`
  even when everything it calls "shouldn't" throw — Phase 84 was a single
  unobserved `await` chain away from the entire app rendering a blank page on
  any startup failure, not only the one that was actually hit twice in one
  session. If a future change adds another fire-and-forget top-level call,
  check it the same way rather than assuming the one fixed in Phase 84 was
  the only one.
- A lookup label is a **field** read, not a record read
  (`resolveLookupTargetRecord` now calls `runtime.readFieldsForDisplay`, not
  `runtime.read`). An application may legitimately grant a target object's
  display field and refuse the record — both reference apps' `User` object does
  since Phase 101 — and every label path in the browser (`adl-list-view`,
  `adl-form-view`, `adl-field-renderer`) falls back to the raw stored id on
  refusal, silently. Getting this wrong renders `user-c52bac75-…` wherever a
  name belongs, with nothing failing. See
  [policy-engine](policy-engine.md)'s Phase 101 section.
- The same policy may also refuse `SEARCH` on the target, which empties a lookup
  `<select>`'s candidate list. `adl-field-renderer` therefore resolves the
  *selected* option's label through the same field-scoped read, and **patches
  the option's `textContent` in place rather than re-rendering**: the label
  arrives asynchronously, and replacing `innerHTML` under a focused `<select>`
  blurs it and discards a selection in progress.
