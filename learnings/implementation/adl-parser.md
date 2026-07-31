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

## Practical guidance

- Keep parser syntax declarative. Unsupported procedural keywords such as `FETCH`, `STORE`, `LOOP`, `SET`, `DART.INLINE`, and `SQL.INTO` should remain rejected.
- Add syntax by extending the AST-to-partial-model conversion, not by bypassing the resolver or validator.
- Prefer examples in `examples/*.adl` for end-to-end parser fixtures. They should compile into the same resolved model shape used by runtime tests.
