# `.adlj`: JSON-Encoded ADL Source

`.adlj` is a JSON-encoded alternative to `.adl` text (Phase 73), for an author
— human or LLM — who would rather write structured JSON than free-form
keyword syntax, and for whom a JSON Schema validating structure before the
ADL compiler ever runs is worth more than infix readability. It shares the
entire resolve/validate/runtime pipeline with `.adl` text: only the front end
differs.

```text
parseAdljDocument(jsonText)              -> AdljSourceDocument   // JSON.parse + schema validation
adljSourceToPartialApplicationModel(doc) -> PartialApplicationModel  // structural mapping + expression parsing
resolveApplicationModel(partialModel)    -> ResolvedApplicationModel   // REUSED UNCHANGED
validateApplicationModel(model)          -> Diagnostic[]               // REUSED UNCHANGED
```

`compileAdlj(jsonText)` runs the whole pipeline and mirrors `compileAdl`'s
result shape exactly: `{ source, partialModel, model, diagnostics }`, where
`source` stands in for `.adl`'s `ast`. A `.adlj` app and an equivalent `.adl`
app that resolve to the same `PartialApplicationModel` are indistinguishable
to everything downstream — the runtime, the authority server, `explainResolvedModel`
— none of which this format touches at all.

## Scope: one self-contained document, v1

`compileAdlj` compiles exactly one `.adlj` document into one
`ResolvedApplicationModel` — the JSON analogue of `compileAdl` on a single
`.adl` file, not of `compileAdlProject`. **Mixing `.adl` and `.adlj` sources
in one `app.yaml`, and merging several `.adlj` files, are both out of
scope.** `compileAdlProject`'s only multi-file mechanism today is
string-concatenating `.adl` text and parsing it once; the one non-trivial
merge rule that depends on ("later object declaration with only `VIEW`
blocks extends the earlier one") runs at the AST level over that
concatenation. Giving `.adlj` parity would need a new merge function
operating on `PartialApplicationModel` values instead of AST nodes — real,
separable work, not a natural side effect of adding a JSON front-end. See
`learnings/process/adlj-json-authoring-surface.md`.

Giggle Band is not migrated to `.adlj` and has no `.adlj` counterpart. A
small standalone fixture app (`examples/task-tracker.adl` /
`examples/task-tracker.adlj`) proves the format instead, exercising computed
fields, an object validation, a lifecycle guard, a decision table, and policy
rules with a condition — the constructs whose expression fields are the
format's one interesting design decision (below).

## Expressions stay as strings

`AdljSourceDocument` (`src/model/adlj-source.ts`) mirrors
`PartialApplicationModel` field-for-field — same top-level keys, same arrays
and optional fields — except every field that holds a `ResolvedExpression`
(or `PartialPolicyConditionModel`, the union that also accepts one) as
authored content is typed `string` instead, holding the identical infix
expression syntax `.adl` text already uses:

```json
{ "name": "priorityInRange", "expression": "Priority >= 1 AND Priority <= 10", "message": "..." }
```

This is deliberate, not a shortcut: expanding every `VALIDATE`, policy
`WHEN`, lifecycle guard, decision-table condition, and list `WHERE` into a
`{"kind":"binary","op":">=","left":{...},"right":{...}}`-shaped tree was
considered and rejected. A nested expression tree is more surface area to
get subtly wrong by hand than one infix line — which would make `.adlj`
*more* error-prone on exactly the constructs where getting it right matters
most, directly against the format's own purpose. `.adlj` is JSON everywhere
that removes ambiguity (field declarations, view layout, sync scope, command
steps — the declarative skeleton) and stays ADL's existing infix syntax
everywhere expressions already do their job well.

`parseExpressionSource(text: string): ResolvedExpression`, exported from
`src/parser/parser.ts`, is the shared leaf conversion: it constructs a parser
over exactly that string and parses one expression to end of input.
Unconsumed trailing content is a parse error
(`"EndDate >= StartDate extra"` fails), not a silently-truncated partial
parse.

A `COMMAND STEP`'s `VALUE`/`SET`/`PATCH` assignments
(`ResolvedCommandValueExpression`) are the one exception: they stay JSON, not
strings. Unlike `VALIDATE`/`WHEN`/`WHERE`, that vocabulary was never free-text
infix syntax to begin with — `VALUE Owner INPUT Owner` is already a small
closed keyword grammar mapping cleanly onto `{"kind":"input","name":"Owner"}`
— so there is no ambiguity for JSON to remove and no readability cost to
leaving it structured.

## A real gap the text parser papers over: `principal.match` has no default inference

`.adl` text's own AST-to-partial conversion quietly infers
`principal.match: "specific"` whenever a rule names `roles`/`users`/`groupRoles`
without writing `match` explicitly — a parser-level convenience.
`resolveApplicationModel` itself does **not** do this: `resolvePrincipal`
defaults an undeclared `match` to `"everyone"` regardless of what else the
principal names, which for a `"everyone"` principal makes any `roles` present
irrelevant. A `.adlj` author who writes `{"roles": ["Admin"]}` without
`"match": "specific"` gets a *silently wider* grant than they meant — the
same "no reading of it is correct" shape as Phase 72's `AUTO_ID` gap, just at
the JSON front-end instead of the parser. **Always write `match` explicitly
in `.adlj` policy principals.** This is not a defect in `resolveApplicationModel`,
which is shared and correct; it is a convenience `.adl` text's own front end
happens to add that `.adlj` does not inherit for free.

## Schema validation

The JSON Schema is generated from `AdljSourceDocument`'s TypeScript types via
`ts-json-schema-generator` (`npm run generate:adlj-schema`, output checked in
at `src/model/adlj-schema.json`) rather than hand-maintained — a third
hand-written shape of "what a valid ADL app looks like," alongside the
parser's grammar and the resolved-model types, is one more place for drift to
happen unnoticed.

`parseAdljDocument` validates with `ajv` and turns a violation into a
`Diagnostic` (`ADL_ADLJ_SCHEMA_INVALID`, naming the violating JSON path) or,
for input that is not valid JSON at all, `ADL_ADLJ_JSON_INVALID` — both
thrown as an `AdljParseError` carrying that one `Diagnostic`, the `.adlj`
analogue of `ParseError` for `.adl` text. Neither a raw `JSON.parse`
exception nor a raw `ajv` `ErrorObject[]` ever reaches a caller, so the
`AGENTS.md`/`CLAUDE.md` "compile-check ADL source before presenting it" rule
applies to `.adlj` exactly the way it already applies to `.adl`: check
`compileAdlj(...).diagnostics`, and be ready to catch `AdljParseError` for
input that never got that far.

## The printer: one direction only

`printPartialApplicationModelAsAdl(model: PartialApplicationModel): string`
(`src/compiler/print-adl.ts`) renders canonical `.adl` text from the same
`PartialApplicationModel` stage both front-ends already share — not from the
fully resolved model, whose filled-in defaults would print noisy text
restating values the author never wrote.

**Generation is one-directional.** There is no `.adl` → `.adlj` importer and
no bidirectional sync tool for a generated `.adl` file edited afterward. A
`.adl` file generated this way is not meant to be hand-edited once its
`.adlj` source exists.

**Coverage**: the full declarative skeleton — `APP`, `ROLE`, `CONTEXT`,
`CONTEXT_GRANT`, `OBJECT` (fields, computed fields, validations, lifecycle,
constraints, scope, sync), `READ_MODEL`, `DECISION_TABLE`, `COMMAND`,
`POLICY`, `THEME`, top-level `SYNC` — and every expression-bearing field,
printed back to infix syntax with every compound sub-expression
unconditionally parenthesized (correctness over prettiness: the contract is
"reparses to the identical tree," not "matches what a human would have
written"). **Composed view presentation (`PartialViewModel.presentation`)
and edit surfaces (`editContainer`/`editSections`) are not printed** —
`printView` throws a clear error naming the view rather than silently
dropping that content. Real, separable work; named as a candidate for a
future phase, not attempted here.

A useful side effect of sharing `PartialApplicationModel` with the text
parser: `.adl` text → `parseAdl` → `PartialApplicationModel` → print →
`parseAdl` again is a round-trip check available for free, proven for the
fixture app (`tests/compile-adlj.test.ts`). It is not required to preserve
whitespace or comments — only to resolve to an identical
`ResolvedApplicationModel` after reparsing.

## A cosmetic model-shape difference, not a behavioural one

`.adl`'s AST-to-partial conversion always supplies `contexts: []` and
`readModels: []`, even when the source declares neither — the parser's AST
always holds these as arrays, never `undefined`. `resolveApplicationModel`
itself treats an *omitted* `contexts`/`readModels` key as "not declared" and
leaves it out of the resolved model rather than defaulting to `[]`. A `.adlj`
document that omits these keys therefore resolves to a model missing those
two keys entirely, rather than holding empty arrays — harmless at runtime
(every consumer already treats "no contexts" and "empty contexts array" the
same way) but a real difference in the resolved model's literal shape.
`examples/task-tracker.adlj` declares `"contexts": [], "readModels": []`
explicitly for exact parity with what `.adl` text always produces; an author
who does not care about that parity can simply omit both keys.

## Known cost: the browser bundle

`compileAdlj`'s `ajv` dependency and the generated JSON Schema are reached
through `src/index.ts`'s barrel export, which the browser UI bundle also
imports — so every browser build now carries `.adlj` compilation support
whether or not the app being built ever uses it. Measured at introduction:
the production bundle grew from 684 KB to 852 KB gzipped (158 KB → 203 KB
gzip). Nothing in this phase's scope required keeping `.adlj` compilation out
of the browser bundle, and the existing barrel-export convention already
carries some Node-only surface the same way, but the size is real and worth
a deliberate look (code-splitting `compile-adlj.ts` behind a dynamic
`import()`, most plausibly) before it compounds with future additions.

## Non-goals (see Planning Handoff in `docs/phases/phase-73-*.md`)

- Mixing `.adl` and `.adlj` sources in one app, or merging several `.adlj`
  files — needs `PartialApplicationModel`-level source merging.
- An `.adl` → `.adlj` importer.
- A bidirectional sync/merge tool between a generated `.adl` file and a
  hand-edit made to it afterward.
- Composed view presentation / edit-surface printing.
- Automated CI drift-checking that a checked-in generated `.adl` file still
  matches a fresh run of the printer.
- Editor/LSP tooling for `.adlj` (the generated JSON Schema is a
  prerequisite for that, not the tooling itself).
