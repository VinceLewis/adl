# Parser Grammar File Map

Read this before changing ADL grammar — before grepping `src/parser/` for a
keyword. Since Phase 88, the parser is a directory of grammar-area files
behind a barrel, not a single 5,750-line file. This document says which file
holds which part of the grammar, and the one structural rule that keeps the
arrangement working.

See [[adl-parser]] for what the parser *decides* (its design rules, keyword
policy, and the AST-to-partial-model contract); this document is only about
where the code lives. Same relationship as [[compiler-model-layer-file-map]]
has to [[model-validator]].

## The shape

`src/parser/parser.ts` is now a 27-line barrel holding the entire public
surface — `parseAdl`, `parseExpressionSource`, `ParseError`,
`ParserDiagnostic` — and nothing else. Every consumer
(`compile-adl.ts`, `compile-adl-project-v2.ts`, `compile-adlj.ts`,
`conformance/runner.ts`, `src/index.ts`'s `export *`) imports that path
unchanged. `AdlParser` itself is not exported and never was.

The implementation is `src/parser/grammar/`: 22 class files plus
`diagnostics.ts` (`ParserDiagnostic`, `ParseError`) and `text.ts`
(`normaliseKeyword`, `lowerCamel`, `pascalCase`).

## Which file holds what

| File | Grammar area |
|---|---|
| `cursor.ts` | Token cursor and parser state: the index, `expectWord`/`matchWord`/`checkWord`/`*DottedWord`/`*Symbol`, `parseEnd`/`checkEnd`, `skipNewlines`, `consumeLineEnd`, `advance`/`current`/`peek`, `rangeFrom`, the `fail*` family, procedural-keyword refusal, `takeLeadingComment`, `recordDeprecatedSpelling` |
| `literals.ts` | Every `consume*` value reader: names, qualified names, name/value lists, literals, numbers, booleans, channel lists, output maps |
| `clauses.ts` | Only the small clauses genuinely shared across areas: `parseSortList`, `parseOptionalBoolean`, `parseViewContextAfterKeyword`, `parseViewContextMode` |
| `expression.ts` | `parseStandaloneExpression` and the full precedence ladder (coalesce → or → and → equality → comparison → additive → multiplicative → unary → primary) |
| `theme.ts` | `THEME` and its token overrides |
| `sync.ts` | `SYNC`: mode, scope, `WINDOW`, `WHERE`, `CONFLICT` |
| `policy.ts` | `POLICY`, rules, principal selectors, effects and actions |
| `decision-table.ts` | `DECISION_TABLE`, inputs, rows, match policy |
| `lifecycle.ts` | `LIFECYCLE`: states, actions, inline `ALLOW`, guards |
| `presentation-scalars.ts` | Every leaf presentation enum/scalar: layout, density, state type/persistence, calendar week start, list render style, row layout, action placement, status theme token, legend include, fragment style, format, icon refs |
| `presentation-row-format.ts` | `ROW` templates and their `TEXT`/`ICON` fragments |
| `presentation-action.ts` | Presentation action controls and their inputs |
| `presentation-source.ts` | `LIST`, `CALENDAR`, and status candidates |
| `presentation-core.ts` | `STATE`, `ICON_MAP`, `STATUS`, `STATUS_MAP`, `LEGEND`, `SECTION`, `TOGGLE` |
| `view.ts` | `VIEW`, `EDIT_CONTAINER`, `EDIT_SECTION`, `CHILD_COLLECTION`, `PICKER` |
| `object-field.ts` | `OBJECT`: `SCOPE`, `CONSTRAINT`, fields, field types, validators, computed fields, `LOOKUP`, `AUTO_ID` |
| `read-model.ts` | `READ_MODEL`, sources, joins, fields, source scope |
| `command.ts` | `COMMAND`: inputs, preconditions, steps, step authority |
| `context.ts` | `CONTEXT`, membership, `CONTEXT_GRANT`, context selection |
| `shell.ts` | `SHELL`: nav items, controls, top bar, drawer, visibility |
| `app.ts` | `APP`, `MIGRATION`, `ROLE` |
| `index.ts` | `parseDocument` and the concrete `AdlParser` |

## The one rule: the files are a linear class chain, and order matters

Each file's class extends the one above it in that table —
`LiteralParser extends CursorParser`, … , `AdlParser extends AppParser` — so
that every `this.parseXxx()` call inside a moved method body still resolves,
with no method body edited during the split. The whole prototype chain
assembles into one object at runtime, exactly as the single class did.

The cost is an ordering constraint: **a lower file cannot call a method
defined in a higher one.** TypeScript enforces this, so a violation is a
`tsc` error, not a silent bug. When you hit it, the fix is to move the shared
helper *down* to a layer below both callers — never to add a back-edge or an
`abstract` declaration. Two areas exist purely because measurement forced
them:

- `clauses.ts` exists because `parseSortList` is called by both `view` (a
  view's `ORDER BY`) and `presentation-source` (a list's and calendar's
  `ORDER BY`). Left in `view.ts` it makes `view` ↔ `presentation` a cycle.
- `presentation-scalars.ts` and `presentation-action.ts` exist because the
  presentation cluster is mutually recursive at the top — a `SECTION`
  contains a `LIST`, a `LIST` parses an action and a density, a `TOGGLE` and
  a `STATUS` both parse an icon ref. Pulling the leaf scalars and the action
  parser into their own layers turns that knot into a five-layer DAG.

Visibility follows the same logic mechanically: a member called from another
area is `protected`, one called only within its own file stays `private`.
After Phase 88 that is 88 protected methods, 86 private, 2 public
(`parseDocument`, `parseStandaloneExpression`), and 4 fields of which only
`styleWarnings` is `protected`.

## Adding grammar

Add a `parseXxx` to the file for its area, `private` unless another area
calls it. A genuinely new area gets a new file, inserted in the chain below
its callers and above its callees. If the new area is called by an existing
one, it must sit *below* that caller — which usually means inserting it just
above `literals.ts`/`expression.ts` rather than appending at the end.

**A new block terminated by `END.X` needs `X` added to `BlockName` in
`src/parser/ast.ts`.** `parseEnd`/`checkEnd` take a `BlockName`, not a string,
so this is a `tsc` error rather than a silent gap — but it lives in a different
file from the grammar and is easy to miss when planning the change. Phase 100
added four (`SELECT`, `CONTEXT_SELECTOR`, `CONFLICT_OVERLAY`, `SUMMARY`), and
that was the whole list of surprises the chain produced: adding directives to
`presentation-source`, `presentation-core` and `view` needed no relocation at
all, because everything they call — `parsePresentationFormat`,
`parsePresentationIconRef`, `consumeNameListUntilLine` — already lives below
them in the chain.

Phase 104 added five more (`MATRIX`, `ROWS`, `CELLS`, `CELL`, `EDIT`) for
`MATRIX`, and measured the same result: the whole construct went into
`presentation-source.ts` beside `LIST` and `CALENDAR`, called from `SECTION` in
`presentation-core.ts` directly above it, and every helper it needed
(`parseSortList`, `parsePresentationFormat`, `parsePresentationDensity`,
`consumeNameListUntilLine`, `consumePrimitiveLiteral`, `parseOptionalBoolean`)
was already below. No file moved and no new grammar-area file was needed.
`EDIT` does not collide with `EDIT_CONTAINER` or `EDIT_SECTION`: those are
single underscore-form keywords, so `checkEnd` compares one whole identifier
and `END.EDIT` and `END.EDIT_SECTION` are unambiguous.

**A `tsc`-clean build is not evidence that you found every consumer of a widened
type.** `BlockName` is the case where the compiler does help. Adding a *field*
to an AST node is the case where it does not help evenly: `matrices` became a
required field on `PresentationSectionDeclarationAst`, and `tsc` named the two
sites that construct or destructure it — but nothing named `print-adl.ts`, whose
gap was a `throw` that had to be replaced by hand, or `adl-to-adlj.ts`, which
passes the field through a `...rest` spread and would have carried a *wrong*
shape just as silently as a right one. Enumerate consumers by search
(`grep -rn "\.calendars"` finds the whole family), then check each.

## Verifying a parser change

`npm test` and `tests/parser.test.ts` prove a lot, but a parser defect is a
*silent wrong parse*, not a thrown error, and no hand-written test set covers
the error paths. For any change that relocates or restructures parser code
rather than adding syntax, use the differential corpus technique Phase 88
built:

1. `git worktree add` at the pre-change commit.
2. In both trees, run a throwaway vitest dump (never commit it — see
   `AGENTS.md`) that parses every `.adl` file in the repo **truncated at
   every line boundary**, plus every string in every `.adlj` file through
   `parseExpressionSource`, recording the full AST on success and
   `code`/`message`/`sourceRange` on failure.
3. Diff the two JSON dumps.

For Phase 88 that was 2,071 inputs — 821 successful parses and **1,250
distinct `ParseError` paths** — and the dumps were byte-identical. The
line-truncation generator is what makes it strong: it drives every "expected
X, got end of file" branch in the grammar for free.

## Trap: identifier scanners and template literals

If you script a change over this code (Phase 88 did, and so should any future
relocation), the scanner that finds `this.<member>` references must strip
**comments only** — not string and template contents. Five lines in the
original `parser.ts` make real calls inside template literals; a scanner that
blanks templates under-detects cross-area calls and emits files that fail to
compile. Cheap to catch (`tsc` fires immediately), expensive to debug if you
assume the scanner is right.

## Related

- [[adl-parser]] — what the parser decides, and the rules for adding syntax.
- [[compiler-model-layer-file-map]] — the same navigation aid for
  `resolved-model`/`validate-model`/`resolve-model`, split by Phase 81 using
  the same barrel strategy but a flat directory rather than a chain (those
  files were pure functions with no shared state; this one is a stateful
  class, which is why the shapes differ).
- [[expression-language]] — the semantics behind `expression.ts`.
- [[adlj-json-authoring-surface]] — `parseExpressionSource`'s other caller.
