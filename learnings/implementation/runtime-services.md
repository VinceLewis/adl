# Runtime Services Implementation

Read this before changing runtime services, UI runtime integration, lifecycle execution, audit, operation log handling, or runtime tests.

## Key decisions from Phases 3 and 8

- `ApplicationRuntime` is the public facade for later UI work. It validates `ResolvedApplicationModel` with `validateApplicationModel(model)` during construction and throws `ModelValidationError` if startup diagnostics include errors.
- Public runtime operations are async: `create`, `read`, `update`, `delete`, `search`, and `transition` all return promises.
- Runtime calls use `RuntimeContext` with `userId`, `roles`, `channel`, and optional `now`, groups, online state, and request id. Tests use fixed `now` values for deterministic metadata.
- `ObjectStore` is still in-memory, but it is not a policy bypass. CRUD calls enforce runtime validation, policy, audit, and operation log recording.
- Records use the existing `StoredObjectRecord` shape: platform metadata in `meta`, business values in `values`. Delete is a tombstone and normal read/search paths exclude deleted records.
- `LifecycleEngine.transition` is a first-class operation, not a simple update. It checks current state, transition legality, transition policy, target validation, before hooks, persistence, audit, operation-log recording, and after hooks in that order.
- Transition validation runs before registered before hooks. If validation, hooks, persistence, audit, or operation-log work fails inside the transition flow, registered `onError` hooks run before the original error is re-thrown.
- `AuditService` records lifecycle transition audit metadata explicitly with `lifecycleAction`, `fromState`, and `toState`, in addition to before/after values, actor, object, record id, and persisted record metadata.
- `OperationLog` records lifecycle transitions with `operation: "transition"` and includes `lifecycleAction`, `fromState`, and `toState`. Do not collapse transitions into update operations.
- `HookRegistry` is no-op-capable: missing hook registrations are skipped, while registered hook failures throw `HookError`.

## Key decisions from Phase 18

- `ApplicationRuntime.executeCommand(...)` is the public entry point for model-declared commands. Commands are resolved model constructs, not app-specific handlers.
- Command steps currently support transactional `create` and `update` writes with model-declared value expressions from command input, runtime values, and earlier step records.
- Command preconditions use the same structured condition evaluator as policy conditions. Failed command preconditions throw `PolicyDeniedError` before any planned writes are committed.
- `ObjectStore` now plans create/update writes before committing them. Direct CRUD calls and command transactions share validation, context-scope checks, policy checks, sync checks, constraints, audit recording, operation-log recording, and read-policy shaping.
- Object constraints are enforced before storage writes. If a later command step would violate uniqueness or ordered-position constraints, earlier planned steps are not persisted.
- Command steps can use `authority: "command"` when the command's own preconditions are the authorization boundary for a write that should not be exposed as a direct object policy grant. Validation, sync checks, scope checks, constraints, audit, and operation logs still run.

## Key decisions from Phase 35

- Multi-record commands require an `ObjectStorageBackend` with transactional commit support. The default in-memory and IndexedDB backends advertise `supportsTransactions` and implement `commitTransaction(...)`.
- `ObjectStore.commitPlannedTransaction(...)` checks constraints before storage writes, commits all planned writes through the backend transaction when more than one write is present, and records audit/operation-log/sync side effects only after storage commit succeeds.
- A backend without transaction support may still run single-record CRUD and single-step commands, but multi-write commands fail with `ADL_STORAGE_ERROR` before any planned write is persisted.
- Command-backed row side effects keep their normal operation kind and add command metadata: `commandName`, optional `commandLabel`, `commandStep`, and shared `commandTransactionId`. This preserves business command intent without hiding affected object records from audit, operation log, or sync queue consumers.

## Key decisions from Phase 71

- `ApplicationRuntime.executeCommand` steps gained a third kind, `read`: it
  reads one existing record through the identical policy-gated path a direct
  API/UI read uses (`ObjectStore.read`, not the write path's unauthorized
  `getRecordForRuntime`), and binds it into the same `stepRecords` namespace a
  `create`/`update` step's own written record already occupies — so a later
  step reads it with the existing `stepField`/`stepMeta` expressions rather
  than a new expression kind. See [[command-read-steps]] for the full design
  record, including why no new step-ordering validation code was needed and
  why a read step never appears in a command's record-id manifest.

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
