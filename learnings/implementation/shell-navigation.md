# Shell Navigation Implementation

Read this before changing shell metadata, drawer navigation, top-bar controls,
or mobile business-context selection.

## Decisions From Phase 31

- Application shell metadata is top-level resolved model data on
  `ResolvedApplicationModel.shell`, not parser AST and not per-app browser
  branches.
- Resolver defaults create one nav item per resolved view, with derived labels,
  object-name groups, stable order, target-view active state, and `always`
  visibility.
- Auth and access remain runtime-policy concerns. Shell visibility can hide
  nav items or controls based on runtime context such as online state or
  business-context availability/selection, but it is not enforcement.
- The parser supports a global `SHELL` block with `NAV`, `CONTROL`, and
  `TOP_BAR` lines. The Giggle reference app uses this to declare Home, Gigs,
  Availability, Songs, Set Lists, and Bands labels without browser-specific
  branches.
- Browser drawer rendering consumes resolved shell nav metadata for labels,
  semantic icons, grouping, order, active state, and visibility.
- Top-bar context selection is a model-declared shell control. Mobile selector
  behavior defaults to `sheet`, rendering a compact selected-label trigger and
  modal sheet while preserving the desktop dropdown path.
- Optional shell controls include `contextSelector`, `syncStatus`,
  `themeSwitch`, `logout`, and `pwaInstall`. As of Phase 67 the current
  browser implements context selection, sync/online status, sign-out (Phase
  47), PWA installability (Phase 47's capture-and-prompt wiring, closed by
  Phase 66's `appinstalled` handling), and theme switching (Phase 67).
  Unavailable host capabilities degrade as disabled controls.

## Decisions From Phase 66

- **`pwaInstall` was already a modelled control kind and its
  capture-and-prompt wiring already existed, from Phase 47.** Before Phase 66,
  `adl-app.ts` already registered a `beforeinstallprompt` listener, called
  `preventDefault()` and stashed the event, rendered the control available
  exactly when a stashed event existed, and called `.prompt()` on click. Do
  not assume a shell control kind is unimplemented just because no reference
  app declares it yet — check the component before planning work to add it.
- **What Phase 66 actually closed**: no `appinstalled` listener existed at
  all, so a device that was already installed had no way to learn that fact
  and kept offering the control the same way an un-offered one looked. The
  click handler fired `.prompt()` without awaiting `userChoice`, so an
  accepted install produced no feedback and was indistinguishable from a
  dismissed one at the call site. Nothing detected a device already running
  installed at page load (`matchMedia("(display-mode: standalone)")` /
  `navigator.standalone`). The Giggle Band reference app declared no
  `pwaInstall` control, so the capability had no end-to-end reference-app
  proof, unlike every other implemented control kind.
- **`appInstalled` is set only by the `appinstalled` event, never by an
  accepted `userChoice`.** An accepted choice and a fired `appinstalled` event
  are not guaranteed to be the same signal across engines, and installation
  can happen entirely outside this control (the browser's own omnibox
  affordance). The browser's own event is the one source of truth for
  "installed."
- **`appInstalled` never un-sets.** Browsers do not fire an "uninstalled"
  event and there is no reliable signal that would make clearing it safe.
- **A captured `beforeinstallprompt` event must be cleared synchronously on
  click, before awaiting anything.** The event can only be prompted once; a
  second click in the same synchronous turn, before the first click's
  `await prompt()` resolves, must not call `prompt()` again on the same spent
  event. Clear `installPrompt` and re-render first, then await
  `prompt()`/`userChoice` in a separate async step.
- **No separate pure-logic module was needed to test this**, unlike
  `service-worker-policy.ts` (see `implementation/usable-sync-slice.md`). That
  split exists because a service worker runs in a different global scope with
  no DOM; `adl-app.ts` is a real `HTMLElement` already fully exercised by
  `happy-dom` (`tests/ui-authority-chrome.test.ts` and siblings), so
  dispatching a real `beforeinstallprompt`-shaped `Event` and an `appinstalled`
  `Event` at `window` and asserting on the rendered button, in
  `tests/ui-pwa-install.test.ts`, is the same technique those tests already
  use for `logout` and `connectivity`. Reaching for a pure-module split would
  have separated state (`installPrompt`, `appInstalled`) that belongs together
  for no testability gain.

## Decisions From Phase 67

- **`themeSwitch` was already a fully modelled control kind, parseable
  end to end, with no rendering behind it** — the same shape `pwaInstall` was
  in before Phase 66. Do not assume a shell control kind needs parser or
  model work just because no reference app declares it or no render branch
  exists yet; check `ShellControlKind`, `parseShellControlKind`, and
  `renderShellControl` before planning any of that as new work.
- **A theme select is a dropdown over `model.themes`, never a binary toggle.**
  `model.themes` always carries at least the three built-in base themes
  (`CorporateLight`, `CorporateDark`, `MinimalLight`) — `resolveThemes` in
  `src/compiler/resolve-model.ts` injects any built-in name the input did not
  already declare — so even a reference app with zero custom `THEME` blocks,
  like Giggle Band, has three options the moment it declares the control.
  A control that assumed exactly two themes would have been wrong from the
  first app to use it.
- **The active theme is mutable, persisted, device-local UI state, layered
  over — not written into — the model's static `app.theme`.** `app.theme` is
  resolved once, at build/model-resolution time, from the `APP ... THEME`
  directive, and stays the declared default for the app. `AdlAppElement`
  holds a separate `activeThemeName: string | undefined` override, `undefined`
  meaning "no device override yet, use the model's default." `resolveActiveTheme`
  is the one place that reconciles the two: override first, falling back to
  `findApplicationTheme(model)` when there is no override or when a stored
  override no longer names a theme the model still declares (a model change
  dropped or renamed it).
- **Reused the existing context-selection `localStorage` pattern rather than
  adding a new persistence mechanism.** `AdlAppElement` already had
  `readStorageValue`/`writeStorageValue` helpers and a
  `` `adl:${appName}:context:${contextName}` `` key convention for exactly
  this shape of state — a per-device UI selection that should survive a
  reload with no application-declared object needed. The theme override reuses
  those helpers under `` `adl:${appName}:theme` ``. This is a platform
  capability every app gets once it declares a `themeSwitch` control, not
  something each app must model as its own preference object the way Giggle
  Band's `OBJECT DevicePreference` models `SelectedBand`/`LastOpenedView`.
  Reach for that existing key-per-app-name `localStorage` convention before
  inventing IndexedDB storage or an app-declared object for any future
  platform-level device setting — `IndexedDbSyncStateStorage`
  (`src/runtime/sync-state-storage.ts`) is async and exists specifically for
  the sync queue and operation log, not a fit for one string a render method
  needs synchronously on every paint.
- **`activeThemeName` never un-sets itself**, the same reasoning Phase 66 gave
  for `appInstalled`: once a person has chosen a theme on a device, nothing
  this phase observes is evidence they want the app's default back. A stale
  override is corrected only by `resolveActiveTheme`'s fallback when the
  stored name no longer resolves, never by clearing the override eagerly.
- **No new `ResolvedTheme` label field was added.** Theme options are labelled
  with `titleCaseIdentifier` over the theme's declared `name`, the same
  fallback every other shell control already uses when no explicit `LABEL` is
  given. Giving themes a friendlier display name distinct from `name` is a
  separate, undemonstrated language change.
- **No separate pure-logic module was needed**, for the same reason Phase 66
  gives: `adl-app.ts` is a real `HTMLElement` fully exercised by `happy-dom`
  already, and the state that matters (`activeThemeName`, the rendered
  `<select>`, the theme actually applied) belongs together in one component.

## Practical Guidance

- Add new shell behavior to the resolved shell contract first, then render it
  from `adl-app`. Do not infer application-specific navigation labels in the
  browser.
- Keep shell visibility predicates deliberately small unless a runtime service
  is added to evaluate richer shell policy. UI hiding must never be treated as
  policy enforcement.
- Validate shell references in `validateApplicationModel` with `ADL_SHELL_*`
  diagnostics before runtime startup.
- Update inspect/explain output whenever shell defaults or reference-bearing
  fields change.
