# Phase 89 — `AdlAppElement` Shell-Area Decomposition

> Phase 88's Planning Handoff named this file by name: "**Highest value next**:
> `src/ui/components/adl-app.ts`'s `AdlAppElement` and
> `src/runtime/presentation-runtime.ts`'s `PresentationRuntime` … These are the
> last two files in the repository whose names carry no signal about their
> contents." This phase claims the first of the two, using the linear
> class-chain strategy Phase 88 established. `presentation-runtime.ts` is
> claimed separately as Phase 90.
>
> Per `learnings/process/phase-execution.md`'s standing rule for
> user-commissioned decomposition work (the same condition that authorised
> Phases 69–73, 81 and 88), this inherits Phase 88's justification rather than
> re-arguing it.

## Objective

Split `src/ui/components/adl-app.ts`'s 152-member `AdlAppElement` class into a
directory of shell-area files, with **zero behavioural change and zero
consumer-visible API change**. Every existing import of
`./components/adl-app.js` continues to resolve to the same two exports
(`AdlAppElement`, `defineAdlApp`).

`adl-app.ts` is 2,747 lines. It is the browser shell: it owns the model, the
runtime, the selected view, the selected record, the edit surface, business
context selection, theme selection, the authority chrome, every DOM event
listener the app registers, and the single `innerHTML = \`…\`` render that
produces the whole page. A task touching one of those — "the theme dropdown is
unreadable", "the mobile top bar stacks", "the drawer shows a control twice" —
currently costs reading or grepping a 2,747-line file to find the 30–80
relevant lines. This is a navigability change for both human and LLM readers,
exactly as Phases 81 and 88 were; it is not a performance change.

## Evidence and Dependency

Measured against `main` at `9066e01` (Phase 88's commit) with a clean working
tree. Re-verify before executing; line numbers drift.

- `src/ui/components/adl-app.ts` — 2,747 lines. Structure is three parts:
  - lines 1–114: value and type imports (88 imported names across 15
    specifiers), plus two module-private interfaces (`InstallPromptEvent`,
    `ActiveViewContextState`).
  - lines 116–2,600: `export class AdlAppElement extends HTMLElement` —
    **152 distinct members / 156 declaration spans** (the 4 extra spans are the
    second half of the `model`/`runtime`/`context`/`authority` accessor pairs).
    That is 37 plain instance fields, 30 `readonly` arrow-function listener
    fields, 4 accessor pairs, and 81 methods/getters.
  - lines 2,602–2,747: `defineAdlApp` plus **13 module-private helpers**
    (`collapsesStagedChildOperation`, `failNoObjects`, `failNoViews`,
    `browserPersistenceAvailable`, `getBrowserOnlineState`,
    `isRunningAsInstalledPwa`, `addBrowserOnlineListeners`,
    `removeBrowserOnlineListeners`, `groupNavItems`, `iconGlyph`,
    `readStorageValue`, `writeStorageValue`, `cloneGroups`).
- **The complete external surface of `adl-app.ts` is two names**:
  `AdlAppElement` and `defineAdlApp`. Consumers are
  `src/ui/components/register.ts` (`defineAdlApp`), `src/ui/main.ts`
  (`import type { AdlAppElement }`), and 6 test files
  (`tests/ui-runtime.test.ts`, `tests/band-reference-app.test.ts`,
  `tests/ui-child-collection.test.ts`, `tests/ui-authority-chrome.test.ts`,
  `tests/ui-pwa-install.test.ts`, `tests/ui-theme-switch.test.ts`, plus
  `tests/edit-surface-runtime.test.ts` as a type-only import). `src/index.ts`
  does **not** re-export anything from `src/ui/components/`, so the two names
  are the whole contract.
- **The class's internal call graph, grouped into the 8 shell areas named in
  the Decision below, is a directed acyclic graph.** This was measured, not
  assumed: every `this.<member>` reference in every member body and doc-comment-
  free declaration was extracted and mapped to its area, and the area graph was
  checked for upward edges. Three boundary placements are *forced* by measured
  cycles (see "Why the areas are shaped this way").
- Of the 152 members, **118 are referenced from a different area** (so must
  become `protected`), **25 are referenced only within their own file** (so stay
  `private`), and **9 are public** (`model`, `runtime`, `context`, `authority`,
  `whenReady`, `refreshAuthorityState`, `refreshFromRuntime`,
  `connectedCallback`, `disconnectedCallback`). No two members share a name, so
  no base/derived shadowing arises.
- **Field initialization order is a live hazard here in a way it was not for
  `parser.ts`.** `AdlAppElement` has 37 plain instance fields and no
  constructor, and one initializer reads another field:
  `private useBrowserOnlineState = this._context.online === undefined;` reads
  `_context`, declared 23 lines above it. In a class chain, base-class field
  initializers run to completion before any derived-class initializer runs, so
  splitting those two across the chain would silently evaluate `this._context`
  as `undefined` — a runtime behaviour change `tsc` cannot see. A full audit of
  all 37 initializers found exactly this one cross-field read; every other
  initializer is a literal, a `new Map()`, `Promise.resolve()`, or absent.
- **The 30 `readonly handleXxx = (event) => {…}` listener members are fields,
  not methods**, so the same ordering rule applies to them. Nothing reads them
  during construction (`connectedCallback` runs later), so they are free to sit
  in a derived class — which they must, since their bodies call `runCommand`,
  `refreshRecords`, `render` and the like.
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax` on, but **not**
  `noUnusedLocals` — a slightly over-broad computed import list will not fail
  `npm run typecheck`, so per-file imports must be computed precisely and
  checked.
- Baseline for the fast suite is **60 test files, 1,084 tests**, with 6 of them
  mounting `<adl-app>` in jsdom/happy-dom against a real reference model.

## Non-goals

Named, not attempted:

- **`src/runtime/presentation-runtime.ts`'s `PresentationRuntime`** — the other
  file Phase 88 named. Claimed as Phase 90, executed in parallel with this one.
- **`src/runtime/object-store.ts`'s `ObjectStore`** and its helper tail.
- **`src/conformance/runner.ts`**, split by concern.
- **Large test file splitting** (`tests/runtime.test.ts` 3,020 lines,
  `tests/model-validation.test.ts` 3,004, `tests/band-reference-app.test.ts`
  2,379, `tests/ui-child-collection.test.ts` 2,194).
- **The `this.innerHTML = \`…\`` full-re-render pattern** across every custom
  element — the repository's real runtime-performance question, unaffected by
  any file decomposition and needing a profiling-first phase of its own.
- **Any change to what the shell renders, when it renders, or what it listens
  to.** This phase is a relocation.

## Decision

### Strategy: a linear class chain of shell-area files, behind the existing barrel

`AdlAppElement` keeps genuinely shared `this`-based instance state (37 fields
plus 30 listener closures). The decomposition therefore moves member
declarations **verbatim** into a chain of classes, one per file, each extending
the previous:

```
src/ui/components/adl-app.ts             <- barrel: AdlAppElement + defineAdlApp
src/ui/components/adl-app/state.ts           class AdlAppStateElement extends HTMLElement
src/ui/components/adl-app/model-lookup.ts    class AdlAppModelLookupElement extends AdlAppStateElement
src/ui/components/adl-app/render-chrome.ts   class AdlAppChromeElement extends AdlAppModelLookupElement
src/ui/components/adl-app/render.ts          class AdlAppRenderElement extends AdlAppChromeElement
src/ui/components/adl-app/data.ts            class AdlAppDataElement extends AdlAppRenderElement
src/ui/components/adl-app/events-shell.ts    class AdlAppShellEventsElement extends AdlAppDataElement
src/ui/components/adl-app/events-record.ts   class AdlAppRecordEventsElement extends AdlAppShellEventsElement
src/ui/components/adl-app/index.ts           class AdlAppElement extends AdlAppRecordEventsElement
```

This is the load-bearing decision, chosen for the same reason Phase 88 chose it:

- **No call site inside the class changes.** `this.render()` still resolves to
  the same method; the assembled prototype chain carries all 152 members. The
  alternative — free functions taking the element as a parameter — would have
  required rewriting roughly 1,000 `this.` references.
- **No member body is edited at all.** The only permitted per-member change is
  the visibility keyword (`private` → `protected` for the 118 cross-area
  members). Bodies move byte-for-byte, doc comments included.
- **No consumer changes.** `adl-app.ts` remains a real module at its current
  path, now holding only the two public names.
- **`customElements.define("adl-app", AdlAppElement)` still registers the
  bottom-most concrete class**, which is the one the barrel imports.

The cost is an ordering constraint: a base class cannot call a method declared
only in a derived class. The measured DAG means no `abstract` declarations are
needed — but a future change that adds a call from a lower area to a higher one
will get a `tsc` error, and the fix is to move the shared member *down* a layer,
never to add a back-edge.

### Directory name

`src/ui/components/adl-app/`, taken literally from Phase 81's convention ("`X.ts`
becomes a barrel over a directory of domain files"). Unlike Phase 88 — where
`src/parser/parser/` would have been redundant — the literal reading reads
correctly here, so no deviation is needed.

### The 8 shell areas, in chain order (base first)

Sizes are the emitted file's total lines, imports and comments included.

| # | File | Class | Lines | Holds |
|---|---|---|---|---|
| 1 | `state.ts` | `AdlAppStateElement` | 422 | **All 37 instance fields, in their original source order** — model, runtime, context, view/record selection, draft values, messages, staged child changes, authority/sync/PWA/theme state. Plus the `runtime` and `context` accessor pairs; the pure state operations (`setEditTarget`, `clearEditTarget`, `closeEditContainer`, `nextStagedChildSequence`, `requireActiveRuntimeContext`, `presentationStateKey`, `recordSyncState`); the runtime-context builders (`baseRuntimeContext`, `baseRuntimeContextWithoutSelected`, `withContextRoles`); and the whole device-local storage layer (`contextStorageKey`, `themeStorageKey`, `read`/`persist` for both context selection and theme, `readRouteContextId`, `resolveRequestedContextId`, `setSelectedContextId`). Owns `InstallPromptEvent`, `browserPersistenceAvailable`, `cloneGroups`, `readStorageValue`, `writeStorageValue`. |
| 2 | `model-lookup.ts` | `AdlAppModelLookupElement` | 237 | Everything derived from the resolved model without touching the DOM: `allViews`, `findView`, `findReadModel`, `findStartView`, `activeObject`/`activeView`/`activeReadModel`, `editObject`/`editFormView`/`activeEditContainer`, `applySelectedScopeToCreateValues`, the shell-visibility predicates (`visibleNavItems`, `hasNavigationDrawerContent`, `isShellControlVisible`, `isShellVisibilityVisible`, `placedShellControls`, `navigableContexts`), and theme resolution (`resolveActiveTheme`, `applyThemeTokens`, `reportableReadModels`). Owns `failNoObjects`, `failNoViews`. |
| 3 | `render-chrome.ts` | `AdlAppChromeElement` | 349 | The shell chrome markup: `renderTopBarControls`, `renderShellControl`, `renderThemeSwitch`, `renderContextSelectors`, `renderNavDrawerControls`, `renderNavigationDrawer`, `renderAuthorityChrome`, `renderAdministrationChrome`. Owns `iconGlyph`, `groupNavItems`. |
| 4 | `render.ts` | `AdlAppRenderElement` | 277 | The page itself: `render` (the single `innerHTML` write and every child-element property assignment that follows it), `renderLoading`, `renderCrudWorkspace`, `renderEditContainer`, `renderContainerCloseButton`. |
| 5 | `data.ts` | `AdlAppDataElement` | 462 | Everything that reads or drives the runtime: `refreshRecords`, `refreshRecordSyncState`, `refreshPresentationView`, `refreshEditSurface`, `applyPendingChildChanges`, `refreshAvailableContexts`, `resolveActiveViewContext`, `runCommand`, `deliverPendingWrites`, `refreshFromRuntime`, `runAuthorityAction`, `initialize`, `navigateToView`, `applyBrowserOnlineState`. Owns `ActiveViewContextState`, `getBrowserOnlineState`. |
| 6 | `events-shell.ts` | `AdlAppShellEventsElement` | 302 | The shell-level listeners: all 16 authority/administration/report handlers, the PWA install trio (`handleInstallPrompt`, `handleAppInstalled`, `handleInstallClick`, `runInstallPrompt`), `handleThemeSwitch`/`handleChange`, and `handleOnlineStateChange`. |
| 7 | `events-record.ts` | `AdlAppRecordEventsElement` | 544 | The record- and view-level listeners: `handleSearch`, `handleSelect`, `handleNew`, `handleDraft`, `handleSave`, `handleDelete`, `handleCancel`, `handleTransition`, `handleStageChildOperation`, `handleClick`, `handleKeyDown`, `handleContextSelection`, and the five presentation handlers plus `openCreateFromPresentationAction`. Owns `collapsesStagedChildOperation`. |
| 8 | `index.ts` | `AdlAppElement` | 193 | The custom-element contract only: the `model` and `authority` accessor pairs, `whenReady`, `refreshAuthorityState`, `connectedCallback`, `disconnectedCallback`. Owns `isRunningAsInstalledPwa`, `addBrowserOnlineListeners`, `removeBrowserOnlineListeners`. |

Largest resulting file is `events-record.ts` at 544 lines (under the ~600-line
target and well under Phase 81's ~1,200-line ceiling); the median is 325, against
2,747 before.

### Why the areas are shaped this way

Four placements are forced by measurement, not chosen. Each was verified by
re-running the area-graph check with the "natural" placement and counting the
upward edges it produces:

1. **`runtime` and `context` must be in `state.ts`, not with the public surface
   in `index.ts`.** Grouping all four accessor pairs as "the element's public
   API" produces **19 upward edges** — `render`, nine `data.ts` members, six
   `events-record.ts` handlers and `events-shell.ts`'s
   `handleDiscardRefusedRecord` all read `this.runtime`, and the last also reads
   `this.context`. The `model` and `authority` pairs have no such callers (every
   internal reader uses `this._model` / `this._authority` directly), so those two
   pairs *do* stay in `index.ts`. A getter and its setter must be declared in the
   same class, so this also drags `clearEditTarget` (called by `set runtime`) and
   `baseRuntimeContext` (called by `get context`) down into `state.ts`.
2. **`runCommand`, `deliverPendingWrites` and `refreshFromRuntime` are a
   3-cycle and must share a file.** `runCommand → deliverPendingWrites →
   refreshFromRuntime → runCommand`. Putting the public `refreshFromRuntime`
   with the other public members in `index.ts` produces 2 upward edges. All
   three therefore live in `data.ts`, and `refreshFromRuntime` is a `public`
   member of a mid-chain class — the direct analogue of Phase 88's public
   `parseStandaloneExpression` living in `expression.ts`.
3. **`events-shell.ts` must sit *below* `events-record.ts`.** `handleClick` is
   the shell's single delegated click listener and dispatches to
   `handleSignOut` and `handleInstallClick`; swapping the two event layers
   produces exactly those 2 upward edges. This is why the authority/PWA handlers
   are the lower layer even though they are conceptually "shell chrome" and the
   record handlers are "content".
4. **`render-chrome.ts` must be below `render.ts`.** `render` composes
   `renderTopBarControls`, `renderNavigationDrawer`, `renderAuthorityChrome`;
   nothing in the chrome file reaches back into `render`. Splitting the render
   layer in two at that seam is what keeps both files under 350 lines.

Everything else follows the shell's own layering: state → derived model queries
→ markup → runtime I/O → event handlers → element contract.

### The barrel

`src/ui/components/adl-app.ts` becomes, in full: a re-export of `AdlAppElement`
from `./adl-app/index.js`, a value import of the same, and `defineAdlApp`
verbatim. It is a small real module rather than a one-line `export *` because
`defineAdlApp` needs the constructor value.

## Scope

1. Create `src/ui/components/adl-app/` with the 8 files above.
2. Reduce `src/ui/components/adl-app.ts` to the barrel.
3. No other file in the repository is edited.

## Constraints

- **No behavioural change of any kind.** No rendered DOM differs. No listener is
  registered or removed differently. No storage key changes.
- **Member declarations move verbatim.** The only permitted per-member edit is
  `private` → `protected` for the 118 members called across an area boundary. If
  a body appears to need any other change to compile, stop and report: that
  means the area assignment is wrong, not that the body needs editing.
- **Every instance field stays in one class, in original source order**, so no
  field initializer can be reordered relative to a field it reads.
- **Each `get`/`set` pair stays in one class.** Splitting a pair across the chain
  silently loses one half with no `tsc` error.
- **No new `abstract` declarations.** Needing one means a back-edge was
  introduced.
- **Zero test file changes.** If a test needs to change to keep passing, that is
  evidence of an accidental behaviour change and must be fixed in the split.
- No new npm dependency.

## Deliverables

- `src/ui/components/adl-app/` fully populated; `src/ui/components/adl-app.ts`
  reduced to the barrel.
- A **rendered-output differential** (see Testing) proving byte-identical DOM
  before and after, across every view of both reference demos.
- `npx tsc --noEmit`, `npm test`, `npm run format:check` clean, with zero test
  file changes.
- `learnings/implementation/adl-app-file-map.md` recording the area map, the
  chain-ordering rule, the **field-initialization-order rule** (new knowledge
  Phase 88 did not have), the accessor-pair rule, the visibility rule, and the
  rendered-output differential recipe.
- `learnings/index.md` pointed at it, and
  `learnings/implementation/browser-ui-runtime.md` updated to say where the
  shell now lives.

## Acceptance Criteria

- `npx tsc --noEmit` passes with no new `any`, no suppressed errors, no changed
  `tsconfig.json`.
- `npm test` passes at **60 files / 1,084 tests** with **zero test file
  changes**.
- The rendered-output differential reports **zero differences**.
- `git diff --stat` shows exactly one modified file
  (`src/ui/components/adl-app.ts`) plus 8 new files under
  `src/ui/components/adl-app/`, and no other file modified.
- No file in `src/ui/components/adl-app/` exceeds 600 lines.
- Every one of the 152 members appears exactly once across the new files,
  verified mechanically against the pre-change tree, not by eye.
- No emitted file carries an unused import (there is no `noUnusedLocals` to
  catch one).

## Testing

The ordinary suite is necessary but not sufficient. A rendering defect here is a
*silently different DOM*, not a thrown error, and the 6 UI test files assert on
selected fragments rather than the whole page. The phase's correctness proof is
therefore a differential DOM dump:

1. **Baseline.** A `git worktree` at the pre-change commit.
2. **Driver.** A throwaway vitest file (never committed, per `AGENTS.md`) that,
   in a DOM environment, mounts `<adl-app>` against **both** reference demos
   (`src/reference/band-app.ts`, `src/reference/jointly-app.ts`), and for each:
   opens and closes the nav drawer through the real click handler, switches
   theme through the real `change` handler, then navigates to **every view the
   model declares** by injecting a `[data-view-nav]` button and clicking it —
   the same path the drawer uses — and at each view additionally exercises
   "new record", `Escape`, row selection and the edit-container close button
   when those affordances are present. Each step records `innerHTML`,
   `textContent` and the element's inline `style` (the theme custom properties).
3. **Determinism.** Record guids (`crypto.randomUUID`) and
   `adl-field-renderer.ts`'s DOM input ids (`Math.random`) are environmental
   noise, not rendering behaviour; both are pinned to counters in the driver so
   the dump is a function of the code under test only.
4. **After.** Run the identical driver against the split tree; compare the two
   JSON dumps byte-for-byte. Any difference at all is a defect in the split.
5. `npx tsc --noEmit` after **each** area file is emitted, not only at the end.
6. A **member census**: assert mechanically that each of the 152 members' full
   declaration span — doc comment included — appears verbatim in exactly its
   assigned file, modulo the visibility keyword, compared against the
   *pre-change* tree.
7. `npm run test:integration` is not expected to be required: this phase touches
   no server, PostgreSQL, or I/O boundary.
8. `npm run verify:push` once, at the end of the integration of this phase and
   Phase 90 together — not per phase, because both touch rendering and
   Playwright is the slowest, most manual step.

## Dependencies

- `src/ui/components/adl-app.ts` (the target).
- `src/ui/components/register.ts`, `src/ui/main.ts` (read-only reference
  confirming the barrel contract).
- Every module `adl-app.ts` imports (unmodified; the relative import paths gain
  one `../` level inside the new directory).

## Parallel Execution Plan

**Do not fan out within this phase.** As in Phase 88, the split is a single
ordered chain: every area file depends on the one below it, so there is no
independent stream to give an agent. Drive it with small Python
extraction/generation scripts (member boundaries, area assignment, area-graph
cycle check, per-file import computation, emit, typecheck, iterate), which gives
exact reproducible control over declaration order and import wiring.

The genuinely parallel work is *between* phases: this phase and Phase 90
(`presentation-runtime.ts`) touch disjoint files and were executed concurrently
in separate worktrees, with `npm run verify:push` run exactly once after both
were integrated.

The one parallelisable step inside the phase is the differential baseline:
generating the pre-change DOM dump in the baseline worktree is independent of
the split and can run while the extraction scripts are being written.

## Tasks

1. Re-verify the Evidence section against current code: line count, member
   count, the two-name public surface, the field-initializer audit, and the DAG.
2. Build the extraction script; assert the member split reproduces the original
   class body byte-for-byte before relying on it.
3. Assign areas; run the area-graph cycle check; fix any upward edge by moving
   the shared member *down*, never by adding a back-edge.
4. Emit the 8 files in chain order, typechecking after each.
5. Reduce `src/ui/components/adl-app.ts` to the barrel.
6. Run the member census and the rendered-output differential.
7. Full verification: `npx tsc --noEmit`, `npm test`, `npm run format:check`.
8. Write `learnings/implementation/adl-app-file-map.md`; point `learnings/index.md`
   at it; add the "where the code is" pointer to
   `learnings/implementation/browser-ui-runtime.md`.
9. Planning handoff looking past both Phase 89 and Phase 90.
10. Commit.

## Planning Handoff

With `parser.ts` (88), `adl-app.ts` (89) and `presentation-runtime.ts` (90) done,
the "files whose names carry no signal about their contents" list that Phases 81
and 88 were working through is empty for source files. Remaining candidates,
none claimed here, in the order they look most valuable **repository-wide**:

- **Highest value next: `src/runtime/object-store.ts`'s `ObjectStore`.** It is
  the last large stateful class in the runtime, it is on the write path for
  every phase that touches persistence, sync verdicts or constraints, and it now
  has two worked precedents for exactly this shape of split. Unlike 88–90 it
  carries real backend behaviour, so it needs `npm run test:integration` at the
  barrier rather than only the fast suite — which is why it is a phase of its
  own rather than a fourth parallel stream.
- **The repo-wide one-line-per-file purpose map** the expert panel recommended
  alongside decomposition (~4–5K tokens, documentation-only). Cheap, separable,
  and now more useful than before: three formerly opaque files became 40-odd
  named ones, and a map is what turns that into navigation rather than a longer
  directory listing.
- **The four oversized test files** (`tests/runtime.test.ts` 3,020 lines,
  `tests/model-validation.test.ts` 3,004, `tests/band-reference-app.test.ts`
  2,379, `tests/ui-child-collection.test.ts` 2,194). Mechanical and safe — a test
  file split is proved by the suite still reporting the same test count — but
  lower value than `object-store.ts` because test files are read by search far
  more often than they are edited wholesale.
- **`src/conformance/runner.ts`**, split by concern. Safe, mechanical, lowest
  value of the four as test-support code.
- **Profiling-first, unrelated to decomposition**: the
  `this.innerHTML = \`…\`` full-re-render pattern across `src/ui/components/`.
  Phases 89 and 90 make this *easier* to attack — `render.ts` is now 277 lines
  and the single write is the only thing in it — but it remains a behaviour
  change needing measurement first, not a relocation.

## Execution Note

Executed in full against `main` at `9066e01`, in one session, in an isolated
worktree, driven by Python extraction/generation scripts exactly as the Parallel
Execution Plan directed — no sub-agent fan-out, since the chain gives no
independent stream.

**Re-verification findings (Task 1).** All Evidence held. The member count is
**152 distinct members across 156 declaration spans** (this document originally
estimated "~150 members"; the four-span discrepancy is the accessor pairs, and
is now stated precisely above). The field-initializer audit found exactly one
cross-field read (`useBrowserOnlineState` → `_context`), as predicted. The
two-name public surface held exactly.

**The DAG held on the first attempt — zero upward edges.** That is a weaker
claim than it sounds, because the eight areas were chosen *after* reading the
call graph, not before: the four forced placements recorded above were each
discovered by proposing the natural arrangement, measuring the upward edges it
produced (19, 2, 2 and 0 respectively), and moving the shared member down. The
`naive.py` counter-examples are kept in the phase record because "it was a DAG"
is only meaningful alongside "here is what was not".

**One thing the plan under-specified, resolved during execution.** The
rendered-output differential's first run produced 38 differing keys out of 119.
All 38 were the same thing: `adl-field-renderer.ts` line 141 mints its `<label
for>` / `<input id>` pair with `Math.random().toString(36)`, so any dump
containing an open edit form differs from itself run to run. `crypto.randomUUID`
had already been pinned for record guids; `Math.random` had not. Pinning both
made the dumps byte-identical. Worth recording as the generalisable point: **a
DOM differential over this shell needs *two* entropy sources pinned, not one**,
and the failure presents as a real-looking 32%-of-inputs diff.

**Verification results:**

- `npx tsc --noEmit` — clean, first attempt, with no member body edited.
- `npm test` (`npx vitest run`) — **60 test files, 1,084 tests, all passing**,
  with **zero test file changes**. Identical to the pre-change baseline.
- **Rendered-output differential (the phase's real correctness proof)** — a
  throwaway vitest driver (never committed; deleted from both trees before the
  commit) ran in a `git worktree` at pre-split `9066e01` and again against the
  split tree, over **119 recorded DOM states**: both reference demos, all **35
  declared views** (20 Giggle Band + 15 Jointly Care), plus drawer open/close,
  theme switch, new-record, `Escape`, row selection and edit-container close at
  every view that offers them. The two 2.4 MB JSON dumps — `innerHTML`,
  `textContent` and the inline theme custom properties for every state — are
  **byte-identical** (`md5 32cc73c1ac9ca94a0fb18cf3f606f1c9` both sides).
- **Member census** — all **156/156** declaration spans, doc comments included,
  verified present verbatim (modulo the visibility keyword) in exactly their
  assigned file, checked against the read-only pre-change worktree rather than
  against the extractor's own memory of the input. The member split was
  separately proved to reproduce the original class body byte-for-byte before
  anything relied on it.
- **Import hygiene** — every emitted file was re-scanned after Prettier and
  carries **zero unused imports**, which `tsc` would not have caught since
  `noUnusedLocals` is off.
- `npm run format:check` — clean after one `prettier --write` pass over the new
  directory and the barrel.
- `git diff --stat` — exactly one modified file (`src/ui/components/adl-app.ts`,
  +2 −2,740) plus 8 new files under `src/ui/components/adl-app/`. No other file
  touched, no test file touched.
- File sizes — largest is `events-record.ts` at 544 lines, then `data.ts` at 462
  and `state.ts` at 422; median 325. Every file is under the 600-line target,
  against 2,747 before.

**Visibility census:** 9 public, 118 protected, 25 private. The 9 public members
are the element's whole contract: the `model`/`runtime`/`context`/`authority`
accessor pairs, `whenReady`, `refreshAuthorityState`, `refreshFromRuntime`,
`connectedCallback` and `disconnectedCallback`. `protected` outnumbers `private`
about 5:1 here, against roughly 1:1 in Phase 88 — a shell element's members are
far more interconnected than a recursive-descent parser's, which is the honest
measure of how much the chain strategy is doing.

**Named, not claimed:** the scanner used to compute cross-area references
classifies template-literal `${…}` substitutions as code and the surrounding
literal text as string, which is what Phase 88's learnings demanded. That was
validated indirectly — `tsc` is clean and no import is unused, both of which a
mis-scanned template would break — rather than by an independent test of the
scanner itself. `npm run build` and `npm run verify:push` were deliberately
**not** run in this worktree; they belong to the integration step that covers
this phase and Phase 90 together.
