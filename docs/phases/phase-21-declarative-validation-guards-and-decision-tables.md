# Phase 21 - Declarative Validation, Guards, and Decision Tables

## Objective

Build the first higher-order declarative business-logic constructs on top of the
Phase 20 expression primitive: object-level cross-field validation, decision
tables, lifecycle guards, and command preconditions.

Together with Phase 20 this closes the core expression/decision-table capability
gap while keeping ADL declarative and avoiding arbitrary scripting. Computed
fields and read-model expression fields are deliberately deferred to Phase 22
because they add read-shaping, storage, and dependency-order questions that
should not be mixed into this phase.

Combined-recommendation coverage: point 3 (pure expression/decision-table
layer), first higher-order half. Executed under the standing constraints of
points 1, 2 and 6 as recorded by Phase 19 ADRs.

## Scope

Design and implement, all built only from Phase 20 expression primitives:

- **Object-level cross-field validation.** Named validation rules over the whole
  record with a message and an expression predicate (e.g. `ApprovalComment`
  required when `Value > 10000`).
- **Decision tables.** A structured, deterministic construct: named inputs
  (expressions), rows mapping input conditions to outputs, with defined
  match semantics (first-match vs single-match) and an explicit default.
- **Lifecycle guards.** Action-level `WHEN` preconditions evaluated in addition
  to state and policy, enforced by `LifecycleEngine`.
- **Command preconditions.** `REQUIRE` expressions on command/transaction
  declarations, enforced by `CommandService`.

Every construct must remain pure, total, and deterministic, and must be
representable in the resolved model as data, not code.

Out of scope: computed/derived fields, read-model computed fields,
cross-object/related-record traversal in expressions, server work, Dart runtime,
Flutter, Wasm, and procedural constructs.

## Design Constraints

- Reuse the Phase 20 `ResolvedExpression` and evaluator unchanged where possible;
  extend the expression language only if a construct genuinely requires it, and
  justify each extension.
- Decision tables should use an analyzable condition subset. Detect
  overlapping/unreachable rows and missing default where the subset permits it;
  reject unanalyzable row conditions or explicitly classify them with a
  diagnostic instead of pretending arbitrary expressions are exhaustively
  analyzable.
- Guards and preconditions are additive to policy, never a replacement for it.
  Policy still decides authorisation; guards/preconditions decide business
  validity.
- All new constructs must be enforced by the runtime on direct calls, not only
  surfaced in the UI.

## Expected Deliverables

- Resolved-model additions for object validations, decision tables, lifecycle
  guards, and command preconditions.
- Runtime evaluation in the relevant services (`ValidationEngine`,
  `LifecycleEngine`, and `CommandService`).
- Compile-time analysis for decision-table completeness/overlap where supported,
  with stable diagnostic codes.
- Parser support for the new constructs.
- Tests for each construct, including compile-time analysis and direct-call
  runtime enforcement.
- Band reference fixture updated to replace remaining documented gaps where the
  new generic constructs apply.

## Acceptance Criteria

- A cross-field validation (e.g. require `ApprovalComment` when `Value > 10000`)
  is enforced on create/update by the runtime.
- A decision table evaluates deterministically, and compile-time analysis flags
  overlapping/unreachable rows and a missing default for the supported
  analyzable subset.
- A lifecycle action `WHEN` guard blocks an otherwise-authorised transition when
  its precondition is false, enforced by `LifecycleEngine`.
- A command `REQUIRE` precondition blocks an invalid transaction, enforced by
  `CommandService`.
- Band reference fixture uses the new constructs in place of at least one
  previously documented gap; existing tests remain valid or are updated.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/reference/band-app-gap-report.md, docs/adr/0003-expression-language-is-pure-and-declarative.md, learnings/implementation/expression-language.md, and docs/phases/phase-21-declarative-validation-guards-and-decision-tables.md as the source of truth.

Execute Phase 21 only. Build object-level validation, decision tables, lifecycle guards, and command preconditions on top of the Phase 20 expression primitive. Add compile-time decision-table analysis for the supported analyzable subset. Keep everything pure, total, declarative, and enforced by the runtime on direct calls. Do not add computed fields, read-model computed fields, procedural constructs, cross-object traversal, a server, a Dart runtime, Flutter, or Wasm. Keep TypeScript as the semantic reference runtime. Before final review, update learnings/ and learnings/index.md if required, and update docs/phases/phase-22-computed-fields-and-read-model-expressions.md if actual results change its scope. Commit and push.
```

## Tasks

1. Review the Phase 20 expression model/evaluator and the remaining band-app
   gap-report items.
2. Add resolved-model shapes for object validations, decision tables, lifecycle
   guards, and command preconditions.
3. Implement object-level validation in `ValidationEngine`.
4. Implement decision-table evaluation with defined match semantics, plus
   compile-time overlap/unreachable/default analysis.
5. Implement lifecycle `WHEN` guards in `LifecycleEngine`.
6. Implement command `REQUIRE` preconditions in `CommandService`.
7. Add parser support for all new constructs and convert to resolved model in
   `compileAdl`.
8. Add tests for each construct, compile-time analysis, and direct-call runtime
    enforcement.
9. Update the band reference fixture to use the new constructs where generic;
    keep existing tests green.
10. Run typecheck, tests, format check, and build.
11. Update `learnings/` and `learnings/index.md`.
12. Review what happened and update
    `docs/phases/phase-22-computed-fields-and-read-model-expressions.md` if
    scope must change.
13. Commit all repository changes for this phase and push the current branch.
