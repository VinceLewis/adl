# Phase 86 — Giggle Band Reference App Favicon

> Commissioned directly by the user: give the Giggle Band ADL reference app
> its own browser-tab icon, sourced from the real Giggle Band product's own
> favicon asset at `/home/vince/projects/personal/giggle-new/static/icon.svg`,
> instead of every reference app sharing the generic ADL mark. Per
> `learnings/process/phase-execution.md`'s standing rule for user-commissioned
> phases, this does not need to justify itself as the next item in a rolling
> handoff.
>
> This document is intentionally tiny: one new static asset, one new optional
> field on an existing interface, one new call in `main.ts` alongside the
> `document.title` line it already sets per demo.

## Objective

The browser tab for the Giggle Band reference app (both `?demo=band` and
`?demo=giggle-band` — see Evidence, they share identical seeded content and
differ only in `app.name` branding) should show Giggle Band's own icon, not
the generic ADL mark every other reference app (Jointly Care, the plain
`?demo=` picker with no demo selected) keeps using.

## Evidence and Dependency

Re-verify against current code before executing.

- **No favicon exists in `index.html` today.** `index.html` has no
  `<link rel="icon">` at all; only `<link rel="manifest"
  href="/manifest.webmanifest">`, whose one icon entry is
  `public/adl-icon.svg` (a generic blue "ADL" wordmark), used for PWA install,
  not the browser tab.
- **`document.title` is the existing precedent for per-demo metadata**:
  `src/ui/main.ts`'s `mountReferenceDemo()` sets
  `document.title = model.app.name;` right after resolving the model
  (`main.ts`, in `mountReferenceDemo`). A favicon swap belongs at the exact
  same call site, the same way.
- **`ReferenceDemoDefinition`** (`src/reference/reference-demo.ts`) is the one
  registration point every reference app's per-demo data flows through
  (`databaseName`, `createModel`, etc.) — `src/ui/main.ts` never branches on
  a specific demo id. Add the icon there as a new optional field, not as a
  special case in `main.ts`.
- **`band` and `giggle-band` are the same app's content under two ids**:
  `src/reference/band-app.ts`'s own comment above `bandReferenceDemo`/
  `giggleBandExampleDemo` (~line 584): "`band` and `giggle-band` are two demo
  ids over the identical seeded schema: `createGiggleBandExampleModel` only
  renames `app.name` on top of `createBandReferenceModel`'s model... both
  definitions deliberately share the same seed function." Both demo
  definitions get the new icon field; Jointly Care
  (`src/reference/jointly-app.ts`) and any future reference app do not.
- **Source asset**: `/home/vince/projects/personal/giggle-new/static/icon.svg`
  — a small, clean SVG (100×100 viewBox, purple circle with a white smile
  glyph), the real Giggle Band product's own icon. Prefer this over that
  directory's `favicon.ico`/`icon-192.png`/`icon-512.png`: this repo's own
  existing icon (`public/adl-icon.svg`) is already SVG-only, so matching that
  convention (one scalable source, no raster fallback) is more consistent
  than introducing a `.ico`/PNG pair for only one reference app.
- **No test today exercises `main.ts`'s `mountReferenceDemo` directly** (it
  is a private, unexported function; `tests/ui-runtime.test.ts` and friends
  construct `<adl-app>` directly and never go through `main.ts`). The
  favicon-per-demo behavior should be proven the same way `document.title`
  would be — through a real browser loading the real demo URL — not by
  exporting `mountReferenceDemo` purely to unit-test it. Playwright's
  `tests/visual/giggle-band.visual.spec.ts` and
  `tests/visual/jointly-care.visual.spec.ts` already load these apps'
  real URLs; add a `link[rel="icon"]` href assertion to each rather than
  inventing a new test file or a new exported seam.

## Decision

1. Add `public/giggle-band-icon.svg`, copied byte-for-byte from
   `/home/vince/projects/personal/giggle-new/static/icon.svg` — no
   recoloring or resizing; it is already a valid, small, scalable favicon.
2. Add `<link rel="icon" href="/adl-icon.svg" id="adl-app-favicon">` to
   `index.html`'s `<head>`, as the default every reference app gets absent a
   more specific icon (this also gives the generic `?demo=`-less shell and
   Jointly Care an actual favicon for the first time, where today they have
   none — a strict improvement, not a behavior change worth a separate
   phase).
3. Add an optional `iconUrl?: string` field to `ReferenceDemoDefinition`
   (`src/reference/reference-demo.ts`), documented alongside `databaseName`.
4. Set `iconUrl: "/giggle-band-icon.svg"` on both `bandReferenceDemo` and
   `giggleBandExampleDemo` in `src/reference/band-app.ts`. Leave
   `jointlyReferenceDemo` (`src/reference/jointly-app.ts`) without the field
   — it keeps the default `/adl-icon.svg` already in `index.html`.
5. In `src/ui/main.ts`'s `mountReferenceDemo()`, immediately after
   `document.title = model.app.name;`, look up `#adl-app-favicon` and set its
   `href` to `demo.iconUrl ?? "/adl-icon.svg"` (explicit fallback so a future
   demo that doesn't set `iconUrl` still ends up with the same default
   `index.html` already has, rather than depending on `index.html` never
   changing).

## Scope

- New file `public/giggle-band-icon.svg`.
- `index.html`: one new `<link rel="icon">` tag.
- `src/reference/reference-demo.ts`: one new optional field on
  `ReferenceDemoDefinition`.
- `src/reference/band-app.ts`: `iconUrl` set on both Giggle Band demo
  definitions.
- `src/ui/main.ts`: one new line in `mountReferenceDemo()`.
- `tests/visual/giggle-band.visual.spec.ts`: assert the favicon link's href
  resolves to `/giggle-band-icon.svg` after loading the real demo page.
- `tests/visual/jointly-care.visual.spec.ts`: assert the favicon link's href
  still resolves to `/adl-icon.svg` (proves the default path is untouched by
  this change).

## Constraints

- Do not touch `manifest.webmanifest` or PWA install icons — this phase is
  the browser-tab favicon only. A per-app install icon is a larger change
  (a real manifest is a single static file today, not swappable per demo the
  way a `<link>` href is) and is out of scope.
- Do not recolor, resize, or otherwise edit the copied SVG — use it exactly
  as the real Giggle Band product ships it.
- Do not change `document.title`'s existing behavior or its call site beyond
  adding the adjacent favicon line.
- Do not add `iconUrl` to `jointlyReferenceDemo` or invent one for it — no
  source asset was supplied for Jointly Care, and this phase is scoped to
  Giggle Band only.

## Deliverables

- `public/giggle-band-icon.svg`.
- Updated `index.html`, `reference-demo.ts`, `band-app.ts`, `main.ts`.
- Updated Playwright assertions in both visual specs listed above.

## Acceptance Criteria

- Loading `?demo=giggle-band` or `?demo=band` in a real browser shows
  Giggle Band's icon (purple circle, white smile) as the tab favicon, not
  the generic ADL mark.
- Loading `?demo=jointly-care` (or whatever Jointly Care's id is — confirm
  at execution time) still shows the generic `/adl-icon.svg` favicon,
  unchanged from before this phase (there was none before; now there is one,
  the same default every non-Giggle-Band demo gets).
- `npm run typecheck`, `npm test`, and `npm run format:check` pass.
- `npm run verify:push` passes.

## Testing

- `npm test` — no unit test changes needed (see Evidence: this is
  deliberately proven only through the real-browser path).
- `npm run verify:push` — includes the two updated Playwright specs; inspect
  that the favicon assertions pass and nothing else regresses.

## Non-goals

- PWA install icon / `manifest.webmanifest` changes (Constraints, above).
- A generic "every reference app can bring its own favicon" content-authoring
  surface in `.adlj`/the language itself — `iconUrl` on
  `ReferenceDemoDefinition` is reference-app scaffolding (like
  `databaseName`), not a language feature.
- Redesigning or updating Jointly Care's branding — it keeps the default icon
  it already effectively had none of.

## Dependencies

- `src/ui/main.ts` (`mountReferenceDemo`).
- `src/reference/reference-demo.ts` (`ReferenceDemoDefinition`).
- `src/reference/band-app.ts` (`bandReferenceDemo`, `giggleBandExampleDemo`).
- `src/reference/jointly-app.ts` (read-only reference — confirms the default
  path stays correct for a demo with no `iconUrl`).
- `index.html`.
- `tests/visual/giggle-band.visual.spec.ts`,
  `tests/visual/jointly-care.visual.spec.ts`.

## Tasks

1. Re-verify the evidence above against current code (in particular, confirm
   `index.html`'s current `<head>` contents and `mountReferenceDemo`'s exact
   current shape haven't moved since this document was written).
2. Copy `/home/vince/projects/personal/giggle-new/static/icon.svg` to
   `public/giggle-band-icon.svg` unmodified.
3. Add the default `<link rel="icon">` to `index.html`.
4. Add `iconUrl?: string` to `ReferenceDemoDefinition`.
5. Set `iconUrl` on both Giggle Band demo definitions in `band-app.ts`.
6. Add the favicon-href line to `mountReferenceDemo()` in `main.ts`.
7. Update both Playwright specs with the favicon-href assertion.
8. Run `npm test`, `npm run typecheck`, `npm run format:check`.
9. Run `npm run verify:push`; inspect results.
10. Commit and push.

## Planning Handoff

- None — standalone, user-commissioned asset/copy fix with no follow-on work
  implied. The next phase is still whatever the highest-value
  repository-wide gap is; re-derive it at that time (Phase 84, startup
  failure recovery UI, remains queued and not yet executed as of this
  writing — see that document).

## Closing Note

Executed as scoped. `public/giggle-band-icon.svg` was copied byte-for-byte
from `/home/vince/projects/personal/giggle-new/static/icon.svg` (verified
with `diff`). `index.html` gained the default
`<link rel="icon" href="/adl-icon.svg" id="adl-app-favicon">`.
`ReferenceDemoDefinition` gained an optional `iconUrl?: string`, documented
alongside `databaseName`. Both `bandReferenceDemo` and
`giggleBandExampleDemo` in `src/reference/band-app.ts` set
`iconUrl: "/giggle-band-icon.svg"`; `jointlyReferenceDemo` was left
untouched. `mountReferenceDemo()` in `src/ui/main.ts` gained one guarded
lookup/`setAttribute` call immediately after `document.title = model.app.name;`.

Both Playwright specs were updated in place inside their existing real-browser
"opens and migrates a persisted..." tests (no new test file, no new exported
seam), asserting `link#adl-app-favicon`'s `href` resolves to
`/giggle-band-icon.svg` for Giggle Band and stays `/adl-icon.svg` for Jointly
Care.

`npm run typecheck`, `npm run format:check`, `npm test` (1069 tests), and
`npm run verify:push` (build + all 54 Playwright specs, including both
updated favicon assertions) all passed clean; the persisted-upgrade
screenshots for both apps were inspected and show no regression.

One execution note for future phases: this session's execution overlapped
with another in-progress session that was mid-flight on Phase 84 (startup
failure recovery UI) and held uncommitted changes to `src/ui/main.ts`,
`src/ui/components/register.ts`, `src/ui/styles.css`,
`playwright.config.ts`, and a learnings file. This phase's one required edit
to `main.ts` was applied as a minimal, targeted insertion on top of that
session's in-progress content, and `main.ts` was deliberately excluded from
this phase's commit to avoid shipping another session's unfinished,
unattributed work. Partway through this phase's execution, that other
session completed and committed its own work independently as `38de3c0`
("Add startup failure recovery UI (Phase 84)"), which absorbed its portion of
`main.ts`'s changes under its own commit. At the time this phase's commit was
made, `src/ui/main.ts`'s only remaining working-tree diff was this phase's
own one-line favicon addition — safe to commit on its own merit, but left
uncommitted anyway per this phase's brief; a trivial follow-up commit can
fold it in.
