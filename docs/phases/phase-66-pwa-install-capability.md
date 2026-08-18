# Phase 66 - PWA Install Capability

> **Why this phase exists at all, after Phase 65 closed with no handoff.**
> `learnings/process/phase-execution.md` records that the rolling handoff
> stopped at Phase 64, and Phase 65 answered one named, evidence-backed gap
> from real-world use of a sibling application (`giggle-new`) without reopening
> it. This phase is the same shape again: `giggle-new` needs "install this app
> to the home screen" as a product feature, and ADL's own reference app should
> demonstrate the capability as something the platform provides, not something
> each application reinvents. It is the user naming a concrete feature after
> real-world use, not a gap derived from re-reading this subsystem's own code.
> It does not reopen the rolling handoff, and it does not license deriving a
> Phase 67 from the code either — see the Planning Handoff below.

## Objective

Make "install this app to the home screen / desktop" a genuinely working,
cross-app platform capability of the ADL UI runtime: capture the browser's
install offer, act on it from the model-declared `pwaInstall` shell control,
and reflect installed state back into the control — demonstrated end to end on
ADL's own Giggle Band reference app.

## Evidence and Dependency

Checked against the code while writing this document, because the task
framing this phase started from assumed a specific starting point that turned
out to be only half right.

- **`pwaInstall` was already a fully modelled shell control kind before this
  phase**, not new surface this phase had to add. `ShellControlKind`
  (`src/model/resolved-model.ts:100`) already included `"pwaInstall"`, the
  parser already accepted `KIND PWA_INSTALL` / `KIND pwaInstall`
  (`src/parser/parser.ts:3889-3891`), and both were unconditional — not stubs
  gated behind a flag.
- **The capture-and-prompt wiring already existed too, landed in Phase 47
  (`e076c46`), not invented here.** Before this phase, `adl-app.ts` already:
  registered `globalThis.addEventListener("beforeinstallprompt",
  this.handleInstallPrompt)` in `connectedCallback` (and removed it in
  `disconnectedCallback`); `handleInstallPrompt` called `event.preventDefault()`
  and stashed the event as `this.installPrompt`; `renderShellControl` computed
  `action = "install"` exactly when `control.kind === "pwaInstall" &&
  this.installPrompt !== undefined`, rendering the control as a normal
  available/unavailable button; and the click handler called
  `this.installPrompt?.prompt()` then cleared the stashed reference. This is
  substantially more than the task's framing anticipated finding, and the
  first task of this phase was confirming that in the code rather than
  assuming the framing's premise.
- **What was genuinely missing, verified by `grep -rn "appinstalled"
  src/`returning nothing:** no listener for the `appinstalled` event at all,
  so a device that had already installed the app — whether through this
  control on a previous visit or through the browser's own install affordance
  — had no way to learn that fact this session. The control's only source of
  "available" was `installPrompt !== undefined`; once that was cleared by a
  click, the control looked exactly as unavailable as it did before any offer
  was ever made, with the same generic title. Nothing distinguished "not
  offered yet" from "already installed."
- **The click handler did not await the outcome.** `void
  this.installPrompt?.prompt()` fired the prompt and moved on; nothing read
  `event.userChoice`, so an accepted install produced no feedback and a
  dismissed one was indistinguishable from an accepted one at the call site.
  The `InstallPromptEvent` interface declared only `prompt(): Promise<unknown>`
  — no `userChoice` — so there was nothing to await even if the call site had
  wanted to.
- **No detection of a device already running installed at page load.**
  Nothing read `matchMedia("(display-mode: standalone)")` or
  `navigator.standalone`, so a returning user who had installed on a prior
  visit would see an "Install" control offered again if a `beforeinstallprompt`
  ever fired for them (some engines still fire it for an already-installed
  context in edge cases), or would simply see the generic "not available"
  title rather than "already installed" if it did not.
- **The Giggle Band reference app declared no `pwaInstall` control at all.**
  `src/reference/giggle-band/ui.adl`'s `SHELL` block had `contextSelector`,
  `connectivity`, and `syncStatus` controls in `topBar` and `logout` in
  `navDrawer`, but nothing exercised `pwaInstall` end to end. The generic
  capability had no reference-app proof, unlike every other shell control kind
  the browser implements.
- **No tests existed for any of this.** `grep -rln
  "installPrompt\|beforeinstallprompt\|pwaInstall" tests/` returned nothing.
  The Phase 47 capture-and-prompt wiring had shipped and been running in every
  build since without a single test exercising it.
- **No separate pure-logic module was needed to make this testable**, unlike
  `service-worker-policy.ts`. That module exists because the service worker
  runs in a different global scope with no DOM at all, so its rules had to be
  extracted to be unit-testable outside a real worker. `adl-app.ts` is a
  `HTMLElement` already fully exercised by `happy-dom` in
  `tests/ui-authority-chrome.test.ts` and siblings — dispatching a real
  `beforeinstallprompt`-shaped `Event` at `window` and asserting on the
  rendered button is the same technique those tests already use for `logout`
  and `connectivity`. Reaching for a pure-module split here would have split
  state that belongs together (`installPrompt`, `appInstalled`) across two
  files for no testability gain.

This phase depends on `ShellControlKind`, `AdlAppElement.handleInstallPrompt`,
`renderShellControl`, `isShellControlVisible`, the parser's
`parseShellControlKind`, and the Giggle Band reference app's `SHELL` block.

## The Decision

Extend the existing Phase 47 wiring rather than replace it:

- Add `appInstalled` as component state, set by a new `appinstalled` window
  listener (mirroring the existing `beforeinstallprompt` listener's lifecycle)
  and initialised at `connectedCallback` from `matchMedia("(display-mode:
  standalone)")` or `navigator.standalone`, read defensively since neither
  exists in every environment.
- `handleInstallPrompt` now ignores a `beforeinstallprompt` event once
  `appInstalled` is true, so an already-installed device never re-offers the
  control.
- The click handler stashes-and-clears the prompt event synchronously (so a
  second click in the same turn cannot call `prompt()` again on a spent
  event), then asynchronously awaits `prompt()` and `userChoice`, surfacing a
  success message on `"accepted"` and nothing on `"dismissed"`. `appInstalled`
  itself is set only by the `appinstalled` event, not by the accepted choice
  here — the browser's own event is the one source of truth for "installed",
  because an accepted `userChoice` and a fired `appinstalled` event are not
  guaranteed to be the same signal across engines, and because installation
  can also happen entirely outside this control.
- `renderShellControl` gains a `pwaInstall`-specific unavailable title —
  "This app is already installed." — distinct from the generic "not available
  in this runtime" reason, so the two states this phase now distinguishes are
  visibly distinct, not just internally distinct.
- `installApp KIND pwaInstall LABEL 'Install' PLACEMENT topBar` is added to
  the Giggle Band `SHELL` block, in `topBar`'s `CONTROLS` list alongside
  `contextSelector`, `connection`, and `syncStatus` — the exact placement
  pattern those controls already use.

No new declarative surface. `ShellControlKind` already had `pwaInstall`; this
phase is runtime behaviour and one reference-app declaration, not language
work.

## Scope

- `appinstalled` event capture, `appInstalled` component state, and its
  interaction with `handleInstallPrompt` (ignore an offer once installed).
- Already-installed detection at connect time via `matchMedia` /
  `navigator.standalone`.
- Awaiting `prompt()`'s `userChoice` and surfacing acceptance as a UI message,
  consistent with how other completed actions in this component report
  success.
- A distinct "already installed" unavailable reason on the `pwaInstall`
  control, alongside the existing generic unavailable reason.
- Wiring `pwaInstall` into the Giggle Band reference app's `SHELL` block.
- Unit tests exercising all of the above through real DOM events against a
  mounted `AdlAppElement` in `happy-dom`.
- A `docs/spec/runtime-semantics.md` correction: its shell-control paragraph
  described `pwaInstall` (and, imprecisely, `logout`) as "declared and
  inspected" but rendering unavailable, which was already stale for `logout`
  and is now clearly stale for `pwaInstall`.

## Constraints

- Do not touch the service worker, the web app manifest, or their tests. This
  phase is the shell control's install-offer handling, not the offline shell.
- Do not add a new `ShellControlKind` or new parser syntax. `pwaInstall`
  already exists; this phase makes it do what it was declared to do.
- Preserve every other shell control's rendering and behaviour exactly.
  `logout`, `contextSelector`, `connectivity`, and `syncStatus` must render
  and behave identically to before this phase.
- `appInstalled` must never be cleared once set. Browsers do not fire an
  "uninstalled" event, and there is no reliable signal that would make
  clearing it safe.
- The click handler must not call `prompt()` more than once on the same
  captured event, including two clicks in the same synchronous turn.
- This is UI-runtime/shell-chrome work per `AGENTS.md`'s implementation
  boundary: the browser reacts to what the host user agent offers and reports
  back to model-declared state; it invents no new policy and enforces nothing
  a runtime service should be enforcing instead.

## Deliverables

- `appinstalled` capture, already-installed detection, awaited `userChoice`
  handling, and the distinct unavailable reason, all in
  `src/ui/components/adl-app.ts`.
- `installApp KIND pwaInstall LABEL 'Install' PLACEMENT topBar` in
  `src/reference/giggle-band/ui.adl`'s `SHELL` block and its `TOP_BAR
  CONTROLS` list.
- `tests/ui-pwa-install.test.ts`: capture-and-offer, at-most-once prompting,
  accepted/dismissed outcomes, `appinstalled` reflection, ignoring a stale
  offer once installed, and already-installed-at-connect detection.
- A `docs/spec/runtime-semantics.md` correction to the shell-control
  capability paragraph.
- A `learnings/implementation/shell-navigation.md` update recording the
  design and what Phase 47 had already shipped versus what this phase closed.

## Acceptance Criteria

- A `beforeinstallprompt` event dispatched at `window` has its default
  prevented, is stashed, and makes the `pwaInstall` control's button
  available with `data-shell-action="install"` — proven without any user
  agent beyond `happy-dom`.
- Clicking the available control calls the stashed event's `prompt()` exactly
  once even under a double-click in the same turn, and the control returns to
  unavailable immediately.
- An accepted `userChoice` surfaces a success message; a dismissed one does
  not.
- Dispatching `appinstalled` disables the control with the title "This app is
  already installed.", and a `beforeinstallprompt` dispatched afterward is
  ignored — the control stays disabled with the same installed-specific
  title.
- A component that starts with `matchMedia("(display-mode: standalone)")`
  reporting `true` renders the control already disabled with the
  installed-specific title, with no `beforeinstallprompt` needed.
- `npm test` passes with the new cases; `npm run typecheck`, `npm run
  format:check`, and `npm run build` are clean; `npm run verify:push` is clean
  and its Playwright screenshots show the new `Install` control rendering
  correctly in the Giggle Band top bar on desktop and mobile, with no layout
  regression on any other captured page.
- Every existing test and conformance case unrelated to this control is
  unmodified and still passes.

## Non-goals

- The service worker, web app manifest, or offline shell caching. Untouched.
- A new `ShellControlKind` or new `SHELL`/`CONTROL` parser syntax.
- Any change to `logout`, `contextSelector`, `connectivity`, or `syncStatus`
  behaviour.
- Telemetry or analytics on install acceptance/dismissal beyond the existing
  UI message convention.
- A next-phase handoff derived from this subsystem. See below.

## Dependencies

- `ShellControlKind`, `ResolvedShellControl`.
- `AdlAppElement`'s `installPrompt`/`appInstalled` state,
  `handleInstallPrompt`, `renderShellControl`, `isShellControlVisible`.
- The Giggle Band reference app's `SHELL` block.
- `tests/ui-authority-chrome.test.ts`'s `mountApp`/`requireElement` pattern,
  reused rather than reinvented for the new test file.

## Parallel Execution Plan

Small enough that a single pass costs less than coordinating a fan-out; this
phase was executed as a single pass. If it were parallelised:

**Serial spine first**: the `appInstalled` state, `handleInstallPrompt`
change, `handleAppInstalled`, the click-handler rewrite, and the
`renderShellControl` unavailable-title branch are all in one file
(`src/ui/components/adl-app.ts`) with each depending on the others' shape —
one agent, one pass.

**Fan out** only after the spine compiles: the reference-app `SHELL`
declaration, the test file, and the spec correction are three independent
files.

**Keep serial**: `src/ui/components/adl-app.ts` and
`src/reference/giggle-band/ui.adl` — this repository's working tree was shared
with a concurrent agent adding `RevokeBandInvitation` to the same `ui.adl`
file during this phase's execution, so the `SHELL` block edit was staged and
verified narrowly rather than committed as part of a wholesale `git add -A`.

Barriers: `npm test` once after the spine and fan-out land; `npm run
verify:push` exactly once, at the end, since this phase touches shell chrome.
No `npm run test:integration` — nothing here touches the authority server,
PostgreSQL, or the HTTP edge.

## Tasks

1. Read the existing `beforeinstallprompt`/`pwaInstall` wiring in full and
   confirm exactly what Phase 47 already shipped versus what was missing,
   before changing anything.
2. Add `appInstalled` state, the `appinstalled` listener, already-installed
   detection at connect, and the ignore-once-installed guard in
   `handleInstallPrompt`.
3. Rewrite the click handler to stash-and-clear synchronously, then await
   `prompt()`/`userChoice` and surface acceptance as a UI message.
4. Add the `pwaInstall`-specific unavailable title in `renderShellControl`.
5. Wire `installApp KIND pwaInstall` into the Giggle Band `SHELL` block's
   `topBar` placement and `TOP_BAR CONTROLS` list.
6. Add `tests/ui-pwa-install.test.ts` covering capture, at-most-once
   prompting, accepted/dismissed outcomes, `appinstalled` reflection,
   post-install offer suppression, and already-installed-at-connect.
7. Correct the stale shell-control capability paragraph in
   `docs/spec/runtime-semantics.md`.
8. Run `npm test`, `npm run typecheck`, `npm run format:check`, `npm run
   build`, and `npm run verify:push`; inspect the Playwright screenshots for
   the new `Install` control.
9. Write the `learnings/implementation/shell-navigation.md` update.
10. **Planning handoff.** Per `learnings/process/phase-execution.md`, a phase
    may not derive its successor from the subsystem it just touched, and the
    standing condition for resuming the rolling handoff — a second reference
    application in a different domain, or a stated capability target — is
    still not met by this phase alone. This phase closes exactly the one
    concrete feature the user named from real-world use (`giggle-new` needing
    installability). No repository-wide gap surfaced by writing it rises to
    the level Phase 46's rule requires, so no Phase 67 is written. The next
    phase, if there is one, again awaits the user naming a concrete feature or
    defect from real-world use.
11. Commit and push, after re-pulling to account for the concurrent agent
    sharing this working directory.

## Closing Note

This phase does not reopen the rolling handoff. It answers one named,
evidence-backed gap — `giggle-new` needing installability, demonstrated on
ADL's own reference app — and stops. See Task 10.
