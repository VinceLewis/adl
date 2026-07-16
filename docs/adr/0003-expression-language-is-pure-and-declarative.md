# ADR 0003 - Expression Language Is Pure and Declarative

Status: Accepted

Date: 2026-07-16

## Context

ADL needs richer business rules than the current field-equality condition model.
Upcoming work requires comparisons, boolean logic, arithmetic, decimal money,
validation predicates, decision tables, lifecycle guards, command preconditions,
and computed values.

The project must add this without turning ADL into a general-purpose scripting
language or reintroducing host-language escape hatches.

## Decision

ADL expressions are pure, total, deterministic, and represented as resolved-model
data.

Runtime services consume `ResolvedExpression` trees, not raw source strings and
not parser AST nodes. Expressions may read whitelisted current-record fields and
runtime values, but they may not mutate state, perform IO, call host-language
code, execute SQL, loop unboundedly, define functions, or access hidden clocks.

Decimal and date/time semantics must be explicit and tested.

## Consequences

- Business logic remains inspectable and portable.
- The same expression semantics can be used by client runtime, future server
  replay, validators, policies, guards, commands, and read models.
- Runtime evaluators must return structured evaluation errors instead of leaking
  uncaught exceptions for expected expression failures.
- Expression design must stay deliberately small; every new operator needs a
  consumer and tests.

## Rejected alternatives

- Add arbitrary scripting to ADL.
- Store raw expression strings and evaluate them at runtime.
- Add JavaScript, Dart, SQL, or other host-language inline code.
- Let the UI own expression or validation behaviour without runtime enforcement.
