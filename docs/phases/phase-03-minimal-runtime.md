# Phase 3 - Minimal Runtime Without Parser

## Objective

Prove that the runtime can execute a resolved model before building ADL syntax.

## Scope

Build runtime services over hardcoded TypeScript or JSON model fixtures. The runtime consumes `ResolvedApplicationModel` only.

Do not implement browser UI, parser, IndexedDB, SQLite, or server sync in this phase.

## Expected Deliverables

- `src/runtime/application-runtime.ts`
- `src/runtime/object-store.ts`
- `src/runtime/policy-engine.ts`
- `src/runtime/lifecycle-engine.ts`
- `src/runtime/validation-engine.ts`
- `src/runtime/audit-service.ts`
- `src/runtime/operation-log.ts`
- `src/runtime/hook-registry.ts`
- Tests for CRUD, policy denial, lifecycle transition, audit events, and operation log entries

## Acceptance Criteria

- A `User` can be created, read, searched, updated, and deleted through the runtime.
- A policy can block an update.
- A lifecycle state can transition through an allowed action.
- Invalid lifecycle transitions are rejected.
- Runtime denies unauthorized operations even when called directly.
- Audit events are recorded.
- Operation log records local create, update, delete, and transition operations.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-03-minimal-runtime.md as the source of truth.

Execute Phase 3 only. Build minimal in-memory runtime services that consume the resolved model and prove create/read/update/delete/search/transition behavior with tests. Do not build parser, UI, browser persistence, or sync. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-04-browser-ui-runtime.md if required.
```

## Tasks

1. Review Phase 1 and Phase 2 outputs and make sure resolved model validation runs before runtime use.
2. Define runtime context types for principal, roles, online/offline state if needed, and request metadata.
3. Implement an in-memory object store with:

   ```ts
   create(objectName, values, context)
   read(objectName, id, context)
   update(objectName, id, patch, context)
   delete(objectName, id, context)
   search(objectName, query, context)
   ```

4. Implement `ValidationEngine` for required fields, type compatibility, validators, readonly fields, and lifecycle state field constraints.
5. Implement `PolicyEngine` with deny-by-default behavior and enough allow rules to support tests.
6. Implement `AuditService` to record who did what, when, against which object and record.
7. Implement `OperationLog` for local operations.
8. Implement `HookRegistry` as a no-op-capable registry for before and after hooks.
9. Implement `LifecycleEngine.transition(objectName, id, actionName, context)`.
10. Implement `ApplicationRuntime` as the coordinated facade used by tests and later UI.
11. Add tests using at least `User` and, if practical, `PurchaseOrder`.
12. Run typecheck and tests.
13. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
14. Review what happened in this phase and update `docs/phases/phase-04-browser-ui-runtime.md` if the actual results require changed scope, constraints, deliverables, or tasks.
15. Commit all repository changes for this phase and push the current branch.
