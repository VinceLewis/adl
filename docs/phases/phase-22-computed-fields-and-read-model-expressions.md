# Phase 22 - Computed Fields and Read-Model Expressions

## Objective

Add computed/derived fields and expression-defined read-model fields on top of
the Phase 20 expression primitive and Phase 21 declarative validation/guard
work.

These features are split out from Phase 21 because they affect read shaping,
storage/write semantics, dependency ordering, and read-model projection behavior.
They should be designed carefully after the expression evaluator and the first
higher-order declarative constructs are stable.

## Scope

Design and implement, all built only from Phase 20 expression primitives:

- **Computed/derived fields.** Read-only fields whose value is an expression over
  the same record, such as `LineTotal = Price * Quantity`. Define whether they
  are evaluated on read, materialised on write, or supported through explicitly
  named strategies. The choice must be deterministic and inspectable in the
  resolved model.
- **Computed-field write protection.** Computed fields cannot be directly
  written through create/update/import/sync replay unless a future migration or
  materialisation mechanism explicitly owns that write.
- **Computed-field dependency analysis.** Detect and reject cycles at compile
  time. Establish a deterministic evaluation order for acyclic dependencies.
- **Read-model computed fields.** Expression-defined fields in read-model
  projections, evaluated by `ReadModelService` against the projected row/source
  values.

Every construct must remain pure, total, deterministic, and representable in
the resolved model as data, not code.

Out of scope: arbitrary cross-object traversal, procedural constructs, server
work, Dart runtime, Flutter, Wasm, and storage-engine-specific materialised
views. If materialisation is introduced, it must stay backend-neutral and
inspectable.

## Design Constraints

- Reuse the Phase 20 `ResolvedExpression` and evaluator unchanged where
  possible. Extend the expression language only if this phase genuinely requires
  it, and justify each extension.
- Computed fields must be clearly separated from normal author-written fields in
  the resolved model and UI/runtime write paths.
- Computed fields must not create evaluation cycles. Cycle diagnostics should
  include the path of dependent fields where practical.
- Read-model expression fields must not expose raw source records to the UI.
  They should evaluate over the same shaped/projected data model that
  `ReadModelService` already returns, unless the phase explicitly documents a
  safer internal evaluation context.
- Runtime enforcement must apply to direct calls, not only UI behavior.

## Expected Deliverables

- Resolved-model additions for computed fields and read-model expression fields.
- Runtime evaluation and read shaping for computed fields.
- Write protection for computed fields in `ValidationEngine` / `ObjectStore`
  paths.
- Compile-time dependency analysis and cycle diagnostics for computed fields.
- Read-model expression evaluation in `ReadModelService`.
- Parser support for computed fields and read-model expression fields.
- Tests for computed-field evaluation, write denial, cycle detection,
  dependency ordering, read-model expression fields, and direct-call runtime
  enforcement.
- Band reference fixture updated where computed/read-model expressions remove a
  generic gap without app-specific hooks.

## Acceptance Criteria

- A computed field such as `LineTotal = Price * Quantity` returns the correct
  value through runtime reads/searches.
- Computed fields cannot be written directly through create/update.
- Acyclic computed-field dependencies evaluate in deterministic order.
- Computed-field cycles are rejected at compile time with a stable diagnostic.
- Read models can expose expression-defined fields evaluated by
  `ReadModelService`.
- Read-model expression fields respect existing read-model policy and field
  shaping boundaries.
- Existing Phase 21 validation, guard, decision-table, and command-precondition
  behavior remains green.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/implementation/expression-language.md, docs/phases/phase-21-declarative-validation-guards-and-decision-tables.md, and docs/phases/phase-22-computed-fields-and-read-model-expressions.md as the source of truth.

Execute Phase 22 only. Add computed/derived fields and read-model expression fields on top of the Phase 20 expression primitive. Define deterministic read/materialisation semantics, protect computed fields from direct writes, detect computed-field dependency cycles, and enforce all behavior through runtime services on direct calls. Do not add procedural constructs, arbitrary cross-object traversal, storage-specific materialised views, a server, a Dart runtime, Flutter, or Wasm. Keep TypeScript as the semantic reference runtime. Before final review, update learnings/ and learnings/index.md if required, and update docs/phases/phase-23-conformance-suite-and-spec.md if actual results change its scope. Commit and push.
```

## Tasks

1. Review the Phase 20 expression model/evaluator and Phase 21 declarative
   construct implementation.
2. Define computed-field model shape, dependency rules, and read vs
   materialisation semantics.
3. Add resolved-model and partial-model support for computed fields and
   read-model expression fields.
4. Add validator rules for computed-field references, type compatibility,
   write protection, and dependency cycles.
5. Implement computed-field evaluation in runtime read/search paths.
6. Ensure create/update/import-style writes reject direct computed-field writes.
7. Implement read-model expression fields in `ReadModelService`.
8. Add parser support for computed-field and read-model expression syntax.
9. Add tests for evaluation, write denial, cycle diagnostics, dependency order,
   read-model expression fields, and direct-call runtime enforcement.
10. Update the band reference fixture where the new constructs replace a
    generic gap.
11. Run typecheck, tests, format check, and build.
12. Update `learnings/` and `learnings/index.md`.
13. Review what happened and update
    `docs/phases/phase-23-conformance-suite-and-spec.md` if scope must change.
14. Commit all repository changes for this phase and push the current branch.
