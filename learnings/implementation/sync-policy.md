# Sync Policy Implementation

Read this before changing object sync modes, runtime write gating, sync queue behavior, operation-log replay, or UI sync-state presentation.

## Key decisions from Phase 10

- The resolved model stores sync modes as lower camel case TypeScript values: `localFirst`, `cacheReadonly`, `onlineRequired`, and `localPrivate`. The ADL parser can still accept author-facing forms such as `LOCAL_FIRST`.
- `SyncPolicyService` is the runtime write gate for object sync mode. It evaluates `RuntimeContext.online`, defaulting to online when the context does not say otherwise.
- Policy and field-policy checks run before sync-mode write checks on create, update, and delete. Lifecycle transition policy also runs before the sync check, and transition sync checks run before lifecycle hooks.
- `ObjectStorageBackend` remains only object-record persistence. Sync decisions and sync queue behavior stay above the backend.
- `SyncQueue` is an explicit runtime service separate from the object-record backend. It stored queue entries for `localFirst` operations only; **Phase 53 changed this** — `onlineRequired` operations queue too, because a mode that accepted a write and queued nothing had no delivery path at all. See [[sync-mode-delivery]].
- `localPrivate` operations are still local runtime operations and may appear in the operation log, but they are not added to the sync queue. Phase 53 added the symmetrical half: they are refused outright on the `sync` channel, so the authority cannot accept one either.
- `cacheReadonly` allows reads of locally cached records but blocks local create, update, delete, and transition writes.
- `onlineRequired` blocks local writes only when `RuntimeContext.online === false`. Phase 53 settled what an allowed one then does: it is queued and delivered, with the failure to deliver made visible.
- Browser UI presentation uses `runtime.syncPolicy` to mark fields readonly, hide blocked write actions, and display compact sync state labels.

## Key decisions from Phase 62

- Sync **mode** and sync **scope** answer different questions and are enforced in
  different places. Mode decides whether a write is allowed and whether it is
  delivered; `SyncPolicyService` is its gate. Scope decides only which records a
  device keeps offline; `OfflineDatasetService` is its only consumer. Nothing
  outside those two services and the compiler reads `sync.scope`, which is why
  changing the reference app's `Event` scope in Phase 62 could not affect policy,
  reads or rendering.
- Scope is now fully declarable from ADL source, including the `recent` window
  and the `custom` predicate, and no scope may be declared in a form the runtime
  ignores. See [[offline-dataset-runtime]] and [[adl-parser]].

## Key decisions from Phase 63

- A sync scope has two separable halves, and they are governed differently. The
  **context** half says which business contexts an object is held for and a
  read-model source may widen it. The **bound** half — the `recent` window, the
  `custom` predicate — says how much of the object a device keeps, and nothing
  widens it. Keep the distinction when adding any future scope: a new scope must
  state which half each of its parts belongs to. See
  [[offline-dataset-runtime]] and [[read-model-runtime]].

## Key decisions from Phase 64

- The two halves above are not just separable, they are **independently
  declarable**. A `SCOPE` selects context only; a `WINDOW` and a `WHERE` are
  bounds that may accompany any scope and each other. `recent` and `custom`
  remain as spellings that imply a bound, and are otherwise ordinary scopes.
- The runtime enforces the bound on **presence**, not on the scope value. When
  adding anything that reads `sync.window` or `sync.predicate`, do not reintroduce
  a `switch (sync.scope)`: it is what made "my records, recent" unsayable for two
  phases.
- A `LIMIT` is the one bound that ranks records against each other, so it applies
  only within the object's own declared scope. See [[offline-dataset-runtime]] for
  why that is not a hole in the Phase 63 rule.

## Practical guidance

- Keep future production sync, remote replay, and persisted sync queues as runtime services or dedicated persistence concerns. Do not add sync protocol state to `ObjectStorageBackend` unless it is pure record metadata.
- Tests for sync behavior should assert direct runtime calls, not only hidden UI controls.
- When adding new write operations, enforce policy first, then sync mode, then storage/audit/operation-log side effects.
