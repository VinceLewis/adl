# Sync Policy Implementation

Read this before changing object sync modes, runtime write gating, sync queue behavior, operation-log replay, or UI sync-state presentation.

## Key decisions from Phase 10

- The resolved model stores sync modes as lower camel case TypeScript values: `localFirst`, `cacheReadonly`, `onlineRequired`, and `localPrivate`. The ADL parser can still accept author-facing forms such as `LOCAL_FIRST`.
- `SyncPolicyService` is the runtime write gate for object sync mode. It evaluates `RuntimeContext.online`, defaulting to online when the context does not say otherwise.
- Policy and field-policy checks run before sync-mode write checks on create, update, and delete. Lifecycle transition policy also runs before the sync check, and transition sync checks run before lifecycle hooks.
- `ObjectStorageBackend` remains only object-record persistence. Sync decisions and sync queue behavior stay above the backend.
- `SyncQueue` is an explicit runtime service separate from the object-record backend. It currently stores in-memory queue entries for `localFirst` operations only.
- `localPrivate` operations are still local runtime operations and may appear in the operation log, but they are not added to the sync queue.
- `cacheReadonly` allows reads of locally cached records but blocks local create, update, delete, and transition writes.
- `onlineRequired` blocks local writes only when `RuntimeContext.online === false`. Full online server write behavior remains deferred.
- Browser UI presentation uses `runtime.syncPolicy` to mark fields readonly, hide blocked write actions, and display compact sync state labels.

## Practical guidance

- Keep future production sync, remote replay, and persisted sync queues as runtime services or dedicated persistence concerns. Do not add sync protocol state to `ObjectStorageBackend` unless it is pure record metadata.
- Tests for sync behavior should assert direct runtime calls, not only hidden UI controls.
- When adding new write operations, enforce policy first, then sync mode, then storage/audit/operation-log side effects.
