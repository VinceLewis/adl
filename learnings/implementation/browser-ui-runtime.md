# Browser UI Runtime Implementation

Read this before changing browser UI components, runtime/UI policy integration, demo fixtures, or browser verification.

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
