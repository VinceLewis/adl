# Phase 95 — Mobile Top-Bar Wrap and the Startup-Recovery Visual Flake

Two independent defects, both recorded as known-and-unfixed by Phase 92's
Execution Note. They are grouped into one phase because they share a single
verification pass: one is a shared-stylesheet change whose proof is the
Playwright screenshot suite, and the other is a defect *in* that same suite.
Splitting them would mean running the slowest check in the repository twice.

## Objective

1. Resolve the specificity conflict that makes the mobile top-bar rule — and
   the long comment above it explaining the decision — dead code, so the
   top-bar tools row stops right-aligning on a phone and `Install` stops
   wrapping onto a stranded, right-aligned second row.
2. Remove the structural race in `startup-failure-recovery.visual.spec.ts`
   that makes it fail intermittently with `net::ERR_ABORTED at page.goto`,
   without weakening what the test proves and without a fixed sleep, a longer
   timeout, or a retry.

## Evidence and Dependency

Both items were found during Phase 92 and are recorded there — see
`docs/phases/phase-92-availability-board-and-shell-chrome-defects.md`'s
"Found, deliberately not fixed" and "Verification" sections — and in
`learnings/implementation/shell-navigation.md`. Line numbers are deliberately
not quoted below: Phase 92 moved code in `src/ui/styles.css`, and the next
reader should re-locate by selector, not by line.

**1. `.adl-topbar-app .adl-topbar-tools { justify-content: flex-end }`
defeats the mobile block.**
The base rule `.adl-topbar-tools` (specificity 0,1,0) sets
`justify-content: flex-end`, and the `@media (max-width: 860px)` block
overrides the same property to `flex-start` on the same single-class selector,
relying on source order. A media query contributes no specificity of its own,
so that works — except that an app-scoped copy of the *identical* declaration,
`.adl-topbar-app .adl-topbar-tools` (0,2,0), outranks it unconditionally.

The app-scoped copy therefore changed nothing on desktop (it restated the base
value) while silently killing the mobile override. `git log -L` dates it to
Phase 28, where it was introduced as `.adl-topbar-composed .adl-topbar-tools`
and renamed to `.adl-topbar-app` later; the base rule has carried `flex-end`
since Phase 14, so the app-scoped copy has been redundant for its entire life.

The comment above the mobile rule states the intent in full: the tools row is
*deliberately* not a column, so the compact status controls "stay that size and
wrap onto their own line together" instead of stacking as full-width bars. That
intent requires `flex-start`. It has never been in effect.

**2. `startup-failure-recovery.visual.spec.ts` races the app's own reload.**
The recovery test clicks `[data-startup-error-reset]`. That handler
(`src/ui/components/adl-startup-error.ts`, `handleReset`) deletes the three
IndexedDB databases via `deleteAppLocalDatabases` and then calls
`globalThis.location?.reload()` in a `finally`. The test's next line calls
`openJointlyCareApp(page)`, which issues its own `page.goto` to the same URL.
Playwright's navigation and the app's reload race, and Playwright loses.

The app is not at fault: reloading is the documented, intended behaviour of the
reset action, and the test is the party that navigates redundantly.

**Dependency:** none beyond Phase 92 being merged (it authored both the CSS
neighbourhood and the Execution Note this phase acts on). Item 1 touches
`src/ui/styles.css` only; item 2 touches one spec file only.

## Decision

### Item 1 — delete the app-scoped rule; do not raise the mobile rule's specificity

Two resolutions are available, and only one is honest about what the code says.

- Raising the mobile rule to `.adl-topbar-app .adl-topbar-tools` would make the
  override win, but it would preserve a declaration that provably contributes
  nothing: it sets the same value as the base rule on desktop.
- Deleting `.adl-topbar-app .adl-topbar-tools { justify-content: flex-end }`
  restores the base/media-query pairing that every other override in this
  stylesheet already relies on, with no change to desktop rendering.

**Taken: delete it.** The comment above the mobile rule is a deliberate,
argued design decision and it should win, which is the first half of the
instruction; the app-scoped rule is genuinely obsolete duplication, which is
the second half. Both halves point the same way. A short comment goes on the
base rule recording why it must stay single-class, so the same override cannot
be re-broken by re-scoping.

### Item 2 — drop the redundant `goto`, wait on the app's own reload

The test's own comment says what it is proving: after reset "the app then
starts with nothing local to read and re-seeds itself". That is a statement
about the **app-initiated reload**, not about a fresh visit to the URL. The
`page.goto` is therefore not merely racy, it proves something weaker than
intended — it would pass even if the app's reload never happened.

**Taken: remove the `goto` from the post-reset path and wait on the recovered
app's own markup instead.** `openJointlyCareApp` splits into a `goto` half and
a readiness half; the post-reset path awaits only the readiness half. Playwright
locator waits are navigation-resilient, so they settle on whichever document
finally mounts `<adl-app>`. This cannot pass against the pre-reload document:
that document has no `<adl-app>` at all (the test already asserts
`toHaveCount(0)` for it, because the failure threw before one was appended) and
does have `<adl-startup-error>`.

No fixed sleep, no raised timeout, no retry — the wait is on a condition only
the reloaded document can satisfy.

## Scope

- `src/ui/styles.css` — remove the redundant app-scoped declaration; comment
  the base rule.
- `tests/visual/startup-failure-recovery.visual.spec.ts` — remove the racing
  navigation; split the open helper.
- `learnings/` — record the specificity trap and the app-initiated-navigation
  trap.
- This phase document.

## Non-goals

- Any change to `src/ui/components/adl-startup-error.ts` or
  `src/runtime/local-data-reset.ts`. The app's reset-then-reload behaviour is
  correct; the test is what is wrong.
- Redesigning the mobile top bar. `Install` may still occupy its own wrapped
  row once the row is full — that is ordinary flex wrapping, and the defect
  being fixed is the *alignment* of that row, not its existence.
- Any change to `.adl-topbar-app`'s other declarations, to the top-bar markup,
  or to either reference app's model. No `modelVersion` moves in this phase.

## Constraints

- Never weaken a constraint, loosen a test, or adjust a case to make
  verification pass. Specifically: the flake must not be "fixed" with a longer
  timeout, `test.retry`, or `waitForTimeout`.
- `src/ui/styles.css` is shared by both reference apps. Both must be inspected
  at the mobile viewport; a screenshot diff in Jointly Care is expected, not a
  surprise to be blessed unread.
- The flake fix must be *proved*, not asserted: establish a reliable
  reproduction on unmodified test code first, then show the fixed test passing
  repeatedly. Report both rates.
- No `.adl`/`.adlj` content is authored or edited here, so the compile-check
  rule does not apply; no authority, projection, migration-SQL or HTTP path is
  touched, so `npm run test:integration` is not required.

## Acceptance Criteria

1. No `.adl-topbar-app .adl-topbar-tools` rule remains, and the computed
   `justify-content` of `.adl-topbar-tools` at a 393px viewport is
   `flex-start` in **both** reference apps.
2. Desktop top-bar layout is unchanged (`flex-end` still applies above the
   breakpoint).
3. The post-reset path in `startup-failure-recovery.visual.spec.ts` issues no
   `page.goto`, and the test still asserts every fact it asserted before.
4. A documented reproduction rate for the unmodified test, and at least ten
   consecutive passes after the change.
5. `npx tsc --noEmit` clean; `npx vitest run` at its 61-file / 1,104-test
   baseline; `npx playwright test` at its 54-passing baseline; `prettier
   --check` clean over the `format:check` glob.

## Testing

- A DOM probe at the mobile viewport (393×852) against both demos, reading
  computed `justify-content` and the bounding boxes of every `.adl-topbar-tools`
  child, before and after — screenshot review alone will not distinguish
  "right-aligned second row" from "left-aligned second row" reliably at a
  glance.
- `npx playwright test tests/visual/startup-failure-recovery.visual.spec.ts
  --grep "recovers via Reset" --repeat-each=25 --workers=2` as the flake
  harness, run on unmodified and modified test code.
- `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`, `prettier
  --check`.
- `npm run verify:push` is **not** run inside this phase's worktree; it is run
  once in the primary tree after this branch is integrated with the other
  parallel branches.

## Parallel Execution Plan

Do not fan out. Two single-file edits sharing one verification pass, one of
which is a defect in that verification pass. A second agent would add
coordination cost and could not run Playwright concurrently anyway: the visual
suite's web servers bind fixed ports (5173/4173/5273/5373), so concurrent
Playwright runs collide.

## Tasks

1. Re-verify both Evidence items against current code, including `git log -L`
   on the app-scoped CSS rule to confirm it was always redundant.
2. Probe the mobile top bar in both demos and capture the "before" state.
3. Apply the CSS deletion and comment the base rule.
4. Re-probe; confirm `flex-start` and left-aligned wrapping in both demos.
5. Establish the flake's reproduction rate on unmodified test code.
6. Apply the test fix; re-run the same harness and report the new rate.
7. Full verification: typecheck, vitest, Playwright, prettier.
8. `learnings/` update; commit.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**, not merely the next gap in the shell or the
visual suite.

## Execution Note

Executed serially in an isolated worktree on branch
`phase-95-topbar-and-flake`, as the Parallel Execution Plan directed.

### A hazard found before any work started

A Vite dev server from an earlier session was still listening on **5173, bound
to `0.0.0.0`, with its cwd in the primary tree** (`git log` shows commit
`14b6a6f` made `0.0.0.0` the default). `playwright.config.ts` sets
`reuseExistingServer: true`, so every Playwright run in this worktree would
silently have tested the *primary tree's* stylesheet, not this branch's — the
visual proof would have been worthless and would have looked clean. The stale
server was killed and replaced with one rooted in this worktree, verified via
`/proc/<pid>/cwd` before any screenshot was taken. Worth knowing for any future
parallel-worktree phase: with `reuseExistingServer`, a warm port is not
automatically *your* port.

### Item 1 — re-verification and outcome

The Evidence held exactly. `git log -L 533,536:src/ui/styles.css` confirms the
rule entered in Phase 28 (`e00351a`) as `.adl-topbar-composed .adl-topbar-tools`
and was renamed in `d0c4413`; `git log -L` on the base rule shows `flex-end`
present since Phase 14 (`8c8ae31`). The app-scoped copy never changed a rendered
pixel on desktop and never did anything on mobile except defeat the override.

Measured at 393×852 before the change, `justify-content` computed to `flex-end`
in both demos, with `Install` alone on a second row at `x = 309` while the row
above started at `x = 81` (Giggle) / `x = 81` (Jointly). After the change,
`flex-start` in both, every child left-aligned from `x = 12`, and `Install`
starting at `x = 12` directly under the row it belongs to.

`Install` still occupies its own wrapped row: the first row's controls total
312px against a 369px content width, so a 72px button plus a 12px gap cannot
join it. That is ordinary flex wrapping at a 393px viewport, and it is out of
scope here (see Non-goals) — the defect fixed is that the wrapped row was
right-aligned and visually stranded away from the controls it belongs with.

### Item 2 — reproduction, before and after

Harness (Chromium, both projects, warm dev server):

```bash
npx playwright test tests/visual/startup-failure-recovery.visual.spec.ts \
  --grep "recovers via Reset" --repeat-each=25 --workers=2
```

- **Before (unmodified spec): 12 failed / 50, twice in a row — 24/100.** Three
  signatures, all the same race: 8× `page.goto: net::ERR_ABORTED`, 3×
  `page.goto: Navigation … is interrupted by another navigation`, 1×
  `locator.waitFor` timing out on the heading after a `goto` that landed on a
  document the app then reloaded out from under it.
- **After: three batches of 50 — 50/50, 49/50, 50/50. The goto race did not
  recur once in 150 runs.**

The single failure in the middle batch is reported here rather than rounded
away, and it is *not* the race this phase fixed. It failed 60 lines earlier, on
`expect(fallback).toBeVisible()` after the metadata corruption — i.e. before the
reset button is ever clicked — with `element(s) not found` after the 10s expect
timeout. Its artifact timestamp is 23:07:49; `npx vitest run` (61 files) started
at 23:07:43 and ran for 22s in the same machine, so that repeat was competing
with the whole hermetic suite for CPU while a dev-mode page compiled a reference
app's model from source. That overlap was the executing agent's own scheduling
mistake, not a property of the test; batches one and three, run with nothing
else on the machine, were clean.

Checked rather than assumed: application metadata is written **only** during
`RuntimeStartupCompatibilityChecks.run`
(`src/runtime/startup-compatibility.ts`), before `<adl-app>` mounts, so there is
no post-mount write that could race the test's corruption and restore a valid
fingerprint. The starvation reading is the one the evidence supports.

A single isolated run of the whole spec file passed both before and after, which
is precisely why the repeat harness was needed: the one-shot invocation is not a
reproduction.

### Verification

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **61 files / 1,104 tests, all passing** — the stated
  baseline, unmoved. Neither change is reachable from the hermetic suite.
- `npx playwright test`: **54 passed**, the stated baseline. The first attempt
  reported 47 passed / 7 failed in the `passkey` and `administration` projects,
  for the same `reuseExistingServer` reason as the hazard above: pre-started
  dev servers on 5273/5373 lacked the per-project `VITE_ADL_AUTHORITY_URL` those
  two projects' web servers set, so no session chrome rendered. Killing them and
  letting Playwright own those ports gave 54/54. Nothing in this phase touches
  authority chrome.
- `npx prettier --check` over the `format:check` glob: clean.
- `npm run test:integration`: not run. This phase touches one CSS declaration
  and one spec file; no authority, projection, migration or HTTP path is
  involved.
- No `modelVersion` moves, so no persisted-state upgrade test needed updating.

Screenshots changed: the top bar in the **mobile** project only. 18 Giggle Band
mobile screenshots, 5 Jointly Care mobile screenshots, the Jointly Care
`startup-failure-mobile-recovered` shot, and — a third app the Scope did not
name — `browser-demo-mobile-persisted-upgrade`, the generic persistent browser
demo, which shares the same shell and whose `10 pending` readout was the control
stranded on its right-aligned second row there. Every one of them changes in
exactly one way: the tools row and its wrapped last control move from
right-aligned to left-aligned. The bar's *height* is unchanged (both rows exist
before and after), so nothing below it moves and no page can clip differently.
Desktop screenshots are byte-identical in layout, as expected, since the base
rule still supplies `flex-end` above the breakpoint. The top bar was cropped and
examined directly at both viewports in both demos rather than eyeballed inside a
full-page shot.

### Design review

`/impeccable audit` was not run: this phase deletes one declaration whose entire
effect was to defeat an existing, documented design decision, and adds no new
visual treatment. The rendered result is the one the stylesheet's own comment
already argues for. The before/after crops were inspected at both viewports in
both apps.

### Not proven

- The flake rate is measured on one machine under one load profile. 24/100 is a
  floor, not a constant; a busier or slower machine would race differently. What
  is proven is that the failing invocation no longer contains the navigation
  that lost the race, and that the same harness that produced 24 failures now
  produces none.
- The mobile comment claims the context selector "gets its own full-width row".
  It does not: the flex child is the unstyled `<adl-context-selector>` host, and
  the `width: 100%` in the mobile block applies to `.adl-context-selector`, a
  class that lives on an element *inside* that host. Measured at 141px (Giggle)
  and 145px (Jointly) against a 369px row. This is a separate defect from the
  one this phase fixes, it is not made worse by the fix, and correcting it would
  restyle the mobile bar — out of scope here. Recorded in
  `learnings/implementation/shell-navigation.md` and offered below.

## Planning Handoff

**Recommended next phase: make the mobile top-bar context selector actually
prominent — i.e. fix the host-element/inner-class mismatch described above.**

Why this is the highest-value remaining gap repository-wide, assessed against
the other candidates on record:

- It is the *last* live piece of the mobile top-bar decision that Phase 92
  documented and this phase half-restored. The stylesheet now contains a comment
  asserting behaviour that is still, in one respect, not happening — the same
  failure mode this phase existed to clear. Leaving a second false claim in the
  same comment block, immediately after fixing the first, is how the original
  one survived from Phase 28 to Phase 95.
- It affects **both** shipped reference apps on the viewport a human actually
  tested them on, and it concerns the one control the comment itself calls out
  as deserving prominence: the context selector is how a person changes band or
  circle, and it currently renders at 38% of the row width, visually equal to a
  status readout.
- It is small, it is confined to `src/ui/styles.css` plus possibly a
  `display` declaration on the custom element, and it rides the same screenshot
  pass.

Assessed and **not** recommended ahead of it:

- *The `N pending` chip with no authority configured* (Phase 92's second
  candidate). Still open, still a genuine product ambiguity — but it needs a
  product decision, not an implementation, and `dev:authority` (commit
  `524e110`) has since made a local authority reachable, which changes the
  framing. Not a phase to start without a decision.
- *`ADL_POLICY_ROLE_UNREACHABLE_ON_OBJECT`* (Phase 92's own recommendation).
  Higher value in the abstract — a compile-time diagnostic prevents a whole
  class of silent policy denial — but it is a compiler phase of real size, and
  it should not be wedged behind a UI phase's screenshot pass. It is the right
  next *substantial* phase; the top-bar item is the right next *cheap* one, and
  finishing the bar first means the compiler phase never has to touch the
  visual suite.
