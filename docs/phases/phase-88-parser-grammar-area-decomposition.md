# Phase 88 — Parser Grammar-Area Decomposition

> Commissioned directly by the user, following a discussion of what actually
> reduces an agent's time-to-fix in this repository. That discussion started
> from a different proposal — hand Claude a session-start JSON index of every
> directory, file, function signature and call site — and three independent
> expert reviews rejected it on the same grounds: the index would cost
> hundreds of thousands of tokens on every turn, would be stale the moment
> any edit landed (including the agent's own mid-session edits), and would
> duplicate what `grep` already does in milliseconds. All three converged on
> the same alternative: **decompose the files whose names carry no signal
> about their contents.** Phase 81 did that for the compiler model layer and
> explicitly named `parser.ts` as the next candidate, deferred because it
> needs a design step rather than a mechanical extraction. This phase is that
> design step plus its execution.
>
> Per `learnings/process/phase-execution.md`'s standing rule for
> user-commissioned phases (the same condition that authorised Phases 69–73
> and 81), this does not need to justify itself as the next item in a rolling
> handoff.

## Objective

Split `src/parser/parser.ts`'s 181-member `AdlParser` class into a directory
of grammar-area files, with **zero behavioural change and zero
consumer-visible API change**. Every existing import of
`src/parser/parser.js` continues to resolve to the same four exports
(`parseAdl`, `parseExpressionSource`, `ParseError`, `ParserDiagnostic`).

`parser.ts` is 5,750 lines. A task touching one grammar area — "fix how
`SYNC WINDOW` parses", "add a clause to `EDIT_SECTION`" — currently costs
reading or grepping the whole file to find the 30–150 relevant lines. Every
language-level phase in this repository's history has touched this file (28
commits), so that cost is paid repeatedly. This is a navigability change for
both human and LLM readers, exactly as Phase 81 was; it is not a performance
change, and JS/TS execution speed does not depend on how code is distributed
across files.

## Evidence and Dependency

Measured against `main` at `d2d613a` with a clean working tree. Re-verify
before executing; line numbers drift.

- `src/parser/parser.ts` — 5,750 lines. Structure is three parts:
  - lines 1–243: type-only imports from `../model/resolved-model.js` (51
    names) and `./ast.js` (79 names), a value import of
    `lexAdlWithComments` from `./lexer.js`, the `ParserDiagnostic` interface,
    the `ParseError` class, the two exported entry points `parseAdl` and
    `parseExpressionSource`, and 7 module-level `const` `Set`s.
  - lines 244–5,624: `class AdlParser` — **181 members** (6 fields +
    constructor + 176 methods, 5,029 lines of member bodies plus ~350 lines
    of doc comments in the gaps between them).
  - lines 5,626–5,750: 11 module-private helper functions (`describeToken`,
    `normaliseKeyword`, `normaliseSyncMode`, `normaliseSyncScope`,
    `normaliseConflictStrategy`, `normaliseRuntimeChannel`,
    `normaliseThemeRadius`, `normaliseThemeDensity`, `normaliseThemeNav`,
    `lowerCamel`, `pascalCase`).
- **`AdlParser` is not exported and is referenced nowhere outside this file**
  (grep across `src/` and `tests/`: only doc-comment mentions in `ast.ts` and
  `lexer.ts`). The class is a pure implementation detail, which is what makes
  its internal structure free to change.
- **The complete external surface of `parser.ts` is four names.** Consumers:
  `src/index.ts` (`export * from "./parser/parser.js"`),
  `src/compiler/compile-adl.ts` (`parseAdl`),
  `src/compiler/compile-adl-project-v2.ts` (`parseAdl`),
  `src/compiler/compile-adlj.ts` (`parseExpressionSource`),
  `src/conformance/runner.ts` (`parseAdl`),
  `tests/compile-adlj.test.ts` (`parseExpressionSource`). No consumer imports
  anything else from this path.
- **The class's internal call graph, grouped into the 20 grammar areas named
  in the Decision below, is a directed acyclic graph.** This was measured,
  not assumed: every `this.<member>` reference in every member body was
  extracted and mapped to its area. Two cycles existed under a naive
  area assignment and both are resolved by the Decision's layering (see
  "Why the areas are shaped this way" below). This DAG is the fact the whole
  plan depends on.
- Of the 176 methods, **88 are called from a different area** (so must become
  `protected`), **86 are called only from within their own area** (so stay
  `private`), and 2 are public (`parseDocument`,
  `parseStandaloneExpression`). Of the 4 fields, only `styleWarnings` is
  read outside its own area. No two members share a name, so no base/derived
  shadowing arises.
- Field usage is narrow: `tokens`, `comments`, `commentsByLine` and
  `currentIndex` are touched only by cursor-area members; `styleWarnings` by
  the cursor area and `parseDocument`; `contextGrantTargets` only by the
  context area.
- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax` on, but **not**
  `noUnusedLocals` — a slightly over-broad computed import list will not fail
  `npm run typecheck`. Type imports must keep the `import type` form.
- `tests/parser.test.ts` is 1,508 lines of parser-level behaviour over real
  `.adl` source text. The repository also carries 6 `.adl` text files
  (`examples/purchase-order.adl`, `examples/task-tracker.adl`,
  `examples/user.adl`, `examples/multi-source/domain.adl`,
  `src/reference/giggle-band/domain.adl`, `src/reference/giggle-band/ui.adl`)
  and 8 `.adlj` files whose expression strings go through
  `parseExpressionSource`.

## Decision

### Strategy: a linear class chain of grammar-area files, behind the existing barrel

`AdlParser` keeps `this`-based shared state (the token cursor). The
decomposition therefore moves method bodies **verbatim** into a chain of
classes, one per file, each extending the previous:

```
src/parser/parser.ts          <- barrel: re-exports the four public names
src/parser/grammar/cursor.ts      class CursorParser
src/parser/grammar/literals.ts    class LiteralParser extends CursorParser
...
src/parser/grammar/index.ts       class AdlParser extends AppParser  (+ parseDocument)
```

This is the load-bearing decision, and it is chosen specifically because it
makes the change mechanical rather than a redesign:

- **No call site inside the class changes.** `this.parseView()` still resolves
  to the same method; the assembled prototype chain carries all 176 methods.
  The alternative — free functions taking the parser as a parameter — would
  have required rewriting roughly 1,400 `this.` references and every call
  site, which is exactly the kind of sweeping mechanical edit that can go
  subtly wrong in a parser.
- **No method body is edited at all.** The only permitted per-member change is
  the visibility keyword (`private` → `protected` for the 88 cross-area
  methods and the one cross-area field). Bodies move byte-for-byte.
- **No consumer changes.** `parser.ts` remains a real module at its current
  path, now holding only the public surface.

The cost of this strategy is an ordering constraint: a base class cannot call
a method declared only in a derived class without an `abstract` declaration.
The measured DAG above means no `abstract` declarations are needed — but a
future phase that adds a call from a lower area to a higher one will get a
`tsc` error, and the fix is to move the shared helper down a layer (as this
phase does for `parseSortList`), not to add a back-edge. Record this in
`learnings/`.

### Directory name

The new directory is `src/parser/grammar/`, not `src/parser/parser/`. Phase
81's convention is "`X.ts` becomes a barrel over a directory of domain
files"; taken literally here it produces `src/parser/parser/`, which is
redundant given the parent directory is already `parser/`. The convention's
actual contract — the original import path keeps working — is fully
preserved. This deviation is deliberate and documented.

### The 20 grammar areas, in chain order (base first)

Sizes are measured member-body lines, excluding doc comments and imports.

| # | File | Class | Lines | Holds |
|---|---|---|---|---|
| — | `diagnostics.ts` | *(no class)* | ~25 | `ParserDiagnostic`, `ParseError`. Separate from `cursor.ts` because `parser.ts` re-exports both and `cursor.ts` throws them. |
| — | `text.ts` | *(no class)* | ~40 | `normaliseKeyword`, `lowerCamel`, `pascalCase` — pure string helpers used by 14 of the 20 areas. |
| 1 | `cursor.ts` | `CursorParser` | 278 | Token cursor and parser state: the 6 fields, the constructor, `takeLeadingComment`, `recordDeprecatedSpelling`, the `matchCanonicalOrDeprecatedWord`/`matchUnderscoreOrDottedWord`/`expectUnderscoreOrDottedWord` alias matchers, `parseEnd`/`checkEnd`, every `expectWord`/`matchWord`/`checkWord`/`*DottedWord`/`*Symbol` primitive, `skipComma`, `skipNewlines`, `consumeLineEnd`, `isLineEnd`, `currentWordIsAny`, `previous`/`current`/`peek`/`advance`/`isAtEnd`, `rangeFrom`, the `fail*` family, `failIfUnsupportedProceduralKeyword`/`currentProceduralKeyword`. Also owns `PROCEDURAL_KEYWORDS` and `describeToken`. |
| 2 | `literals.ts` | `LiteralParser` | 224 | Every `consume*` value reader: names, qualified names, name lists, word/number/boolean tokens, literals, primitive literals, modifier values, value lists, state lists, channel lists, output maps. Owns `normaliseRuntimeChannel`. |
| 3 | `clauses.ts` | `ClauseParser` | 59 | Small clauses shared by more than one grammar area, and only those: `parseSortList` (used by `view` and by list/calendar sources), `parseOptionalBoolean`, `parseViewContextAfterKeyword`, `parseViewContextMode` (used by `view` and `read-model`). |
| 4 | `expression.ts` | `ExpressionParser` | 239 | `parseStandaloneExpression` (public — `parseExpressionSource` calls it) and the full precedence ladder: coalesce, or, and, equality, comparison, additive, multiplicative, unary, primary, plus `parseExpressionUntil` and `isExpressionStop`. |
| 5 | `theme.ts` | `ThemeParser` | 148 | `parseTheme`, `parseThemeToken`, `parseThemeTokenName`, `parseThemeTokenValue`; owns `normaliseThemeRadius`/`normaliseThemeDensity`/`normaliseThemeNav`. |
| 6 | `sync.ts` | `SyncParser` | 87 | `parseSync`, `parseSyncWindow`, `currentIsSyncWindowFieldName`; owns `SYNC_OPTION_WORDS`, `SYNC_WINDOW_NON_FIELD_WORDS`, `normaliseSyncMode`, `normaliseSyncScope`, `normaliseConflictStrategy`. |
| 7 | `policy.ts` | `PolicyParser` | 197 | `parsePolicy`, `parsePolicyRule` (including principal selectors), `parsePolicyEffect`, `parsePolicyAction`; owns `FIELD_LIST_STOP_WORDS` and uses `pascalCase` for generated policy names. |
| 8 | `decision-table.ts` | `DecisionTableParser` | 111 | `parseDecisionTable`, `parseDecisionTableMatch`, `parseDecisionTableInput`, `parseDecisionTableRow`. |
| 9 | `lifecycle.ts` | `LifecycleParser` | 199 | `parseLifecycle`, `parseState`, `parseAction`, `parseActionAllow`, `parseLifecycleGuardFromCurrent`. |
| 10 | `presentation-scalars.ts` | `PresentationScalarParser` | 248 | Every leaf presentation enum/scalar reader — layout, density, state type, state persistence, calendar week start, list render style, row layout, action placement, status theme token, legend include, fragment style, format (+ `normalisePresentationFormatKind`), and `parsePresentationIconRef`. Extracted as its own layer because these are the shared leaves that otherwise create cycles between the presentation files. |
| 11 | `presentation-row-format.ts` | `PresentationRowFormatParser` | 106 | `parsePresentationRowTemplate`, `parsePresentationTextFragment`, `parsePresentationIconFragment`. |
| 12 | `presentation-action.ts` | `PresentationActionParser` | 114 | `parsePresentationAction`, `parsePresentationActionInput`. Its own layer because both `presentation-source` and `presentation-core` call it. |
| 13 | `presentation-source.ts` | `PresentationSourceParser` | 265 | `parsePresentationList`, `parsePresentationCalendar`, `parsePresentationStatusCandidate`. |
| 14 | `presentation-core.ts` | `PresentationCoreParser` | 348 | `parsePresentationState`, `parsePresentationIconMap`(+`Value`), `parsePresentationStatus`, `parsePresentationStatusMap`(+`Value`), `parsePresentationLegend`, `parsePresentationSection`, `parsePresentationToggle`. |
| 15 | `view.ts` | `ViewParser` | 441 | `parseView`, `parseViewKind`, `parseEditFieldsSection`, `parseEditChildCollection`, `parseRelationshipPicker`, `parseEditChildOperations`, `parseEditContainerMode`, `parseRelationshipPickerSourceKind`, `parseRelationshipPickerSelection`. |
| 16 | `object-field.ts` | `ObjectFieldParser` | 549 | `parseObject`, `parseComputedField`, `parseObjectScope`, `parseObjectConstraint`, `parseOrderedCollectionReorder`/`Compaction`, `parseField`, `parseFieldType`, `parseObjectValidation`, `parseLookup`, `validator`, `predicateValidator`, `ensureAutoId`. |
| 17 | `read-model.ts` | `ReadModelParser` | 217 | `parseReadModel`, `parseReadModelSource`, `parseReadModelSourceJoin`, `parseReadModelJoinCardinality`, `parseReadModelField`, `parseReadModelSourceScope`; owns `READ_MODEL_SOURCE_OPTION_WORDS`. |
| 18 | `command.ts` | `CommandParser` | 338 | `parseCommand`, `parseCommandInput`, `parseCommandInputItemField`, `parseCommandPreconditionFromCurrent`, `matchCommandStepValueDirective`, `parseCommandStep`, `parseCommandStepAction`, `parseCommandStepAuthority`, `parseCommandValueExpression`; owns `COMMAND_INPUT_MODIFIER_WORDS`, `COMMAND_STEP_HEADER_WORDS`. |
| 19 | `context.ts` | `ContextParser` | 238 | `parseBusinessContext`, `parseContextMembership`, `parseContextGrant`, `requireDeclaredContextsForGrants`, `parseContextSelectionMode`/`Persistence`/`Source`. Declares the `contextGrantTargets` field, which no other area touches. |
| 20 | `shell.ts` | `ShellParser` | 325 | `parseShell`, `parseShellNavItem`, `parseShellControl`, `parseShellTopBar`, `parseShellNavDrawer`, `parseShellVisibility`, `parseShellControlKind`, `parseShellControlPlacement`, `parseShellContextSelectorPlacement`, `parseShellMobileContextSelectorMode`, `parseShellNavigationMode`. |
| 21 | `app.ts` | `AppParser` | 200 | `parseApp`, `parseMigration`, `parseMigrationObject`, `parseRole`. |
| 22 | `index.ts` | `AdlParser` | 78 | The document orchestrator `parseDocument` only — the direct analogue of Phase 81 keeping `validateApplicationModel`/`resolveApplicationModel` in their directories' `index.ts`. |

Largest resulting file is `object-field.ts` at ~549 member lines (well under
Phase 81's ~1,200-line ceiling); the mean is ~250.

### Why the areas are shaped this way

The area boundaries are not free choices — two of them are forced by measured
cycles in the call graph:

1. **`clauses.ts` exists because of `parseSortList`.** With `parseSortList`
   in `view`, `view → presentation` (a `VIEW` declares `LIST`/`CALENDAR`
   presentation) and `presentation → view` (list and calendar both parse
   `ORDER BY`) form a cycle. `parseSortList` calls nothing above the literal
   layer, so moving it — with the three other genuinely cross-area small
   clauses — below both breaks the cycle honestly rather than by fiat.
2. **`presentation-scalars.ts` and `presentation-action.ts` exist for the
   same reason inside the presentation cluster.** `parsePresentationSection`
   contains lists and calendars; lists and calendars parse actions and
   densities; toggles, statuses and actions all parse icon refs. Pulling the
   leaf scalars and the action parser into their own layers turns a
   mutually-recursive cluster into a five-layer DAG with no back-edges.

Everything else follows the declaration structure of the language itself.

### The barrel

`src/parser/parser.ts` becomes, in full: the `ParserDiagnostic`/`ParseError`
re-export from `./grammar/diagnostics.js`, the `AdlParser` import from
`./grammar/index.js`, and the two entry-point functions `parseAdl` and
`parseExpressionSource` verbatim as they exist today (including
`parseExpressionSource`'s doc comment). It is a small real module, not a
one-line `export *`, because the two entry points construct `AdlParser` and
`AdlParser` must stay unexported from the public path.

## Scope

1. Create `src/parser/grammar/` with the 24 files above (22 classes +
   `diagnostics.ts` + `text.ts`).
2. Reduce `src/parser/parser.ts` to the barrel described above.
3. No other file in the repository is edited. `src/index.ts`'s
   `export * from "./parser/parser.js"` is untouched and continues to export
   exactly the same four names.

## Constraints

- **No behavioural change of any kind.** No AST node gains or loses a field or
  a source range. No `ParseError` gains a different code, message, or range.
  No style warning changes. No `.adl` source that parses today fails, and none
  that fails today parses.
- **Method bodies move verbatim.** The only permitted per-member edit is
  `private` → `protected` for the 78 methods called across an area boundary.
  If a body appears to need any other change to compile, stop and report why
  before proceeding — that means the area assignment is wrong, not that the
  body needs editing.
- **No new `abstract` declarations.** The measured DAG makes them unnecessary;
  needing one means a back-edge was introduced.
- No consumer file outside `src/parser/parser.ts` is edited — not even an
  import path. If achieving the split requires touching one, stop and report:
  that means the "four public names, no other importer" evidence was wrong.
- **Zero test file changes.** If a test needs to change to keep passing, that
  is evidence of an accidental behaviour change and must be fixed in the
  split, not in the test.
- No new npm dependency.
- Do not attempt `adl-app.ts`, `presentation-runtime.ts`, or `object-store.ts`
  in this phase — see Non-goals.

## Deliverables

- `src/parser/grammar/` fully populated; `src/parser/parser.ts` reduced to the
  barrel.
- A **parser equivalence corpus check** (see Testing) proving byte-identical
  parse results, success and failure alike, across thousands of inputs before
  and after the split.
- `npm run typecheck`, `npm test`, `npm run format:check`, `npm run build`,
  `npm run verify:push` all clean, with zero test file changes.
- `learnings/implementation/parser-grammar-file-map.md` recording the area map,
  the chain-ordering rule, and the two forced boundaries, so a later phase can
  locate a grammar area without grepping — the direct analogue of
  `compiler-model-layer-file-map.md`.
- `learnings/index.md` updated to point parser task types at it, and
  `learnings/implementation/adl-parser.md` updated to say where the parser now
  lives.

## Acceptance Criteria

- `npm run typecheck` passes with no new `any`, no suppressed errors, no
  changed `tsconfig.json`.
- `npm test` passes with **zero test file changes**.
- The equivalence corpus check reports **zero differences** across every input
  in the corpus (see Testing for its exact composition).
- `git diff --stat` shows exactly one modified file (`src/parser/parser.ts`,
  reduced by ~5,600 lines) plus 24 new files under `src/parser/grammar/`, and
  **no other file modified**.
- No file in `src/parser/grammar/` exceeds 700 lines including imports and
  comments.
- Every one of the 181 original members appears exactly once across the new
  files, verified mechanically, not by eye.
- `npm run build` succeeds and the production bundle's gzip size does not
  regress by more than 1%.
- `npm run verify:push` clean with zero screenshot diffs.

## Testing

The ordinary suite is necessary but not sufficient here. A parser defect is a
*silent wrong parse*, not a thrown error, so the phase's correctness proof is
a differential corpus check, built before any code moves:

1. **Baseline.** Create a `git worktree` at pre-split `main`. In it, run a
   throwaway script (never committed, per `AGENTS.md`) that walks a corpus and
   writes one deterministic JSON record per input: on success the full
   `AdlDocumentAst`, on failure the `ParseError`'s `code`, `message` and
   `sourceRange`.
2. **Corpus.** Three generators, all mechanical:
   - Each of the 6 `.adl` files whole.
   - Each of the 6 `.adl` files **truncated at every line boundary**
     (`source.split("\n").slice(0, n).join("\n")` for every `n`). This
     exercises several thousand distinct error paths — every "expected X, got
     end of file" branch in the grammar — which no hand-written test set
     covers.
   - Every string value appearing in the 8 `.adlj` files, fed to
     `parseExpressionSource`, recording success or the exact `ParseError`.
     This covers the standalone-expression entry point including its
     trailing-content rejection.
3. **After.** Run the identical script against the split tree; diff the two
   JSON outputs. Any difference at all is a defect in the split.
4. `npm run typecheck` after **each** area file is extracted, not only at the
   end — a misplaced member or a missing `protected` surfaces immediately,
   while the diff causing it is still one file.
5. `npm test` at the end, and after `view.ts`/`object-field.ts` (the two
   largest and most interconnected areas) as intermediate checkpoints.
6. A **member census**: assert mechanically that the multiset of member names
   across the new files equals the original 181, and that each member's body
   text is byte-identical to the original modulo the visibility keyword and
   Prettier re-wrapping.
7. `npm run test:integration` is not expected to be required — this phase
   touches no server, PostgreSQL, or I/O boundary. Confirm that holds once the
   diff is final.
8. `npm run verify:push` once, at the end. The parser feeds every reference
   app's compiled model, so a screenshot regression here would be a real
   signal, not a formality.

## Non-goals

Named, not attempted, carried forward from Phase 81's list minus what this
phase claims:

- **`src/ui/components/adl-app.ts`'s `AdlAppElement`** (~140 methods) and
  **`src/runtime/presentation-runtime.ts`'s `PresentationRuntime`** — both
  splittable along existing method clusters, but both touch live rendering, so
  each needs `verify:push` per extracted chunk rather than once at the end.
  The same class-chain strategy this phase establishes should apply.
- **`src/runtime/object-store.ts`'s `ObjectStore`** and its helper tail.
- **`src/conformance/runner.ts`**, split by concern — safe and mechanical,
  lower value as test-support code.
- **Large test file splitting** (`tests/runtime.test.ts` 3,020 lines,
  `tests/model-validation.test.ts` 3,004, `tests/band-reference-app.test.ts`
  2,379, `tests/ui-child-collection.test.ts` 2,194).
- **The `this.innerHTML = \`...\`` full-re-render pattern** across every custom
  element — the repository's real runtime-performance question, unaffected by
  any file decomposition, and needing a profiling-first phase of its own.
- **A repo-wide file-purpose map.** The expert panel's second recommendation
  (one line per file, ~4–5K tokens) is real and cheap, but it is a
  documentation phase, not this one.

## Dependencies

- `src/parser/parser.ts` (the target).
- `src/parser/ast.ts`, `src/parser/lexer.ts` (imported; not modified).
- `src/model/resolved-model.ts` (type imports via its Phase 81 barrel; not
  modified).
- `src/index.ts` (read-only reference confirming the barrel contract).

## Parallel Execution Plan

**Do not fan out.** Unlike Phase 81's three mutually independent files, this
phase splits a single class into a single ordered chain: every area file
depends on the one below it, so there is no independent stream to give an
agent. Phase 81's own execution note records that even for three genuinely
independent files, scripted extraction in one session beat coordinating
worktree agents. Follow that: drive the split with small Python
extraction/generation scripts (parse member boundaries, assign to areas,
compute per-file imports, emit, typecheck, iterate), which gives exact,
reproducible control over declaration order and import wiring.

The one genuinely parallelisable step is the equivalence corpus: baseline
generation in the pre-split worktree is independent of the split itself and
can run while the extraction scripts are being written.

## Tasks

1. Re-verify the Evidence section against current code: line count, member
   count, the four-name public surface, the no-external-`AdlParser`-reference
   fact, and the DAG.
2. Build the equivalence corpus script and generate the baseline from a
   pre-split worktree.
3. Extract members with their preceding doc comments; assert the extraction
   reproduces the original file byte-for-byte before relying on it.
4. Emit `diagnostics.ts` and `text.ts`, then the 22 class files in chain
   order, typechecking after each.
5. Reduce `src/parser/parser.ts` to the barrel.
6. Run the member census and the equivalence corpus diff.
7. Full verification: `npm run typecheck`, `npm test`, `npm run format:check`,
   `npm run build` (bundle size), `npm run verify:push`.
8. Write `learnings/implementation/parser-grammar-file-map.md`; update
   `learnings/index.md` and `learnings/implementation/adl-parser.md`.
9. Planning handoff naming the Non-goals above as unclaimed candidates.
10. Commit and push.

## Planning Handoff

Named candidates, none claimed here:

- **Highest value next**: `src/ui/components/adl-app.ts`'s `AdlAppElement`
  and `src/runtime/presentation-runtime.ts`'s `PresentationRuntime`, using
  the class-chain strategy this phase establishes, with `verify:push` per
  extracted chunk because both touch live rendering. These are the last two
  files in the repository whose names carry no signal about their contents.
- **Cheap and separable**: the repo-wide one-line-per-file purpose map the
  expert panel recommended alongside decomposition.
- **Mechanical, lower value**: `object-store.ts`'s helper tail,
  `conformance/runner.ts`, and the four oversized test files.
- **Profiling-first, unrelated to decomposition**: the full-re-render pattern
  in `src/ui/components/`.

## Closing Note

Not yet executed. This document exists to make the split mechanical before any
code is touched: the exact area for all 181 members, the measured DAG that
proves the chain has no back-edges, the two boundaries that measurement forced
rather than taste, and the one real risk — a silent wrong parse — answered by a
differential corpus check rather than by trusting the existing test suite.

## Execution Note

Executed in full against `main` at `d2d613a`, in one session, driven by a
Python extraction/generation script exactly as the Parallel Execution Plan
directed — no sub-agent fan-out, since the chain gives no independent stream.

**Re-verification findings (Task 1).** All Evidence held except two counts
this document had wrong before execution and which are now corrected above:
the `resolved-model.js` type import is 51 names, not 53, and the `ast.js`
import is 79, not "~120". The member count (181), the four-name public
surface, the no-external-`AdlParser`-reference fact, and the DAG all held
exactly as stated.

**One design detail the plan under-specified, resolved by measurement.** The
script's first identifier scanner stripped template literals along with
comments and strings before looking for `this.<member>` references. Five
lines in `parser.ts` make real calls *inside* a template literal, so that
scanner silently under-detected cross-area calls and produced a file that
failed `tsc` on a missing `pascalCase` import. The fix — strip comments only,
keep string and template contents — is recorded in the script and in
`learnings/`, because it is the generalisable trap: **an identifier scanner
used to compute cross-module references must not treat template literals as
opaque.** The typecheck caught it immediately, which is the value of the
"typecheck after each file" rule.

**Verification results:**

- `npm run typecheck` — clean, first attempt, once the scanner was fixed.
- `npm test` — 60 test files, 1,084 tests, all passing, with **zero test file
  changes**.
- **Differential parser corpus (the phase's real correctness proof)** — a
  throwaway vitest dump (never committed) ran in a `git worktree` at pre-split
  `d2d613a` and again against the split tree, over 2,071 inputs: the 6 `.adl`
  files truncated at every line boundary, plus every string value in the 9
  `.adlj` files fed to `parseExpressionSource`. That corpus exercised **821
  successful parses and 1,250 distinct `ParseError` paths**. The two 21.4 MB
  JSON dumps — full `AdlDocumentAst` on success, `code`/`message`/`sourceRange`
  on failure — are **byte-identical**. The `.adlj` list was 9 files, not the 8
  this document estimated.
- **Member census** — all 181 member bodies verified present verbatim in the
  emitted files (modulo the visibility keyword) before Prettier ran, and the
  extraction was proved byte-exact against the original class body first, so
  nothing relied on the extractor being trusted.
- `npm run format:check` — clean after one `prettier --write` pass over the new
  directory.
- `npm run verify:push` — clean; all 54 Playwright tests passed with zero
  screenshot diffs and no changed snapshot files.
- `git diff --stat` — exactly one modified file (`src/parser/parser.ts`, +5
  −5,728) plus 24 new files under `src/parser/grammar/`. No other file touched.
- File sizes — largest is `object-field.ts` at 593 lines, then `view.ts` at
  502; median 255. Every file is well under the 700-line ceiling, against 5,750
  before.

**Bundle-size outcome, and an unexpected side effect worth recording.** The
acceptance criterion was "no more than 1% gzip regression". Total across chunks
moved 229.75 kB → 230.52 kB gzip (**+0.33%**), inside the threshold. But that
total hides a real improvement: the **eager `index` chunk fell 177.16 kB →
159.78 kB gzip (−9.8%)** while the lazily-imported `compile-adl-project-v2`
chunk rose 52.59 kB → 70.74 kB. Sourcemap inspection confirms why: before the
split, `parser.ts` was a single atomic module, so any eager reference dragged
all 5,750 lines into the entry chunk; after it, Rollup places the 24 modules
per-chunk, and the entry chunk carries only 8 of them (`cursor`, `literals`,
`clauses`, `expression`, `theme`, `sync`, `diagnostics`, `text`) with the other
16 reachable only through the dynamic import. This is the same class of win
Phase 79 was chasing when it worked to keep the compiler out of the browser
bundle — obtained here as a side effect of module granularity, not by design.

**Named, not claimed:** *why* the entry chunk still reaches those particular 8
bottom-of-chain grammar modules was not traced to the specific eager import
that causes it. The behaviour is proven correct and the direction is
favourable, so this was not chased further, but a phase that wants the eager
bundle smaller still should start there — the remaining 8 modules look
severable.
