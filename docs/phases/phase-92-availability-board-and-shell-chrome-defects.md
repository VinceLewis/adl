# Phase 92 — Availability Board Wording and Shell Chrome Affordances

A batch of presentation defects observed in the running Giggle Band demo on a
mobile viewport: a misleading section heading, a legend that costs more than
it explains, and three shell top-bar affordance problems. Small individually;
grouped because they share one verification pass (`verify:push` screenshots)
and because splitting them would mean running that pass four times.

## Objective

Correct the wording and chrome defects listed below, with the reference-app
changes made in `.adlj` and the chrome changes made once in shared shell code
so both reference apps benefit.

## Evidence and Dependency

Observed from a mobile-viewport screenshot of the Giggle Band demo, then
traced to source. Each item below cites what was actually read.

**1. `Who is free` is a roster, not a filter.**
`src/reference/giggle-band/ui.adl:324` heads the section `Who is free`, but
the list beneath it (`TeamAvailabilityList`, `FROM READ_MODEL
BandMemberAvailability`) carries no filter, so it renders every member's
availability including `Unavailable` rows. This is deliberate — the source
comment at `ui.adl:283` describes it as the view's "whole-band roster" — so
the list is correct and only the heading overclaims.

**2. The legend is placed away from what it explains, and its title is
visually indistinguishable from an item.**
`ui.adl:322` declares `LEGEND MyScheduleLegend TITLE 'My schedule'` at *view*
level. `src/ui/components/adl-composed-view.ts:207-225` renders
`renderLegends()` once, above every section — so a legend describing the
calendar in the second section necessarily renders above the first section,
separated from it by the entire availability list. Separately,
`adl-composed-view.ts:244` emits the title as a bare `<div>` inside the same
`display: flex; flex-wrap: wrap; gap: var(--adl-space-sm)` container as the
items (`src/ui/styles.css:900`), so the title-to-first-item gap is identical
to the item-to-item gap and the reader cannot tell which label each swatch
binds to. That container is also `role="list"` with a non-`listitem` child,
which is invalid ARIA.

**Decision taken:** the legend is not worth keeping on this view. Each status
already carries both a distinct colour *and* a distinct icon (`ICON calendar`
vs `ICON x`, `ui.adl:310-312`) plus an `ARIA_LABEL`, so the encoding is not
colour-only and the legend is redundant. Removing it resolves the placement,
the title ambiguity and the ARIA defect at once, without touching
`adl-composed-view.ts`.

**Executing agent — confirm before acting:** this decision removes a legend
rather than fixing its rendering. The rendering defects at
`adl-composed-view.ts:244` and `styles.css:900` remain latent for any *other*
view that declares a `LEGEND`. Check whether any other view in either
reference app declares one; if so, say so and propose whether the rendering
fix should be done here anyway or deferred to its own phase.

**3. Status chips are styled as buttons.**
`ui.adl:13-19` places five top-bar controls: `contextSelector`,
`connectivity`, `syncStatus`, `themeSwitch`, `pwaInstall`. In the rendered
bar, `The Alphas` (an interactive selector) and `Online` / `25 pending` (pure
status readouts) present as three visually identical chips.
`src/ui/components/adl-app/render-chrome.ts:165-174` renders `syncStatus` as a
`<span class="adl-shell-status">` — so the markup is already correctly
non-interactive and the defect is purely that the CSS gives it button
affordance.

**4. `Install` has weak contrast** — light blue on the blue top bar.

**5. The `Band` label is small and vertically misaligned** against the chip
row it labels.

**Dependency:** items 3-5 touch `src/ui/components/adl-app/render-chrome.ts`,
which Phase 89 created, and `src/ui/styles.css`. Phase 89 must be merged
first. Item 1's and 2's changes are confined to
`src/reference/giggle-band/ui.adlj`.

## Decision

### Wording

- Section heading `Who is free` → `Availability`.
- **Open decision for the executing agent:** `ui.adl:11` gives the *nav* item
  for this same view the label `Who is free`, and `ui.adl:5` already gives a
  different view (`MyAvailabilityList`) the nav label `Availability`.
  Renaming the nav label to `Availability` would produce two identical nav
  entries. Recommendation: leave the nav label distinct — `Band Availability`
  for the board, keeping `Availability` for the member's own list — and apply
  `Availability` only to the section heading. Do not create a duplicate nav
  label; if you deviate from the recommendation, justify it.

### Legend

Remove `LEGEND MyScheduleLegend` from `BandMemberAvailabilityBoard`. Leave the
`STATUS` declarations themselves untouched — they still drive the calendar's
colours, icons and ARIA labels.

### Chrome

Give non-interactive top-bar readouts a visually distinct, non-button
treatment; raise `Install` to an accessible contrast ratio against the top-bar
background; align the context-selector label with its control. These are CSS
changes in `src/ui/styles.css` wherever possible — reach into
`render-chrome.ts` only if the markup genuinely cannot carry the distinction.

## Scope

- `src/reference/giggle-band/ui.adlj` — heading, nav label, legend removal.
- `src/ui/styles.css` — chrome affordance, contrast, alignment.
- `src/ui/components/adl-app/render-chrome.ts` — only if markup must change.
- Test and snapshot updates that follow from the above.

## Non-goals

- The read-model lookup display defect — that is Phase 91.
- Any change to Jointly Care's model. Shared CSS changes will affect its
  screenshots; that is expected and must be inspected, not suppressed.
- Redesigning the top bar. These are targeted corrections.

## Constraints

- **`.adlj` is the authoring surface.** Edit `src/reference/giggle-band/ui.adlj`
  and compile-check it. `ui.adl` and `domain.adl` are superseded citation
  references whose line numbers are cited across `docs/` and `learnings/` —
  **do not edit them**, per the note at the end of each file. This phase
  document cites `ui.adl` line numbers for the same reason.
- Any ADL source edited must be run through the compiler and its
  `diagnostics` checked before being committed.
- Never weaken a constraint, loosen a test, or adjust a conformance case to
  make verification pass. Snapshot updates are permitted **only** where the
  diff is exactly the intended visual change; inspect every one.

## Acceptance Criteria

1. The board's section heading reads `Availability`; no two nav items share a
   label.
2. `BandMemberAvailabilityBoard` declares no legend; the calendar still
   renders statuses with colour, icon and ARIA label.
3. Top-bar status readouts are visually distinguishable from controls.
4. `Install` meets WCAG AA contrast against the top bar.
5. The context-selector label is aligned with its control.
6. `npm test` green; every changed Playwright snapshot inspected and its diff
   accounted for.

## Testing

- Compile-check the edited `.adlj` via `compileAdlj` and check `diagnostics`.
- `npm test` — expect `tests/band-reference-app.test.ts` and any test
  asserting the old heading or the legend's presence to need updating; those
  are legitimate updates, not loosened tests. State each one in the Execution
  Note.
- `npm run verify:push` once, at the end. Both reference apps' snapshots will
  move because `styles.css` is shared. **Inspect every screenshot** and
  confirm each diff is exactly an intended change.

## Parallel Execution Plan

Do not fan out. Two small edit sites and one shared verification pass; a
second agent would spend more time coordinating than editing.

## Tasks

1. Verify the Evidence section still holds against current code.
2. Answer the two open decisions (nav label; whether any other view declares a
   `LEGEND`) and record the answers.
3. `.adlj` edits, compile-check.
4. CSS/chrome edits.
5. `npm test`, then `verify:push`, inspect screenshots.
6. `learnings/` update if anything reusable emerged, then commit.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**. Two candidates are already known and should
be assessed rather than assumed:

- The legend rendering defects at `adl-composed-view.ts:244` / `styles.css:900`
  (flex-sibling title, invalid `role="list"` child) and the view-level-only
  legend placement, if this phase leaves them latent.
- The syncStatus control's meaning with no authority configured.
  `src/ui/main.ts:36-37` makes the authority opt-in — with none configured the
  browser is a purely local demo — while `src/runtime/object-store.ts:1268`
  marks every record of a queueable-`SYNC` object `pending` on write. The demo
  therefore reports `N pending` for a server that will never exist in that
  deployment. The chip is literally accurate but arguably misleading; whether
  it should read differently with no authority configured is a product
  decision that has not been taken.
