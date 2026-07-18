# Phase 35 - Command-Backed Multi-Table Actions

## Objective

Make multi-record and multi-table workflows explicit runtime commands instead of
UI-orchestrated sequences of independent CRUD calls.

Examples include creating an event and attaching selected set lists, creating a
song and adding streaming links, accepting an invitation by inserting membership
and updating invitation status, and applying a batch relationship picker result.

## Scope

Strengthen command-backed workflows:

- Declarative commands with multiple ordered operations.
- Transaction-like runtime execution where the storage backend can support it.
- Policy checks for the command and each affected object/relationship.
- Validation and constraint handling across all affected records.
- Audit/operation-log entries that preserve command intent.
- Browser action dispatch for commands created by earlier phases.
- Clear diagnostics for commands unsupported by a backend.

This phase should not add new UI renderer shapes except where needed to dispatch
or test command-backed actions.

## Design Constraints

- Commands are runtime semantics, not UI scripts.
- The browser must not be the only enforcement point.
- Multi-table commands must preserve object sync modes and offline write rules.
- Partial failure behavior must be explicit: atomic, compensating, staged, or
  unsupported.
- Do not introduce backend-specific SQL concepts into ADL source.

## Expected Deliverables

- Resolved command model additions or hardening for multi-operation commands.
- Runtime command execution for ordered multi-record operations.
- Policy, validation, audit, and operation-log integration.
- Tests for success, rejection, partial failure/unsupported backend behavior,
  and policy denial.
- Browser action integration for command-backed workflows from Phase 32-34.
- Documentation updates for command semantics.

## Acceptance Criteria

- A command can create a parent record and link selected existing children in
  deterministic order.
- A command can update records in two object collections as one business action
  where the backend supports atomic execution.
- Runtime policy checks are applied consistently for all affected records.
- Validation/constraint failures report actionable diagnostics and do not leave
  silent partial writes in supported atomic paths.
- Audit or operation-log output records the business command, not only low-level
  row mutations.
- Offline behavior respects existing sync policy classifications.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/runtime-semantics.md, docs/phases/phase-32-action-placement-and-command-aware-controls.md, docs/phases/phase-33-parent-child-composed-edit-surfaces.md, docs/phases/phase-34-relationship-pickers-and-multi-select-linking.md, learnings/implementation/runtime-services.md, learnings/implementation/policy-engine.md, learnings/implementation/sync-policy.md, learnings/implementation/storage-backend.md, and docs/phases/phase-35-command-backed-multi-table-actions.md as the source of truth.

Execute Phase 35 only. Add or harden command-backed multi-record/multi-table runtime execution so UI workflows can call a business command rather than orchestrating unrelated CRUD calls. Integrate policy, validation, audit/operation log, sync policy, and browser action dispatch. Do not add new renderer shapes beyond command dispatch needed for tests. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing command service, lifecycle action, storage, audit, and
   operation-log behavior.
2. Design or refine the resolved command representation for multiple operations.
3. Add validation for invalid command targets, operation ordering, and unsupported
   backend capabilities.
4. Implement runtime execution paths with explicit partial-failure behavior.
5. Integrate policy, validation, audit, operation log, and sync mode checks.
6. Wire browser action dispatch to command execution.
7. Add tests for parent-plus-links, invitation-style state changes, policy denial,
   and constraint failure.
8. Update runtime and language docs.
9. Update learnings if reusable command guidance is produced.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
