# Runtime Services Implementation

Read this before changing runtime services, UI runtime integration, lifecycle execution, audit, operation log handling, or runtime tests.

## Key decisions from Phase 3

- `ApplicationRuntime` is the public facade for later UI work. It validates `ResolvedApplicationModel` with `validateApplicationModel(model)` during construction and throws `ModelValidationError` if startup diagnostics include errors.
- Public runtime operations are async: `create`, `read`, `update`, `delete`, `search`, and `transition` all return promises.
- Runtime calls use `RuntimeContext` with `userId`, `roles`, `channel`, and optional `now`, groups, online state, and request id. Tests use fixed `now` values for deterministic metadata.
- `ObjectStore` is still in-memory, but it is not a policy bypass. CRUD calls enforce runtime validation, policy, audit, and operation log recording.
- Records use the existing `StoredObjectRecord` shape: platform metadata in `meta`, business values in `values`. Delete is a tombstone and normal read/search paths exclude deleted records.
- `LifecycleEngine.transition` is a first-class operation, not a simple update. It checks current state, transition legality, transition policy, hooks, validation, audit, and operation-log recording.
- `OperationLog` records lifecycle transitions with `operation: "transition"` and includes `lifecycleAction`, `fromState`, and `toState`. Do not collapse transitions into update operations.
- `HookRegistry` is no-op-capable: missing hook registrations are skipped, while registered hook failures throw `HookError`.

## Policy and validation notes

- `PolicyEngine` is deny-by-default and explicit deny wins.
- Field-specific policy can restrict row policy. Runtime write enforcement treats only `effect: "allow"` as allowed; `readonly`, `hidden`, `mask`, and `deny` block writes.
- Search requires `search` permission and then filters candidate rows through `read` permission.
- Runtime validation rejects unknown fields, missing required fields, incompatible types, validator failures, readonly writes, direct lifecycle state updates, and invalid lifecycle states.
- Business lifecycle state fields are set to their initial state on create. Metadata-backed lifecycle state is also supported through record metadata.

## Practical guidance

- Phase 4 UI should call `ApplicationRuntime` rather than individual services for data operations, and should use the shared `policyEngine.evaluate(...)` for visibility/editability decisions.
- UI code must handle typed runtime errors: `ModelValidationError`, `RuntimeValidationError`, `PolicyDeniedError`, `LifecycleError`, `StorageError`, and `HookError`.
- Tests that need to prove enforcement should call runtime services directly, not only simulated UI behaviour.
