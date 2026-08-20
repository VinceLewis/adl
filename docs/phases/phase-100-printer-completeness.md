# Phase 100 — Make `print-adl.ts` a Complete Printout of `.adlj`

The repository owner has restated the language's direction: **`.adlj` is the
language; `.adl` text is only the human-readable printout of it.** Nobody
authors `.adl` by hand. Under that contract the printer is not merely narrow,
it is *wrong*: it could not render the flagship reference application at all,
and `docs/spec/adlj.md` carried a list of twelve constructs it refused by name.
This phase does the parser-grammar work those refusals were deferred against.

## Objective

Both reference applications print and round-trip: `.adlj` → resolved model →
printed `.adl` text → reparse → an identical resolved model. Every construct
given text syntax is specified in `docs/spec/language.md` as a first-class part
of the language, and every construct still refused is refused for a stated
reason rather than by omission.

## Evidence and Dependency

### The gap, and who recorded it

`docs/phases/phase-98-delete-kept-adl-snapshot.md`'s Planning Handoff proposes
exactly this phase, and argues it as the highest-value remaining gap
repository-wide: one stated contract, clearly unmet, with the trend running the
wrong way — the printable subset shrank every time the `.adlj` surface grew
(three of the refused constructs arrived in Phases 86 and 87 alone).

Phase 94 isolated the three blockers by iterative stripping
(`conflictOverlay`, `projectedFields`, `summary`). `docs/spec/adlj.md`'s
printer section enumerated the rest, and its Non-goals section deferred all of
them on the grounds that "they would need new parser grammar first, not a
printer change." That reasoning was correct and is precisely what this phase
acts on.

### What it has already cost

Phase 98 found two real defects the frozen `.adl` corpus had been hiding, both
the moment a real `.adlj` was printed: `MIGRATION` was never printed at all —
*silently*, against the printer's own contract — and `FIELD_LIST_STOP_WORDS`
omitted `FIELDS`/`FIELD`, mis-parsing a real policy rule. Neither was reachable
without a round-trip over a real application.

### Verified before starting, by measurement rather than by the list

A walk over both reference applications' compiled `partialModel`, looking for
every key on `adlj.md`'s list, found exactly **three** in use — all in Giggle
Band:

| Construct | Where |
|---|---|
| `conflictOverlay` | `objects[4].views[3].presentation.sections[0].calendars[0]` (`BandEventCalendar`'s `MonthPlanner`) |
| `projectedFields` | `objects[7].views[1].editSections[1]` (`SetListForm`'s `Songs`) |
| `summary` | same section |

Jointly Care uses none and already round-tripped. The `contextSelector` the
same walk hit in both apps is the **shell** control (`shell.controls[0].kind`),
which has had grammar and a printer branch all along — not the presentation
control that had neither. That distinction is why the measurement was worth
doing before designing anything.

## Decision

### Scope by measurement, then decide the remainder deliberately

Nine constructs get text syntax; three are deferred with reasons.

**Added — the three blockers:**

| Construct | Surface syntax |
|---|---|
| A calendar's `conflictOverlay` | `CONFLICT_OVERLAY FROM READ_MODEL <name> ... END.CONFLICT_OVERLAY` with `DATE_FIELD`, `FLAG_FIELD`, `STATUS` |
| A child collection's `projectedFields` | `PROJECTED_FIELD <name> THROUGH <lookup field> FIELD <target field>`, repeatable |
| A child collection's `summary` | `SUMMARY <aggregate> [<field>] ... END.SUMMARY` with `LABEL`, `FORMAT`, `PLACEMENT` |

**Added — six more that cost little and close the gap rather than narrow it:**

| Construct | Surface syntax |
|---|---|
| A calendar's `month.labelFormat` | `MONTH_LABEL_FORMAT <kind> ['pattern']` |
| A list's `fields` | `FIELDS <names>` (mirroring `CALENDAR`'s own) |
| An empty state's `icon` (list and calendar) | `EMPTY_ICON <iconRef>` |
| A field text fragment's `fallback` | `TEXT <field> FALLBACK 'text'` |
| A `select` presentation control | `SELECT <name> ... OPTION <value> LABEL 'text' [ICON ref] ... END.SELECT` |
| A `contextSelector` presentation control | `CONTEXT_SELECTOR <name> ... END.CONTEXT_SELECTOR` |

**Deferred — three, each for a reason that is not convenience:**

- `MATRIX`. A whole construct with six nested sub-structures and its own
  resolved-model file. `docs/spec/ui-language-addendum.md` already sketches an
  intended syntax and records that parser support is future work; implementing
  that sketch is its own phase, not a clause on an existing block.
- Conditional row fragments. `ui-language-addendum.md` lists "how much
  conditional logic should be allowed in row templates before it becomes a
  computed/read-model concern?" as an **open language question**. Inventing a
  `WHEN` block would answer it by fiat.
- Per-view `presentation.shell.regions`. Same document, the other open
  question: "should view-scoped shell regions get source syntax, or should
  shell stay global with view-local controls referenced through presentation?"

A construct the printer refuses *by name* is not the dangerous kind of gap. The
expensive defects have all been the silent ones. Leaving three named refusals
standing is a defensible end state; leaving one construct silently dropped
never is.

### The surface syntax, and what was rejected

**`CONFLICT_OVERLAY` is a block, not a header line.** It carries four clauses,
and every other multi-clause presentation construct in the language (`LIST`,
`CALENDAR`, `PICKER`, `TOGGLE`, `ACTION`) is a block with an `END.X`
terminator. A one-line
`CONFLICT_OVERLAY READ_MODEL X DATE_FIELD D FLAG_FIELD F STATUS s` was rejected
as a 90-column line that reads as a run-on. `FROM READ_MODEL` is spelled out
even though a read model is the only thing an overlay can bind to, because the
entire reason the construct exists is that it is a *second* read model,
distinct from the calendar's own `source` on the line above; a bare `FROM X`
would read as though it could be an object. All four parts are required, since
`ResolvedPresentationCalendarConflictOverlay` declares none optional — an
incomplete block is a parse failure rather than a partial model no resolver can
complete.

**`PROJECTED_FIELD` is one physical line**, like the `CHILD <object>
PARENT_FIELD <field>` directive above it: three names, no sub-structure, so a
block would be four lines of ceremony around three words. A dotted
`PROJECTED_FIELD Duration FROM Song.DurationSeconds` was rejected because the
resolver reaches exactly one lookup hop and a dotted path reads as though it
could reach further. A `PROJECTED_FIELDS a b c` name list cannot carry
`through`/`field` at all.

**`SUMMARY` puts the aggregate and its field on the header line**, the way an
aggregate reads everywhere else (`SUM(x)`), with the presentation details as
directives. Header options are also accepted inline, matching `TOGGLE` and
`STATUS`. The field is optional only because `count` may omit it. The
aggregate vocabulary stays the closed five Phase 87 chose.

**`SELECT` and `CONTEXT_SELECTOR` are deliberately `TOGGLE`'s siblings** — same
header options, same "`STATE` defaults to the control's own name" rule —
because they are the same kind of thing and differ only in what they offer. A
select `OPTION` must carry a `LABEL`: an unlabelled option renders a blank row,
so it is refused rather than defaulted to the value's own text.

**`EMPTY_ICON` is its own directive** rather than an `EMPTY_TEXT 'x' ICON y`
extension, because `EMPTY_TEXT` is shared by `LIST`, `CALENDAR`,
`CHILD_COLLECTION` and `PICKER` and only two of those have an icon; keeping it
uniform is worth one more keyword.

### One defect found on the way, fixed here

`parsePresentationFormat` read a format's pattern with `consumeLiteral`, which
accepts a bare identifier. So `TEXT Field FORMAT DATE STYLE BOLD` — text the
printer itself emits for a `.adlj` fragment with a pattern-less format and a
style — took `STYLE` as the pattern and then failed on `BOLD`. A pattern is
always a quoted string (`ResolvedPresentationFormat.pattern` is `string`), so
the reader now only consumes one when the current token is a string. This is
strictly more accepting: no input that parsed before parses differently.

## Scope

- `.adl` text grammar in `src/parser/grammar/{presentation-scalars,
  presentation-row-format, presentation-source, presentation-core, view}.ts`.
- AST nodes and `BlockName` entries in `src/parser/ast.ts`.
- AST → partial-model conversion in `src/compiler/compile-adl.ts`.
- Printer branches in `src/compiler/print-adl.ts`, replacing nine throws.
- `docs/spec/language.md`, `docs/spec/adlj.md`,
  `docs/spec/ui-language-addendum.md`.
- Tests: round-trips for both reference apps, a coverage fixture for the
  constructs no app reaches, refusal tests for the three still deferred,
  parser refusal tests for the new grammar's own guards, a full-circle importer
  test, and two conformance cases.
- `learnings/`.

## Non-goals

- `MATRIX`, conditional row fragments, per-view shell regions (see Decision).
- Changing what either reference app declares. This phase gives existing
  constructs a text syntax; it alters no application content, and no
  `modelVersion` or `modelFingerprint` moves.
- Any browser rendering, shell chrome, presentation-runtime or CSS change.
- A `.adl` → `.adlj` bidirectional sync tool (still a stated non-goal).

## Constraints

- The runtime consumes the resolved model, not AST nodes. Nothing in
  `resolve-model`, `validate-model` or any runtime service changes: they
  already accept these shapes, which is the point of a runtime-model-first
  language.
- `src/parser/grammar/` is a linear class chain. A lower file may not call a
  method defined in a higher one; the fix is always to move the shared helper
  down (`learnings/implementation/parser-grammar-file-map.md`).
- Every new grammar rule must be shown failing on the pre-change grammar.
- Assert on resolved models, not printed text. Text formatting is not the
  contract; semantic identity is. Printed-text pins are additional, for the
  constructs whose whole risk is being silently dropped.
- No test may be weakened. Two existing assertions change because the
  behaviour they pin has legitimately changed (a parse-error message that now
  lists two more directives; a refusal test whose subject now prints).

## Acceptance Criteria

1. Giggle Band and Jointly Care both compile from `.adlj`, print, reparse with
   zero diagnostics, and resolve to a `toEqual`-identical model.
2. Every construct given syntax is documented in `docs/spec/language.md`.
3. `docs/spec/adlj.md`'s unprintable list and Non-goals section state what is
   actually true after the change.
4. Each new rule is shown failing before it works.
5. No `modelVersion` and no `modelFingerprint` moves.
6. `tsc` clean; full suite green; conformance suite green; integration suite at
   baseline; `prettier --check` clean.

## Testing

- `tests/compile-adlj.test.ts`: Giggle Band round-trip with printed-text pins
  on all three blockers; a `.adlj` coverage fixture round-trip for the six
  constructs no application reaches; three refusal tests for `MATRIX`, a
  conditional row fragment and per-view shell regions.
- `tests/adl-to-adlj.test.ts`: `.adlj` → print → `importAdlAsAdlj` → `.adlj` →
  identical model over Giggle Band, and the comment-preservation test now
  prints the real model instead of a clone with the unprintable constructs
  stripped out.
- `tests/parser.test.ts`: the new grammar's own refusals — an incomplete
  `CONFLICT_OVERLAY`, a non-read-model overlay source, an unknown aggregate, an
  unknown placement, an unterminated `SUMMARY`, a malformed `PROJECTED_FIELD`,
  an unlabelled `OPTION`, a `CONTEXT_SELECTOR STATE`, and `FALLBACK` on a
  literal fragment.
- `conformance/model/edit-surfaces.json` and
  `conformance/presentation/status-matrix-calendar.json`: one `adl`-source
  model and one `resolveModel` case each, proving the new syntax resolves to
  the shapes the JSON surface already produces. Both were shown to
  discriminate by breaking one expectation and watching the case fail.

## Parallel Execution Plan

Serial. The phase is one chain of dependent edits through five layers of the
same parser class chain, and every later layer's shape is decided by the one
below it: the AST node decides the conversion, which decides the printer,
which decides the tests. Fanning out would mean agents predicting each other's
outputs. The measurement that scopes it is also serial by nature — it decides
what the phase *is*. No shared-spine file is touched: `src/index.ts`,
`src/ui/components/register.ts`, shell chrome, migration SQL and the
conformance runner are all untouched, and reference-app fixtures are untouched
by design.

## Tasks

1. Measure which of `adlj.md`'s constructs each reference app actually uses.
2. Decide the remainder deliberately; record the reasons.
3. Prove every intended new rule fails on the current grammar first.
4. Add grammar, AST nodes, conversions and printer branches, layer by layer.
5. Round-trip both reference apps; fix what that exposes.
6. Add the coverage fixture, the refusal tests, the parser tests and the
   conformance cases.
7. Update `language.md`, `adlj.md` and `ui-language-addendum.md`; compile-check
   every new ADL example.
8. Correct every learning that asserts a construct is unprintable.

## Planning Handoff

**Next phase: Phase 101 — give `MATRIX` ADL text syntax.**

It is now the largest single remaining hole in the same contract this phase
served, and the only one of the three deferrals that is a *construct* rather
than an open design question. `docs/spec/ui-language-addendum.md` has carried a
worked `MATRIX ... END.MATRIX` example labelled "intended language direction"
since Phase 29, with `ROWS FROM`, `COLUMNS DATE_RANGE`, `CELLS FROM`, `STATUS`,
`UNSET_STATUS` and `EDIT ... CYCLE` already spelled out. The design work is therefore already done and
reviewed; what is missing is the grammar, and this phase has just established
the five-part recipe for adding it (grammar, AST node, `BlockName`, conversion,
printer branch) together with the round-trip and fail-first techniques that
prove it. A matrix is also the one refused construct with real runtime
behaviour behind it — `evaluatePresentationView` renders resource/date matrices
today, and `conformance/presentation/status-matrix-calendar.json` already pins
eleven matrix cases — so text syntax would make an existing, tested, shipped
capability expressible in the printed view rather than adding new semantics.

The two open language questions (conditional row fragments; view-scoped shell
regions) are deliberately *not* proposed. Both need an answer from the
repository owner before any grammar is worth writing, and a phase that invents
one would be making a language decision under cover of a printer task — the
exact move this phase declined to make.

Two smaller candidates surfaced and were not taken. `normalisePresentationFormatKind`
in `src/parser/grammar/presentation-scalars.ts` falls back to `"text"` for any
unrecognised kind word rather than failing, so `FORMAT duraton 'm:ss'` parses
clean and silently means something else — the same silent-wrong-parse shape
this phase fixed one layer up, but nothing in the repository reaches it and
tightening it is a behaviour change to an existing accepted input rather than a
strict widening. And `compileAdlj` still omits `contexts`/`readModels` keys that
`compileAdl` emits as `[]` — cosmetic, already documented, and carried forward
from Phase 98's own handoff.

## Execution Note

### The measurement decided the phase, and one grep nearly misled it

Grepping the two `.adlj` files for the construct names hit `"contextSelector"`
in both applications, which reads as "both apps use a construct the printer
refuses." They do not: that is `shell.controls[0].kind`, the global shell
control, which has had grammar since Phase 59. The presentation-section control
of the same name is a different construct in a different place. Walking the
compiled `partialModel` and recording the *path* of every hit, rather than
grepping the source text for the name, is what made the difference — and the
paths are what turned a twelve-item list into "three blockers, all in Giggle
Band, one file."

### Every new rule, failing first

All eleven probes were run against the pre-change grammar inside a minimal app
that otherwise compiles clean, so nothing but the new syntax could be at fault:

| Probe | Failure on the pre-change grammar |
|---|---|
| `CONFLICT_OVERLAY` block | `Expected CALENDAR directive DATE_FIELD, … or END.CALENDAR, but found 'CONFLICT_OVERLAY'.` |
| `PROJECTED_FIELD` | `Expected CHILD_COLLECTION directive …, but found 'PROJECTED_FIELD'.` |
| `SUMMARY` block | `… but found 'SUMMARY'.` |
| `MONTH_LABEL_FORMAT` | `Expected CALENDAR directive …, but found 'MONTH_LABEL_FORMAT'.` |
| `LIST FIELDS` | `Expected LIST directive ORDER BY, WHERE, …, but found 'FIELDS'.` |
| `LIST EMPTY_ICON` | `… but found 'EMPTY_ICON'.` |
| `CALENDAR EMPTY_ICON` | `… but found 'EMPTY_ICON'.` |
| `TEXT … FALLBACK` | `Expected TEXT option FORMAT, STYLE, or end of line, but found 'FALLBACK'.` |
| `SELECT` control | `Expected SECTION directive HEADING, LAYOUT, DENSITY, TOGGLE, ACTION, LIST, CALENDAR, or END.SECTION, but found 'SELECT'.` |
| `CONTEXT_SELECTOR` control | `… but found 'CONTEXT_SELECTOR'.` |
| `TEXT Title FORMAT text STYLE bold` | `Expected TEXT option FORMAT, STYLE, or end of line, but found 'bold'.` — the format reader had eaten `STYLE` as the pattern |

After the change all eleven parse. Two of the probes then reported *model*
diagnostics rather than parse errors
(`ADL_PRESENTATION_CALENDAR_CONFLICT_OVERLAY_READ_MODEL_UNKNOWN` and
`ADL_VIEW_EDIT_SECTION_SUMMARY_FIELD_UNKNOWN`, both correct for the synthetic
probe), which is its own useful evidence: the new syntax reaches the validator
that was already there, rather than routing around it.

### The round-trip, and exactly what was compared

For each reference application: `compileAdlProjectV2` over the real
`app.yaml` + `domain.adlj` + `ui.adlj` produces model **A** and a
`partialModel`; `printPartialApplicationModelAsAdl` renders that partial model
to `.adl` text; `compileAdl` reparses that text into model **B**. The
assertions are `expect(reparsed.diagnostics).toEqual([])` and
`expect(reparsed.model).toEqual(original.model)` — Vitest structural deep
equality over the whole `ResolvedApplicationModel`, not a text diff, not a
subset, and not a fingerprint comparison. Both pass. Giggle Band prints to
1,199 lines and Jointly Care to 678.

The Giggle Band case additionally pins the three blockers as printed text,
because a construct being silently dropped is the failure mode that a
model-equality assertion alone could miss if a resolver default happened to
put it back.

### No `modelVersion` moved

Measured directly from the two compiled models: `giggle-band` 1.9.0
`sha256-20f7ee6c231d6c64fd4d12f6b751a70a0b4b58b1c774a399889f6c79ac62052a`,
`jointly-care` 1.4.0
`sha256-e82da010cc4c493a45fa239d46e52e7c94ba674848dcbff2514cc48b0856559a` —
byte-identical to the values Phase 98 recorded. No `.adlj` was edited, no
migration is implicated, and no persisted-state upgrade test is affected.

### Two existing assertions changed, and why neither is a weakening

`tests/parser.test.ts`'s `CHILD_COLLECTION` error-message case now expects the
two new directives in the accepted-options list; the message is the assertion's
whole subject and it legitimately changed. `tests/compile-adlj.test.ts`'s
"refuses, by name, a source using a construct with no ADL text syntax" had
Giggle Band as its subject; Giggle Band now prints, so the test was replaced by
three narrower refusal tests whose subjects genuinely still have no syntax —
more assertions covering the same contract, not fewer.

The comment-preservation test in `tests/adl-to-adlj.test.ts` also lost its
`withoutUnprintableJsonOnlyConstructs` helper, a deep clone that stripped
`conflictOverlay`/`projectedFields`/`summary` before printing. It now prints
the real model. That helper existed only to route around this phase's gap.

### Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 61 files, 1,127 tests, all passing. Baseline was 61 files,
  1,121 tests. Accounting: −1 (the replaced refusal test), +5 in
  `tests/compile-adlj.test.ts` (Giggle Band round-trip, coverage-fixture
  round-trip, three refusal tests), +1 in `tests/adl-to-adlj.test.ts`
  (full circle), +1 in `tests/parser.test.ts` (Phase 100 presentation
  refusals). 1,121 − 1 + 7 = 1,127. The two conformance cases are data inside
  existing tests and add no `it`.
- `npx vitest run --config vitest.integration.config.ts` — 15 files, 159 tests,
  all passing; identical to baseline. Run because this phase changes the
  parser, even though no integration test was edited.
- `npm run format:check` — clean (three files needed `prettier --write`).
- Every new ADL example in `docs/spec/language.md` was compiled through
  `compileAdl` with `diagnostics: []` before being committed, per `AGENTS.md`.
- `npm run verify:push` was **not** run here; its Playwright stage runs once in
  the primary tree after integration. Nothing in this phase touches browser
  rendering, shell chrome, CSS, presentation-runtime output or reference-app
  model content — both fingerprints are unchanged — so no screenshot delta is
  expected.

### Not proven

- That `MATRIX`, conditional row fragments and per-view shell regions would be
  printable if given grammar. They are refused, and the refusals are tested;
  nothing here says what their syntax should be.
- That the `SELECT`, `CONTEXT_SELECTOR`, `EMPTY_ICON`, list `FIELDS`,
  `FALLBACK` and `MONTH_LABEL_FORMAT` constructs behave correctly *at runtime*
  when authored from `.adl` text rather than `.adlj`. They resolve to the
  identical partial-model shapes the JSON surface produces — that is what the
  round-trip and the conformance cases prove — and the runtime consumes the
  resolved model, so there is no separate path to exercise. But no runtime
  conformance case was added for them.
- Anything about the browser: no Playwright ran in this worktree.
