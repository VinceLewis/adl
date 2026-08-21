# Phase 104 — Give `MATRIX` ADL Text Syntax

`MATRIX` is the last construct in the language that has a full resolved model, a
shipped runtime, eleven conformance cases and a browser renderer — and no way to
write it in `.adl` text at all. Phase 100 gave nine constructs text syntax and
deferred this one by name, on the grounds that it is a whole construct with six
nested sub-structures rather than a clause on an existing block, and nominated it
as its own phase.

> **Phase numbers are no longer execution order in this repository.** The owner
> reprioritised mid-flight: Phases 100 and 101 were executed before Phase 99.
> This document is executed **after Phase 99 lands**, and **after Phases 102 and
> 103**, last in the ordered run 102 → 103 → 104.

## Objective

Every part of `PartialPresentationMatrixModel` is expressible in `.adl` text,
prints from `print-adl.ts`, reparses, and resolves to an identical model. The
printer's `MATRIX` refusal is deleted rather than reworded. `docs/spec/language.md`
carries the construct as first-class language, and
`docs/spec/ui-language-addendum.md` stops describing a syntax that does not exist.

## Evidence and Dependency

Re-verified against the worktree at `3b9f7e0`. The measurements in §4 and §5 were
run by the author, not taken from a prior document.

### 1. Phase 100 deferred it deliberately, and said what would be needed

`docs/phases/phase-100-printer-completeness.md`'s Decision section, under
"Deferred — three, each for a reason that is not convenience":

> `MATRIX`. A whole construct with six nested sub-structures and its own
> resolved-model file. `docs/spec/ui-language-addendum.md` already sketches an
> intended syntax and records that parser support is future work; implementing
> that sketch is its own phase, not a clause on an existing block.

Its Planning Handoff then nominates this phase and argues it: `MATRIX` is "the
only one of the three deferrals that is a *construct* rather than an open design
question", the design work is "already done and reviewed", and "a matrix is also
the one refused construct with real runtime behaviour behind it".

### 2. The refusal, as shipped

`src/compiler/print-adl.ts:899-908`:

```ts
// NO TEXT SYNTAX: MATRIX has a full resolved-model/JSON shape …
if (section.matrices !== undefined && section.matrices.length > 0) {
  throw new Error(
    `printPartialApplicationModelAsAdl: section '${section.name}' declares a MATRIX, which has no ADL text syntax yet. See docs/spec/adlj.md.`,
  );
}
```

Pinned by `tests/compile-adlj.test.ts:612-630` ("refuses a MATRIX by name").

### 3. The shape that needs syntax

`src/model/resolved-model/presentation-matrix.ts` — one construct, six nested
structures, three closed enums:

| Structure | Fields | Line |
|---|---|---|
| `ResolvedPresentationMatrix` | `name`, `density`, `rowSource`, `columnAxis`, `cellSource`, `cell`, `edit?` | 16 |
| `…AxisSource` | `sourceKind`, `source`, `keyField?`, `labelField`, `fields[]`, `sort[]` | 25 |
| `…DateColumnAxis` | `kind`, `start`, `end`, `stepDays`, `labelFormat?` | 33 |
| `…CellSource` | `sourceKind`, `source`, `rowField`, `columnField`, `fields[]`, `status?`, `recordSource?` | 40 |
| `…Cell` | `status?`, `unsetStatus?`, `accessibleLabel?` | 49 |
| `…Edit` | `object`, `rowField`, `columnField`, `valueField`, `cycle[]`, `unsetValue?`, `unsetAsAbsence`, `bulkBehavior` | 54 |

Enums: `PresentationMatrixSourceKind = "readModel" | "object"` (line 13),
`PresentationMatrixColumnKind = "dateRange"` (14),
`PresentationMatrixBulkBehavior = "sequentialValidatedWrites"` (15).

Resolver defaults, which decide what the printer may omit
(`src/compiler/resolve-model/presentation-matrix.ts:19-103`): `density` →
`"comfortable"`, both `sourceKind`s → `"readModel"`, `columnAxis.kind` →
`"dateRange"`, `stepDays` → `1`, `fields`/`sort`/`cycle` → `[]`,
`unsetAsAbsence` → `false`, `bulkBehavior` → `"sequentialValidatedWrites"`,
`cell` → `{}` when absent.

Eleven validator codes already exist
(`src/compiler/validate-model/codes.ts:271-281`), so the new grammar reaches a
validator that is already there rather than needing one.

### 4. The addendum's sketch is materially incomplete — measured against the model

`docs/spec/ui-language-addendum.md:344-357`:

```text
MATRIX AvailabilityMatrix
  ROWS FROM Members KEY User LABEL Name
  COLUMNS DATE_RANGE 2026-08-01 TO 2026-08-14 STEP_DAYS 1
  CELLS FROM AvailabilityCells ROW User COLUMN Date
  STATUS AvailabilityStatus(Status), BusyStatus(BusyElsewhere)
  UNSET_STATUS unset
  EDIT Availability VALUE Status CYCLE Available Unavailable UNSET_AS_ABSENCE
END.MATRIX
```

Walking it against the table in §3:

- **It omits two *required* fields.** `edit.rowField` and `edit.columnField` are
  non-optional in `ResolvedPresentationMatrixEdit` (lines 56-57) and the sketch
  has neither. A matrix authored from the sketch could not resolve.
- **It omits nine optional or defaulted ones**: `density`, `rowSource.fields`,
  `rowSource.sort`, `columnAxis.labelFormat`, `cellSource.fields`,
  `cellSource.recordSource`, `cell.accessibleLabel`, `edit.unsetValue`,
  `edit.bulkBehavior`.
- **It cannot express either `sourceKind`.** `FROM Members` gives no way to say
  `object` versus `readModel`, and the resolver defaults to `readModel` — so the
  sketch cannot author the object-sourced matrix that the conformance corpus
  actually uses.
- **It cannot express both status bindings.** `cellSource.status` and
  `cell.status` are distinct and the runtime prefers the latter:
  `src/runtime/presentation-runtime/matrix-runtime.ts:205` —
  `matrix.cell.status ?? matrix.cellSource.status`. The sketch's single
  top-level `STATUS` is ambiguous between them.
- **Its `STATUS` line contradicts the language's own status syntax.**
  `AvailabilityStatus(Status), BusyStatus(BusyElsewhere)` is a comma-separated
  list with a bare parenthesised field. Everywhere else — `LIST`, `CALENDAR`,
  `TOGGLE`, and `printPresentationStatusCandidate`
  (`src/compiler/print-adl.ts:1143-1158`) — a candidate is one `STATUS`
  directive per line, spelled `STATUS <name>`, `STATUS <map>(FIELD <field>)` or
  `STATUS <map>(VALUE <literal>)`.
- **Its dates are unquoted.** `CALENDAR`'s `RANGE` prints quoted string literals
  (`src/compiler/print-adl.ts:1100-1102`).

The sketch has been in the specification since Phase 29 and has never been
compiled, because there has never been anything to compile it with. It is a
sketch, not a reviewed grammar.

### 5. The round-trip subject exists, and it is not a reference app

Measured by walking every compiled model in the repository:

- **Neither reference app declares a `MATRIX`.** Giggle Band's availability board
  is `TeamAvailabilityList`, a `LIST` over the `BandMemberAvailability` read model
  (`src/reference/giggle-band/ui.adlj`, `objects[2].views[0].presentation.sections[0].lists[0]`).
  Jointly Care declares none.
- **`conformance/presentation/status-matrix-calendar.json`'s `resourceMatrix`
  model declares two**: `Grid/Availability/AvailabilityMatrix` and
  `SteppedGrid/Availability/SteppedMatrix`. Run through `compileAdlj` it produces
  **zero diagnostics** — it is a complete, valid, reviewed two-matrix
  application, and it is the corpus the eleven runtime matrix conformance cases
  already execute against.
- Between them those two matrices exercise `density`, `keyField`, `labelField`,
  `fields`, `sort` in both directions, a column axis with and without
  `stepDays`, one with and one without `labelFormat`, a `cellSource.status` map
  candidate, `cell.unsetStatus`, `cell.accessibleLabel`, and an `edit` with
  `cycle` and `unsetAsAbsence`. They do **not** reach: `sourceKind: "readModel"`,
  `cellSource.recordSource`, `cell.status`, `edit.unsetValue`, an explicit
  `edit.bulkBehavior`, the `status`/`map(FIELD)`/`map(VALUE)` candidate kinds, or
  more than one candidate. Those are exactly what the coverage fixture must add.
- **`cellSource.recordSource` is read by nothing.** `grep -rn "recordSource"`
  over `src/`, `docs/` and `conformance/` returns four hits: the two type
  declarations (`presentation-matrix.ts:47,95`), the `.adlj` schema
  (`adlj-schema.json:2292`), and the resolver line that copies it
  (`resolve-model/presentation-matrix.ts:73`). No validator, no runtime, no
  specification, no conformance case. It is a dead model field — see Decision.

### 6. The five-part recipe and the fail-first standard already exist

Phase 100 established both: grammar → AST node → `BlockName` entry → conversion →
printer branch, and "every new grammar rule must be shown failing on the
pre-change grammar" with the failure message recorded. Its execution note carries
eleven worked examples. `learnings/implementation/parser-grammar-file-map.md`
carries the chain rule and the `BlockName` trap.

**Dependency:** Phases 99, 102 and 103, by ordering only. Nothing here depends on
any of their content. Phase 100 is a hard content dependency: this phase reuses
its conventions, its helpers and its test shapes.

## Decision

### Adopt the addendum's *skeleton*; amend its syntax

The sketch's five section keywords — `ROWS`, `COLUMNS`, `CELLS`, `STATUS` /
`UNSET_STATUS`, `EDIT` — are kept, because they name the right things and have
been in the specification since Phase 29. Everything below the keyword is
amended, for the reasons measured in Evidence §4.

### The surface syntax

```adl
MATRIX AvailabilityMatrix
  DENSITY COMPACT
  ROWS FROM OBJECT Member
    KEY MemberKey
    LABEL MemberName
    FIELDS MemberKey MemberName
    ORDER BY MemberName ASC
  END.ROWS
  COLUMNS DATE_RANGE '2026-03-02' TO '2026-03-06' STEP_DAYS 3 LABEL_FORMAT DATE 'EEE d'
  CELLS FROM OBJECT Availability ROW MemberKey COLUMN Day
    FIELDS MemberKey Day State
    RECORD_SOURCE AvailabilityRecords
    STATUS StateStatus(FIELD State)
    STATUS busyElsewhere
  END.CELLS
  CELL
    STATUS ConflictStatus(VALUE 'double-booked')
    UNSET_STATUS unset
    ACCESSIBLE_LABEL 'Availability cell'
  END.CELL
  EDIT Availability ROW MemberKey COLUMN Day VALUE State
    CYCLE 'available' 'unavailable'
    UNSET_VALUE null
    UNSET_AS_ABSENCE
    BULK_BEHAVIOR SEQUENTIAL_VALIDATED_WRITES
  END.EDIT
END.MATRIX
```

That example **has not been compiled**, and could not be: it is the syntax this
phase creates, and no compiler in the repository accepts it yet. It is a
specification, not verified source. `AGENTS.md`'s compile-check rule binds from
Task 2 onward — every example in it, and every example that reaches
`docs/spec/*`, must go through `compileAdl` with `diagnostics: []` before it is
committed. Treat any divergence between this block and what the grammar actually
accepts as a defect in this document, and correct the document.

Clause-by-clause, and why each shape rather than another:

**`MATRIX <name>` is a block with `END.MATRIX`**, sitting beside `LIST` and
`CALENDAR` inside a `SECTION`. `DENSITY` is a directive on the block, matching
`LIST`/`CALENDAR` (`print-adl.ts:1079-1081`), not a header option — the header
already carries the name and nothing else does.

**`ROWS` and `CELLS` are blocks**, by Phase 100's stated rule that a multi-clause
construct is a block with an `END.X` terminator. `ROWS` carries five parts, two of
them lists; `CELLS` carries six, one of them a repeatable `STATUS`. A one-line
`ROWS FROM OBJECT Member KEY MemberKey LABEL MemberName FIELDS MemberKey
MemberName ORDER BY MemberName ASC` is 106 columns before indentation and reads as
a run-on — the exact objection Phase 100 raised against a one-line
`CONFLICT_OVERLAY`. Blocks are also the only way to keep the two `FIELDS` lists
apart: `rowSource.fields` and `cellSource.fields` are different lists and a flat
`MATRIX` body could not distinguish them.

**`FROM OBJECT X` / `FROM READ_MODEL X`** rather than a bare `FROM X`. This is
`printPresentationSourceRef`'s existing spelling (`print-adl.ts:1016-1022`),
already used by `LIST` and `CALENDAR`. The sketch's bare `FROM Members` cannot
express `sourceKind` at all, and defaulting silently to `readModel` would make
every object-sourced matrix — which is what the conformance corpus actually uses —
unwritable.

**`COLUMNS` is one physical line.** It is the one sub-structure that is genuinely
a simple record: a kind word, two dates, and two optional trailing options. A
block for it would be Phase 100's "four lines of ceremony around three words"
objection, and the common printed case —
`COLUMNS DATE_RANGE '2026-03-02' TO '2026-03-06' LABEL_FORMAT DATE 'EEE d'` — is
75 columns with indentation, inside the threshold Phase 100 used. `DATE_RANGE` is
spelled out even though it is the only `PresentationMatrixColumnKind`, so that
adding a second kind later is a new word rather than a breaking reinterpretation
of an unmarked line. `LABEL_FORMAT <kind> ['pattern']` reuses
`printPresentationFormat` and mirrors Phase 100's own `MONTH_LABEL_FORMAT`.

**`STATUS` is one directive per candidate**, spelled exactly as
`printPresentationStatusCandidate` already prints it: `STATUS <status>`,
`STATUS <map>(FIELD <field>)`, `STATUS <map>(VALUE <literal>)`. The sketch's
comma-separated `Map(Field)` list is rejected outright: it is a second, parallel
status syntax for no gain, and the bare parenthesised name is exactly the
`FIELD`-versus-`VALUE` ambiguity that `printPresentationIconRef`'s doc comment
(`print-adl.ts:859-866`) says the printer must always disambiguate.

**`CELL` is its own block**, and this is the amendment that matters most. The
sketch's flat `STATUS` + `UNSET_STATUS` cannot say which of the two status
bindings it means, and the runtime treats them differently — `cell.status`
overrides `cellSource.status` (`matrix-runtime.ts:205`). Nesting each under the
structure it belongs to removes the ambiguity by construction. `ACCESSIBLE_LABEL`
joins it because it is a cell property (`matrix-runtime.ts:226-230`).

**`EDIT <object> ROW <f> COLUMN <f> VALUE <f>` is a block** with the four
required parts on the header and the four optional ones as directives. The object
name is bare, not `OBJECT X`, because an edit always writes an object — there is
no `sourceKind` to disambiguate — which is the same reasoning behind Phase 100's
bare `CHILD <object> PARENT_FIELD <field>`. The sketch's omission of `ROW` and
`COLUMN` is a plain error against the model and is corrected, not preserved.
`CYCLE` takes a whitespace-separated list of literals, printed with
`printLiteralValue`, because `cycle` is `JsonPrimitive[]` — the sketch's bare
`Available Unavailable` would resolve to identifiers, not the string values a
cell actually stores. `UNSET_AS_ABSENCE` uses `parseOptionalBoolean`
(`src/parser/grammar/clauses.ts:17-19`), the established flag convention: bare
keyword means `true`, an explicit boolean is also accepted.

**`UNSET_VALUE` is a trap and is called out explicitly.** `unsetValue` is
`JsonPrimitive | null | undefined`, and the resolver distinguishes absent from
`null` (`resolve-model/presentation-matrix.ts:100`). So `UNSET_VALUE null` must
produce `unsetValue: null` and an omitted directive must produce absence. A
printer that prints nothing for `null` silently changes the model.

**`RECORD_SOURCE` gets syntax even though nothing reads it.** `recordSource` is a
dead field (Evidence §5). The printer's contract is completeness, so it prints;
giving it no syntax would reintroduce the silent-drop failure mode this whole line
of work exists to close. Deleting it instead would be a language decision taken
under cover of a printer task — the move Phase 100 explicitly declined — and it
belongs in its own small phase. Recorded in the Planning Handoff.

### Where the grammar lives

`src/parser/grammar/presentation-source.ts`, beside `LIST` and `CALENDAR`, called
from `SECTION` in `presentation-core.ts`. Per
`learnings/implementation/parser-grammar-file-map.md`'s chain rule, everything a
matrix needs already sits at or below that layer: `parsePresentationStatusCandidate`
(same file), `parseSortList` (`clauses.ts`), `parsePresentationFormat` and the
density/scalar readers (`presentation-scalars.ts`), and the literal and name-list
readers (`literals.ts`). **No file needs to move and no new grammar-area file is
needed** — the same result Phase 100 measured for its own additions.

`BlockName` in `src/parser/ast.ts:67-95` gains five entries: `MATRIX`, `ROWS`,
`CELLS`, `CELL`, `EDIT`. This is the trap the file map warns about — `parseEnd` /
`checkEnd` take a `BlockName`, so a missing entry is a `tsc` error in a different
file from the grammar. None of the five collides with an existing entry, and
`EDIT` does not collide with `EDIT_CONTAINER` or `EDIT_SECTION`, which are single
keywords with no spaced alias (`src/parser/grammar/view.ts:118,151,172`).

### Rejected alternatives

**Adopt the addendum's sketch as-is.** It cannot express two required fields, two
source kinds, one of the two status bindings, or nine optional ones, and its
`STATUS` line contradicts the status syntax the rest of the language already uses
(Evidence §4). Shipping it would mean shipping a grammar that cannot round-trip
the corpus the runtime already executes.

**A flat `MATRIX` body with prefixed directives** — `ROW_FIELDS`, `CELL_FIELDS`,
`ROW_SOURCE`, `CELL_STATUS`, `CELL_UNSET_STATUS` and so on. It avoids five
`BlockName` entries and it is what a smaller construct would deserve. Rejected:
`MATRIX` has six nested structures, three of which have their own optional
sub-parts, so a flat body needs a disambiguating prefix on roughly a dozen
directives and the reader has to reassemble the structure mentally. The language
already uses nesting for exactly this — `VIEW` contains `SECTION` contains `LIST`
contains `ROW`.

**Make `COLUMNS` a block too, for uniformity.** Tempting, and rejected on
Phase 100's own stated grounds: the common case is a kind word and two dates, and
wrapping that in `END.COLUMNS` is ceremony. Uniformity of *shape* is not the rule
Phase 100 set; "block when multi-clause, one line when it is a simple record" is.

**Delete `cellSource.recordSource` instead of giving it syntax.** See above. It
is probably the right end state and it is not this phase's decision to make.

**Add a `MATRIX` to a reference app so the round-trip has a real subject.**
Discussed in the next section; rejected for this phase and recommended as a
follow-up.

### The acceptance test, and where its subject comes from

Phase 100 established the standard: compile → print → reparse → **`toEqual`** on
the resolved model, over a real application, with printed-text pins for the
constructs whose whole risk is being silently dropped. Neither reference app
declares a matrix, so this phase uses three subjects instead of one, in
descending order of realism:

1. **The `resourceMatrix` conformance model** (`conformance/presentation/status-matrix-calendar.json`).
   Two real matrices, compiles clean through `compileAdlj` with zero diagnostics
   (measured), and it is already the model the eleven runtime matrix conformance
   cases execute against. `compileAdlj` → `printPartialApplicationModelAsAdl` →
   `compileAdl` → `toEqual` on the resolved model. This is as close to "a real
   application" as `MATRIX` has, and it has the property that matters: it was
   authored to exercise the runtime, not the printer, so it cannot have been
   shaped to fit the grammar.
2. **The `PRINTER_COVERAGE_SOURCE` fixture** (`tests/compile-adlj.test.ts:255-349`),
   extended with a matrix reaching everything the conformance corpus does not:
   `sourceKind: "readModel"` on both sources, `cellSource.recordSource`,
   `cell.status`, `edit.unsetValue` (including the `null` case),
   an explicit `edit.bulkBehavior`, and all three status-candidate kinds with more
   than one candidate. Phase 100 created this fixture for exactly this purpose and
   it is where constructs no application reaches are kept honest.
3. **A `resourceMatrixAdlSource` conformance model**, an `adl`-source model
   mirroring `calendarConflictOverlayAdlSource` (Phase 100's precedent, and the
   only `adl`-keyed model in that file today), with a `resolveModel` case
   asserting the text resolves to the same shape the JSON `resourceMatrix`
   produces. This is what makes the syntax *specification* rather than an
   implementation detail of the printer.

**Recommendation on a reference app: yes, but as a follow-up phase, not here.**
Giggle Band's `TeamAvailabilityList` — a `LIST` over the `BandMemberAvailability`
read model on the availability board — is a member × date availability grid
rendered as a list, which is precisely the shape Phase 37 built the matrix runtime
for. Converting it would give the language its first real matrix and would
probably be a better screen. It is out of scope here because it is a *content*
change: it moves Giggle Band's `modelFingerprint`, so it needs a `modelVersion`
bump with a migration hop and a real-browser persisted-state upgrade test
(`AGENTS.md`, Testing), plus `npm run verify:push` with the availability-board
screenshots inspected and an `/impeccable audit` pass, plus a product judgement
about whether a matrix or a list is the better board. Bundling that into a
grammar phase would put a UI decision behind a parser change.

## Scope

- `src/parser/grammar/presentation-source.ts`: `parsePresentationMatrix` and its
  five sub-parsers; `presentation-core.ts`: the `SECTION` dispatch and its
  `failUnexpected` accepted-directives message.
- `src/parser/ast.ts`: the matrix AST nodes and five `BlockName` entries.
- `src/compiler/compile-adl.ts`: AST → `PartialPresentationMatrixModel`.
- `src/compiler/print-adl.ts:899-908`: the throw is **deleted** and replaced by
  `printPresentationMatrix`, plus its sub-printers.
- `docs/spec/language.md`: `MATRIX` as first-class language, with a compiled
  example.
- `docs/spec/ui-language-addendum.md:338-357`: the sketch is replaced by the real
  syntax and the "parser support remains future work" sentence is deleted.
- `docs/spec/adlj.md`: `MATRIX` leaves the unprintable list; the mapping table
  gains its `.adlj` ↔ `.adl` correspondence.
- `tests/compile-adlj.test.ts`: the `MATRIX` refusal test at 612-630 is replaced
  by the two round-trips; `PRINTER_COVERAGE_SOURCE` gains a matrix.
- `tests/parser.test.ts`: the new grammar's own refusals.
- `conformance/presentation/status-matrix-calendar.json`: the
  `resourceMatrixAdlSource` model and its case.
- `learnings/implementation/presentation-matrix-runtime.md`,
  `implementation/adl-parser.md`, `implementation/parser-grammar-file-map.md`,
  `implementation/reference-app-drift.md` (which records `MATRIX` as unprintable).

## Non-goals

- **No change to `resolve-model`, `validate-model` or any runtime service.** The
  runtime consumes the resolved model; all eleven `ADL_PRESENTATION_MATRIX_*`
  codes and the whole matrix runtime already accept these shapes. If any of them
  needs a change, the grammar is producing the wrong shape.
- **No reference-app content change.** No `modelVersion` and no
  `modelFingerprint` moves, so no migration hop and no persisted-state upgrade
  test is implicated. This must be **measured**, as Phase 100 measured it.
- **No deletion of `cellSource.recordSource`**, and no new validator for it.
- **No second `PresentationMatrixColumnKind`** (a resource axis, a numeric axis).
  `dateRange` is the only kind the runtime implements; inventing a second in a
  grammar phase would be a language decision by fiat.
- **The other two Phase 100 deferrals stay deferred.** Conditional row fragments
  and per-view `presentation.shell.regions` are open *language questions* in
  `ui-language-addendum.md`, not missing grammar, and both need an answer from
  the repository owner first. Their refusal tests
  (`tests/compile-adlj.test.ts:632` onward) stay green.
- **No browser, CSS, shell-chrome or presentation-runtime change.**

## Constraints

- `src/parser/grammar/` is a linear class chain: a lower file may not call a
  method defined in a higher one, and the fix is always to move the shared helper
  down, never to add a back-edge
  (`learnings/implementation/parser-grammar-file-map.md`).
- Every new grammar rule must be shown failing on the pre-change grammar, with
  the failure message recorded — Phase 100's standard, and the only evidence that
  a rule is new rather than accidentally already accepted.
- **Assert on resolved models, not printed text.** Text formatting is not the
  contract; semantic identity is. Printed-text pins are additional, for the parts
  whose whole risk is being silently dropped — `recordSource`, `cell.status` and
  `UNSET_VALUE null` are the three most likely to vanish without a model-equality
  assertion noticing, because a resolver default or an absent key can mask each.
- No test may be weakened. The `MATRIX` refusal test is *replaced* by round-trips
  covering strictly more, exactly as Phase 100 replaced its own refusal test when
  Giggle Band began to print.
- No `modelVersion` and no `modelFingerprint` may move.
- Every ADL example added to any specification document must be run through
  `compileAdl` with `diagnostics: []` before it is committed (`AGENTS.md`).

## Acceptance Criteria

1. `conformance/presentation/status-matrix-calendar.json`'s `resourceMatrix`
   model compiles, prints, reparses with zero diagnostics and resolves to a
   `toEqual`-identical model.
2. The extended `PRINTER_COVERAGE_SOURCE` does the same, reaching every field in
   `PartialPresentationMatrixModel` — including `recordSource`, `cell.status`,
   `unsetValue: null`, an explicit `bulkBehavior`, `sourceKind: "readModel"`, and
   all three status-candidate kinds.
3. `printPartialApplicationModelAsAdl` no longer throws on a matrix, anywhere.
4. Every new grammar rule was shown failing on the pre-change grammar, with the
   message recorded in the execution note.
5. `MATRIX` is documented in `docs/spec/language.md` with a compiled example, and
   `ui-language-addendum.md` no longer describes an unimplemented syntax.
6. `docs/spec/adlj.md`'s unprintable list is true after the change.
7. The `resourceMatrixAdlSource` conformance case passes and was shown to
   discriminate.
8. No `modelVersion` and no `modelFingerprint` moves, measured from both compiled
   reference-app models.
9. `npx tsc --noEmit`, `prettier --check`, unit, conformance and integration
   suites all clean, with no test weakened.

## Testing

- **Unit** (`npx vitest run`; baseline 1,128 after Phase 101, plus whatever
  Phases 102 and 103 add).
  - `tests/compile-adlj.test.ts`: the `resourceMatrix` round-trip; the extended
    coverage-fixture round-trip; printed-text pins on `RECORD_SOURCE`, the
    `CELL … STATUS` block and `UNSET_VALUE null`. The `MATRIX` refusal test is
    removed and its two siblings (conditional row fragment, per-view shell
    regions) stay.
  - `tests/adl-to-adlj.test.ts`: `.adlj` → print → `importAdlAsAdlj` → `.adlj` →
    identical model, over a matrix-bearing source — the full circle Phase 100
    added for its own constructs.
  - `tests/parser.test.ts`: the new grammar's refusals — an unterminated
    `MATRIX`; a `ROWS` with no `LABEL`; a `COLUMNS` with no `TO`; an unknown
    column kind; a `CELLS` missing `ROW` or `COLUMN`; an `EDIT` missing `VALUE`;
    an unknown `BULK_BEHAVIOR`; a bare-identifier status candidate with no
    `FIELD`/`VALUE` keyword; and the updated `SECTION` accepted-directives
    message.
- **Conformance.** `resourceMatrixAdlSource` plus a `resolveModel` case, shown to
  discriminate by breaking one expectation and watching it fail
  (`learnings/implementation/conformance-suite.md`). The eleven existing runtime
  matrix cases must stay green untouched — if the grammar work changes any of
  them, the grammar is producing a different shape.
- **Integration** (`--config vitest.integration.config.ts`). No test is edited,
  but the suite is run: this phase changes the parser, which Phase 100 also
  treated as reason enough.
- **Differential parser corpus.** Not required. That technique
  (`parser-grammar-file-map.md`) is for *relocating* parser code; this phase only
  adds grammar, and adds no file to the chain.
- **Not run:** `npm run verify:push`, `npm run build`, Playwright. No browser
  rendering, shell chrome, reference-app screen, presentation-runtime output or
  CSS changes, and both fingerprints are unchanged, so no screenshot delta is
  possible.

## Parallel Execution Plan

**Serial.** This is the same shape Phase 100 was, and its reasoning applies
unchanged: one chain of dependent edits through five layers of the same parser
class chain, where every later layer's shape is decided by the one below it — the
AST node decides the conversion, which decides the printer, which decides the
tests. Fanning out would mean agents predicting each other's outputs, which is the
one thing this repository's parallel-execution rule exists to prevent.

The one genuinely independent stream is the specification prose
(`language.md`, `ui-language-addendum.md`, `adlj.md`), and it is **not** worth
splitting off: every example in it must be compile-checked against the grammar
that does not exist until the serial work is done.

No shared-spine file is touched. `src/index.ts`,
`src/ui/components/register.ts`, shell chrome and the ordered migration SQL are
untouched; the conformance corpus is touched in one file by one agent; and no
reference-app fixture is touched at all.

## Tasks

1. Re-verify Evidence §4 and §5 against the tree as found: the sketch's gaps
   against `presentation-matrix.ts`, and that `resourceMatrix` still compiles
   clean with two matrices.
2. Write the intended syntax as probes and show every rule failing on the
   pre-change grammar; record each message.
3. Add the AST nodes and the five `BlockName` entries.
4. Add `parsePresentationMatrix` and its sub-parsers to
   `presentation-source.ts`; wire the `SECTION` dispatch in
   `presentation-core.ts` and update its accepted-directives message.
5. Add the AST → partial-model conversion in `compile-adl.ts`.
6. Delete the printer's throw; add `printPresentationMatrix` and its
   sub-printers, taking care that `UNSET_VALUE null`, `RECORD_SOURCE` and
   `CELL … STATUS` all survive.
7. Round-trip the `resourceMatrix` conformance model; fix what it exposes.
8. Extend `PRINTER_COVERAGE_SOURCE` with everything the conformance corpus does
   not reach; round-trip it; add the printed-text pins.
9. Add the parser refusal tests and the `resourceMatrixAdlSource` conformance
   model and case; show the case discriminates.
10. Replace the `MATRIX` refusal test; leave the other two standing.
11. Update `language.md`, `ui-language-addendum.md` and `adlj.md`;
    compile-check every new example through `compileAdl`.
12. Measure both reference apps' `modelVersion` and `modelFingerprint` and record
    that neither moved.
13. Update the four learning documents that assert `MATRIX` is unprintable.

## Planning Handoff

With this phase, every construct in `docs/spec/adlj.md`'s mapping table that is a
*construct* has ADL text syntax. The two remaining refusals are open language
questions, not missing grammar, and both should stay refused until the repository
owner answers them.

Candidates for the next phase, in the order this document would rank them:

- **Convert Giggle Band's `TeamAvailabilityList` to a `MATRIX`.** Recommended
  above. It gives the language its first matrix in a shipped application, it is
  probably a better availability board, and after this phase it is a pure content
  change with a well-understood cost: a `modelVersion` bump with a migration hop,
  a real-browser persisted-state upgrade test for Giggle Band, `verify:push` with
  the board's screenshots inspected on both viewports, and an `/impeccable`
  pass. It is also the thing that would prove the syntax works end to end in a
  way no fixture can.
- **Delete `cellSource.recordSource`, or give it a meaning.** A resolved-model
  field, in the `.adlj` schema, copied by the resolver, read by nothing — and
  after this phase, with grammar and a printer branch as well. Either it names
  something the matrix runtime should do, or it should go. Small, and it is a
  language decision that deserves its own document rather than a line in a
  grammar phase.
- **`normalisePresentationFormatKind`'s silent fallback**
  (`src/parser/grammar/presentation-scalars.ts`), carried forward from Phase
  100's handoff: an unrecognised kind word falls back to `"text"`, so
  `FORMAT duraton 'm:ss'` parses clean and means something else. The same
  silent-wrong-parse shape Phase 100 fixed one layer up. Still unreached by
  anything in the repository, which is why it keeps being deferred.
- **`compileAdlj` omitting `contexts`/`readModels` keys that `compileAdl` emits
  as `[]`.** Cosmetic, documented, and carried forward from Phase 98's handoff
  through Phase 100's. It stays carried forward.

The two open language questions — how much conditional logic belongs in a row
template, and whether view-scoped shell regions get source syntax — are
deliberately **not** proposed. Both need an owner decision first, and a phase that
invents one would be making a language decision under cover of a printer task:
the move Phase 100 declined and this phase declines again.

---

# Execution Note (2026-08-21)

Executed on a branch off `c552cfc` (Phases 102 and 103 merged). Everything below
was measured on that tree, not read off this document.

## Evidence that had drifted, and what still held

**Every substantive claim in "Evidence and Dependency" held.** Two things in the
rest of the document did not:

- **There is no "per-view shell regions" refusal test, and never was one on this
  branch.** Scope (line 431) and Testing (line 485) both say the `MATRIX`
  refusal test has "two siblings (conditional row fragment, per-view shell
  regions)" that stay green. `tests/compile-adlj.test.ts` has exactly **one**
  sibling, the conditional row fragment, and `print-adl.ts` has exactly two
  `NO TEXT SYNTAX` refusals, not three. `docs/spec/adlj.md` carried the same
  error in prose — "Three constructs still have … no ADL text syntax" above a
  list of two — which is where it probably came from. Per-view
  `presentation.shell.regions` was **removed as a construct** by Phase 99, as
  `learnings/implementation/adlj-json-authoring-surface.md` records; there is
  nothing left to refuse. `docs/spec/adlj.md` is corrected here; it now says
  "One".
- **`learnings/implementation/reference-app-drift.md` does not record `MATRIX`
  as unprintable.** Scope names it as one of four learning documents to update.
  `grep -n MATRIX` over it returns nothing. Not updated; the four documents
  actually carrying the claim are `presentation-matrix-runtime.md`,
  `adlj-json-authoring-surface.md`, `ui-presentation-model.md` and
  `calendar-presentation-runtime.md`, and all four are updated.

Line numbers that were checked and still resolve: `print-adl.ts:899-908` (the
throw), `presentation-matrix.ts` (all six structure declarations and the three
enums), `resolve-model/presentation-matrix.ts:19-103` (every default),
`validate-model/codes.ts:271-281` (eleven codes — they are at `286-296` now,
same eleven), `tests/compile-adlj.test.ts:612-630` (the refusal test, now at
`840`), `ui-language-addendum.md:344-357` (the sketch).

Measured afresh: `conformance/presentation/status-matrix-calendar.json`'s
`resourceMatrix` still compiles through `compileAdlj` with **zero
diagnostics** and still declares exactly two matrices; neither reference app
declares one.

## The document's surface syntax was right in every clause but one

The `## Decision` block compiles as written, with a single spelling change:
`STATUS <map>(FIELD <field>)` and `STATUS <map>(VALUE <literal>)` were both
already correct, but the document had no spelling at all for a **third** map
form the corpus actually uses. See below.

## The defect the document did not predict: a status candidate with no field

Deleting the `MATRIX` refusal was **not** enough to print the conformance
corpus. `printPresentationStatusCandidate` (`print-adl.ts`) throws for a
candidate of kind `map` carrying neither `field` nor `value`:

```
printPartialApplicationModelAsAdl: STATUS map reference 'StateStatus' must declare field or value.
```

That shape means "use the status map's own declared field". It is legal in
`PartialPresentationStatusCandidateModel`, `validatePresentationMatrixStatusBinding`
handles it explicitly (`candidate.field === undefined` → check the *map's*
field), and **both** of `resourceMatrix`'s matrices use it. It affects `LIST`
and `CALENDAR` identically; nothing had it on any list, because it is not a
construct with no syntax, it is one branch of a construct that has syntax.

Spelling it as a bare `STATUS StateStatus` was not available: that reparses as a
**direct status reference** named after the map — a different resolved model,
with a clean typecheck and a green suite. Exactly the silent widening Phase 103
measured for policy principals. The form added is `STATUS <map>()`, symmetric
with the other two, and both halves are pinned:
`expect(printed).not.toMatch(/^\s*STATUS SlotStatus$/m)` beside the positive
pin, and a conformance expectation asserting the candidate's `kind` is `map`
rather than `status`.

## Red-first evidence

Every new grammar rule was written as a test first and run against the
pre-change grammar. All twenty-one malformed-matrix probes plus the positive
parse failed with the same single message, because the whole construct was new:

```
FAIL  tests/parser.test.ts > ADL parser > parses a complete MATRIX into a section's matrices
ParseError: Expected SECTION directive HEADING, LAYOUT, DENSITY, TOGGLE, SELECT,
CONTEXT_SELECTOR, ACTION, LIST, CALENDAR, or END.SECTION, but found 'MATRIX'. at 10:7
```

```
FAIL  tests/parser.test.ts > ADL parser > reports malformed MATRIX declarations with the options they accept
AssertionError: expected 'Expected SECTION directive HEADING, L…' to contain 'Expected END.MATRIX, but found \'END\…'
Expected: "Expected END.MATRIX, but found 'END'."
Received: "Expected SECTION directive HEADING, LAYOUT, DENSITY, TOGGLE, SELECT, CONTEXT_SELECTOR, ACTION, LIST, CALENDAR, or END.SECTION, but found 'MATRIX'."
```

```
FAIL  tests/parser.test.ts > ADL parser > names MATRIX among the directives a SECTION accepts
Expected: "…ACTION, LIST, CALENDAR, MATRIX, or END.SECTION, but found 'WHERE'."
Received: "…ACTION, LIST, CALENDAR, or END.SECTION, but found 'WHERE'."
```

`Test Files 1 failed (1) | Tests 3 failed | 47 passed (50)` before the grammar
existed; `50 passed (50)` after.

## `tsc` found two consumers of the widened AST node, and missed the two that mattered

Adding a required `matrices` field to `PresentationSectionDeclarationAst` made
`npx tsc --noEmit` name the grammar and the AST-to-partial conversion. It said
nothing about `print-adl.ts` — whose gap was a `throw` to be replaced by hand —
and nothing about `adl-to-adlj.ts`, which carries the field through a
`{ controls, lists, calendars, ...rest }` spread and would have carried a wrong
shape exactly as silently as a right one. Both were found by
`grep -rn "\.calendars"`, and `adl-to-adlj.ts` now has its own full-circle test.

`src/model/adlj-schema.json` needed no regeneration: no resolved-model or
`.adlj` source type changed. `PartialPresentationMatrixModel` has been in the
schema since Phase 37.

## Mutation checks

Seven, each reverted immediately. Every one was caught.

| Mutation | Caught by |
|---|---|
| `STATUS <map>()` printed as bare `STATUS <map>` | 3 tests: the printed-text pin, the conformance corpus round-trip, and the corpus's own validation |
| `RECORD_SOURCE` never printed | the coverage fixture's printed-text pin |
| `UNSET_VALUE null` treated as absent by the printer | the coverage fixture's printed-text pin |
| `CELL` block never printed | 3 tests, including a resolved-model `toEqual` |
| `COLUMNS STEP_DAYS` parsed and discarded | 4 tests across parser, printer round-trips and conformance |
| `STATUS <map>()` parsed as a *direct* status | 4 tests |
| `UNSET_AS_ABSENCE` forced to `true` | 2 tests |
| conformance: `edit.unsetValue` expected `$absent` instead of `null` | the corpus |
| conformance: field-less map candidate expected as `kind: "status"` | the corpus |

## Positive/negative pairs

| Positive | Negative |
|---|---|
| `parses a complete MATRIX into a section's matrices` (`tests/parser.test.ts`) | `reports malformed MATRIX declarations with the options they accept` — 20 sources, each asserting an exact named message |
| — | `names MATRIX among the directives a SECTION accepts` |
| `round-trips the constructs neither reference app reaches` (matrix pins) | five `not.toMatch` assertions in the same test, one per spelling the construct must **not** print as |
| `round-trips the presentation conformance corpus's two matrices` | `not.toContain("STEP_DAYS 1")`, `not.toContain("DENSITY COMFORTABLE")`, and an assertion that the second matrix prints no empty `EDIT` — resolver defaults must not become authored values |
| `carries a MATRIX all the way round` (`tests/adl-to-adlj.test.ts`) | asserts the imported document's section actually holds one matrix, so a dropped `matrices` key cannot pass as "two matrix-less models are equal" |
| `presentation.matrix.adl-source.001` / `.002` | `presentation.matrix.adl-source.003` — an ADL-source matrix naming an unknown `CELL` status and unset status, asserting both diagnostics by code and path |
| — | the sketch's own `STATUS Map(F), Map(F)` line is refused: `Expected end of line after CELLS STATUS directive, but found ','.` |

## A pre-existing validator defect, reproduced and deliberately not fixed

When a matrix declares a `cellSource.status` and no `cell.status`, that binding
is validated **twice** — once inside `validatePresentationMatrixCellSource` and
again by `validatePresentationMatrix` via
`matrix.cell.status ?? matrix.cellSource.status` — so every diagnostic it
produces is emitted twice at the identical path. Reproduced from a
**JSON-authored** model, so it predates the text syntax and is independent of
it. Not fixed: this phase's Non-goals exclude `validate-model`. Not pinned
either — the conformance negative was rewritten to put its `STATUS` in the
`CELL` block, which is validated once, rather than encoding a duplicate as
correct. Recorded in `learnings/implementation/presentation-matrix-runtime.md`
and in the handoff below.

## Fingerprints, measured

Unchanged, before and after, by compiling both apps through
`compileAdlProjectV2`:

- Giggle Band `1.12.0` /
  `sha256-8249bac35b2fa5282fd764db729ed3ed2b98121cab95b21c0bee47eb8f9de11c`
- Jointly Care `1.7.0` /
  `sha256-171158c70c06bfa0f975dd8fb92ae91ab58124e3d14210db026fb250813b8bef`

No reference-app content changed, so no `modelVersion` bump, no migration hop
and no persisted-state upgrade test is implicated.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run format:check` — clean.
- `npx vitest run` — **65 files / 1,244 tests passed** (baseline 65 / 1,240;
  +3 parser, +1 `adl-to-adlj`, and `compile-adlj` net 0 — one refusal test
  removed, one round-trip added; the three new conformance cases run inside an
  existing `it`).
- `npm run test:integration` — **19 files / 186 tests passed**, exactly the
  baseline.
- **Not run:** `npm run verify:push`, `npm run test:visual`, Playwright. Another
  agent held the fixed-port Playwright lock. Nothing here touches browser
  rendering, shell chrome, a reference-app screen, presentation-runtime output
  or CSS, and both fingerprints are unchanged, so no screenshot delta is
  possible — but that is an argument, not a measurement, and the run is
  outstanding.

## Deliberately not done

- **No reference-app `MATRIX`.** Recommended below, as the document argued.
- **`printPresentationIconRef` has the same gap** the status candidate had: a
  `PartialPresentationIconRefModel` of kind `map` with neither `field` nor
  `value` throws. Nothing in the repository produces one, and no `ICON` syntax
  change is in scope here, so it is left alone and recorded.
- **`src/inspect.ts` walks a section's `lists` and `calendars` but not its
  `matrices`**, so `explainResolvedModel` reports no origin entries for any
  matrix. Pre-existing, unrelated to text syntax, and out of scope.
- **The duplicate matrix status diagnostic**, above.
- **`compileAdlj`'s omission of `contexts`/`readModels`** still means the
  conformance corpus's `resourceMatrix` must be compiled with both keys
  supplied for the round-trip to compare equal. Measured: those two keys and
  the resulting fingerprint are the *only* difference. Carried forward.

## Planning Handoff, revised

The document ranked "convert Giggle Band's `TeamAvailabilityList` to a `MATRIX`"
first. **That is not the highest-value remaining gap repository-wide**, and the
queue that has formed since this document was written says so plainly.

Recommended next: **Phase 105** — the invited person in Jointly Care who sees an
enabled Accept button whose click is silently refused. It is a measured live
defect in a shipped application, reachable by a real user on a real screen,
fixed by one branch of `resolveActiveViewContext`; it needs no language change,
no `modelVersion` bump and no migration. Phase 106 (an authority-minted identity
has no `User` record, so every person renders as a raw id, including to
themselves) is the broader of the two and Phase 103's executor recommended it on
that ground — but breadth is the argument for doing it *well*, not for doing it
first, and 105 is the one where the product currently lies to a user about what
a button will do. Ship the lie-fix, then the breadth.

After those, in order:

- **Convert Giggle Band's availability board to a `MATRIX`.** Now unblocked and
  worth doing: it gives the language its first matrix in a shipped application
  and is the only thing that would prove this syntax end to end in a way no
  fixture can. Cost is a content change's cost — `modelVersion` bump, migration
  hop, persisted-state upgrade test, `verify:push` with the board inspected on
  both viewports, an `/impeccable` pass — and it carries a product judgement
  (is a grid a better board than a list?) that should be made deliberately.
- **The duplicate matrix status diagnostic**, above. A four-line fix in
  `validate-model/presentation-matrix.ts` plus a conformance case that would
  currently have to assert the duplicate. Small, and it makes a negative case
  writable without encoding a defect.
- **Delete `cellSource.recordSource`, or give it a meaning.** Unchanged from the
  document's own handoff, and slightly stronger now: it has grammar, a printer
  branch, a schema entry, a resolver line and a conformance assertion, and still
  nothing reads it at runtime.
- **`normalisePresentationFormatKind`'s silent fallback** — carried forward from
  Phase 100 and now reachable from one more place, `COLUMNS LABEL_FORMAT`. An
  unrecognised kind word still falls back to `"text"`, so
  `LABEL_FORMAT duraton 'm:ss'` parses clean and means something else.
- **`compileAdlj` omitting `contexts`/`readModels`.** Carried forward again, and
  it now costs a paragraph of explanation in two tests rather than one.
