# Phase 6 - ADL Parser

## Objective

Add textual ADL syntax after the resolved model and runtime have proven useful.

## Scope

Parse a small declarative ADL subset into an AST, convert the AST into the partial application model, resolve it, and validate it.

Do not add procedural keywords, inline host language code, Dart generation, Elixir generation, or app-code generation.

Phase 5 added built-in resolved base themes and token inheritance. Parser work should compile textual theme declarations into `PartialThemeModel` and rely on the existing resolver/validator for base-theme flattening and diagnostics.

## Expected Deliverables

- `src/parser/lexer.ts`
- `src/parser/parser.ts`
- `src/parser/ast.ts`
- `src/compiler/compile-adl.ts`
- Example `.adl` files
- Parser and compiler tests

## Acceptance Criteria

- A representative ADL example parses.
- Parser errors include useful messages and locations where possible.
- Parsed ADL resolves to the same model shape consumed by runtime services.
- Invalid parsed models produce structured validation diagnostics.
- Parsed theme declarations can reference built-in base themes and token overrides without producing customer-specific components.
- No generated Dart, Flutter, Elixir, LiveView, or bespoke application code is produced.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-06-adl-parser.md as the source of truth.

Execute Phase 6 only. Implement the initial declarative ADL lexer/parser/compiler path into the existing partial/resolved model flow. Do not add procedural keywords or code generation. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-07-policy-engine-hardening.md if required.
```

## Tasks

1. Review the current resolved model, partial model, validator, and runtime fixture models.
2. Choose a parser approach consistent with the project: hand-written recursive descent or Chevrotain if already justified.
3. Create lexer support for identifiers, strings, numbers, booleans, keywords, comments if needed, and line/column tracking.
4. Create AST types for:
   - `APP`
   - `OBJECT`
   - `FIELD`
   - `LIFECYCLE`
   - `STATE`
   - `ACTION`
   - `VIEW`
   - `POLICY`
   - `THEME` with optional base theme and token overrides matching `PartialThemeModel`
   - `SYNC`
   - `END.*`
5. Implement parser support for a small initial grammar that can express the demo model.
6. Implement AST-to-partial-model conversion.
7. Implement `compileAdl(source)` to parse, convert, resolve, and validate.
8. Add examples for `User` and `PurchaseOrder`.
9. Add parser tests for valid examples, useful syntax errors, and unsupported procedural keywords.
10. Add compile tests proving parsed ADL feeds the existing runtime model shape.
11. Run typecheck and tests.
12. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
13. Review what happened in this phase and update `docs/phases/phase-07-policy-engine-hardening.md` if the actual results require changed scope, constraints, deliverables, or tasks.
14. Commit all repository changes for this phase and push the current branch.
