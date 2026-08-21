# Shell Navigation Implementation

Read this before changing shell metadata, drawer navigation, top-bar controls,
or mobile business-context selection.

## Decisions From Phase 31

- Application shell metadata is top-level resolved model data on
  `ResolvedApplicationModel.shell`, not parser AST and not per-app browser
  branches.
- Phase 31 originally made the resolver create one nav item per resolved view.
  Phase 80 supersedes that default; see below. The derivation rules remain the
  opt-in behavior.
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
  `themeSwitch`, `logout`, `pwaInstall`, and — since Phase 99, see below —
  `commandAction`. As of Phase 67 the current
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

## Decisions From Phase 80

- **Navigation defaults to `explicitOnly`.** A `VIEW` declares a runtime
  surface, not a promise that the surface is a top-level user destination.
  Forms, child lists, lookup helpers, and alternate projections therefore no
  longer leak into the drawer merely by existing in the model.
- **The opt-in names the exceptional behavior:** `.adl` uses
  `NAV_MODE INCLUDE_UNLISTED_VIEWS`; `.adlj` uses
  `shell.nav.mode: "includeUnlistedViews"`. This is clearer at the call site
  than restating the default with an `EXPLICIT_ONLY` flag. The explicit enum
  value remains accepted so model values and printer round trips are closed.
- **Explicit entries win by view name.** In opt-in mode the resolver only
  derives items for views absent from `shell.nav.items`; it never merges over
  an author's label, icon, group, order, active-state list, or visibility.
- **An empty navigation model means no drawer chrome.** The browser hides the
  hamburger, overlay, and drawer when there are no visible nav items and no
  visible drawer controls. Drawer controls still keep the drawer reachable
  even when the nav item list itself is empty.
- **Reference applications inherit the curated default; exploratory fixtures
  opt in.** Giggle Band and Jointly Care already declare intentional nav items,
  so omission is meaningful. The generic browser demo explicitly requests
  generated entries because it is a platform exploration surface.
- **Inspect output includes `shell.nav.mode`.** The origin distinguishes an
  omitted platform default from a mode explicitly supplied by source, making
  this behavior diagnosable without reading resolver code.

## Key decisions from Phase 92: the top bar has three visual registers

- **A readout is not a control, and must not be shaped like one.** `Online` and
  `25 pending` are `<span class="adl-shell-status">` — correct, non-interactive
  markup — but the CSS gave them the same fill, border, radius and control
  height as the context selector beside them, so three visually identical chips
  sat in the bar and only one of them did anything. They are now dot + text with
  no box; interactive controls keep the chip; a disabled control gets an
  outlined, unfilled variant. Three registers, one glance.
- **Nothing checks that non-interactive markup *looks* non-interactive.**
  `tests/ui-runtime.test.ts` asserted the `<span>` and passed throughout. If
  affordance matters, it has to be looked at.
- **A translucent white overlay on a coloured bar is a contrast trap.**
  `rgba(255, 255, 255, 0.16)` over `#155eef` resolves to `#3a78f2`, where white
  text measures **4.08:1** — below WCAG AA, on every select, the context chip
  and every button in the bar. Darkening (`rgba(0, 0, 0, 0.18)`) instead of
  lightening keeps the same on-brand chip and takes white to **7.29:1**. Reach
  for a darker overlay, not a lighter one, whenever the backdrop is already
  mid-tone.
- **`button:disabled { opacity: 0.55 }` is calibrated for a light surface.** On
  the primary-coloured bar it pulled `Install`'s label to **2.03:1** against the
  bar while leaving it looking like a filled, pressable button — the worst of
  both. A disabled control in an inverted region needs its own treatment
  (drop the fill, keep the label at 4.7:1), not a blanket opacity.
- **`align-items: stretch` on mobile top-aligns a control's own label.** The
  mobile block stretches `.adl-context-selector` to full width so the control
  fills the row; that also stretched the `Band` label's box, leaving its 12px
  text floating above the chip it names. `align-self: center` on the label — a
  **direct-child** selector, so it never touches `.adl-context-single`'s or
  `.adl-context-compact`'s inner spans — fixes it.
- **An app-scoped copy of a base declaration silently kills its media-query
  override.** `.adl-topbar-app .adl-topbar-tools { justify-content: flex-end }`
  (0,2,0) beat the mobile block's `.adl-topbar-tools { justify-content:
  flex-start }` (0,1,0) — a media query adds no specificity of its own — so
  from Phase 28 to Phase 95 the mobile rule and the long comment above it were
  dead: the tools row was right-aligned on phones and `Install` wrapped alone
  onto a stranded right-aligned second row. The app-scoped copy set the
  *identical* value the base rule already set, so it changed nothing on desktop
  either; it existed only to break the override. **Phase 95 deleted it** and
  left a comment on the base rule saying not to re-scope it. When a base rule
  is overridden by source order inside `@media`, any descendant-scoped restating
  of the same property outranks the override — check for one before concluding a
  media-query rule is in effect.
- **The mobile top bar's context selector is not full width, despite the comment
  saying it is.** The flex child of `.adl-topbar-tools` is the unstyled
  `<adl-context-selector>` custom element; the mobile block's
  `.adl-context-selector { width: 100% }` targets a class on an element *inside*
  that host, so it never sizes the flex item. Measured at 141px (Giggle) /
  145px (Jointly) against a 369px row at 393px viewport. Open as of Phase 95.
- **`ui.adl` and `ui.adlj` have diverged.** `ui.adl:13-19` still places
  `themeSwitch` in the top bar; the real compiled source `ui.adlj` places it in
  the nav drawer and gives the top bar four controls, not five. The `.adl` files
  are superseded citation snapshots (their own trailing note says so), so cite
  them for line numbers but read the `.adlj` for what the app actually does.
- **A stale second copy of the shell cost real investigation time.** Phase 92
  read `ui.adl:13-19` as evidence that `themeSwitch` sat in the top bar; the
  real compiled source, `src/reference/giggle-band/ui.adlj`, had already moved
  it to the nav drawer. That `.adl` text was a snapshot frozen at model version
  1.0.0 and was deleted in Phase 98. Read `ui.adlj` for what the shell declares
  — it is the only place the shell is declared — and see
  `implementation/reference-app-drift.md` before ever keeping a second copy of
  a declaration on disk.

## Decisions From Phase 99 — `COMMAND_ACTION`, `EMPTY_STATE`, `UNAVAILABLE`

- **The shell gained the one control kind that is about the application.**
  `commandAction` runs a declared `COMMAND`, prompting for that command's own
  declared `INPUTS` through `<adl-command-form>`. Every other control kind
  (`contextSelector`, `syncStatus`, `connectivity`, `themeSwitch`, `logout`,
  `pwaInstall`) is about the device or the session; this one writes. That
  difference drives three rules:
  - It is **available**, never "unavailable" the way an unbacked host
    capability is: the command exists in the model, and whether the caller may
    run it is the runtime's answer, not the shell's.
  - It renders **only when an authority says somebody is signed in**, or when
    there is no authority at all. The signed-out identity is the non-empty
    placeholder `adl-signed-out`, so a bare `authenticated` create policy
    would *accept* a signed-out visitor's local write and the authority would
    then refuse to sync it.
  - It **decides nothing else**. `<adl-command-form>` collects values and
    dispatches them; `executeCommand` runs the preconditions and every step's
    policy check. UI is never the enforcement point.
- **Why it had to exist at all.** A presentation `ACTION`'s `input` is
  `Record<string, ResolvedExpression>` evaluated against a *row*, so it can
  only restate values that already exist somewhere. Nothing in the language
  could ask a person for a value, which made any command with a required
  free-text input unreachable from a browser — and left a person holding an
  identity and no membership with no affordance at all, because every
  context-scoped view renders its empty state for them.
- **`PLACEMENT EMPTY_STATE` has no region control list, and that is
  deliberate.** `topBar` and `navDrawer` each carry an ordered `CONTROLS` list
  because they are shared chrome whose ordering is a layout decision, and a
  control placed there but not listed silently never renders (the defect
  `validateShellRegionControls` exists to catch). The empty state is one
  message with, in practice, one way out of it, so order is declaration order
  and the renderer consumes `placement` directly.
- **`VISIBLE WHEN CONTEXT X UNAVAILABLE` is the mirror of `AVAILABLE`**, and
  the pair is what makes an onboarding surface self-removing: it appears for a
  person who can reach no instance of the context and takes itself away the
  moment they belong to one.
- **Landing the person inside what they made is half the feature.** After the
  command commits, `runShellCommand` re-reads `availableContexts` and selects
  the instance created by the step that declared `ESTABLISHES CONTEXT` — named
  by the command, never guessed. Without that they land back on the same empty
  state that offered them the control, and the only fix a person would find is
  a reload.
- **The shell must hold the form's draft.** `render()` rewrites the whole
  `innerHTML`, so `<adl-command-form>` is recreated rather than updated on
  every render and cannot keep anything itself. A refusal re-rendering with the
  person's answers wiped is the worst moment to lose them, so the submitted
  values live on the shell as `commandFormValues` and are handed back — exactly
  as record drafts already are.
- **`refreshFromRuntime` must go through `refreshRecords`.** It used to call
  `refreshPresentationView` directly for a composed view, skipping the context
  resolution and going straight to `requireActiveRuntimeContext()`. A signed-in
  person who is a member of no context therefore got `The active view does not
  have a runtime context.` as an *error banner* instead of the view's empty
  state. Unreachable before self-service registration, because every identity
  used to arrive holding a membership.

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
