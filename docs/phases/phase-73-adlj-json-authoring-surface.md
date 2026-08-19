# Phase 73 - `.adlj` JSON Authoring Surface

> Commissioned directly by the user, following Phase 72's Planning Handoff,
> which named this idea as a candidate rather than claiming it: "Worth
> recording precisely because `compile-adl.ts`'s actual pipeline ...
> already separates 'get to a `PartialApplicationModel`' from 'resolve and
> validate it' — a JSON front-end producing `PartialApplicationModel`
> directly would share 100% of resolution and validation with the text
> parser, not duplicate it." Per `learnings/process/phase-execution.md`'s
> "Rolling Handoff Stopped At Phase 63" rule, unchanged since Phase 64,
> this is the same user-commissioned condition that authorised Phase 69
> through Phase 72.
>
> **This document is a plan, not a completed phase**, matching Phase 72's
> own framing — nothing below has been implemented.

## Objective

Add `.adlj`: a JSON-encoded ADL source format that an author — human or
LLM — can write directly, that a JSON Schema can validate structurally
before the ADL compiler ever runs, and that shares the *entire* resolve/
validate/runtime pipeline with `.adl` text through the existing
`PartialApplicationModel` stage rather than duplicating it. Pair it with a
printer that renders canonical `.adl` text from the same shared stage, so
a `.adlj`-authored app has a human-reviewable, diffable text form on
demand — the specific capability the originating conversation asked for:
"I can ask you to write the ADL and it's easy for you, and you can convert
back to human readable if required."

This directly answers Phase 72's Class A (grammar spelling/shape
ambiguity) for whatever is authored as `.adlj`, by removing the free-text
surface that ambiguity needs to exist in at all. It does nothing for
Class B (behavioral traps like `AUTO_ID`'s missing runtime path) — those
live in the resolved model and the runtime regardless of which surface
produced it, and stay Phase 72's problem to solve, not this phase's.

## Evidence and Dependency

Re-verify against current code (main at `6e3d864`, Phase 72's process
change) before executing.

- `src/compiler/compile-adl.ts:107-119`: `compileAdl(source: string)` is
  exactly `parseAdl(source) -> adlAstToPartialApplicationModel(ast) ->
  resolveApplicationModel(partialModel) -> validateApplicationModel(model)`.
  The last two stages take a `PartialApplicationModel` / a
  `ResolvedApplicationModel` respectively — no text-shaped input required
  by either. This is the fact the whole design below depends on: adding a
  JSON front-end that produces a `PartialApplicationModel` needs no change
  to resolution or validation at all.
- `src/model/resolved-model.ts:1629-1643`: `PartialApplicationModel`'s
  full field list — `modelVersion?`, `app`, `shell?`, `roles?`,
  `contexts?`, `objects`, `readModels?`, `decisionTables?`, `commands?`,
  `policies?`, `themes?`, `sync?`, `migrations?` — all plain arrays and
  optional fields, already JSON-serializable data with no class instances
  or functions anywhere in it.
- `src/model/resolved-model.ts:1912`:
  `PartialPolicyConditionModel = ResolvedExpression | ResolvedPolicyCondition`
  — confirms expression-bearing fields are already fully-structured
  `ResolvedExpression` trees at the `PartialApplicationModel` stage, not
  deferred source text. The same is true of field `VALIDATE`, lifecycle
  guards, decision-table inputs/rows, command preconditions, `SYNC ...
  WHERE`, computed fields, read-model expression fields, and list `WHERE`
  — confirm the full field-by-field list during execution rather than
  assumed complete here.
- `src/parser/parser.ts:4432`: `parseExpressionUntil(stopWords):
  ResolvedExpression` is a **private** method on the `Parser` class,
  reading from that instance's own token stream mid-document. There is no
  standalone exported function today that parses one expression string in
  isolation.
- `src/compiler/compile-adl-project.ts:25-46`: multi-source-file support
  (`app.yaml`'s `sources` list) works by **string-concatenating** every
  listed `.adl` file's text (`.join("\n\n")`) and calling `compileAdl`
  **once** over the joined string. The "later object declaration that
  contains only `VIEW` blocks extends the earlier declaration" merge rule
  (`docs/spec/language.md`'s Syntax Shape section; implemented by
  `mergeViewOnlyObjectDeclarations`, `compile-adl.ts:123`) runs at the
  **AST** level, over that single concatenated parse — there is no
  `PartialApplicationModel`-level merge function anywhere in the compiler
  today. This is the load-bearing fact behind this phase's scope boundary
  below.
- `package.json`: no JSON-Schema-from-TypeScript generator and no `ajv`
  (or equivalent JSON Schema validator) among current dependencies —
  confirmed by reading the full `devDependencies` list. Both would be new.

## The Decision

### Scope boundary: a `.adlj` app is self-contained in v1 — no mixing `.adl` and `.adlj` sources, no merging multiple `.adlj` files

Directly forced by the evidence above, not a conservative default chosen
without a reason: today's only multi-file mechanism is "concatenate `.adl`
text, parse once," and the one non-trivial merge rule it relies on
(VIEW-only object extension) is implemented once, at the AST layer, over
that concatenated text. Giving `.adlj` parity — usable inside a
multi-source `app.yaml` alongside `.adl` files, or split across several
`.adlj` files the way Giggle Band splits `domain.adl`/`ui.adl` — would
need a new merge function operating on `PartialApplicationModel` values
instead of AST nodes, replicating the same VIEW-only-extension rule (and
every other top-level list's merge semantics: objects, policies, read
models, decision tables, commands, roles, contexts, shell, themes,
migrations) at a different layer. That is real, separable work with its
own design questions (what does "later declaration extends earlier"
mean when there is no longer one linear concatenated file to define
"later"?) — not a natural side effect of adding a JSON front-end, and not
taken on speculatively here.

v1 scope instead: `compileAdlj(jsonText: string)` compiles exactly one
self-contained `.adlj` document into one `ResolvedApplicationModel`, the
direct JSON analogue of `compileAdl(source: string)` on a single `.adl`
file, not of `compileAdlProject`. This is also why Giggle Band is not
migrated to `.adlj` in this phase (see "Non-goals") — it is deliberately
two files today, for reasons `learnings/` already records, and forcing it
into one `.adlj` document to fit v1's boundary would be a regression in
service of nothing this phase needs to prove. A new, small, standalone
fixture app proves the format instead.

### Pipeline: a second front-end into the existing pipeline, not a second compiler

```
parseAdljDocument(jsonText)              -> AdljSourceDocument   // JSON.parse + schema validation
adljSourceToPartialApplicationModel(doc) -> PartialApplicationModel  // structural mapping + expression parsing
resolveApplicationModel(partialModel)    -> ResolvedApplicationModel   // REUSED UNCHANGED
validateApplicationModel(model)          -> Diagnostic[]               // REUSED UNCHANGED
```

`compileAdlj` mirrors `compileAdl`'s exact result shape (`CompileAdljResult`
= `{ source, partialModel, model, diagnostics }`, `source` standing in for
`ast`). Only the first two stages are new code. Every validation rule,
every diagnostic code, every runtime behaviour downstream of
`PartialApplicationModel` is defined exactly once — a `.adlj` app and an
equivalent `.adl` app that resolve to the same `PartialApplicationModel`
are indistinguishable to everything after that point, including the
runtime and the authority server, neither of which this phase touches at
all.

### `AdljSourceDocument`: `PartialApplicationModel`'s own shape, with expressions kept as strings

`PartialApplicationModel`'s real field list (Evidence, above) is close
enough to already be the target shape: the same top-level keys, the same
arrays and optional fields, all plain data. The one place `AdljSourceDocument`
needs a sibling type rather than direct reuse is every field that holds a
`ResolvedExpression` (or a union including one) as authored content — in
`AdljSourceDocument` these are typed `string`, holding the identical infix
expression syntax `.adl` text already uses (`"EndDate >= StartDate"`),
not a hand-authored JSON expression tree.

This is the phase's one deliberate rejection of "more JSON-native, in
every place JSON could go": expanding every `VALIDATE`, policy `WHEN`,
lifecycle guard, decision-table condition, and list `WHERE` into a
`{"kind":"binary","op":">=", "left": {...}, "right": {...}}`-shaped object
was considered and rejected. Nested expression trees are more surface
area to get subtly wrong by hand than a single infix line, which would
make `.adlj` *more* error-prone on exactly the constructs — policy rules,
validations, filters — where getting it right matters most, directly
against the format's own purpose. `.adlj` should be JSON everywhere that
removes ambiguity (field declarations, view layout, sync scope, command
steps — the declarative skeleton) and stay ADL's existing infix syntax
everywhere expressions already do their job well.

### New shared parser entry point: `parseExpressionSource`

Add `export function parseExpressionSource(text: string): ResolvedExpression`
to `src/parser/parser.ts` — constructs a `Parser` over exactly that string
and runs the equivalent of `parseExpressionUntil(new Set())` through to
end of input, raising a parse diagnostic if input remains unconsumed
afterward (an expression string with trailing garbage must fail loudly,
not silently parse a prefix). `adljSourceToPartialApplicationModel` calls
this once per expression-bearing field the JSON document declares.
Nothing about expression grammar itself is duplicated — this exposes the
existing private capability, it does not reimplement it.

### Schema validation: generate the JSON Schema from the TypeScript types

Recommend a TypeScript-to-JSON-Schema generator (for example
`ts-json-schema-generator`) run against `AdljSourceDocument`'s type
declarations, with the generated schema checked in as a build artifact —
not a hand-written schema kept in sync by hand. For the same reason Phase
72 preferred one canonical grammar over documenting exceptions: a
third hand-maintained shape of "what a valid ADL app looks like" (after
the parser's grammar and the resolved-model types) is one more place for
drift, and here the TypeScript types already are the single source of
truth this project otherwise relies on. Validate incoming `.adlj`
documents against the generated schema with `ajv` inside
`parseAdljDocument`; a violation becomes a `Diagnostic`
(`ADL_ADLJ_SCHEMA_INVALID`, carrying the schema violation's JSON path and
message) through the project's existing `Diagnostic` shape, not a raw
library exception — so the `AGENTS.md`/`CLAUDE.md` "compile-check ADL
source before presenting it" rule Phase 72 added applies to `.adlj`
exactly the way it already applies to `.adl`.

Both `ts-json-schema-generator` and `ajv` are new devDependencies; neither
exists in `package.json` today (Evidence, above). Confirm this is still
current and settle the exact package choice at execution time.

### The printer: `.adl` text from `PartialApplicationModel`, one direction only

Add `printPartialApplicationModelAsAdl(model: PartialApplicationModel):
string`, rendering canonical `.adl` source text. It operates on
`PartialApplicationModel` — the stage both front-ends already share —
rather than on the fully resolved `ResolvedApplicationModel`, whose
defaults are filled in and would print noisy text restating values the
author never wrote (every object's `THEME` spelled out even when nobody
declared one, for example). `PartialApplicationModel` is exactly what
`.adl` text itself parses down to, so printing from that stage is the
closest a printer can get to "what a human would plausibly have typed."

The direction is declared explicitly, because it decides how staleness is
handled: **generation is one-directional.** `.adl` is never hand-edited
once a `.adlj` counterpart exists for that source; a generated `.adl` file
carries a header comment naming its `.adlj` source and stating it is
generated. This phase does not build an `.adl` → `.adlj` importer or any
bidirectional merge tool — real, separable scope, deliberately not taken
on (see "Non-goals"). A later drift check (re-run the printer, diff
against the checked-in `.adl`) is a natural CI addition but is not
required for this phase. An app can remain pure hand-written `.adl` with
no `.adlj` at all; nothing here is a migration requirement for existing
content.

A useful side effect of sharing `PartialApplicationModel` with the text
parser: `.adl` text → `parseAdl` → `PartialApplicationModel` → print →
`parseAdl` again is a round-trip check available for free. Run it once
over the standalone fixture app (and, as a smoke check, over a sample of
the existing conformance corpus) as a regression signal that the printer
means what the original author wrote — not required to preserve
whitespace or comments, but required to resolve to an identical
`ResolvedApplicationModel` after reparsing.

## Scope

- `src/model/resolved-model.ts` (or a new `src/model/adlj-source.ts`):
  `AdljSourceDocument` type family, mirroring `PartialApplicationModel`
  with expression-bearing fields typed `string`.
- `src/parser/parser.ts`: new exported `parseExpressionSource`.
- New `src/compiler/compile-adlj.ts`: `compileAdlj`, `CompileAdljResult`,
  `parseAdljDocument`, `adljSourceToPartialApplicationModel`.
- New `src/compiler/print-adl.ts` (naming TBD):
  `printPartialApplicationModelAsAdl`.
- A generated JSON Schema artifact plus its generation script wired into
  `package.json`.
- `package.json`: new devDependencies for schema generation and
  validation.
- A new, small, standalone fixture app (not Giggle Band) written twice —
  once as `.adl`, once as hand-equivalent `.adlj` — proving both compile
  to the identical `ResolvedApplicationModel`.
- `docs/spec/language.md` or a new `docs/spec/adlj.md`: the format
  documented, including the "expressions stay as strings" rule and the
  one-directional generation/staleness policy.
- Tests: schema validation (accept/reject), `adljSourceToPartialApplicationModel`
  mapping, `parseExpressionSource` (including the trailing-garbage
  failure case), the golden-equivalence fixture pair, printer round-trip.
- `learnings/` new document; `learnings/index.md` updated.

## Constraints

- No mixing `.adl` and `.adlj` sources in one `app.yaml`, and no merging
  multiple `.adlj` files, in this phase — see "The Decision".
- No `.adl` → `.adlj` importer.
- No bidirectional sync or merge tool for a `.adl` file edited after being
  generated.
- No change to `resolveApplicationModel` or `validateApplicationModel`.
  Both are reused exactly as they exist today; if implementation reveals
  either needs to change for `.adlj` to work correctly, that is evidence
  this document's "shared pipeline" premise needs re-examining before
  proceeding, not something to quietly patch around.
- No expression-as-JSON-AST authoring format. Expression fields stay
  strings in the existing infix syntax, always.
- Giggle Band is not migrated, duplicated, or given a `.adlj` counterpart
  in this phase.

## Deliverables

Listed under "Scope" above; repeated here as the completion checklist once
executed.

- `AdljSourceDocument` type family.
- `parseExpressionSource`, exported from `parser.ts`.
- `compileAdlj` and its supporting `parseAdljDocument`/
  `adljSourceToPartialApplicationModel`, producing `Diagnostic`s
  (including `ADL_ADLJ_SCHEMA_INVALID`) through the existing `Diagnostic`
  shape.
- `printPartialApplicationModelAsAdl`.
- Generated JSON Schema, checked in, with its generation script.
- The standalone fixture app's `.adl`/`.adlj` pair and its
  golden-equivalence test.
- Printer round-trip test.
- Spec documentation.
- `learnings/` write-up naming the merge-architecture gap this phase
  deliberately did not close (see "Planning Handoff").

## Acceptance Criteria

- `compileAdlj` on the standalone fixture app's `.adlj` source produces a
  `ResolvedApplicationModel` deep-equal to `compileAdl`'s result on the
  hand-equivalent `.adl` source, and both report zero diagnostics.
- A `.adlj` document violating the generated schema fails with
  `ADL_ADLJ_SCHEMA_INVALID` naming the violating path — not a raw
  `JSON.parse`/`ajv` exception surfacing to the caller.
- An expression string with unconsumed trailing tokens (for example
  `"EndDate >= StartDate extra"`) fails `parseExpressionSource` with a
  parse diagnostic, not a silently-truncated partial parse.
- `printPartialApplicationModelAsAdl` run over the fixture app's
  `PartialApplicationModel`, then reparsed with `parseAdl`, resolves to a
  `ResolvedApplicationModel` deep-equal to the original.
- At least one existing model-validation diagnostic exercised by an
  existing `.adl` conformance case also fires when the equivalent
  condition is expressed in `.adlj` — proven by hand-porting one such
  case, not claimed for the whole corpus.
- `npm test`, `npm run typecheck`, and `npm run format:check` pass.
- `npm run test:integration` and `npm run verify:push` are not expected —
  nothing in this phase touches the authority server, PostgreSQL, or any
  rendered UI surface; confirm this holds once the diff is final rather
  than assumed from this plan.
- Every pre-existing test and conformance case is unmodified and still
  passes.

## Testing (planned)

- `npm test` — new unit coverage for schema validation,
  `adljSourceToPartialApplicationModel`, `parseExpressionSource`, the
  golden-equivalence pair, and the printer round-trip.
- `npm run typecheck`, `npm run format:check`.
- `npm run test:integration` — expected not required (see Acceptance
  Criteria); confirm at execution time rather than assumed.
- `npm run verify:push` — expected not required; nothing renders.

## Non-goals

- Mixing `.adl` and `.adlj` sources in one app, or merging several
  `.adlj` files (Phase 74 candidate — see "Planning Handoff").
- An `.adl` → `.adlj` importer.
- A bidirectional sync/merge tool between a generated `.adl` file and a
  hand-edit made to it afterward.
- Migrating Giggle Band, or any part of it, to `.adlj`.
- Automated CI drift-checking that a checked-in generated `.adl` file
  still matches a fresh run of the printer. A natural follow-up, not
  required here.
- Editor/LSP tooling for `.adlj` (schema-driven autocomplete, inline
  diagnostics). The generated JSON Schema is a prerequisite for that, not
  the tooling itself.
- Any change to Phase 72's Class B behavioral-trap work. Independent
  scope; `.adlj` changes nothing about whether `AUTO_ID` mints at runtime
  or `CONTEXT_MEMBER` can gate `SEARCH`.

## Dependencies

- `src/model/resolved-model.ts` (`PartialApplicationModel` and every
  `Partial*Model` interface it references).
- `src/compiler/compile-adl.ts` (`resolveApplicationModel`,
  `validateApplicationModel`, imported unchanged).
- `src/compiler/compile-adl-project.ts` (read-only reference — confirms
  why multi-source mixing is out of scope; not modified).
- `src/parser/parser.ts` (`parseExpressionUntil`'s expression grammar,
  reused by the new `parseExpressionSource`).
- `src/model/diagnostics.ts` or wherever `Diagnostic` is defined
  (confirm exact path at execution time).
- `package.json` (new devDependencies).

## Parallel Execution Plan

1. **Serial spine**: define `AdljSourceDocument`'s exact type family
   against the current, re-verified `PartialApplicationModel` shape.
   Everything else — the schema generator's input, the JSON front-end's
   output type, the printer's input type (`PartialApplicationModel`
   itself, already frozen and unchanged by this phase) — depends on this
   being settled first.
2. **Fan out, two genuinely independent streams once the spine lands**:
   - Agent A: the JSON front-end — `parseExpressionSource`,
     `parseAdljDocument` (including schema-generator/`ajv` wiring),
     `adljSourceToPartialApplicationModel`, `compileAdlj`.
   - Agent B: the printer — `printPartialApplicationModelAsAdl`. This
     consumes only `PartialApplicationModel`, which the spine step
     confirms is unchanged, so Agent B needs nothing from Agent A's
     implementation to start, only the same frozen type both already
     share.
3. **Barrier**: the standalone fixture app's `.adl`/`.adlj` pair and its
   golden-equivalence and round-trip tests, written last because they
   need both streams finished — the equivalence test needs Agent A's
   `compileAdlj`, and the round-trip test needs Agent B's printer.
4. **Barrier**: `npm test`, `npm run typecheck`, `npm run format:check`,
   once, after everything lands together.

## Tasks

1. Re-verify the evidence above against current code.
2. `AdljSourceDocument` type family.
3. `src/parser/parser.ts`: `parseExpressionSource`.
4. Schema generator wiring; generated JSON Schema checked in.
5. `src/compiler/compile-adlj.ts`: `parseAdljDocument` (schema validation
   via `ajv`), `adljSourceToPartialApplicationModel`, `compileAdlj`.
6. `src/compiler/print-adl.ts`: `printPartialApplicationModelAsAdl`.
7. Standalone fixture app: `.adl` and hand-equivalent `.adlj`.
8. Tests: schema accept/reject, mapping, `parseExpressionSource`,
   golden-equivalence, printer round-trip.
9. `docs/spec/adlj.md` (or `language.md` addition).
10. `npm test`, `npm run typecheck`, `npm run format:check`.
11. `learnings/` new document plus `learnings/index.md` update, naming
    the merge-architecture gap as a Phase 74 candidate.
12. Planning handoff.
13. Commit and push.

## Planning Handoff

Named candidates, none claimed here, per the same standing rule Phase 71
and Phase 72 both used:

- **`PartialApplicationModel`-level source merging.** Would unblock mixing
  `.adl` and `.adlj` sources in one `app.yaml` and merging several `.adlj`
  files, matching how `.adl` sources already merge today. Its own design
  problem: "later declaration extends earlier" currently means something
  precise (linear order in one concatenated text); a set of independently
  parsed `PartialApplicationModel` fragments has no such inherent order
  unless `app.yaml`'s existing source-list order is threaded through. Real
  work, deliberately not started here.
- **An `.adl` → `.adlj` importer.** The natural complement to the printer,
  for converting existing hand-written `.adl` content (Giggle Band
  included) into `.adlj` form. Not attempted here because it is a second,
  independent direction with its own fidelity questions (what happens to
  a construct `.adlj` cannot yet represent, if any gap between the two
  surfaces exists).
- **Editor/LSP support for `.adlj`**, once the generated JSON Schema
  exists — real-time validation in an editor the way any JSON-Schema-backed
  format gets today, for free from the schema this phase produces.
- **Porting a real piece of Giggle Band to `.adlj`**, once source merging
  (above) makes that possible without giving up the deliberate
  `domain.adl`/`ui.adl` split.

## Closing Note

Not yet executed. This document exists to settle the design — one
self-contained `.adlj` document per app in v1, a JSON front-end sharing
`resolveApplicationModel`/`validateApplicationModel` unchanged with `.adl`
text, expressions kept as strings rather than JSON ASTs, and a
one-directional printer rather than a bidirectional sync tool — before any
code is written, matching Phase 72's own "plan first" framing. The two
Phase 72 Class B capability gaps (`AUTO_ID` minting;
`LOOKUP TARGET_FIELD`'s two unhonoured paths) remain tracked there,
unrelated to and unaffected by this phase.
