# ADL App Shell File Map

Read this before changing the browser shell — before grepping
`src/ui/components/` for a render method, an event listener, or a piece of shell
state. Since Phase 89, `AdlAppElement` is a directory of shell-area files behind
a barrel, not a single 2,747-line file. This document says which file holds
which part of the shell, and the four structural rules that keep the arrangement
working.

See [[browser-ui-runtime]] for what the shell *decides* (its design rules, the
component contract, policy presentation); this document is only about where the
code lives. Same relationship as [[parser-grammar-file-map]] has to
[[adl-parser]], and [[compiler-model-layer-file-map]] to [[model-validator]].

## The shape

`src/ui/components/adl-app.ts` is now a 9-line barrel holding the entire public
surface — `AdlAppElement` and `defineAdlApp` — and nothing else. Every consumer
(`register.ts`, `main.ts`, and the six test files that mount `<adl-app>`)
imports that path unchanged.

The implementation is `src/ui/components/adl-app/`: eight class files forming a
linear chain, bottom to top.

## Which file holds what

| File | Class | Shell area |
|---|---|---|
| `state.ts` | `AdlAppStateElement` | **All 37 instance fields**, in original order. The `runtime` and `context` accessor pairs. Pure state operations: `setEditTarget`, `clearEditTarget`, `closeEditContainer`, `nextStagedChildSequence`, `requireActiveRuntimeContext`, `presentationStateKey`, `recordSyncState`. Runtime-context builders: `baseRuntimeContext`, `baseRuntimeContextWithoutSelected`, `withContextRoles`. The device-local storage layer: `contextStorageKey`, `themeStorageKey`, read/persist for context selection and theme, `readRouteContextId`, `resolveRequestedContextId`, `setSelectedContextId`. Declares `InstallPromptEvent`. |
| `model-lookup.ts` | `AdlAppModelLookupElement` | Everything derived from the resolved model with no DOM: `allViews`, `findView`, `findReadModel`, `findStartView`, `activeObject`/`activeView`/`activeReadModel`, `editObject`/`editFormView`/`activeEditContainer`, `applySelectedScopeToCreateValues`, the shell-visibility predicates (`visibleNavItems`, `hasNavigationDrawerContent`, `isShellControlVisible`, `isShellVisibilityVisible`, `placedShellControls`, `navigableContexts`), theme resolution (`resolveActiveTheme`, `applyThemeTokens`), `reportableReadModels`. |
| `render-chrome.ts` | `AdlAppChromeElement` | Shell chrome markup: top-bar controls, `renderShellControl`, the theme switch, context selectors, nav-drawer controls and the drawer itself, the authority and administration chrome. Owns `iconGlyph` and `groupNavItems`. |
| `render.ts` | `AdlAppRenderElement` | The page: `render` (the single `innerHTML` write plus every child-element property assignment after it), `renderLoading`, `renderCrudWorkspace`, `renderEditContainer`, `renderContainerCloseButton`. |
| `data.ts` | `AdlAppDataElement` | Everything that reads or drives the runtime: `refreshRecords`, `refreshRecordSyncState`, `refreshPresentationView`, `refreshEditSurface`, `applyPendingChildChanges`, `refreshAvailableContexts`, `resolveActiveViewContext`, `runCommand`, `deliverPendingWrites`, `refreshFromRuntime`, `runAuthorityAction`, `initialize`, `navigateToView`, `applyBrowserOnlineState`. |
| `events-shell.ts` | `AdlAppShellEventsElement` | Shell-level listeners: the 16 authority / administration / report handlers, the PWA install trio, the theme switch (`handleChange`, `handleThemeSwitch`), and `handleOnlineStateChange`. |
| `events-record.ts` | `AdlAppRecordEventsElement` | Record- and view-level listeners: search, select, new, draft, save, delete, cancel, transition, staged child operations, the delegated `handleClick`, `handleKeyDown`, context selection, and the five presentation handlers. |
| `index.ts` | `AdlAppElement` | The custom-element contract only: the `model` and `authority` accessor pairs, `whenReady`, `refreshAuthorityState`, `connectedCallback`, `disconnectedCallback`. |

## Rule 1: the files are a linear class chain, and order matters

Each file's class extends the one above it in that table —
`AdlAppModelLookupElement extends AdlAppStateElement`, … ,
`AdlAppElement extends AdlAppRecordEventsElement` — so that every
`this.render()` / `this.refreshRecords()` call inside a moved member body still
resolves, with no body edited during the split. The whole prototype chain
assembles into one object at runtime, exactly as the single class did, and
`customElements.define("adl-app", AdlAppElement)` registers the bottom-most
concrete class.

The cost is an ordering constraint: **a lower file cannot call a member defined
in a higher one.** TypeScript enforces this, so a violation is a `tsc` error,
not a silent bug. When you hit it, the fix is to move the shared member *down*
to a layer below both callers — never to add a back-edge or an `abstract`
declaration.

Four placements exist only because measurement forced them, each verified by
counting the upward edges the "natural" arrangement produces:

- **`runtime` and `context` live in `state.ts`, not with the other public
  members in `index.ts`** (19 upward edges otherwise — `render`, nine `data.ts`
  members and seven handlers all read `this.runtime`). `model` and `authority`
  *do* stay in `index.ts`, because every internal reader of those uses
  `this._model` / `this._authority` directly.
- **`runCommand`, `deliverPendingWrites` and `refreshFromRuntime` are a 3-cycle**
  (`runCommand → deliverPendingWrites → refreshFromRuntime → runCommand`) and
  must share `data.ts`. This is why the public `refreshFromRuntime` sits in a
  mid-chain class rather than in `index.ts`.
- **`events-shell.ts` sits *below* `events-record.ts`**, because the delegated
  `handleClick` dispatches to `handleSignOut` and `handleInstallClick`.
- **`render-chrome.ts` sits below `render.ts`**, because `render` composes the
  chrome and nothing in the chrome reaches back.

## Rule 2: field initialization order — the one that bites silently

**Every instance field lives in `state.ts`, in its original source order. Keep it
that way.**

In a class chain, base-class field initializers run to completion *before* any
derived-class initializer runs. `AdlAppElement` has no constructor and 37 field
initializers, one of which reads another field:

```ts
private _context: RuntimeContext = browserDemoContext;
// ... 23 lines later ...
protected useBrowserOnlineState = this._context.online === undefined;
```

Split those two across the chain with `_context` above and
`useBrowserOnlineState` would read `undefined`, silently, at construction —
`tsc` sees nothing wrong, and the shell would just stop tracking browser
online/offline state. Phase 88 never met this hazard because `AdlParser`'s
fields are all literals; a stateful DOM element is where it appears.

The 30 `readonly handleXxx = (event) => {…}` listener members are **fields, not
methods**, so the same rule governs them — but they are the exception that
proves it: nothing reads them during construction (`connectedCallback` runs
later), and their bodies call `runCommand`/`render`/`refreshRecords`, so they
*must* be in a derived class. That is safe precisely because an arrow-function
initializer reads nothing. If you ever add a listener field whose initializer
reads another field, that field belongs in `state.ts` with the rest.

Rule of thumb: **a field initializer that mentions `this.` pins that field to
the same class as everything it reads.** Audit for `this.` inside initializers
before moving any field.

## Rule 3: accessor pairs are indivisible

`model`, `runtime`, `context` and `authority` each have a `get`/`set` pair. A
getter and its setter **must be declared in the same class**. Split across the
chain, the derived half shadows the base half and the other accessor is silently
lost — with no `tsc` error, because the property still exists and still has the
right type. That constraint propagates: `set runtime` calls `clearEditTarget`
and `get context` calls `baseRuntimeContext`, so both of those had to come down
into `state.ts` too.

## Rule 4: visibility is mechanical

A member referenced from another area is `protected`; a member referenced only
within its own file stays `private`; a public member stays public. TypeScript
`private` in a base class is inaccessible from a derived class, so this is
enforced by `tsc`, not by taste.

After Phase 89 that is **9 public, 118 protected, 25 private**. The public nine
are the element's whole contract: the four accessor pairs, `whenReady`,
`refreshAuthorityState`, `refreshFromRuntime`, `connectedCallback`,
`disconnectedCallback`. Note the ratio: `protected` outnumbers `private` about
5:1 here, against roughly 1:1 in [[parser-grammar-file-map]] — a shell element's
members are far more interconnected than a recursive-descent parser's.

## Adding to the shell

- A new **render method** goes in `render-chrome.ts` if it produces chrome and
  in `render.ts` if `render` composes it directly; `private` unless another
  area calls it.
- A new **event listener** is a `readonly handleXxx = (event) => {…}` field in
  `events-shell.ts` or `events-record.ts`, and must be added to *both*
  `connectedCallback` and `disconnectedCallback` in `index.ts`.
- A new **piece of shell state** is a field in `state.ts`, in declaration order,
  with any storage helpers beside it.
- A new **runtime read** goes in `data.ts`.
- If a new member is needed by two areas, put it in the lowest file that is
  below both — not in the one that reads like its home.

## Verifying a shell change

`npm test` proves a lot, but the six UI test files assert on selected fragments,
not the whole page, and a rendering defect here is a *silently different DOM*,
not a thrown error. For any change that relocates or restructures shell code
rather than changing what it renders, use the differential technique Phase 89
built:

1. `git worktree add` at the pre-change commit.
2. In both trees, run a throwaway vitest driver (never commit it — see
   `AGENTS.md`) that mounts `<adl-app>` against **both** reference demos
   (`band-app.ts`, `jointly-app.ts`), navigates to **every view the model
   declares** by injecting a `[data-view-nav]` button and clicking it, and at
   each view also exercises drawer open/close, theme switch, new-record,
   `Escape`, row selection and edit-container close. Record `innerHTML`,
   `textContent` and the element's inline `style` (the theme custom properties)
   at every step.
3. Diff the two JSON dumps.

**Pin two entropy sources, not one.** Record guids come from
`crypto.randomUUID`; `adl-field-renderer.ts` mints its `<label for>` / `<input
id>` pair with `Math.random().toString(36)`. Pinning only the first makes 32% of
inputs differ from themselves run to run, which reads exactly like a real
regression. Phase 89 lost a cycle to this.

For Phase 89 that was 119 recorded DOM states over 35 declared views across the
two demos, and the two 2.4 MB dumps were byte-identical.

## Trap: identifier scanners and template literals

If you script a change over this code (Phase 89 did, and so should any future
relocation), the scanner that finds `this.<member>` references must strip
**comments only** — not string and template contents, and it must treat a
template's `${…}` substitutions as *code*. This file is almost entirely HTML
template literals, and the real `this.renderXxx()` calls live inside backticks;
a scanner that blanks templates under-detects cross-area calls and emits files
that fail to compile. This is the same trap [[parser-grammar-file-map]] records,
and it is strictly worse here.

There is also no `noUnusedLocals` in `tsconfig.json`, so an over-broad computed
import list typechecks cleanly while leaving junk imports behind. Re-scan each
emitted file for unused imports explicitly.

## Related

- [[browser-ui-runtime]] — what the shell decides, and the component contract.
- [[shell-navigation]] — `SHELL`, nav items, controls, drawer semantics; the
  model side of `render-chrome.ts`.
- [[context-ui-navigation]] — context selectors and view navigation; the
  behaviour behind `state.ts`'s selection layer and `data.ts`'s
  `resolveActiveViewContext`.
- [[theme-system]] — the tokens `applyThemeTokens` writes.
- [[parser-grammar-file-map]] — the same navigation aid for the parser, split by
  Phase 88 with the same chain strategy but without the field-initialization
  hazard (its class holds only literal-initialized fields).
- [[compiler-model-layer-file-map]] — Phase 81's flat-directory variant, for
  pure functions with no shared state.
- [[visual-browser-verification]] — the Playwright pass that must still run
  before any shell change is pushed.
