# Phase 90 — Presentation Runtime Area Decomposition

> The third and last file named in the decomposition thread that Phase 81
> opened and Phase 88 continued. Phase 88's Planning Handoff named exactly two
> remaining files "whose names carry no signal about their contents":
> `src/ui/components/adl-app.ts` and `src/runtime/presentation-runtime.ts`.
> This phase claims the second; the first is Phase 89, executed in parallel
> against a disjoint file set.
>
> Per `learnings/process/phase-execution.md`'s standing rule for
> user-commissioned decomposition work (the same condition that authorised
> Phases 81 and 88), this does not need to justify itself as the next item in
> a rolling handoff — but it happens also to be the highest-value remaining
> gap repository-wide, and the Evidence section below says why.

## Objective

Split `src/runtime/presentation-runtime.ts` into a barrel plus a directory of
area files, with **zero behavioural change and zero consumer-visible API
change**. Every existing import of `src/runtime/presentation-runtime.js`
continues to resolve to the same 46 exported names.

`presentation-runtime.ts` is 3,304 lines. A task touching one presentation
area — "fix how a calendar cell picks its effective status", "add a matrix
edit reason", "change how a duration formats" — currently costs reading or
grepping the whole file to find the 30–100 relevant lines. This is a
navigability change for both human and LLM readers, exactly as Phases 81 and
88 were; it is not a performance change.

## Evidence and Dependency

Measured against `main` at `9066e01` (Phase 88's commit) with a clean working
tree. Re-verify before executing; line numbers drift.

- **`src/runtime/presentation-runtime.ts` is the largest file under `src/` —
  3,304 lines**, ahead of `src/ui/components/adl-app.ts` (2,747),
  `src/conformance/runner.ts` (2,491) and `src/runtime/object-store.ts`
  (2,139). Phase 88 named it and `adl-app.ts` as the last two files whose
  names carry no signal about their contents. That is the repository-wide
  justification: no other file in `src/` is both this large and this
  undifferentiated by name.
- Structure is **three distinct regions**, not one:
  - lines 1–45: type-only imports from `../model/resolved-model.js` (30
    names), `./runtime-types.js` (6 names) and `./sync-policy-service.js` (1),
    plus value imports of `RECORD_ID_JOIN_FIELD`, `evaluateExpression`,
    `evaluateExpressionAsBoolean`, `RuntimeModelIndex`, `cloneJson`,
    `noopRuntimeLogger`, `safeContextLog`.
  - lines 47–415: **41 exported `interface`/`type` declarations** —
    `RuntimePresentationView`, `RuntimePresentationCalendar`,
    `RuntimePresentationMatrix*`, `RuntimePresentationDataSource`, …
  - lines 417–2,266: `export class PresentationRuntime` — **44 members**
    (constructor + 43 methods; **no fields other than the constructor's four
    parameter properties, and no accessor pairs**).
  - lines 2,268–3,304: `initializePresentationState`,
    `applyPresentationStateUpdates`, `formatPresentationValue`, one further
    exported interface (`DiagnosticLocation`), 6 module-private interfaces,
    4 module-private constants, and **43 module-private pure free functions**
    (46 free functions counting the three exported ones).
- **The complete external surface is 46 names**: the 41 types from the type
  block, `DiagnosticLocation`, and the four values `PresentationRuntime`,
  `initializePresentationState`, `applyPresentationStateUpdates`,
  `formatPresentationValue`. Consumers: `src/index.ts`
  (`export * from "./runtime/presentation-runtime.js"` — so the whole set is
  package public API), `src/runtime/application-runtime.ts`,
  `src/runtime/edit-surface-runtime.ts`,
  `src/ui/components/adl-composed-view.ts`, `src/ui/components/adl-app.ts`,
  and tests.
- **The class's internal call graph, grouped into the 7 chain layers named in
  the Decision below, is a directed acyclic graph.** Measured, not assumed:
  every `this.<member>` reference in every member body was extracted and
  mapped to its area, and the area graph checked for cycles. Unlike Phase 88's
  parser, **no cycle existed under the natural topic grouping**, so no area
  file exists purely to break one.
- Of the 43 methods, **16 are called from a different area** (so must become
  `protected`), **22 are called only from within their own area** (so stay
  `private`), and 5 are public (`initializeState`, `applyStateUpdates`,
  `evaluate`, `cycleMatrixCell`, `applyMatrixRangeEdit`). All three
  collaborator fields (`dataSource`, `index`, `logger`) are read from more
  than one area and become `protected`.
- **Field-initialisation-order risk is nil.** The class declares no instance
  fields beyond the constructor's parameter properties, no field initialiser
  reads another field via `this.`, and there are no `get`/`set` pairs. A
  base/derived split therefore cannot reorder initialisation. This was audited
  member by member, not assumed.
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax` on, but **not**
  `noUnusedLocals` — a slightly over-broad computed import list will not fail
  `npm run typecheck`, so the emitted imports must be checked separately.
- The reference apps declare **no matrices**, so the fast suite's matrix
  coverage comes from hand-built models in `tests/presentation-runtime.test.ts`
  and `tests/ui-runtime.test.ts` plus
  `conformance/presentation/status-matrix-calendar.json`. Any differential
  corpus must therefore reach past the reference apps into the conformance
  models, or it will not exercise matrix editing at all.

## Decision

### Strategy: a hybrid — flat modules for the pure regions, a class chain for the class

This file's shape differs from `parser.ts`'s, and the decomposition follows
the shape rather than imposing one strategy on both regions.

**The type block and the 46 free functions become flat topic modules**, in the
Phase 81 style. They hold no shared state and call each other as ordinary
functions, so an inheritance chain would buy nothing and cost readability. A
plain module DAG is the honest structure.

**`PresentationRuntime` becomes a linear class chain**, exactly as Phase 88
did for `AdlParser`:

```
src/runtime/presentation-runtime.ts             <- barrel: export * from the index
src/runtime/presentation-runtime/base.ts            class PresentationRuntimeBase
src/runtime/presentation-runtime/icon-runtime.ts    class IconRuntime extends PresentationRuntimeBase
...
src/runtime/presentation-runtime/index.ts           class PresentationRuntime extends MatrixRuntime
```

This is the load-bearing decision for the class region, chosen because it
makes the change mechanical rather than a redesign:

- **No call site inside the class changes.** `this.resolveStatus()` still
  resolves to the same method; the assembled prototype chain carries all 43
  methods. The alternative — free functions taking the runtime as a parameter
  — would have required rewriting every `this.` reference and every call site.
- **No method body is edited at all.** The only permitted per-member change is
  the visibility keyword.
- **No consumer changes.** `presentation-runtime.ts` remains a real module at
  its current path.

The cost is an ordering constraint: a base class cannot call a method declared
only in a derived class. The measured DAG means no `abstract` declarations are
needed, and a future phase that adds a call from a lower area to a higher one
gets a `tsc` error whose fix is to move the shared helper down a layer, never
to add a back-edge.

### Directory name

`src/runtime/presentation-runtime/`, the literal Phase 81 convention ("`X.ts`
becomes a barrel over a directory of domain files"). Phase 88 deviated to
`src/parser/grammar/` only because `src/parser/parser/` is redundant; nothing
is redundant here.

### The 7 flat areas

Sizes are measured declaration lines, excluding the file header comment and
imports.

| File | Lines | Decls | Holds |
|---|---|---|---|
| `types.ts` | 360 | 46 | All 42 exported shapes plus `DiagnosticLocation`, and the 4 module-private shapes shared across areas (`BoundPresentationRow`, `CalendarConflictOverlay`, `PlannedMatrixCellWrite`, `CalendarGridCell`). |
| `format.ts` | 419 | 21 | `formatPresentationValue` and the whole formatting cluster: `primitiveToText`, `formatNumber`/`Date`/`Time`/`Duration`/`DateTime`, `DateParts`/`TimeParts`, `MONTH_SHORT`/`WEEKDAY_SHORT`, `parseDateParts`/`parseTimeParts`, `applyDatePattern`/`applyTimePattern`/`replaceTimeTokens`, `containsDateToken`/`containsTimeToken`, `unsupportedFormat`/`invalidFormatValue`, `isJsonPrimitive`. |
| `iso-date.ts` | 12 | 2 | `parseIsoDate`, `addUtcDays`. |
| `calendar-grid.ts` | 204 | 13 | `CALENDAR_WEEKDAYS`, `CALENDAR_MONTH_NAMES`, `resolveCalendarMonth`, `buildCalendarCells`, `groupCalendarRowsByDate`, `calendarWeekdays`, `countCalendarStatuses`, `chooseEffectiveStatus`, `normaliseCalendarMonth`/`normaliseCalendarDate`, `shiftIsoMonth`, `defaultMonthLabel`, `titleCaseWord`. |
| `matrix-edit.ts` | 111 | 7 | `buildDateColumns`, `matrixCellKey`, `primitiveKey`, `nextMatrixCycleValue`, `matrixEditOperation`, `matrixEditOperationForRecord`, `matrixEditPatch`. |
| `row-binding.ts` | 76 | 6 | `readModelRowToPresentationRow`, `objectRecordToPresentationRow`, `rowActionValues`, `sortPresentationRows`, `compareJsonValues`, `dropTrailingWhitespaceOnlyFragment`. |
| `state.ts` | 69 | 3 | `initializePresentationState`, `applyPresentationStateUpdates`, `valueMatchesPresentationStateType`. |

### The 7 class-chain areas, base first

Sizes are measured member-body lines, excluding doc comments and imports.

| # | File | Class | Lines | Members | Holds |
|---|---|---|---|---|---|
| 1 | `base.ts` | `PresentationRuntimeBase` | 6 | 1 | The constructor and its three `protected readonly` collaborators: `dataSource`, `index`, `logger`. |
| 2 | `icon-runtime.ts` | `IconRuntime` | 93 | 2 | `resolveIcon`, `resolveIconMapValue`. |
| 3 | `status-runtime.ts` | `StatusRuntime` | 258 | 7 | `evaluateStatusBinding`, `evaluateStatusCandidates`, `evaluateStatusCandidate`, `resolveStatusMapValue`, `resolveStatus`, `evaluateLegends`, `evaluateLegend`. |
| 4 | `row-runtime.ts` | `RowRuntime` | 410 | 10 | `bindListRows`, `rowPassesFilter`, `evaluateRow`, `evaluateActionControl`, `evaluateActionInput`, `evaluateActionVisibility`, `evaluateCommandActionState`, `evaluateFragments`, `evaluateFieldText`, `evaluateEmptyState`. |
| 5 | `calendar-runtime.ts` | `CalendarRuntime` | 299 | 5 | `evaluateCalendar`, `resolveConflictOverlay`, `bindCalendarRows`, `evaluateCalendarCell`, `evaluateCalendarItem`. |
| 6 | `matrix-runtime.ts` | `MatrixRuntime` | 412 | 11 | `evaluateMatrix`, `bindMatrixSourceRows`, `resolveMatrixRowKey`, `evaluateMatrixCell`, `evaluateMatrixCellEdit`, `matrixCellRecord`, `requireMatrix`, `planMatrixCellWrite`, `planMatrixCellWriteFor`, `findMatrixEditRecord`, `applyMatrixCellWrite`. |
| 7 | `index.ts` | `PresentationRuntime` | 318 | 8 | The five public entry points plus `evaluateSection`, `evaluateControl`, `evaluateList`; and the re-export of the 46 public names. |

### The DAG evidence

The class chain's ordering is forced by the measured call graph, layer by
layer, with no back-edges:

- `icon` is the deepest leaf: `resolveIcon` is called by `status`
  (`resolveStatus`), `row` (`evaluateRow`, `evaluateFragments`,
  `evaluateEmptyState`), `calendar` (`evaluateCalendarCell`) and `index`
  (`evaluateControl`). It calls nothing but itself and `base`'s fields.
- `status` sits above `icon` and below everything else: `resolveStatus` is
  called by `calendar` (`resolveConflictOverlay`) and `matrix`
  (`evaluateMatrixCell`); `evaluateStatusCandidates` by `calendar`
  (`evaluateCalendarItem`) and `matrix` (`evaluateMatrixCell`);
  `evaluateStatusBinding` by `row` (`evaluateRow`); `evaluateLegends` by
  `index` (`evaluate`).
- `row` sits above `status`: `evaluateActionControl` is called by `calendar`
  (`evaluateCalendarCell`) and `index` (`evaluateControl`);
  `evaluateEmptyState` by `calendar` (`evaluateCalendar`) and `index`
  (`evaluateList`).
- `calendar` and `matrix` never call each other, so their relative order is
  free; `calendar` is placed first, arbitrarily.
- `index` calls into all six.

**No area file exists in this phase purely to break a cycle** — the honest
difference from Phase 88, where `clauses.ts` and
`presentation-scalars.ts`/`presentation-action.ts` were forced by measured
cycles. The presentation runtime's areas are genuinely layered already: icons
are a leaf of statuses, statuses a leaf of rows, and rows a leaf of calendars
and matrices.

One flat file is close to forced rather than chosen: **`iso-date.ts`** exists
only because `parseIsoDate` and `addUtcDays` are the shared leaf of
`calendar-grid.ts` and `matrix-edit.ts`. It is 12 lines, below the size this
phase would otherwise justify, and it is kept because the alternative —
`matrix-edit.ts` importing from `calendar-grid.ts` — encodes a dependency
between two unrelated areas that does not exist.

### The barrel

`src/runtime/presentation-runtime.ts` becomes a 6-line file: a header comment
and `export * from "./presentation-runtime/index.js";`, matching
`src/model/resolved-model.ts`'s Phase 81 shape. `index.ts` re-exports exactly
the 46 original names — explicitly, name by name, **not** with `export *`,
because `types.ts` also exports the four module-private shapes that the area
files need and the package must not.

## Scope

1. Create `src/runtime/presentation-runtime/` with the 14 files above.
2. Reduce `src/runtime/presentation-runtime.ts` to the barrel.
3. No other file in the repository is edited (docs and learnings aside).

## Constraints

- **No behavioural change of any kind.** No `RuntimePresentationView` field,
  diagnostic code, message, path, or ordering changes. No formatted string
  changes.
- **Bodies move verbatim.** The only permitted per-declaration edits are the
  visibility keyword on a class member, and the `export` keyword on a
  module-private declaration that a sibling area file must now import.
- **No new `abstract` declarations.**
- **Zero test file changes.** If a test needs to change to keep passing, that
  is evidence of an accidental behaviour change and must be fixed in the
  split.
- No new npm dependency.

## Deliverables

- `src/runtime/presentation-runtime/` fully populated; the barrel reduced.
- A **presentation evaluation differential** (see Testing) proving
  byte-identical evaluation output before and after.
- `npm run typecheck`, `npm test`, `npm run format:check` clean, zero test
  file changes.
- `learnings/implementation/presentation-runtime-file-map.md`.
- `learnings/index.md` pointed at it, and the presentation learnings docs that
  are about this file given a "Where the code is" pointer.

## Acceptance Criteria

- `npm run typecheck` passes with no new `any`, no suppressed errors, no
  changed `tsconfig.json`.
- `npm test` passes with **zero test file changes**, at the same file and test
  counts as before the split.
- The evaluation differential reports **zero differences**.
- The barrel's export set is proved equal to the original file's export set,
  mechanically, in both directions.
- Every one of the 44 class members and 98 non-class top-level declarations
  appears exactly once across the new files, verified mechanically.
- No file in `src/runtime/presentation-runtime/` exceeds 600 lines.

## Testing

The ordinary suite is necessary but not sufficient. A presentation defect is
*silently different output*, not a thrown error, so the correctness proof is a
differential dump, built before any code moves:

1. **Baseline.** A `git worktree` at pre-split `main`, with a throwaway vitest
   dump (never committed, per `AGENTS.md`) writing one canonicalised JSON
   document.
2. **Corpus**, four generators, all mechanical:
   - Every view of every object in **both reference demos** (band and
     jointly), composed or not, evaluated under every state permutation —
     each boolean flipped, all-true, all-false, each month state shifted by
     ±1/±2/±13 months, plus invalid month strings — across every seeded
     context. Non-composed views drive the
     `ADL_PRESENTATION_VIEW_NOT_COMPOSED` path.
   - Every case in `conformance/presentation/*.json` run through
     `runConformanceSuite`, dumping the full `actual` result, not pass/fail.
   - Every **model** declared in those suites (`resourceMatrix`,
     `monthCalendar`, `rowTemplate`, `viewState`, …) driven directly: seeded
     from the union of the cases' `setup` steps, evaluated the same way, then
     an exhaustive matrix sweep — every cell of every matrix cycled three
     times so create → update → delete all run, plus whole-grid range edits
     for each declared cycle value and for reversed and unknown column keys.
   - An exhaustive `formatPresentationValue` sweep: every format kind × a
     fixed pattern corpus (valid, unsupported, empty) × a fixed value corpus
     (valid, invalid, edge, wrong-typed).
3. **Determinism.** Record ids are minted from `crypto.randomUUID`, and a
   random id makes tie-broken row ordering differ between runs. The dump stubs
   `crypto.randomUUID` with a counter, and canonicalises wall-clock timestamps
   and revision tokens. Prove the baseline dump is byte-identical to itself
   across two runs *before* trusting a cross-tree comparison.
4. **After.** Run the identical dump against the split tree; diff. Any
   difference at all is a defect in the split.
5. `npx tsc --noEmit` after **each** emitted file, not only at the end.
6. `npm test` at the end; the counts must match the baseline exactly.
7. A **census**: assert mechanically that every declaration's text is
   byte-identical to its original span, modulo the two permitted keyword
   edits, and that the multiset of names across the new files equals the
   original.
8. `npm run test:integration` is not expected to be required — this phase
   touches no server, PostgreSQL, or I/O boundary.
9. `npm run verify:push` once, at the end, at the integration point — the
   presentation runtime feeds every reference app screen, so a screenshot
   regression here would be a real signal.

## Non-goals

- **`src/ui/components/adl-app.ts`** — Phase 89, in parallel.
- **`src/runtime/object-store.ts`** (2,139 lines) and
  **`src/conformance/runner.ts`** (2,491) — splittable, mechanical, lower
  value.
- **Large test file splitting** (`tests/runtime.test.ts` 3,020 lines,
  `tests/model-validation.test.ts` 3,004, `tests/band-reference-app.test.ts`
  2,379, `tests/ui-child-collection.test.ts` 2,194).
- **The `this.innerHTML = \`...\`` full-re-render pattern** across every custom
  element — the repository's real runtime-performance question, unaffected by
  file decomposition.
- **A repo-wide file-purpose map.**

## Dependencies

- `src/runtime/presentation-runtime.ts` (the target).
- `src/model/resolved-model.ts`, `src/runtime/runtime-types.ts`,
  `src/runtime/model-helpers.ts`, `src/runtime/expression-evaluator.ts`,
  `src/runtime/sync-policy-service.ts` (imported; not modified).
- `src/index.ts` (read-only reference confirming the barrel contract).

## Parallel Execution Plan

**Do not fan out within the phase.** The class region is a single ordered
chain, so no independent stream exists; the flat region is small enough that
coordinating agents costs more than it saves, and both regions share one
extraction script. Phase 81's and Phase 88's execution notes both record that
scripted extraction in one session beat coordinating worktree agents. Follow
that: drive the split with Python extraction/generation scripts (segment
declarations, assign to areas, measure the reference graph, check for cycles,
compute per-file imports, emit, typecheck, iterate).

The one genuinely parallelisable step is the differential baseline: generating
it in the pre-split worktree is independent of the split and can run while the
extraction scripts are being written.

Across phases, this phase and Phase 89 (`adl-app.ts`) touch disjoint files and
may run in parallel worktrees. `npm run verify:push` runs **once**, at the
integration point, not per phase — its Playwright pass is the slowest step and
concurrent runs would be wasteful and flaky.

## Tasks

1. Re-verify the Evidence section against current code: line count, region
   boundaries, member count, the 46-name public surface, the no-fields fact,
   and the DAG.
2. Build the differential dump and generate the baseline from a pre-split
   worktree; prove it is deterministic.
3. Segment declarations and members with their doc comments; assert the
   segmentation reproduces the original file line-for-line before relying on
   it.
4. Emit the 7 flat files then the 7 chain files, typechecking after each.
5. Reduce the barrel; reconcile the export set in both directions.
6. Run the census and the differential diff.
7. Full verification: `npx tsc --noEmit`, `npm test`, `npm run format:check`.
8. Write `learnings/implementation/presentation-runtime-file-map.md`; point
   `learnings/index.md` at it; add "Where the code is" pointers to the
   presentation learnings docs.
9. Planning handoff.
10. Commit.

## Planning Handoff

With `parser.ts` (Phase 88), `adl-app.ts` (Phase 89) and
`presentation-runtime.ts` (this phase) all decomposed, the "files whose names
carry no signal" thread that Phase 81 opened is **closed**. The remaining
candidates are a different and smaller class of work, and none is claimed
here:

- **Highest value next**: the repo-wide one-line-per-file purpose map the
  expert panel recommended alongside decomposition, and which every
  decomposition phase since 81 has deferred. It is now the cheapest remaining
  navigability win, and it is the only one that helps with the ~2,000-line
  files this thread deliberately left alone. Roughly 4–5K tokens, no code
  risk.
- **Profiling-first, unrelated to decomposition**: the
  `this.innerHTML = \`...\`` full-re-render pattern across
  `src/ui/components/`. This is the repository's real runtime-performance
  question and no file split has touched it. It needs a profiling phase, not
  a refactor phase, and it should be measured on a real device rather than
  assumed.
- **Mechanical, lower value**: `object-store.ts` (2,139 lines) and
  `conformance/runner.ts` (2,491). Both are large but both have names that do
  say what is inside; the marginal navigability win is much smaller than it
  was for the three files just split.
- **Test-suite hygiene**: the four oversized test files. Splitting a test file
  carries a different risk profile (a lost test is silent), so it wants a
  census-based approach like this phase's rather than a free-hand move.

The bundle-size side effect Phase 88 recorded — module granularity letting
Rollup place chunks per-module rather than dragging one atomic module into the
entry chunk — was **not measured for this phase**, because `npm run build` is
deliberately deferred to the integration point. A follow-up that cares about
the eager bundle should measure it there.

## Execution Note

Executed in full against `main` at `9066e01`, in one session, in an isolated
worktree, driven by Python segmentation/emission scripts exactly as the
Parallel Execution Plan directed — no sub-agent fan-out.

**Re-verification findings (Task 1).** All Evidence held. Three counts this
document originally estimated were corrected by measurement and are now
correct above: the exported type block is 41 declarations (not "~45"), the
class has 44 members (not "~45"), and the tail region holds 43 module-private
free functions plus 3 exported ones (not "~50"). The "no instance fields, no accessor pairs"
audit came back clean, which is what makes the base/derived split safe.

**Two design details the plan under-specified, both resolved by measurement.**

1. The class's area graph turned out to be **acyclic under the natural topic
   grouping**, so unlike Phase 88 no file exists purely to break a cycle. The
   plan assumed one might be needed; the honest record is that none was. The
   one near-forced file is `iso-date.ts`, forced by a shared leaf rather than
   by a cycle.
2. `isJsonPrimitive` has two callers, both in `status-runtime.ts`'s area
   (`evaluateStatusCandidate`, `resolveIcon`), and so belongs to no
   free-function topic by usage. It is placed in `format.ts` next to
   `primitiveToText`, its sibling primitive-value helper. That is a judgement
   call, not a measurement, and it is recorded as such.

**Two mechanical traps hit and fixed during emission**, both caught by
`tsc` immediately, which is the value of the typecheck-after-each-file rule:

- Relative import specifiers had to be rewritten one directory deeper
  (`./runtime-types.js` → `../runtime-types.js`,
  `../model/resolved-model.js` → `../../model/resolved-model.js`). Obvious in
  hindsight; the first emission failed on all 14 files.
- Every module-private declaration a sibling area imports had to gain an
  `export` keyword. This is the exported-but-not-re-exported distinction the
  barrel must then be careful about, and it is why `index.ts` enumerates its
  46 re-exports rather than using `export *`.

Phase 88's template-literal scanner trap did **not** recur: the scanner used
here strips comments only, keeping string and template contents, from the
start.

**Verification results:**

- `npx tsc --noEmit` — clean.
- `npm test` — **60 test files, 1,084 tests, all passing, with zero test file
  changes** — the same counts as the pre-split baseline.
- **Differential presentation dump (the phase's real correctness proof)** — a
  throwaway vitest dump (never committed) ran in a `git worktree` at pre-split
  `9066e01` and again against the split tree. Corpus: **381 view evaluations**
  across 35 reference-app views (8 of them composed) and 20 conformance-model
  views, over the 8 seeded reference contexts plus every context the
  conformance cases declare, and every state permutation; **110
  `initializePresentationState`/`applyPresentationStateUpdates` calls**; **57
  conformance presentation cases** dumped with their full `actual` results;
  **72 matrix cell cycles and 14 matrix range edits** including reversed and
  unknown column keys; and a **7,380-call `formatPresentationValue` sweep**
  (6 kinds × 30 patterns × 41 values). The two 9.4 MB canonicalised JSON dumps
  are **byte-identical** (`md5 135f026f8a4fe9d416b4c8fe759cf466`). The dump was
  first proved byte-identical to itself across two baseline runs, so the
  comparison rests on a stable canonicalisation rather than on luck.
- **Export-set reconciliation, both directions** — the 46 exported names of
  the original file were extracted mechanically and compared with the names
  `index.ts` re-exports: equal, no missing, no extra. Separately, a generated
  scratch probe importing all 46 names *by name* from `../src/index.js`
  typechecks clean in both the baseline and the split tree, so the check is
  `tsc`-level and not grep-level.
- **Census** — all 44 class members and all 98 non-class top-level
  declarations verified
  present verbatim in their emitted files (modulo the visibility and `export`
  keywords) before Prettier ran, and the segmentation was proved to reproduce
  the original file line-for-line first, so nothing relied on the extractor
  being trusted. A separate pass confirmed **zero unused imports** across the
  14 new files, since `noUnusedLocals` is off and would not have caught them.
- `npm run format:check` — clean after one `prettier --write` pass over the new
  directory.
- `git diff --stat` — exactly one modified source file
  (`src/runtime/presentation-runtime.ts`, 3,304 → 6 lines) plus 14 new files
  under `src/runtime/presentation-runtime/`. No other source file touched, no
  test file touched.
- File sizes — largest are `format.ts` and `matrix-runtime.ts` at 471 lines
  each, then `row-runtime.ts` at 462 and `types.ts` at 449; median 270. Every
  file is under the 600-line target, against 3,304 before.

**Named, not done:** `npm run build`, `npm run test:visual` and
`npm run verify:push` were deliberately **not** run in this phase's worktree.
They run once at the integration point, after this phase and Phase 89 are
merged, per the project's parallel-execution rule. Until that run lands, this
phase's screenshot and bundle evidence is absent, not clean — the differential
dump proves the runtime's *output* is unchanged, which is the strongest
available proxy, but it is not a rendered-pixel proof.
