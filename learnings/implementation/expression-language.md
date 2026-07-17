# Expression Language Implementation

Read this before changing `ResolvedExpression`, expression evaluation, parser
expression syntax, policy conditions, predicate validators, command
preconditions, computed fields, decision tables, lifecycle guards, or read-model
expressions.

## Key decisions from Phase 20

- `ResolvedExpression` is the resolved-model contract. Runtime services consume
  expression trees, not raw ADL source strings or parser AST nodes.
- The Phase 18 `equals`/`all`/`any`/`not` condition shape remains accepted as
  partial-model compatibility input, but `resolveApplicationModel(...)`
  normalises policy conditions and command preconditions to `ResolvedExpression`.
- The evaluator is pure and total from the caller's perspective:
  `evaluateExpression(...)` and `evaluateExpressionAsBoolean(...)` return either
  a typed value or a structured `ADL_EXPRESSION_*` error. Expected failures such
  as type mismatch, divide by zero, missing `runtime.now`, invalid temporal
  values, and decimal overflow must not leak uncaught exceptions.
- Runtime references are deliberately small: `runtime.userId` resolves to text
  and `runtime.now` resolves to a datetime only when `RuntimeContext.now` is
  supplied. The evaluator does not read the wall clock.
- Decimal arithmetic uses fixed-scale integer math with scale 4, max absolute
  value `999999999999.9999`, and half-away-from-zero rounding. Runtime results
  are returned as JSON numbers only after fixed-scale calculation.
- Null handling is explicit: missing fields evaluate as `null`; `==` and `!=`
  can compare nulls; relational comparisons with null return `false`; `??`
  returns the right operand only when the left operand is null; `and` and `or`
  short-circuit and require boolean operands.
- Date/time values are serialized as strings. `runtime.now` is ISO datetime.
  Date literals use `YYYY-MM-DD`; time literals use `HH:mm`, `HH:mm:ss`, or
  `HH:mm:ss.SSS`; datetime comparisons use `Date.parse` on ISO-style strings.
  When one comparison side is explicitly temporal and the other side is text,
  the evaluator coerces the text side to the temporal kind for comparison.
- Parser expression support is intentionally limited to Phase 20 slots:
  field-level `VALIDATE`/`PREDICATE` validators and policy `WHEN` clauses.
  Cross-object references, functions, loops, local variables, SQL, host code,
  lifecycle guards, object-level validators, decision tables, and computed
  fields remain out of scope for Phase 20.
- The `in` operator is reserved in the type model but intentionally rejected by
  validation/evaluation until list expression semantics are introduced.

## Key decisions from Phase 21

- Object-level validations, lifecycle guards, decision-table predicates, and
  command-level `REQUIRE` preconditions all reuse `ResolvedExpression`; no new
  expression operators were needed.
- Object validations live on `ResolvedObject.validations` and are enforced by
  `ValidationEngine` on create, update, and lifecycle transition target values.
- Lifecycle action guards live on `ResolvedLifecycleAction.guards` and are
  enforced by `LifecycleEngine` after state/policy checks and before writes.
- Command-level preconditions live on `ResolvedCommand.preconditions` and are
  evaluated once against prepared command input before any command step reads or
  transaction planning.
- Decision tables are top-level object-scoped model data. Table inputs are
  expressions over the source object; row conditions are expressions over named
  input values; runtime evaluation supports first-match and single-match
  semantics with explicit default outputs.
- Compile-time decision-table analysis intentionally recognizes a small subset:
  literal boolean rows, `AND`, equality against literals, and numeric ranges
  over table input names. Other valid runtime predicates receive an
  `ADL_DECISION_TABLE_ROW_CONDITION_UNANALYZABLE` warning rather than fake
  exhaustiveness.

## Practical guidance

- Add expression consumers by validating expressions at model startup and then
  enforcing them in runtime services. Do not implement expression behavior only
  in UI code.
- Keep new operators justified by a concrete consumer and add evaluator,
  validator, parser, and conformance coverage together.
- If a runtime caller needs object field types during evaluation, extend the
  expression input deliberately; do not make the evaluator depend on parser AST
  nodes or global model state.
- Extend `conformance/expressions` with data-driven cases whenever expression
  semantics change. Phase 23 is expected to broaden this into the full
  cross-runtime conformance suite.
