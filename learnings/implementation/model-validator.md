# Model Validator Implementation

Read this before changing resolved model validation, compile-time validation integration, runtime startup checks, or tests that assert diagnostic codes.

## Key decisions from Phase 2

- `validateApplicationModel(model)` validates `ResolvedApplicationModel` only. It does not depend on ADL source syntax, parser AST nodes, or old MINIL structures.
- Diagnostics are structured objects with severity, stable `ADL_*` code, message, and model path. The validator returns all diagnostics it can reasonably derive instead of throwing on the first failure.
- Ordinary author-facing references, such as policy fields, view fields, lookup fields, business keys, and display fields, resolve against object business fields only.
- Lifecycle state fields may resolve against business fields or the metadata-backed `_state` field, because Phase 1 made `_state` part of the runtime model contract.
- Phase 1 default-deny policies are valid when they have `defaultEffect: "deny"` and an empty `rules` array. Do not add a deny-all rule to make them appear more explicit.
- Hook references are only syntax-checked at model validation time. Runtime hook registration and missing-hook handling belong to later runtime phases.

## Key decisions from Phase 18

- The validator checks structured policy conditions, object constraints, and command declarations as resolved-model features.
- Policy and command condition field operands resolve against business fields on the target object. Runtime-only metadata fields are still not valid author-facing field operands.
- Unique and ordered constraints validate referenced fields at startup. Ordered constraints require a numeric position field and a positive integer `minPosition`.
- Command validation checks command/input/step name uniqueness, target objects, written fields, input references, runtime expression properties, and earlier-step references. Step expressions may only reference earlier steps to keep command execution deterministic.

## `grep` lies about `validate-model.ts` (Phase 56)

`src/compiler/validate-model.ts` contains one deliberate NUL byte — a separator in
a composite map key, `` `${migration.from}\0${migration.to}` `` — which makes
`file` report the source as `data` and makes `grep`/`rg` treat it as binary.
**They then print nothing and exit as if the pattern simply did not match**, with
no error and no "binary file matches" line, because the pattern genuinely does
not match on a line-oriented read of a file the tool has decided is binary.

Two independent Phase 56 reconnaissance passes concluded from this that the file
"contains zero validation for constraints" and "zero validation for read models".
Both were wrong: both areas have comprehensive validators and a dozen diagnostic
codes each. A conclusion of the form "this 6,878-line validator validates
nothing" should have been implausible enough to re-check on its own.

Always use `grep -a` (or the Read tool) on this file. The same trap will apply to
any future source that embeds a NUL as a key separator, which is a reasonable
thing to do — an unambiguous separator is worth more than greppability — so the
fix is the habit, not the byte.

## Practical guidance

- Add new validator rules with stable diagnostic codes and focused tests. Avoid changing existing code strings unless downstream tooling has a migration path.
- Keep model validation separate from runtime enforcement. Phase 3 should call validation before runtime use, then enforce policy, lifecycle, and field constraints in runtime services.
- When adding new metadata-backed runtime fields, decide explicitly whether they are allowed in author-facing references, runtime-only references, or both.
