# Presentation Runtime File Map

Read this before changing how a presentation view evaluates — before grepping
`src/runtime/` for a status, a calendar cell, a matrix edit or a format
pattern. Since Phase 90, the presentation runtime is a directory of area files
behind a barrel, not a single 3,304-line file. This document says which file
holds which part, and the three structural rules that keep the arrangement
working.

See [[ui-presentation-model]], [[semantic-status-presentation]],
[[presentation-matrix-runtime]] and [[calendar-presentation-runtime]] for what
the presentation runtime *decides*; this document is only about where the code
lives. Same relationship as [[parser-grammar-file-map]] has to [[adl-parser]].

## The shape

`src/runtime/presentation-runtime.ts` is now a 6-line barrel:
`export * from "./presentation-runtime/index.js";`. Every consumer
(`application-runtime.ts`, `edit-surface-runtime.ts`, `adl-composed-view.ts`,
`adl-app.ts`, `src/index.ts`'s `export *`, and the tests) imports that path
unchanged and gets the same **46 names**: 42 types (41 from the old type block
plus `DiagnosticLocation`) and 4 values — `PresentationRuntime`,
`initializePresentationState`, `applyPresentationStateUpdates`,
`formatPresentationValue`.

The implementation is `src/runtime/presentation-runtime/`, and it is a
**hybrid**, because the original file was: seven flat modules for the types and
the pure free functions, and a seven-file linear class chain for
`PresentationRuntime` itself.

## Which file holds what

### Flat modules (types and pure functions — no class, no chain)

| File | Holds |
|---|---|
| `types.ts` | Every renderer-neutral shape: view, sections, controls, lists, matrices, calendars, rows, statuses, icons, fragments, diagnostics, and the `RuntimePresentationDataSource` port. Also the four module-private shapes shared across areas. |
| `format.ts` | `formatPresentationValue` and the whole formatting cluster: `primitiveToText`, `formatNumber`/`Date`/`Time`/`Duration`/`DateTime`, the `DateParts`/`TimeParts` parsers, the `applyDatePattern`/`applyTimePattern`/`replaceTimeTokens` token vocabulary, `MONTH_SHORT`/`WEEKDAY_SHORT`, and the `unsupportedFormat`/`invalidFormatValue` diagnostics. Also `isJsonPrimitive`. |
| `iso-date.ts` | `parseIsoDate`, `addUtcDays` — the two UTC date primitives shared by the calendar grid and the matrix column axis. |
| `calendar-grid.ts` | Month arithmetic: `resolveCalendarMonth` (navigation bounds and labels), `buildCalendarCells` (the fixed 42-cell grid), `calendarWeekdays`, `groupCalendarRowsByDate`, `countCalendarStatuses`, `chooseEffectiveStatus`, the `normaliseCalendarMonth`/`normaliseCalendarDate` parsers, `shiftIsoMonth`. |
| `matrix-edit.ts` | `buildDateColumns` (the column axis), `matrixCellKey`, `primitiveKey`, `nextMatrixCycleValue`, `matrixEditOperation`(`ForRecord`), `matrixEditPatch`. |
| `row-binding.ts` | `objectRecordToPresentationRow`, `readModelRowToPresentationRow`, `rowActionValues` (the row's own record identity for a row-scoped `ACTION`), `sortPresentationRows`/`compareJsonValues`, `dropTrailingWhitespaceOnlyFragment`. |
| `state.ts` | `initializePresentationState`, `applyPresentationStateUpdates`, `valueMatchesPresentationStateType`. |

### The class chain (base first — order matters)

| # | File | Class | Holds |
|---|---|---|---|
| 1 | `base.ts` | `PresentationRuntimeBase` | The constructor and the three `protected readonly` collaborators every area reads: `dataSource`, `index`, `logger`. |
| 2 | `icon-runtime.ts` | `IconRuntime` | `resolveIcon`, `resolveIconMapValue`. |
| 3 | `status-runtime.ts` | `StatusRuntime` | `evaluateStatusBinding`, `evaluateStatusCandidates`(`Candidate`), `resolveStatusMapValue`, `resolveStatus`, `evaluateLegends`/`evaluateLegend`. |
| 4 | `row-runtime.ts` | `RowRuntime` | `bindListRows`, `rowPassesFilter`, `evaluateRow`, `evaluateActionControl`/`ActionInput`/`ActionVisibility`/`CommandActionState`, `evaluateFragments`, `evaluateFieldText`, `evaluateEmptyState`. |
| 5 | `calendar-runtime.ts` | `CalendarRuntime` | `evaluateCalendar`, `resolveConflictOverlay`, `bindCalendarRows`, `evaluateCalendarCell`, `evaluateCalendarItem`. |
| 6 | `matrix-runtime.ts` | `MatrixRuntime` | `evaluateMatrix`, `bindMatrixSourceRows`, `resolveMatrixRowKey`, `evaluateMatrixCell`(`Edit`), `matrixCellRecord`, `requireMatrix`, `planMatrixCellWrite`(`For`), `findMatrixEditRecord`, `applyMatrixCellWrite`. |
| 7 | `index.ts` | `PresentationRuntime` | The five public entry points (`initializeState`, `applyStateUpdates`, `evaluate`, `cycleMatrixCell`, `applyMatrixRangeEdit`), plus `evaluateSection`, `evaluateControl`, `evaluateList`; and the explicit re-export of the 46 public names. |

## Rule 1: the class files are a linear chain, and order matters

Each class extends the one above it in that table —
`IconRuntime extends PresentationRuntimeBase`, … ,
`PresentationRuntime extends MatrixRuntime` — so every `this.evaluateXxx()`
call inside a moved method body still resolves, with no method body edited
during the split. The whole prototype chain assembles into one object at
runtime, exactly as the single class did.

The cost is an ordering constraint: **a lower file cannot call a method defined
in a higher one.** TypeScript enforces this, so a violation is a `tsc` error,
not a silent bug. When you hit it, the fix is to move the shared helper *down*
to a layer below both callers — never to add a back-edge and never to declare
an `abstract` member.

The order is not arbitrary; it fell out of the measured call graph:

- **icons are the deepest leaf.** `resolveIcon` is called by statuses, rows,
  calendars and controls, and calls nothing but itself.
- **statuses sit on icons**, and are called by rows (`evaluateRow`), calendars
  (`resolveConflictOverlay`, `evaluateCalendarItem`), matrices
  (`evaluateMatrixCell`) and the top (`evaluate` → `evaluateLegends`).
- **rows sit on statuses**, and are called by calendars
  (`evaluateCalendarCell` → `evaluateActionControl`) and the top.
- **calendars and matrices never call each other**, so their relative order is
  free.

Unlike [[parser-grammar-file-map]]'s chain, **no file here exists purely to
break a measured cycle** — the presentation runtime was already layered. The
one near-forced file is `iso-date.ts`, which exists because `parseIsoDate` and
`addUtcDays` are the shared leaf of `calendar-grid.ts` and `matrix-edit.ts`; at
12 lines it is smaller than this repository would normally justify, and it is
kept because the alternative (`matrix-edit` importing from `calendar-grid`)
encodes a dependency between two unrelated areas that does not exist.

## Rule 2: the free-function region is flat, deliberately

The 46 free functions and the 42 types hold no shared state and call each other
as ordinary functions, so they are plain modules with a plain import DAG — the
[[compiler-model-layer-file-map]] shape, not the chain shape. **Do not put them
into the chain.** An inheritance chain buys nothing where there is no `this`,
and it would make `formatPresentationValue` — a genuinely standalone exported
function that `edit-surface-runtime.ts` also calls — reachable only through a
class.

## Rule 3: exported from its area file ≠ exported from the module

Six module-private interfaces (`BoundPresentationRow`,
`CalendarConflictOverlay`, `PlannedMatrixCellWrite`, `CalendarGridCell`,
`DateParts`, `TimeParts`) and four module-private constants
(`CALENDAR_WEEKDAYS`, `CALENDAR_MONTH_NAMES`, `MONTH_SHORT`, `WEEKDAY_SHORT`)
were private to the old single file. Splitting forced every one that crosses an
area boundary to gain an `export` keyword so a sibling file can import it.

That must not widen the package's public API, and `src/index.ts` does
`export *` from this path, so anything the barrel forwards *is* public. The
rule that keeps the two apart:

> `index.ts` re-exports the 46 public names **explicitly, one by one**. It never
> does `export * from "./types.js"`.

If you add a shape that other area files need, export it from its area file and
leave `index.ts` alone. If you add one that consumers need, add it to
`index.ts`'s re-export list on purpose.

## Visibility follows the call graph mechanically

A class member called from another area file is `protected`; one called only
within its own file stays `private`. After Phase 90 that is **16 protected
methods, 22 private, 5 public** (`initializeState`, `applyStateUpdates`,
`evaluate`, `cycleMatrixCell`, `applyMatrixRangeEdit`), plus the three
`protected readonly` constructor fields. No two members share a name, so no
base/derived shadowing arises.

There are **no instance fields beyond the constructor's parameter properties
and no `get`/`set` pairs**, which is what makes the base/derived split safe: a
derived-class field initialiser that read a base field via `this.` would run in
a different order after a split, and `tsc` would not complain. Audit that
before adding one.

## Verifying a presentation-runtime change

`npm test` and `tests/presentation-runtime.test.ts` prove a lot, but a
presentation defect is *silently different output*, not a thrown error. For any
change that relocates or restructures this code rather than adding behaviour,
use the differential technique Phase 90 built:

1. `git worktree add` at the pre-change commit.
2. In both trees, run a throwaway vitest dump (never commit it — see
   `AGENTS.md`) that writes one canonicalised JSON document from four
   generators:
   - every view of every object in **both** reference demos (band and jointly),
     composed or not, under every state permutation (each boolean flipped,
     all-true, all-false, each month state shifted ±1/±2/±13 months, invalid
     month strings), across every seeded context;
   - every case in `conformance/presentation/*.json` via `runConformanceSuite`,
     dumping the full `actual`, not pass/fail;
   - every **model** in those suites driven directly — seeded from the union of
     the cases' `setup` steps — then an exhaustive matrix sweep: every cell
     cycled three times so create → update → delete all run, plus whole-grid
     range edits per cycle value and for reversed and unknown column keys;
   - an exhaustive `formatPresentationValue` sweep over every kind × pattern ×
     value.
3. Diff the two dumps.

For Phase 90 that was 381 view evaluations, 110 state calls, 57 conformance
cases, 72 matrix cycles, 14 range edits and 7,380 format calls, and the two
9.4 MB dumps were byte-identical.

**The reference apps declare no matrices.** A corpus built only from the demos
looks broad and silently misses every matrix edit path. Reach into the
conformance models.

## Trap: the dump must be made deterministic before it is trusted

Record ids come from `crypto.randomUUID`, and a random id makes tie-broken row
ordering differ between two runs of the *same* tree. Stub `crypto.randomUUID`
with a counter in the dump, and replace wall-clock timestamps and revision
tokens with constants. Then **prove the baseline dump is byte-identical to
itself across two runs** before comparing trees at all — otherwise a clean diff
means nothing and a dirty one sends you hunting a defect that is not there.

## Trap: identifier scanners and template literals

If you script a change over this code (Phase 90 did, and so should any future
relocation), the scanner that finds `this.<member>` and cross-module references
must strip **comments only** — not string and template contents. Real calls
live inside backticks; a scanner that blanks templates under-detects references
and emits files that fail to compile. This cost Phase 88 an hour; Phase 90
inherited the fix and did not hit it.

## Trap: `noUnusedLocals` is off

`tsconfig.json` does not set `noUnusedLocals`, so an over-broad computed import
list typechecks perfectly clean while leaving junk imports behind. If you
generate imports, check them separately — scan each file's body for each
imported name and fail on any that never appears.

## Related

- [[parser-grammar-file-map]] — the same navigation aid for the parser, split
  by Phase 88 with the same class-chain strategy. Read it for the general rule;
  this file differs in being a hybrid.
- [[compiler-model-layer-file-map]] — the flat-directory shape Phase 81
  established, which this file's free-function region follows.
- [[ui-presentation-model]] — what presentation declarations mean.
- [[semantic-status-presentation]] — the semantics behind `status-runtime.ts`.
- [[presentation-matrix-runtime]] — the semantics behind `matrix-runtime.ts`
  and `matrix-edit.ts`.
- [[calendar-presentation-runtime]] — the semantics behind
  `calendar-runtime.ts` and `calendar-grid.ts`.
- [[browser-ui-runtime]] — `adl-composed-view.ts`, the main consumer of
  `RuntimePresentationView`.
