# Phase 67 - Theme Select Shell Control

> **Why this phase exists at all, after Phase 66 declined to write a Phase 67.**
> `learnings/process/phase-execution.md` records that the rolling handoff
> stopped at Phase 63, and Phases 64, 65 and 66 each answered one named,
> concrete feature or defect from real-world use of a sibling application
> (`giggle-new`) without reopening the rolling handoff. This phase is the same
> shape again: the user named a concrete capability — a theme *select*, not a
> binary toggle, because an app may declare more than two themes — after using
> the system. It is not derived from re-reading this subsystem's own code, and
> it does not license deriving a Phase 68 from the code either. See the
> Planning Handoff below.

## Objective

Make "let a person pick which declared theme this device uses, and remember
the choice" a genuinely working, cross-app platform capability of the ADL UI
runtime: mutable active-theme state that starts from the app's declared
default, a `themeSwitch` shell control rendered as a dropdown over every
declared theme (not a two-state toggle), and a device-local persistence
mechanism that needs no application-declared object or field — demonstrated
end to end on ADL's own Giggle Band reference app, which already carries three
themes (`CorporateLight`, `CorporateDark`, `MinimalLight`) without declaring a
single custom `THEME` block.

## Evidence and Dependency

Checked against the code while writing this document, following Phase 56's
and Phase 66's precedent of verifying inherited evidence rather than trusting
it.

- **`ResolvedApplicationModel.themes: ResolvedTheme[]` already holds every
  declared theme, with three built-ins always injected.**
  `src/compiler/resolve-model.ts`'s `resolveThemes` computes `[...input
  themes, ...createBuiltInThemes().filter(name not already declared)]`, so
  `model.themes.length` is at least 3 for any model, including Giggle Band's,
  which declares no `THEME` block of its own beyond `APP ... THEME
  CorporateLight` (a *default selection*, not a declaration) in
  `src/reference/giggle-band/domain.adl`. Confirmed: there is no way through
  today's resolver to end up with fewer than three declared themes.
- **`ResolvedApp.theme: string` is still a single static field**, set once at
  model resolution from the `APP ... THEME Name` directive
  (`src/model/resolved-model.ts:314`), and nothing in the runtime mutated it
  before this phase — `findApplicationTheme` (`src/ui/theme/default-theme.ts`)
  was the only reader, called once per render from `applyThemeTokens`.
- **`themeSwitch`/`THEME_SWITCH` was already a fully parseable shell control
  kind, exactly as the prior investigation reported.**
  `ShellControlKind` (`src/model/resolved-model.ts:98`) already included
  `"themeSwitch"`, and `parseShellControlKind`
  (`src/parser/parser.ts:3877-3903`) already accepted both `THEME_SWITCH` and
  `themeswitch` as the keyword, unconditionally — not a stub gated behind a
  flag. This was the same shape `pwaInstall` was in before Phase 66 gave it a
  branch: declarable, but with no rendering behind it.
- **`renderShellControl` in `src/ui/components/adl-app.ts` had no branch for
  `themeSwitch`**, confirmed by reading the method in full before this phase:
  it branched on `contextSelector`, `connectivity`, and `syncStatus`
  explicitly, then fell through to the generic button branch for everything
  else (`logout`, `pwaInstall`, and `themeSwitch` alike), which computed
  `action` as `undefined` for any kind other than `logout`/`pwaInstall` — so a
  declared `themeSwitch` control rendered as a permanently disabled button
  with the generic "not available in this runtime" title, never wired to
  anything.
- **`docs/spec/runtime-semantics.md` explicitly documented this as
  unimplemented**: "Theme switch has no runtime behind it yet" and "any
  control whose host capability the runtime does not supply — theme switch
  always, today...". Confirmed present, word for word, before editing it.
- **No existing platform-level device-setting store outside the object
  model**, but an existing *pattern* for exactly this shape of state was
  already in the same file: business-context selection persistence.
  `setSelectedContextId` / `persistContextSelection` / `readPersistedContextId`
  (`src/ui/components/adl-app.ts`, current lines ~2165-2230) already read and
  write `globalThis.localStorage`/`sessionStorage` keyed by
  `` `adl:${model.app.name}:context:${contextName}` ``, with small
  `readStorageValue`/`writeStorageValue` module-level helpers that swallow
  storage exceptions. This is a platform mechanism already proven for
  per-device UI-selection persistence that survives a reload, keyed by app
  name so multiple ADL apps on one origin do not collide, and it needs no
  object or field in any app's domain model. It is a better fit than
  `IndexedDbSyncStateStorage` (`src/runtime/sync-state-storage.ts`), which is
  async, exists specifically for the sync queue/operation log, and is
  overkill for one string a render method needs to read synchronously on
  every paint. It is also a better fit than forcing every app author to
  declare an `OBJECT DevicePreference` (the pattern Giggle Band's
  `SYNC LOCAL_PRIVATE SCOPE currentUser` object uses for its own
  `SelectedBand`/`LastOpenedView` prefs) merely to get a platform capability
  every app should have for free once it declares the control.
- **Giggle Band's `SHELL` block declared no `themeSwitch` control**, so like
  `pwaInstall` before Phase 66, the generic capability had no reference-app
  proof.
- **No tests existed for this**: `grep -rln "themeSwitch\|activeThemeName"
  tests/` returned nothing before this phase.
- **No separate pure-logic module was needed**, for the same reason Phase 66
  gave for `pwaInstall`: `adl-app.ts` is a real `HTMLElement` already fully
  exercised by `happy-dom`, and the state that matters here
  (`activeThemeName`, the rendered `<select>`, the theme actually applied to
  the element's dataset/CSS custom properties) belongs together in one
  component, not split across a pure module and the component for no
  testability gain.

This phase depends on `ShellControlKind`, `ResolvedApplicationModel.themes`,
`ResolvedTheme`, `findApplicationTheme`/`applyResolvedTheme`
(`src/ui/theme/default-theme.ts`), `AdlAppElement`'s existing context-selection
storage helpers and `handleChange`, and the Giggle Band reference app's `SHELL`
block.

## The Decision

Add mutable, persisted active-theme state to `AdlAppElement`, reusing the
existing context-selection storage pattern rather than adding a new
persistence mechanism:

- A new private field, `activeThemeName: string | undefined`. `undefined`
  means "no device override": the model's declared `app.theme` still governs.
  It is set from a device-local override read back on every `model`
  assignment (`readPersistedThemeName`), and only ever reassigned by a
  successful theme choice — never cleared back to `undefined` by this phase's
  own code, mirroring Phase 66's "`appInstalled` never un-sets" reasoning:
  once a person has expressed a preference on this device, nothing observed
  here is evidence they want to go back to the app's default.
- `resolveActiveTheme()` looks up `activeThemeName` in `model.themes` first,
  falling back to `findApplicationTheme(model)` — both when no override is
  set and when a stored override no longer names a declared theme (a model
  change dropped or renamed it since the override was stored). This keeps a
  stale `localStorage` entry from an earlier model version from ever
  resolving to nothing.
- `applyThemeTokens()` now calls `resolveActiveTheme()` instead of
  `findApplicationTheme(this._model)` directly — the only change to the
  existing theme-application code path.
- Persistence reuses `localStorage`, keyed by `` `adl:${appName}:theme` ``,
  through the same `readStorageValue`/`writeStorageValue` helpers
  context-selection already uses, added to (not duplicated for) that existing
  mechanism. This is a `localStorage`-only choice, not
  session/local-configurable like context selection: the active theme is
  presentation state a person expects to persist indefinitely on a device,
  with no equivalent to a context's "don't remember this" need.
- `renderShellControl` gains a `themeSwitch` branch, delegating to
  `renderThemeSwitch`, which renders a `<select>` (not a toggle button) with
  one `<option>` per `model.themes` entry, labelled via the same
  `titleCaseIdentifier` fallback every other control already uses for a
  theme's bare `name` (there is no friendlier label field on `ResolvedTheme`
  today, and adding one is out of scope — see Non-goals). The active theme's
  option is marked `selected`. With fewer than two declared themes — not
  reachable through today's resolver, but kept for the same defensive
  reason `pwaInstall` renders unavailable with no host capability — the
  control instead renders the same disabled-button shape the generic
  unavailable branch already produces.
- `handleChange` gains a `data-theme-switch="true"` branch, checked before the
  existing `data-view-switch="true"` branch, calling `handleThemeSwitch`,
  which validates the chosen name against `model.themes`, updates
  `activeThemeName`, persists it, re-applies theme tokens, and re-renders —
  all synchronously, since no runtime write or async work is involved: the
  active theme is device presentation state, not application data passing
  through policy or sync.
- `installApp KIND themeSwitch LABEL 'Theme' PLACEMENT topBar` — actually
  named `themeSwitch` for both control name and kind, following the existing
  `syncStatus`/`syncStatus` precedent — is added to Giggle Band's `SHELL`
  block, in `topBar`'s `CONTROLS` list between `syncStatus` and `installApp`.

No new declarative surface. `ShellControlKind` already had `themeSwitch`; this
phase is runtime behaviour, CSS for the new control shape, and one
reference-app declaration, not language work.

## Scope

- `activeThemeName` component state, `resolveActiveTheme`,
  `readPersistedThemeName`, `persistThemeSelection`, and the
  `themeStorageKey` helper, all in `src/ui/components/adl-app.ts`.
- A `themeSwitch` branch in `renderShellControl` / `renderThemeSwitch`
  rendering a `<select>` over `model.themes`.
- A `data-theme-switch="true"` branch in `handleChange`.
- `.adl-theme-switch` CSS in `src/ui/styles.css`, added to the existing shared
  selector groups `.adl-object-switch`/`.adl-view-switch`/
  `.adl-context-selector` already use for topBar layout, inverted-color
  topBar-app treatment, and the narrow-viewport full-width stacked layout —
  not a new visual language for this one control.
- Wiring `CONTROL themeSwitch KIND themeSwitch LABEL 'Theme' PLACEMENT topBar`
  into the Giggle Band reference app's `SHELL` block and its `TOP_BAR
  CONTROLS` list.
- `tests/ui-theme-switch.test.ts`: every declared theme listed with the
  default selected, an immediate re-render on choice, `localStorage`
  persistence under an app-scoped key, restoring the persisted choice across
  a fresh `model` assignment (this test suite's stand-in for a reload), and
  falling back to the app's declared default when a stored name no longer
  matches a declared theme.
- A `docs/spec/runtime-semantics.md` correction: its shell-control paragraph
  said "Theme switch has no runtime behind it yet," which this phase makes
  false.
- A `learnings/implementation/shell-navigation.md` update recording the
  design, mirroring the Phase 66 entry's shape.

## Constraints

- Do not touch `ShellControlKind`, the parser's `parseShellControlKind`, or
  any grammar. `themeSwitch` already exists; this phase makes it do what it
  was declared to do.
- Preserve every other shell control's rendering and behaviour exactly.
  `contextSelector`, `connectivity`, `syncStatus`, `logout`, and `pwaInstall`
  must render and behave identically to before this phase.
- Do not add a friendlier label field to `ResolvedTheme`. `titleCaseIdentifier`
  over the theme's declared `name` is the same fallback every other control
  already uses when a model supplies no explicit `LABEL`; a dedicated theme
  label is a separate, undemonstrated language change out of scope here.
- Do not invent a second device-local storage mechanism. Reuse the existing
  `localStorage` pattern and its `readStorageValue`/`writeStorageValue`
  helpers rather than adding an IndexedDB store or an app-declared preference
  object for a platform capability every app should get for free.
- This is UI-runtime/shell-chrome work per `AGENTS.md`'s implementation
  boundary: presentation state and device-local persistence, not a runtime
  service, policy decision, or sync-queued write.

## Deliverables

- `activeThemeName` state, `resolveActiveTheme`, the theme storage helpers,
  the `renderShellControl`/`renderThemeSwitch` branch, and the `handleChange`
  branch, all in `src/ui/components/adl-app.ts`.
- `.adl-theme-switch` CSS in `src/ui/styles.css`.
- `CONTROL themeSwitch KIND themeSwitch LABEL 'Theme' PLACEMENT topBar` in
  `src/reference/giggle-band/ui.adl`'s `SHELL` block and its `TOP_BAR
  CONTROLS` list.
- `tests/ui-theme-switch.test.ts`.
- A `docs/spec/runtime-semantics.md` correction.
- A `learnings/implementation/shell-navigation.md` update.

## Acceptance Criteria

- A model with no custom `THEME` block still renders a `themeSwitch` control
  listing all three built-in themes, with the app's declared `app.theme`
  selected initially.
- Choosing a different option applies that theme's tokens to the element
  immediately (`dataset.adlTheme` and the CSS custom properties change) and
  re-renders the `<select>` with the new choice marked `selected`.
- The choice is written to `localStorage` under `` `adl:${appName}:theme` ``.
- A fresh `model` assignment on the same or a differently-constructed element
  restores the persisted choice without any other signal, standing in for a
  page reload.
- A stored theme name that no longer matches any declared theme falls back to
  the app's declared default rather than resolving to nothing.
- `npm test` passes with the new cases; `npm run typecheck`, `npm run
  format:check`, and `npm run build` are clean; `npm run verify:push` is clean
  and its Playwright screenshots show the new `Theme` dropdown rendering
  correctly in the Giggle Band top bar on desktop and mobile, with the three
  built-in themes present and no layout regression on any other captured
  page.
- Every existing test and conformance case unrelated to this control is
  unmodified and still passes.

## Non-goals

- A friendlier per-theme display label distinct from the theme's declared
  `name`.
- Any change to `logout`, `contextSelector`, `connectivity`, `syncStatus`, or
  `pwaInstall` behaviour.
- Syncing a theme choice across a person's devices. This is deliberately
  device-local, the same as context-selection persistence.
- A next-phase handoff derived from this subsystem. See below.

## Dependencies

- `ShellControlKind`, `ResolvedShellControl`, `ResolvedApplicationModel.themes`,
  `ResolvedTheme`.
- `AdlAppElement`'s `activeThemeName` state, `resolveActiveTheme`,
  `renderShellControl`, `handleChange`, and the existing context-selection
  storage helpers it reuses.
- The Giggle Band reference app's `SHELL` block.
- `tests/ui-pwa-install.test.ts`'s `mountApp`/`requireElement` pattern, reused
  rather than reinvented for the new test file.

## Parallel Execution Plan

Small enough that a single pass costs less than coordinating a fan-out; this
phase was executed as a single pass. If it were parallelised:

**Serial spine first**: the `activeThemeName` state, `resolveActiveTheme`,
the storage helpers, the `renderShellControl`/`renderThemeSwitch` branch, and
the `handleChange` branch are all in one file (`src/ui/components/adl-app.ts`)
with each depending on the others' shape — one agent, one pass.

**Fan out** only after the spine compiles: the reference-app `SHELL`
declaration, the CSS, the test file, and the spec correction are four
independent files.

**Keep serial**: `src/ui/components/adl-app.ts` and
`src/reference/giggle-band/ui.adl`, since this repository's working tree may
be shared with a concurrent agent, per Phase 66's precedent of staging shared
files narrowly rather than via a wholesale `git add -A`.

Barriers: `npm test` once after the spine and fan-out land; `npm run
verify:push` exactly once, at the end, since this phase touches shell chrome.
No `npm run test:integration` — nothing here touches the authority server,
PostgreSQL, or the HTTP edge.

## Tasks

1. Read the existing `renderShellControl`, context-selection storage, and
   `findApplicationTheme`/`applyResolvedTheme` code in full and confirm
   exactly what was missing before changing anything.
2. Add `activeThemeName` state, `resolveActiveTheme`, `readPersistedThemeName`,
   `persistThemeSelection`, and `themeStorageKey` to `adl-app.ts`; update
   `applyThemeTokens` and `set model` to use them.
3. Add the `themeSwitch` branch to `renderShellControl` /
   `renderThemeSwitch`, and the `data-theme-switch="true"` branch to
   `handleChange`.
4. Add `.adl-theme-switch` to the shared CSS selector groups in
   `src/ui/styles.css`.
5. Wire `CONTROL themeSwitch KIND themeSwitch` into the Giggle Band `SHELL`
   block's `topBar` placement and `TOP_BAR CONTROLS` list.
6. Add `tests/ui-theme-switch.test.ts` covering listing, immediate
   application, persistence, restoration across a fresh `model` assignment,
   and fallback on a stale stored name.
7. Correct the stale shell-control capability paragraph in
   `docs/spec/runtime-semantics.md`.
8. Run `npm test`, `npm run typecheck`, `npm run format:check`, `npm run
   build`, and `npm run verify:push`; inspect the Playwright screenshots for
   the new `Theme` dropdown.
9. Write the `learnings/implementation/shell-navigation.md` update.
10. **Planning handoff.** Per `learnings/process/phase-execution.md`, a phase
    may not derive its successor from the subsystem it just touched, and the
    standing condition for resuming the rolling handoff — a second reference
    application in a different domain, or a stated capability target — is
    still not met by this phase alone. This phase closes exactly the one
    concrete feature the user named from real-world use (a theme *select*,
    because more than two themes can be declared). No repository-wide gap
    surfaced by writing it rises to the level Phase 46's rule requires, so no
    Phase 68 is written. The next phase, if there is one, again awaits the
    user naming a concrete feature or defect from real-world use.
11. Commit and push, after re-pulling to account for any concurrent agent
    sharing this working directory.

## Closing Note

This phase does not reopen the rolling handoff. It answers one named,
evidence-backed gap — a theme select control, demonstrated on ADL's own
reference app with its three built-in themes — and stops. See Task 10.
