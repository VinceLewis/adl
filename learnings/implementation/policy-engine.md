# Policy Engine Hardening

Read this before changing policy evaluation, runtime record returns, UI policy presentation, lifecycle action visibility, or tests that assert policy-shaped output.

## Key decisions from Phase 7

- `PolicyEngine.evaluate(...)` is the single decision path for row, field, state, lifecycle action, and channel checks. Decisions include an `effect` and structured reasons with the matching policy/rule where one exists.
- Default deny remains a fallback from `defaultEffect: "deny"` and empty default policies. It is not modeled as an explicit deny rule.
- Explicit deny wins over allow for matching rules. Presentation restrictions are ordered as `hidden`, then `mask`, then `readonly`, before `allow`.
- Public runtime record returns are shaped through `PolicyEngine.applyReadPolicy(...)`. Field read decisions with `mask` return `MASKED_POLICY_FIELD_VALUE`; `hidden` and `deny` omit the field value.
- Field-level read policy restricts an allowed row read; it must not expand a missing row-level read grant.
- Runtime enforcement still happens before output shaping. Audit events, operation log entries, storage commits, and lifecycle hooks should continue to operate on full persisted records rather than masked public responses.
- Lifecycle transition responses are policy-shaped after after-hooks run. Tests that expect returned field values after a transition need a read policy for the target state.

## Key decisions from Phase 18

- Policy rules can carry structured runtime conditions. The initial condition model supports `equals`, `all`, `any`, and `not` over field operands, literal values, and the runtime `userId`.
- Field operands evaluate against candidate values: the existing record values overlaid with the requested patch. This lets create/update policies express invariants such as `Availability.User == runtime.userId` and prevents changing the ownership field away from the caller during an update.
- Opaque policy condition strings are not the runtime contract. Fixtures should use structured condition objects so validation and runtime evaluation stay model-first.

## Practical guidance

- Add policy enforcement tests against direct runtime calls, not only UI rendering.
- When adding new public runtime operations that return records, shape the returned record with `applyReadPolicy(...)` after internal persistence/audit work is complete.
- UI components should keep deriving visibility, masking, readonly, and action availability from the shared `PolicyEngine`; masked or readonly field renderers should not submit values back in save patches.
