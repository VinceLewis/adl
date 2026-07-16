# Phase 20 - Expression Language Foundation

## Objective

Add a small, pure, deterministic expression sublanguage to the resolved model
and runtime, and wire it into the two consumers that already need it most:
field validators and policy conditions.

This is the biggest current capability gap. Today the runtime can only express
one condition form (field equality such as `Availability.User == runtime.userId`).
Real business rules need comparisons, boolean logic, arithmetic, decimal money,
and references to fields and runtime context. This phase builds the primitive
that every later declarative construct (computed fields, decision tables,
lifecycle guards, command preconditions, read-model fields) is built on.

Combined-recommendation coverage: point 3 (design the pure expression/
decision-table layer next), foundation half. This phase follows the architecture
reconciliation ADRs from Phase 19 and keeps TypeScript as the semantic reference;
no Dart rewrite, Flutter, Wasm, or appliance work is in scope.

## Scope

Design and implement:

- A JSON-serialisable expression representation in the resolved model
  (`ResolvedExpression`), parsed at compile time, never a source string
  evaluated at runtime.
- A pure, total evaluator in the runtime.
- Compile-time type checking of expressions against object fields and runtime
  references, with structured diagnostics.
- Parser support for expressions in validator and policy-condition slots only.
- Integration into `ValidationEngine` (predicate validators) and `PolicyEngine`
  (generalised `condition`).

The expression language is deliberately **not** a general programming language.

Out of scope for this phase, deferred to Phases 21 and 22: computed/derived
fields, object-level cross-field validation, decision tables, lifecycle guards,
command preconditions, read-model computed fields.

Do not add: loops, local variable assignment, mutation, function definitions,
host-language inline code, SQL, network/filesystem/clock side effects beyond the
whitelisted `runtime.now` reference, or any non-deterministic operation. Do not
add a server, Dart runtime, Flutter renderer, or Wasm backend.

## Design Constraints

- **Pure and total.** Evaluation has no side effects. Every evaluation returns
  either a typed value or a structured evaluation error; it must never throw an
  uncaught exception, loop unboundedly, or depend on wall-clock time except via
  the explicit `runtime.now` reference passed in `RuntimeContext`.
- **Deterministic decimal money.** Numbers used for money must be fixed-precision
  decimals with defined rounding, not IEEE floats. Define and document the
  decimal semantics (precision, rounding mode) once, here.
- **Value types.** `text`, `number` (decimal), `boolean`, `date`, `datetime`,
  `time`, and `null`. Define null-handling rules explicitly (e.g. comparisons
  with null, `and`/`or` short-circuit, `??`-style coalescing if included).
- **References.** Support current-record field references and only the runtime
  references justified by the first two consumers. `runtime.userId` and
  `runtime.now` are expected. Additional references such as `runtime.roles`,
  `runtime.contexts`, or `runtime.contextRoles` require an explicit consumer and
  must not turn expressions into a second policy engine. Related-record /
  cross-object references are out of scope for Phase 20; note them as a later
  candidate.
- **Operators (minimal).** Arithmetic (`+ - * /` with decimal rules and defined
  divide-by-zero behaviour), comparison (`== != < <= > >=`), boolean
  (`and or not`), membership (`in`), and a small string helper set only if a
  consumer needs it. Justify every operator added.
- **Date/time semantics.** Define serialisation, comparison, timezone treatment
  for `runtime.now`, and date/datetime/time coercion rules before implementing
  the evaluator.
- **Resolved model is the contract.** The expression AST lives in
  `ResolvedApplicationModel`. Runtime services consume the resolved expression
  tree, not parser AST nodes and not raw source.
- **Initial conformance seeds.** Add data-driven expression conformance cases in
  this phase. Phase 23 expands them into the full cross-runtime conformance
  suite.

## Expected Deliverables

- `ResolvedExpression` types added to `src/model/resolved-model.ts` (JSON-safe).
- A pure evaluator, e.g. `src/runtime/expression-evaluator.ts`, returning a typed
  value or a structured evaluation error.
- Decimal money value handling with documented precision/rounding.
- Compile-time expression type checking in `src/compiler/validate-model.ts` with
  stable diagnostic codes.
- Parser support for expressions inside validator and policy-condition slots in
  `src/parser/` and `compileAdl`.
- `ValidationEngine` predicate-validator support using expressions.
- `PolicyEngine` generalised `condition` using expressions, replacing the
  special-cased field-equality path while keeping existing behaviour green.
- Tests for evaluation, purity/totality, decimal math, type checking, parser
  round-trip, and direct-runtime enforcement of policy conditions.
- A small initial `conformance/expressions` corpus covering expression semantics
  introduced in this phase.

## Acceptance Criteria

- An expression such as `Value > 10000 and Status == 'Submitted'` resolves,
  type-checks, and evaluates deterministically.
- Decimal arithmetic (e.g. `Price * Quantity`) is money-safe and rounding is
  documented and tested.
- Division by zero and type mismatches produce structured evaluation errors, not
  thrown exceptions.
- Evaluation never depends on wall-clock time except through `runtime.now`.
- A policy `condition` expressed as a general expression is enforced by the
  runtime on direct calls, not only in the UI.
- The existing `Availability.User == runtime.userId` behaviour continues to pass
  through the generalised expression path.
- Compile-time type errors (unknown field, wrong operand type, unknown runtime
  reference) are reported as diagnostics with stable codes, not runtime failures.
- Parsed expressions resolve to the same `ResolvedExpression` shape used by the
  runtime.
- Initial expression conformance cases run against the TypeScript reference
  evaluator and pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/adr/0003-expression-language-is-pure-and-declarative.md, docs/adr/0005-typescript-runtime-is-the-semantic-reference.md, learnings/implementation/model-validator.md, learnings/implementation/policy-engine.md, learnings/implementation/runtime-services.md, and docs/phases/phase-20-expression-language-foundation.md as the source of truth. Treat docs/claude-review.md and docs/gpt-review.md as background review inputs, not source-of-truth documents.

Execute Phase 20 only. Add a pure, total, deterministic expression sublanguage to the resolved model and runtime, with money-safe decimals, exact date/time semantics, compile-time type checking, initial expression conformance cases, and wiring into ValidationEngine predicate validators and PolicyEngine conditions. Do not add loops, variables, inline host code, SQL, side effects, computed fields, decision tables, lifecycle guards, command preconditions, a server, a Dart runtime, Flutter, or Wasm. Keep TypeScript as the semantic reference runtime. Before final review, update learnings/ and learnings/index.md if required, and update docs/phases/phase-21-declarative-validation-guards-and-decision-tables.md if actual results change its scope. Commit and push.
```

## Tasks

1. Review the current condition handling in `policy-engine.ts`, the named
   validators in `validation-engine.ts`, and the band-app gap report entries
   that require expressions.
2. Specify the value type system, null-handling rules, decimal money semantics
   (precision, scale, rounding), and date/time semantics (serialisation,
   comparison, timezone handling for `runtime.now`). Write this into the phase
   learnings.
3. Add JSON-serialisable `ResolvedExpression` node types to
   `src/model/resolved-model.ts`.
4. Implement the pure evaluator with structured evaluation errors and totality
   guarantees (no throw, no unbounded work, no hidden clock).
5. Implement compile-time expression type checking in `validate-model.ts` with
   stable diagnostic codes for unknown references and type mismatches.
6. Add parser support for expressions in validator and policy-condition slots
   only; convert AST to `ResolvedExpression` in `compileAdl`.
7. Integrate predicate validators into `ValidationEngine`.
8. Generalise `PolicyEngine` conditions to expressions; keep the existing
   field-equality behaviour green through the new path.
9. Add tests: evaluation, purity/totality, decimal math and rounding, date/time
   comparison, type checking diagnostics, parser round-trip, and direct-call
   policy enforcement.
10. Add initial data-driven expression conformance cases and a minimal harness
    path that can later be expanded by Phase 23.
11. Run typecheck, tests, format check, and build.
12. Update `learnings/` (add an `implementation/expression-language.md`) and
    `learnings/index.md` with when to read it.
13. Review what happened and update
    `docs/phases/phase-21-declarative-validation-guards-and-decision-tables.md`
    if scope must change.
14. Commit all repository changes for this phase and push the current branch.
