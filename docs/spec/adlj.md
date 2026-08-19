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

## Scope: one self-contained document (`compileAdlj`), or several merged (`compileAdlProjectV2`)

`compileAdlj` compiles exactly one `.adlj` document into one
`ResolvedApplicationModel` — the JSON analogue of `compileAdl` on a single
`.adl` file, not of `compileAdlProject`. That single-document scope is
unchanged.

As of Phase 76, mixing `.adl` and `.adlj` sources in one `app.yaml`, and
merging several `.adlj` files, are both supported — through a second project
compiler, `compileAdlProjectV2` (`src/compiler/compile-adl-project.ts`), that
sits alongside the original `compileAdlProject` rather than replacing it.
`compileAdlProject` itself is unchanged: an all-`.adl` `sources` list still
compiles exactly as it always has (string-concatenate every source, parse
the concatenation once). Reach for `compileAdlProjectV2` only when a project
actually needs a `.adlj` source, mixed or standalone.

**How `compileAdlProjectV2` builds its sources.** `compileAdlProject`'s only
multi-file mechanism is string-concatenating `.adl` text and parsing it
once; the one non-trivial merge rule it depends on ("later object
declaration with only `VIEW` blocks extends the earlier one") runs at the
AST level over that concatenation
(`mergeViewOnlyObjectDeclarations` in `compile-adl.ts`). An individual `.adl`
fragment with no `APP` block (a typical `ui.adl`) cannot be parsed on its
own — `.adl`'s parser requires `APP ... END.APP` as the literal first thing
in any document — so `compileAdlProjectV2` does not try to parse each `.adl`
source separately. Instead it partitions `manifest.sources` by extension (a
source is `.adlj` only if its listed path ends in `.adlj`; everything else
is treated as `.adl`), concatenates **all** `.adl`-extension entries
together — in their relative manifest order, regardless of whether they are
contiguous — into one text blob and parses it once via the existing
`.adl` path, producing a single `PartialApplicationModelFragment`. Each
`.adlj`-extension entry compiles independently into its own fragment via
`parseAdljDocument` + `adljSourceToPartialApplicationModel`.

**Fragment ordering.** The single `.adl`-derived fragment is placed at the
position of the *first* `.adl` entry in the manifest's overall source order;
each `.adlj` fragment is placed at its own manifest position. A manifest
listing `domain.adl`, `extra.adlj`, `ui.adl` therefore produces two
fragments in this order: `[domain.adl+ui.adl fragment, extra.adlj fragment]`
— the combined `.adl` fragment takes the position of `domain.adl` (the first
`.adl` entry), and `extra.adlj` keeps its own position after it, even though
`ui.adl` is textually last in the manifest. This is a deliberate, documented
choice among more than one reasonable option (a fully positional interleave
that split the `.adl` blob itself was considered and rejected as
unimplementable, per the parser constraint above) — a future phase could
revisit it if a project's ordering needs turn out to require finer-grained
control over where the `.adl`-derived content sits relative to `.adlj`
sources that come both before and after it.

**Merge rules**, applied by `mergePartialApplicationModelFragments`
(`src/compiler/merge-partial-model.ts`) to the resulting fragment array:

- `app`: the FIRST fragment (in the order above) that declares one wins.
  Every individual `.adlj` document's own schema requires `app`, so in
  practice every fragment always carries one; only the first fragment's
  survives merging, and every other fragment's `app` is discarded silently.
  Throws `at least one source must declare APP` if literally no fragment
  declares one (only reachable when every source is `.adl` text with no
  `APP` block anywhere in the concatenation, which `.adl`'s parser itself
  already refuses before this code path is reached).
- `modelVersion`: same rule — first fragment that declares one wins;
  undefined if none do.
- `shell`: the LAST fragment that declares one wins. This matches what
  `.adl` text concatenation already does today: `parseDocument`'s main loop
  just overwrites `shell = this.parseShell()` with no merging every time it
  sees a `SHELL` block, so whichever block is textually last in the
  concatenated document survives — the merge function reproduces that same
  outcome one level up, across fragments instead of across `SHELL` blocks
  within one fragment.
- `roles`, `contexts`, `readModels`, `decisionTables`, `commands`,
  `policies`, `themes`, `sync`, `migrations`: concatenated across all
  fragments, in fragment order, with each fragment's own internal order
  preserved.
- `objects`: concatenated the same way, then the view-only-object merge rule
  runs over the concatenated sequence: for each object entry (after the ones
  before it), if it declares nothing but a `name` and `views` — `businessKey`,
  `displayField`, `fields`, `computedFields`, `scope`, `constraints`,
  `validations`, `lifecycle`, and `sync` are all undefined — and an earlier
  entry in the sequence has the same `name`, its `views` are appended to the
  end of that earlier entry's own `views` (creating one if the earlier entry
  had none), and the later duplicate entry is dropped. This is the
  `PartialApplicationModel`-level equivalent of `compile-adl.ts`'s
  `isViewOnlyObjectDeclaration`/`mergeViewOnlyObjectDeclarations`, which does
  the same job at the AST level for an all-`.adl` project. Any other
  same-named-object collision — one that is not view-only — is left alone:
  both entries stay in the array, and `validateApplicationModel`'s existing
  `OBJECT_DUPLICATE` check refuses it downstream. That refusal is the
  correct outcome for a genuine naming conflict; the merge step must not
  paper over it.

See `learnings/implementation/adlj-json-authoring-surface.md` for the
implementation-side notes on this merge design.

Giggle Band is not migrated to `.adlj` and has no `.adlj` counterpart. A
small standalone fixture app (`examples/task-tracker.adl` /
`examples/task-tracker.adlj`) proves the single-document format, exercising
computed fields, an object validation, a lifecycle guard, a decision table,
and policy rules with a condition — the constructs whose expression fields
are the format's one interesting design decision (below).
`examples/multi-source/` proves multi-source merging: an `.adlj`-only
three-file split (`tasks-core.adlj` declaring the object's fields and
lifecycle, `tasks-views.adlj` declaring only a view for that same object,
`tasks-policy.adlj` declaring a policy) and a mixed `.adl` + `.adlj` pair
(`domain.adl` + `extra.adlj`).

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

**The printer itself is one-directional**: it only ever renders `.adl` text
from a `PartialApplicationModel`, never the reverse, and there is still no
bidirectional sync tool for a generated `.adl` file edited afterward — a
`.adl` file generated this way is not meant to be hand-edited once its
`.adlj` source exists. A separate importer (below) goes the other direction,
from `.adl` text to `.adlj` JSON, but it does not go through the printer at
all — it converts the shared `PartialApplicationModel` stage directly.

**Coverage**: the full declarative skeleton — `APP`, `SHELL`, `ROLE`,
`CONTEXT`, `CONTEXT_GRANT`, `OBJECT` (fields, computed fields, validations,
lifecycle, constraints, scope, sync), `READ_MODEL`, `DECISION_TABLE`,
`COMMAND`, `POLICY`, `THEME`, top-level `SYNC` — and every expression-bearing
field, printed back to infix syntax with every compound sub-expression
unconditionally parenthesized (correctness over prettiness: the contract is
"reparses to the identical tree," not "matches what a human would have
written"). **Composed view presentation (`PartialViewModel.presentation`) and
edit surfaces (`editContainer`/`editSections`) are printed too (Phase 78)** —
`LAYOUT`, `DENSITY`, local `STATE`, `ICON_MAP`, `STATUS`/`STATUS_MAP`,
`LEGEND`, `SECTION` (toggles, actions, `LIST`, `CALENDAR`, `ROW` templates,
status candidates), `EDIT_CONTAINER`, `EDIT_SECTION`, `CHILD_COLLECTION`, and
`PICKER` all round-trip, proven against the Giggle Band reference app's
actual compiled `partialModel` (`tests/compile-adlj.test.ts`), not just a
hand-built fixture.

A small, named set of constructs has a resolved-model/JSON shape but **no
ADL text syntax at all** — the parser has no grammar that ever produces
them, so the printer throws a clear, named error naming the construct rather
than guessing at invented syntax or silently dropping content:

- `MATRIX` (`PartialPresentationSectionModel.matrices`) — the parser has no
  `MATRIX` construct; `docs/spec/ui-language-addendum.md` documents it as
  "intended language direction... parser support remains future work."
- `select` and `contextSelector` presentation controls — only `toggle` and
  `action` controls have ADL source syntax.
- Conditional row fragments (`PartialPresentationRowFragmentModel` of kind
  `"conditional"`) — `ROW` only ever produces `TEXT`/`ICON` fragments.
- A field text fragment's `fallback`.
- A list's `fields` (`PartialPresentationListModel.fields`) — `LIST` has no
  `FIELDS` directive.
- An empty state's `icon` (list or calendar) — `EMPTY_TEXT` only ever takes a
  literal string.
- A calendar's `month.labelFormat`.
- Per-view `presentation.shell.regions` — only the global `SHELL` block (now
  printed too) has ADL source syntax; per-view shell regions are
  JSON/TypeScript-only per `docs/spec/ui-language-addendum.md`.

Getting the Giggle Band round-trip to actually pass also surfaced and fixed
several **pre-existing** printer defects outside composed presentation/edit
surfaces — real gaps the task-tracker fixture's narrower construct coverage
had never exercised: `APP`'s display name is now quoted (it may contain
spaces, unlike every other declared name); `CONTEXT` now prints as the
single physical line the parser actually requires (no `END.CONTEXT`, and
`SELECTION`/`AUTO_SELECT`/`PERSISTENCE` are independent directives, not one
grouped under `SELECTION`); a `READ_MODEL`'s `union` strategy now prints the
bare `UNION` directive the parser actually has (there is no `STRATEGY`
keyword at all); a `READ_MODEL SOURCE ... JOIN ... ON` clause now
re-qualifies the joined field (`member.User`, not a bare `User`) the way
`consumeQualifiedName` requires it on the way back in; a policy rule's
`FIELDS`/`STATE`/`ROLE`/`GROUP_ROLE`/`USER` name lists now quote any entry
that collides with a `POLICY RULE` stop word (Giggle Band has a field
literally named `Role`, ambiguous with the `ROLE` principal selector on the
same physical line); and a list-typed `COMMAND INPUT` with structured item
fields now prints its nested `FIELD ... END.INPUT` block instead of silently
dropping every item field's shape.

A useful side effect of sharing `PartialApplicationModel` with the text
parser: `.adl` text → `parseAdl` → `PartialApplicationModel` → print →
`parseAdl` again is a round-trip check available for free, proven for the
fixture app and for Giggle Band (`tests/compile-adlj.test.ts`). It is not
required to preserve whitespace or comments — only to resolve to an
identical `ResolvedApplicationModel` after reparsing.

## The importer: `.adl` text into `.adlj` JSON

`partialApplicationModelToAdljSource(model: PartialApplicationModel):
AdljSourceDocument` (`src/compiler/adl-to-adlj.ts`) is the structural mirror
of `adljSourceToPartialApplicationModel` (`src/compiler/compile-adlj.ts`):
the same walk over every object/field/validator/lifecycle/policy/decision-table/
command/context/readModel/sync structure, but inverted — everywhere the JSON
front-end calls `parseExpressionSource(someString)` to go string → tree, the
importer calls `printExpression`/`printCondition` (exported from
`print-adl.ts`, reused rather than reimplemented) to go tree → string. Every
other field passes straight through unchanged. `COMMAND STEP`
`values`/`patch`/`recordId` (`ResolvedCommandValueExpression`) stay JSON
as-is, unchanged, for the same reason `adljSourceToPartialApplicationModel`
leaves them alone: that vocabulary was never infix text to begin with.

A `PartialPolicyConditionModel`-typed field that actually holds the legacy
pre-Phase-20 `ResolvedPolicyCondition` shape (`equals`/`all`/`any`/`not`)
is refused with a clear error naming the field, exactly like `printCondition`
already refuses it for the `.adl` printer — nothing in this codebase authors
that shape any more, so translating it silently would launder stale content
rather than surface it.

`importAdlAsAdlj(adlSource: string): { document?: AdljSourceDocument;
diagnostics: Diagnostic[] }` is the convenience entry point: it runs
`compileAdl` and, only when the result carries no *error* diagnostics
(warnings pass through), converts `partialModel` with
`partialApplicationModelToAdljSource`. When there is a blocking error,
`document` is left `undefined` and no conversion is attempted, mirroring the
"compile-check before presenting it" rule the rest of this codebase already
follows for `.adl` source.

**Correctness contract**: matching the printer's own contract ("reparses to
the identical tree," not "produces identical text"), the importer's contract
is not byte-identical JSON against a hand-written `.adlj` file — field
ordering and whitespace may differ — but that compiling the *imported*
document with `compileAdlj` resolves to a `ResolvedApplicationModel`
deep-equal to compiling the original `.adl` text with `compileAdl`. Proven
for the fixture app in `tests/adl-to-adlj.test.ts`.

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

## Browser bundle cost: addressed (Phase 79)

`compileAdlj`'s `ajv` dependency and the generated JSON Schema were reached
through `src/index.ts`'s barrel export, which the browser UI bundle also
imports — so every browser build carried `.adlj` compilation support whether
or not the app being built ever used it. Measured at introduction (Phase 73):
the production bundle grew from 684 KB to 852 KB gzipped (158 KB → 203 KB
gzip).

`.adlj` compilation is an authoring/build-time concern; nothing in the
deployed browser runtime calls it (confirmed by grepping `src/ui/**` for any
`compile-adlj`/`compileAdlj` import — there is none). Phase 79 removed
`compile-adlj.ts`, `print-adl.ts`, and `model/adlj-source.ts` from
`src/index.ts`'s barrel `export *` list, the same treatment the barrel
already gives `simplewebauthn-adapter.ts` for the identical "browser bundle
carries a dependency it doesn't need" reason. Callers that need these
modules (currently only `tests/compile-adlj.test.ts`, which already imported
them by direct module path rather than through the barrel) import
`./compiler/compile-adlj.js`, `./compiler/print-adl.js`, or
`./model/adlj-source.js` directly.

Measured after the fix: the production bundle returned to 684.81 KB gzipped
158.18 KB (from 852.37 KB / 202.98 KB), matching the pre-Phase-73 baseline.
No dynamic `import()` / Vite-level code-splitting was needed — removing the
barrel re-export was sufficient, since nothing in `src/ui/**` reaches these
modules at all.

## Strategic direction: `.adlj` as the primary authoring surface

The working assumption going forward is that `.adlj` — not `.adl` text — is
what gets *authored*, because the author is overwhelmingly an LLM writing to
a JSON Schema rather than a human hand-typing keyword syntax. `.adl` text's
role narrows to what Phase 73's own originating conversation asked for: a
generated, human-reviewable, diffable read surface (`printPartialApplicationModelAsAdl`),
never a hand-edited source of truth. That reframing settles two open
questions Phase 72 deliberately left as "real, larger ideas, not started
here":

- **An `adlfmt` formatter is redundant, not merely deferred.** Its whole job
  was normalising inconsistent spelling in *hand-typed* `.adl` text — Phase
  72's Class A problem (`MIN 0` vs `MIN(0)`, `VALIDATE` vs `PREDICATE`, and
  the rest of the catalogue in `docs/spec/language.md`'s "Deprecated
  Spellings" table). If `.adl` text is never hand-typed — only ever emitted
  by the printer — that ambiguity cannot arise: a print function has exactly
  one way to render each construct by construction. There is nothing left
  for a formatter to normalise. The "check mode" a formatter would have
  offered (is this checked-in `.adl` file still canonical?) is already
  covered by the printer round-trip / drift-check tests described above, so
  even that half of the idea is not a gap.
- **A formal grammar file (PEG/ANTLR/Ohm) for the whole `.adl` declarative
  language is superseded by the JSON Schema for the surface that actually
  matters.** The idea existed to make the whole language provably
  unambiguous and parseable by tooling independent of this TypeScript
  implementation. `src/model/adlj-schema.json`, generated from
  `AdljSourceDocument`'s TypeScript types, already is that formal,
  machine-checkable, tooling-friendly specification — for the declarative
  skeleton, which is the part of the language `.adlj` authors actually write
  by hand (or rather, that an LLM writes to a schema).

**One real exception, worth stating precisely rather than glossing over.**
Expression-bearing fields in `.adlj` stay strings in infix syntax,
deliberately (see above) — the JSON Schema can validate that such a field
*is a string*, it cannot validate that the string is a *syntactically valid
ADL expression*. That check still runs through `parseExpressionSource`,
backed by the same hand-written expression grammar inside `src/parser/parser.ts`
that `.adl` text has always used. So it is not quite accurate to say the
formal-grammar idea is now "just a JSON Schema checker" — more precisely:
the declarative-skeleton grammar is now just a JSON Schema checker, and the
*expression* sub-grammar remains a real, load-bearing, hand-written text
grammar — just a far smaller and more tractable one than the whole language
was, and one already under conformance test coverage (see
`learnings/implementation/expression-language.md`).

Neither `adlfmt` nor a formal grammar file appears in the Non-goals list
below as a deferred candidate: they are not future work, they are ideas this
direction makes unnecessary.

## Non-goals (see Planning Handoff in `docs/phases/phase-73-*.md`, `phase-76-*.md`, and `phase-78-*.md`)

- A bidirectional sync/merge tool between a generated `.adl` file and a
  hand-edit made to it afterward.
- Printing the small, named set of presentation/edit-surface constructs that
  have no ADL text syntax at all (see above) — they would need new parser
  grammar first, not a printer change.
- Editor/LSP tooling for `.adlj` (the generated JSON Schema is a
  prerequisite for that, not the tooling itself).

Composed view presentation and edit-surface printing (Phase 73's gap) and a
permanent CI drift check against a real reference app (Phase 73's other
listed gap) are both now done — see "The printer" above.
