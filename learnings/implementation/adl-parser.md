# ADL Parser Implementation

Read this before changing the ADL lexer, parser, AST-to-partial-model compiler, parser tests, or examples.

## Key decisions from Phase 6

- The initial ADL parser is hand-written TypeScript under `src/parser/`. It is line-oriented inside explicit blocks and supports `END.APP`, `END.OBJECT`, `END.LIFECYCLE`, `END.ACTION`, `END.VIEW`, `END.POLICY`, and `END.THEME`.
- Parser AST nodes carry source ranges, but runtime and validator code still consume the resolved model only. Do not make runtime services depend on parser AST nodes.
- `compileAdl(source)` parses ADL, converts the AST to `PartialApplicationModel`, resolves it with `resolveApplicationModel`, then returns structured validation diagnostics from `validateApplicationModel`.
- `compileAdlProject({ manifestSource, sources })` parses the folder-level
  `app.yaml` manifest, concatenates the listed ADL sources in manifest order,
  and then compiles them through the same `compileAdl` path.
- Syntax errors throw `ParseError` with source location. Parsed-but-invalid models return validator diagnostics through `compileAdl`.
- Top-level `THEME Name BASE BuiltInTheme` declarations compile to `PartialThemeModel` token overrides. Existing resolver logic flattens built-in base themes.
- Inline lifecycle action declarations such as `ALLOW ROLE Admin` compile to deterministic generated policies named `<Object><Action>Policy`, and the lifecycle action receives that policy reference. This keeps action permissions in the normal policy model.
- Empty policy `channels` arrays must be omitted from the partial model unless source explicitly declares channels. An empty array means no runtime channels match after resolution.
- The root `src/index.ts` exports `parseAdl`, `lexAdl`, and `compileAdl`, but it does not re-export `src/parser/ast.ts` wholesale because the AST source range names conflict with validator source range exports.

## Key decisions after the Giggle Band ADL conversion

- `src/reference/giggle-band/app.yaml` is the folder-level manifest for the
  band reference app, and `src/reference/giggle-band/domain.adl` is the current
  authored source listed by that manifest. `src/reference/band-app.ts` imports
  both as raw text, compiles them with `compileAdlProject`, and keeps only
  executable runtime/seed helpers in TypeScript.
- The parser now supports top-level `CONTEXT` declarations, object `SCOPE`,
  `CONSTRAINT UNIQUE`, `CONSTRAINT ORDERED`, view `CONTEXT`, view `READ_MODEL`,
  and read-model `CONTEXT` declarations. These compile through the normal
  AST-to-partial-model path.
- Field names that collide with policy keywords, such as a field literally named
  `Role`, can be quoted in policy field lists: `FIELDS 'Role'`.

## Key decisions from Phase 25

- UI presentation syntax is parsed inside ordinary object-scoped `VIEW`
  declarations and compiles to `PartialViewModel.presentation`. The runtime and
  validators still consume only the resolved model.
- The implemented UI syntax subset covers view `LAYOUT`/`DENSITY`, local
  `STATE`, `ICON_MAP`, `SECTION`, `TOGGLE`, `LIST FROM`, list `ORDER BY`,
  `WHERE`, `RENDER_AS`, `DENSITY`, `EMPTY_TEXT`, `ROW`, `TEXT`, and `ICON`.
  Shell syntax remains out of parser scope.
- `FORMAT` accepts an explicit kind before the pattern, such as
  `TEXT EventDate FORMAT date 'EEE d MMM'`. If a pattern appears without a kind,
  the parser records a text format.
- Icon map calls are context-sensitive shorthand: row fragments parse
  `ICON EventTypeIcon(EventType)` as a field lookup, while toggle controls parse
  `ICON EventTypeIcon(Gig)` as a value lookup. Authors can use explicit
  `FIELD` or `VALUE` inside the call when ambiguity matters.
- `compileAdlProject` still concatenates manifest sources in order. The
  AST-to-partial conversion now folds later object declarations that contain
  only `VIEW` blocks into the first object of the same name, allowing
  `domain.adl` plus `ui.adl` without redefining domain fields.

## Key decisions from Phase 59

- Edit-surface syntax lives inside the ordinary object-scoped `VIEW` block:
  `EDIT_CONTAINER`, an `EDIT_SECTION ... END.EDIT_SECTION` block, and a
  `CHILD_COLLECTION ... END.CHILD_COLLECTION` block containing an optional
  `PICKER ... END.PICKER`. It compiles to `PartialViewModel.editContainer` and
  `PartialViewModel.editSections`, which already resolved and validated.
- It is `EDIT_SECTION` rather than `SECTION` because a view's `SECTION` already
  means a composed presentation section and a view may declare both.
- New keywords take the underscore form only. `READ_MODEL`/`READ.MODEL` and
  `ICON_MAP`/`ICON.MAP` accept a dotted alias for historical reasons; do not add
  more, and note that the underscore-only form is what keeps `END.<BLOCK>`
  unambiguous for a two-word block name.
- Flag directives (`STAGED`, `EXCLUDE_LINKED`) mean `true` when written bare and
  accept an explicit boolean, because both resolve to `true` by default and
  turning one off is otherwise unsayable.
- `compileAdl` omits `editSections` entirely when a view authors none, so
  resolution still supplies the default `fields` section. An empty array would
  resolve to a view with no editable fields at all. See
  [[edit-surface-language]].

## Key decisions from Phase 62

- `SYNC` gained two clauses: `WINDOW [<field>] [<n> DAYS] [LIMIT <n>]` and
  `WHERE <expression>`. Both are parsed inside the existing `parseSync` option
  loop, so they may appear in any order alongside `SCOPE` and `CONFLICT`.
- `WHERE` parses with `parseExpressionUntil(SYNC_OPTION_WORDS)` rather than to
  end of line, so a `CONFLICT` following the predicate on the same line is not
  swallowed by the expression. Any new option word on a line that can also carry
  an expression must be added to that stop set.
- `WINDOW`'s optional leading field name is distinguished from `14 DAYS` and
  `LIMIT 5` by token kind plus a `SYNC_WINDOW_NON_FIELD_WORDS` set, not by
  lookahead. A field name is any identifier or quoted string that is not one of
  those words, which is why `_updatedAt` works and `LIMIT` cannot be a field
  name here.
- The unit word after the day count is required, matching `OFFLINE_GRACE
  <days> DAYS`. Follow that precedent for any future numeric clause.
- The parser produces syntax; it does not decide meaning. Whether a `WINDOW` or
  a `WHERE` is *allowed* on a given scope is a `validate-model.ts` refusal, so a
  JSON `PartialApplicationModel` is held to the same rule. See
  [[edit-surface-language]] for the same split, and
  [[offline-dataset-runtime]] for what the clauses mean.

## Why Phase 64 needed no parser change at all

Phase 64 made a `WINDOW` and a `WHERE` legal alongside any sync scope, and
`parser.ts` was not touched. `parseSync` reads its options in a loop with no
ordering and no cross-checking — a clause's legality was never encoded here — so
the whole language change was the *removal* of two refusals in
`validate-model.ts`.

This is the concrete payoff of the rule above, and it is worth the discipline
elsewhere. Had the parser refused a `WINDOW` after `SCOPE currentUser`, the same
change would have meant new syntax, new parser tests, and a second place for the
two rules to disagree. When adding a clause, parse the shape and let the
validator decide whether the combination means anything.

## Key decisions from Phase 68: `MIME_TYPE` parsed the wrong shape

- `MIME_TYPE` used `consumeModifierValue` (one literal, optional parentheses —
  the same helper `MIN`/`MAX`/`MIN_LENGTH`/`MAX_LENGTH`/`MAX_SIZE`/`DEFAULT`
  use), but `validate-model.ts`'s `NAMED_VALIDATOR_RULES` already declared its
  value shape as `"list"`, same as `IN`. The mismatch meant every `MIME_TYPE`
  declaration failed `ADL_FIELD_VALIDATOR_VALUE_INVALID` unconditionally — a
  validator that compiled to a shape the model itself would then refuse.
- The fix is `MIME_TYPE` calling `consumeValueList` instead, matching `IN`'s
  established list-value precedent exactly. When a parser clause's value
  shape and a validator's declared expectation for that same value disagree,
  check both sides before assuming one of them is correct: here the
  validator, the runtime (`validation-engine.ts`'s `hasAllowedMimeType`
  already handled an array), and even a JSON-authored conformance model
  (`conformance/runtime/validation.json`'s `fieldValidators.Doc.validators`)
  all agreed the value should be a list. Only the parser disagreed with
  everything else, which is why it was the thing to fix.
- A JSON-authored conformance model bypasses the parser entirely (it is a
  `PartialApplicationModel` fed directly to `resolveApplicationModel`), so it
  cannot catch a parser-only defect like this one no matter how thorough its
  runtime coverage is. A parser bug needs a parser-level test
  (`parseAdl`/`compileAdl` over real ADL source text), not another
  resolved-model-JSON conformance case.

## Leading comment capture (the `comment` field on `Partial*Model`)

The lexer/parser used to discard every `#`/`//` comment as pure trivia with
no representation anywhere downstream. It now additionally captures a
leading comment block — one or more consecutive whole-line comments with no
blank line between them and none between the block and the declaration that
follows — and attaches it to that declaration's AST node as an optional
`leadingComment?: string` field, which `compile-adl.ts` threads into a
`comment?: string` field on the corresponding `Partial*Model` type (see
`learnings/implementation/adlj-json-authoring-surface.md` for the full
design writeup, including why the field lives on `Partial*Model` rather than
only `.adlj`'s `AdljSourceDocument`).

**The change is additive to the lexer, not a change to the main token
stream.** `lexAdl`'s returned `Token[]` is byte-for-byte identical before and
after — same tokens, same order. `lexAdlWithComments` (used internally by
`parseAdl`/`parseExpressionSource`) is a new sibling entry point that returns
that same token array plus a side array of `{ text, line }` records, one per
whole-line comment (a trailing same-line comment after code is deliberately
never captured, so a comment cannot be misattributed to the next
declaration). This is why the change needed no new parser test to be added
defensively for every *existing* parsing behaviour: nothing the grammar used
to accept or reject changed, so the entire existing parser test suite passed
unmodified.

**Capture is a pure line-number lookup, not a token-stream concept.**
`AdlParser.takeLeadingComment()` — called as the very first statement inside
each target construct's `parseXxx` method, before that method consumes its
own first token — walks backward from the current token's line through a
`Map<line, text>` built from the comment side array, collecting consecutive
lines until the first gap. No "already consumed" bookkeeping is needed: each
call site queries a distinct line range by construction (the lines strictly
above one specific declaration), so the same block can never double-attach.
This is also what makes a comment separated by a blank line, or a comment
with nothing following it at all (real example: Giggle Band's `domain.adl`
has one immediately before `END.OBJECT` inside `Availability`), silently
have no attachment point — it is simply a line number nothing ever queries
for, not a special-cased refusal.

**Which `parseXxx` methods call it**: `parseApp`, `parseShell`, `parseRole`,
`parseBusinessContext`, `parseContextGrant`, `parseObject`, `parseField`,
`parseObjectConstraint` (all three branches: unique/ordered/protectedRole),
`parseObjectValidation`, `parseView`, `parseRelationshipPicker`,
`parsePresentationSection`, `parsePresentationAction`, `parseReadModel`,
`parseReadModelSource`, `parseReadModelField` (both branches),
`parsePolicy`, `parsePolicyRule`, `parseCommand`, `parseCommandStep`. Adding
comment support to a further construct means adding the same two-line
pattern (`const leadingComment = this.takeLeadingComment();` before the
method's first token consumption; `...(leadingComment === undefined ? {} :
{ leadingComment })` in every branch that returns the AST node) to its
`parseXxx` method, the matching field on its AST interface in `ast.ts`, and
the matching `comment?: string` field on its `Partial*Model` interface in
`resolved-model.ts` — nothing else, since `compile-adlj.ts`/`adl-to-adlj.ts`
thread it for free via their existing destructure-then-spread mapper idiom
(see `learnings/implementation/adlj-json-authoring-surface.md`).

## Practical guidance

- Keep parser syntax declarative. Unsupported procedural keywords such as `FETCH`, `STORE`, `LOOP`, `SET`, `DART.INLINE`, and `SQL.INTO` should remain rejected.
- Add syntax by extending the AST-to-partial-model conversion, not by bypassing the resolver or validator.
- Prefer examples in `examples/*.adl` for end-to-end parser fixtures. They should compile into the same resolved model shape used by runtime tests.
