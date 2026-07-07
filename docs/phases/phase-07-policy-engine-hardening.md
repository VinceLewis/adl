# Phase 7 - Policy Engine Hardening

## Objective

Make row, field, state, and action control first-class and enforceable everywhere.

## Scope

Harden the existing `PolicyEngine` and its integration with runtime and UI. Policy must be the single source of truth for runtime operations and UI presentation decisions.

Do not add server authorization or a full identity provider in this phase.

## Expected Deliverables

- Hardened `src/runtime/policy-engine.ts`
- Runtime integration updates where policy decisions are applied
- UI integration updates where policy decisions affect visibility and editability
- Tests for row, field, state, action, masking, deny precedence, and decision explanations

## Acceptance Criteria

- Deny by default.
- Explicit deny wins over allow.
- Field policy can restrict row policy.
- Lifecycle action policy controls both action visibility and runtime transition permission.
- Runtime update blocks unauthorized field changes even if UI tries.
- Search and list output masks fields according to policy.
- Policy decisions include testable reasons.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-07-policy-engine-hardening.md as the source of truth.

Execute Phase 7 only. Harden policy decisions and enforcement across runtime and UI using the existing model shape. Do not add server auth or unrelated parser work. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-08-lifecycle-engine-hardening.md if required.
```

## Tasks

1. Review current policy model, policy engine tests, runtime enforcement points, and UI usage.
2. Define a policy decision result that can represent:
   - allow
   - deny
   - readonly
   - mask
   - hidden
   - reasons
3. Implement deny-by-default behavior for missing policy.
4. Implement explicit deny precedence.
5. Implement field-level policy that can further restrict row-level permission.
6. Implement state-specific and lifecycle-action-specific checks.
7. Ensure create, read, update, delete, search, and transition paths call `PolicyEngine`.
8. Ensure UI calls the same `PolicyEngine` for visible, hidden, readonly, masked, and action-enabled behavior.
9. Add tests proving direct runtime calls cannot bypass policy.
10. Add tests for masking in list/search output.
11. Add tests for policy decision reasons.
12. Run typecheck, tests, and browser verification if UI behavior changed.
13. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
14. Review what happened in this phase and update `docs/phases/phase-08-lifecycle-engine-hardening.md` if the actual results require changed scope, constraints, deliverables, or tasks.
15. Commit all repository changes for this phase and push the current branch.
