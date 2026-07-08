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

## Practical guidance

- Add new validator rules with stable diagnostic codes and focused tests. Avoid changing existing code strings unless downstream tooling has a migration path.
- Keep model validation separate from runtime enforcement. Phase 3 should call validation before runtime use, then enforce policy, lifecycle, and field constraints in runtime services.
- When adding new metadata-backed runtime fields, decide explicitly whether they are allowed in author-facing references, runtime-only references, or both.
