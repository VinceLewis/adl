# ADL Parser Implementation

Read this before changing the ADL lexer, parser, AST-to-partial-model compiler, parser tests, or examples.

## Key decisions from Phase 6

- The initial ADL parser is hand-written TypeScript under `src/parser/`. It is line-oriented inside explicit blocks and supports `END.APP`, `END.OBJECT`, `END.LIFECYCLE`, `END.ACTION`, `END.VIEW`, `END.POLICY`, and `END.THEME`.
- Parser AST nodes carry source ranges, but runtime and validator code still consume the resolved model only. Do not make runtime services depend on parser AST nodes.
- `compileAdl(source)` parses ADL, converts the AST to `PartialApplicationModel`, resolves it with `resolveApplicationModel`, then returns structured validation diagnostics from `validateApplicationModel`.
- Syntax errors throw `ParseError` with source location. Parsed-but-invalid models return validator diagnostics through `compileAdl`.
- Top-level `THEME Name BASE BuiltInTheme` declarations compile to `PartialThemeModel` token overrides. Existing resolver logic flattens built-in base themes.
- Inline lifecycle action declarations such as `ALLOW ROLE Admin` compile to deterministic generated policies named `<Object><Action>Policy`, and the lifecycle action receives that policy reference. This keeps action permissions in the normal policy model.
- Empty policy `channels` arrays must be omitted from the partial model unless source explicitly declares channels. An empty array means no runtime channels match after resolution.
- The root `src/index.ts` exports `parseAdl`, `lexAdl`, and `compileAdl`, but it does not re-export `src/parser/ast.ts` wholesale because the AST source range names conflict with validator source range exports.

## Practical guidance

- Keep parser syntax declarative. Unsupported procedural keywords such as `FETCH`, `STORE`, `LOOP`, `SET`, `DART.INLINE`, and `SQL.INTO` should remain rejected.
- Add syntax by extending the AST-to-partial-model conversion, not by bypassing the resolver or validator.
- Prefer examples in `examples/*.adl` for end-to-end parser fixtures. They should compile into the same resolved model shape used by runtime tests.
