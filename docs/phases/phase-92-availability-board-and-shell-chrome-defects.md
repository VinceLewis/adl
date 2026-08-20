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

## Execution Note

Executed in full against `main` at `808c3a0` (Phase 91), serially, as the
Parallel Execution Plan directed.

### Re-verification (Task 1)

All five items still held, and Phase 91's own
`giggle-mobile-who-is-free.png` shows every one of them. Two corrections to the
Evidence, neither changing the work:

- **Item 3's control list is stale.** `ui.adl:13-19` places five controls in the
  top bar including `themeSwitch`. The real compiled source, `ui.adlj`, places
  `themeSwitch` in the **nav drawer** and gives the top bar four: `contextSelector`,
  `connection`, `syncStatus`, `installApp`. `ui.adl` is a superseded citation
  snapshot (its own trailing note says so) and the two have genuinely diverged.
  The defect is unaffected — the three identical chips were the context
  selector, `Online` and `25 pending`.
- **Item 4's cause is more specific than "light blue".** `Install` is rendered
  `disabled` whenever the browser has offered no install prompt, and the global
  `button:disabled { opacity: 0.55 }` — calibrated for a light surface — puts
  its label at **2.03:1** against the bar while leaving it looking like a filled,
  pressable button.

### Open decision 1: the nav-label collision

Took the recommendation. Section heading → `Availability`; nav label →
`Band Availability`, leaving `Availability` to `MyAvailabilityList`. No two nav
items share a label; `giggle-mobile-nav-drawer.png` shows both entries. The
reasoning is recorded as a `comment` on the section in `ui.adlj` so the next
reader does not have to rediscover why the two differ.

### Open decision 2: does any other view declare a `LEGEND`? — Yes, four

- Giggle Band: `HomeDashboard` (`ScheduleStatus`), `BandEventCalendar`
  (`CalendarStatus`).
- Jointly Care: `HomeDashboard` (`ScheduleStatus`), the circle calendar
  (`CircleCalendarStatus`).

So removing only `MyScheduleLegend` would have left the rendering defects — the
flex-sibling title and the invalid `role="list"` child — live on four views
across **both** reference apps, including each app's landing screen.

**Proposed and taken: fix the rendering here, in addition to removing the
legend.** It is an accessibility defect on the first screen a user sees; the fix
is a handful of lines in code this phase already has open; and Phase 92 already
runs the one shared `verify:push`, in which those legends appear. Deferring
would have meant shipping a change that touches the exact code while leaving the
defect live for an unknown number of phases. The legend removal and the
rendering fix are independent, so this holds whichever way the user's terse
instruction is read.

`renderLegends` now nests the items in their own
`.adl-presentation-legend-items` container carrying `role="list"` and the
`aria-label`, with the title as a sibling outside it.
`tests/ui-runtime.test.ts` asserts that shape directly (every child of the list
is a `listitem`, the title is not inside it, and the title still reads
`Schedule status`), so it cannot silently revert.

**A trap on the way there, worth recording.** Setting the item gap to 12px did
not separate the items, because `.adl-presentation-status` carries
`margin-right: var(--adl-space-xs)` for row use, which stacked on the item's own
6px gap: the intended 6 / 12 / 16 was really 12 / 12 / 16, and a label still
floated between two swatches. The legend now zeroes that margin. Verified by
cropping the rendered legend, not by reading the CSS.

### Chrome

All three items are CSS; `render-chrome.ts` was not touched, because its markup
was already correct (a readout is a `<span>`, a control is a `<button>`) — the
defect was purely that the CSS gave them the same shape.

The top bar now has **three visual registers**:

| | Treatment | White-text contrast on `#155eef` |
|---|---|---|
| Readout (`Online`, `25 pending`) | state dot + text, no fill, no border | **5.41:1** (was 4.08:1) |
| Control (selects, context chip, enabled buttons) | `rgba(0, 0, 0, 0.18)` fill, white outline | **7.29:1** (was 4.08:1) |
| Disabled control (`Install`) | no fill, quiet outline, label at 90% white | **4.69:1** (was 2.03:1) |

The key finding is that the old `rgba(255, 255, 255, 0.16)` overlay *lightened*
the backdrop to `#3a78f2`, where white measures 4.08:1 — below WCAG AA, and not
only for `Install`: every select and the context chip failed too. Darkening
instead of lightening fixes all of them at once and keeps the on-brand look.
Jointly Care's bar is darker still, so every ratio there is higher.

Item 5: the mobile block sets `align-items: stretch` on `.adl-context-selector`
so the control fills the row, which also stretched the `Band` label's box and
left its text top-aligned above the chip. Fixed with `align-self: center` on a
**direct-child** selector, plus 13px/600 — deliberately `> span`, so it never
touches `.adl-context-single`'s or `.adl-context-compact`'s inner spans, which
the existing descendant rule sizes at 12px.

### Design review (`/impeccable audit`)

Run over `src/ui/styles.css` and `src/ui/components/adl-composed-view.ts`, as
AGENTS.md requires. Two findings, both triaged rather than ignored:

- **Fixed: three hard-coded hex colours.** The status dots shipped as literal
  `#6ce9a6` / `#fec84b` / `#fda29b`. They are now a small
  `--adl-color-on-primary-ok` / `-pending` / `-alert` ramp in `:root`, beside the
  existing `--adl-color-status-*` constants. They cannot be theme tokens: a
  declared `THEME` only ever sets the twelve colours in
  `THEME_COLOR_CSS_VARIABLES`, so anything else in `:root` is a stylesheet
  constant — which is exactly what `--adl-color-status-*` already is. The
  existing status ramp could not be reused: it is calibrated for the light
  content surface and goes muddy on the bar.
- **Recorded as a false positive: three `side-tab` hits** at `styles.css:1075`,
  `:1207`, `:1279` — `border-left: 3px solid var(--adl-status-color, …)` on
  presentation rows, calendar items and matrix cells. The detector's rule targets
  a decorative accent stripe on a card. Here the stripe is *model-declared
  information*: the colour comes from the view's own `STATUS … THEME`
  declaration, and the same status is also carried by a coloured dot, an icon
  and an `ARIA_LABEL`, so it is never a colour-only encoding. All three are
  pre-existing and untouched by this phase.

Beyond the detector: no gradient text, no glassmorphism, no hero-metric block,
no identical-card grid, no tracked-uppercase eyebrow. Touch targets stay at
`--adl-control-height` (34px, below the 44px guidance) — a pre-existing,
shell-wide value, not something this phase introduced or should change
unilaterally.

### Tests

Modified (each asserts a string or structure this phase deliberately changed;
none loosened):

- `tests/compile-adl.test.ts` — the nav-item table's `Who is free` →
  `Band Availability`.
- `tests/visual/giggle-band.visual.spec.ts` — the page spec renamed
  `who-is-free` → `band-availability` with `expectedText: "Availability"`, and a
  comment saying why.
- `tests/band-reference-app.test.ts` / `tests/browser-model-migration.test.ts` —
  `modelVersion` `1.8.0` → `1.9.0`, the new hop assertion, the golden
  fingerprint, and the `MIGRATION_APPLIED` diagnostic's expected version.

Added: the legend ARIA/structure assertions in `tests/ui-runtime.test.ts`.

`ui.adlj` changed, so Giggle Band's fingerprint moves: `modelVersion`
`1.8.0 → 1.9.0` with an empty-object hop. Jointly Care's model is untouched by
this phase (its screenshots move only because `styles.css` is shared), so it
needs no bump. Both apps' persisted-upgrade specs read the live version from the
mounted app, so neither needed editing.

### Verification

- `npm test`: **61 files / 1,104 tests, all passing.**
- `npm run verify:push`: **exit 0** — typecheck, format:check, vitest, build and
  **54 Playwright tests**. Redirected to a file, never piped.
- `npm run test:integration` was **not** re-run for this phase: it touches no
  authority, projection, migration-SQL or HTTP path (`.adlj` content, CSS, and
  one renderer's markup). Phase 91's run stands, including its one pre-existing
  failure.
- **The `startup-failure-recovery.visual.spec.ts` flake is real and was
  investigated, not assumed.** It failed three consecutive `test:visual` runs
  mid-phase, which looked like a regression. It is not: with the working tree
  stashed back to Phase 91, the same test failed **4/4** in isolation, and it
  passed on later runs with the changes applied. `ERR_ABORTED at page.goto`,
  the documented signature. Intermittent, pre-existing, untouched.

Screenshots inspected (desktop and mobile for both apps):

- `giggle-*-band-availability`: heading reads `Availability`, no legend, roster
  and calendar unchanged, member names still resolved (Phase 91 unregressed).
- `giggle-*-home`, `giggle-*-calendar`, `jointly-care-*-home`,
  `jointly-care-*-circle-overview`: legend title now clearly separated from its
  items, swatch bound to its own label, items unchanged otherwise.
- Every screen of both apps, for the shared chrome: dotted readouts, darker
  control chips, outlined `Install`, centred selector label. Cropped and
  examined the top bar at 3× on both apps rather than eyeballing the full page.
- `giggle-mobile-nav-drawer`: `Availability` and `Band Availability` both
  present and distinct.

### Found, deliberately not fixed

`.adl-topbar-app .adl-topbar-tools { justify-content: flex-end }` (specificity
0,2,0) defeats the mobile block's `.adl-topbar-tools { justify-content:
flex-start }` (0,1,0), so the mobile rule — and the long comment above it
explaining the decision — is dead: the tools row is right-aligned on phones and
`Install` wraps alone onto a right-aligned second row. It is a live defect, not
a design choice, but it is outside this phase's five listed items and fixing it
would move the whole mobile bar. Recorded in
`learnings/implementation/shell-navigation.md` and offered as a candidate below.

### Not proven

- The legend-removal scope rests on an interpretation of a terse instruction
  ("Legend title and legends list not required it's obvious anyway") as *remove
  the legend* rather than *no fix needed*. The rendering fix was done anyway, so
  the four other legends are correct either way; if the intended reading was the
  other one, restoring `MyScheduleLegend` is a three-line `.adlj` revert plus a
  version bump.
- Contrast is computed against sRGB WCAG 2.1 ratios for the two shipped themes'
  actual bar colours. A future app declaring a light `colorPrimary` would put
  white-on-primary below AA everywhere in the bar — a pre-existing property of
  the inverted top bar, unchanged by this phase and not addressed by it.

## Planning Handoff

**Recommended next phase: a compile-time diagnostic for an unreachable `ROLE`
principal** (`ADL_POLICY_ROLE_UNREACHABLE_ON_OBJECT`, or similar). A `specific`
principal naming a role that is only ever earned through a business context's
`MEMBERSHIP`, on an object that is neither scoped to that context nor that
context's own bound object, can never match. It is decidable in exactly the
place `ADL_POLICY_SEARCH_CONDITION_UNREACHABLE` and
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` already live.

Why this is the highest-value remaining gap repository-wide:

- **Both** shipped reference apps hit it. Jointly Care found it by hand and
  worked around it with a recorded comment; Giggle Band shipped it, and it
  stayed live until Phase 91 — silently denying every `User` read and search in
  the app, which degraded every `LOOKUP User DISPLAY Name` label in the app to a
  raw record id and made Phase 91's own Evidence section wrong.
- It is an access-control failure that presents as a cosmetic one, because every
  lookup-label path degrades quietly by design. Nothing detects it: the rule
  compiles clean and looks like a working grant.
- The trap was already written down in
  `learnings/implementation/policy-engine.md` and recurred anyway. **A
  documented footgun that recurs is a missing diagnostic**, and this is the
  second time that has proved true in this repository's policy layer.

Assessed against the two candidates this document named:

- **The legend rendering defects — closed by this phase, not deferred.** The
  flex-sibling title and the invalid `role="list"` child are fixed for all four
  remaining legends and covered by a test. What remains is only the *placement*
  limit (a view-level `LEGEND` always renders above the first section), which is
  a language addition — section-scoped legends — with no live defect behind it
  now that the one view it hurt declares no legend. Low value today.
- **`syncStatus` with no authority configured** — still a genuine product
  question, and still not urgent. `src/ui/main.ts` makes the authority opt-in
  while `src/runtime/object-store.ts` marks every queueable-`SYNC` record
  `pending` on write, so the local demo reports `25 pending` for a server that
  will never exist in that deployment. It is literally accurate, now visibly a
  *readout* rather than something to click (this phase), and it misleads nobody
  into an incorrect action. It is a wording decision needing a product answer,
  not a defect; it should be raised with the user rather than chosen by an
  agent.

Two smaller items found in this phase, worth folding into whichever phase next
touches shell CSS rather than carrying their own: the dead mobile
`justify-content: flex-start` rule described above, and the divergence between
`ui.adl` and `ui.adlj` on `themeSwitch`'s placement — the `.adl` files are
superseded citation snapshots, and every phase document that cites their line
numbers should be read with that in mind.
