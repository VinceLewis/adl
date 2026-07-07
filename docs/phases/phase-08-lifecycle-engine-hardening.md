# Phase 8 - Lifecycle Engine Hardening

## Objective

Treat business state transitions as first-class runtime operations, not ordinary field updates.

## Scope

Harden `LifecycleEngine.transition` and runtime integration. Transitions must enforce state, policy, validation, hooks, persistence, audit, operation log, and event behavior in a single coordinated flow.

Do not build full workflow scripting or procedural language support in this phase.

## Expected Deliverables

- Hardened `src/runtime/lifecycle-engine.ts`
- Updated runtime facade if needed
- Tests for allowed transition, invalid transition, unauthorized transition, audit, operation log, and hooks

## Acceptance Criteria

- `Draft -> Active` works when allowed by lifecycle and policy.
- `Active -> Suspended` works when allowed by lifecycle and policy.
- Invalid transitions are rejected.
- Unauthorized transitions are rejected.
- Audit event records old state, new state, user, action, object, and record.
- Operation log records transition as a transition, not a simple update.
- Before and after hooks are called in the correct order where hooks are registered.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-08-lifecycle-engine-hardening.md as the source of truth.

Execute Phase 8 only. Harden lifecycle transition behavior as a first-class runtime operation. Do not add procedural workflow scripting or storage upgrades. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-09-storage-upgrade.md if required.
```

## Tasks

1. Review current lifecycle model, lifecycle engine, policy engine, validation engine, audit service, operation log, and hook registry.
2. Ensure runtime exposes:

   ```ts
   transition(objectName, recordId, actionName, context)
   ```

3. Implement transition flow:
   - load record
   - determine current state
   - find lifecycle action
   - validate `from` state
   - evaluate policy
   - run validation
   - run registered before hooks
   - apply state change
   - persist record
   - write audit event
   - write operation log entry when appropriate
   - run registered after hooks
   - emit event or return transition result
4. Prevent direct update of lifecycle state field unless explicitly allowed by model/runtime rules.
5. Add tests for allowed transitions.
6. Add tests for invalid and unauthorized transitions.
7. Add tests for audit and operation log entries.
8. Add hook-order tests.
9. Run typecheck and tests.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-09-storage-upgrade.md` if the actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
