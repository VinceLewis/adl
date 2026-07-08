# Phase 18 - Band Reference Platform Gaps

## Objective

Turn the concrete platform gaps found while building the Phase 17 band reference app into model-first ADL capabilities.

The goal is not to copy Giggle behavior or add app-specific handlers. The goal is to add generic runtime/model features that make the band reference app express more of its workflows without bespoke hooks.

## Scope

Design and implement a small set of generic capabilities needed by the band reference app. Keep the runtime model first. Do not introduce PostgreSQL, a production auth provider, an email sender, a remote sync server, or generated application code.

Prioritize behavior that improves runtime enforcement over UI-only affordances.

## Expected Deliverables

- Model/runtime support for policy conditions or equivalent field equality checks.
- A generic command/action shape for transactional multi-record workflows.
- A generic ordered-child relation helper or constraint model for ordered rows.
- Validation/runtime support for scoped uniqueness where practical.
- Tests proving direct runtime enforcement.
- Updates to the band reference app fixture to use new generic capabilities where they replace Phase 17 documented gaps.

## Acceptance Criteria

- Availability self-service writes can require `Availability.User` to equal the runtime user.
- Invitation acceptance can be represented as a transaction that updates an invitation and creates membership.
- Band creation can be represented with a follow-up membership creation command or documented atomic workflow.
- Set-list item order can enforce positive positions and prevent duplicate positions within the same set list.
- Song titles and set-list names can declare uniqueness within a band without backend-specific SQL.
- Runtime tests prove the new capabilities are enforced outside the UI.
- Existing Phase 17 reference app tests remain valid or are updated to use the new model features.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/reference/band-app-gap-report.md, learnings/implementation/reference-app-models.md, and docs/phases/phase-18-band-reference-platform-gaps.md as the source of truth.

Execute Phase 18 only. Add generic model/runtime capabilities for the concrete gaps discovered by the band reference app. Keep changes backend-neutral and model-driven. Do not build a production email sender, auth provider, PostgreSQL backend, sync server, or app-specific command handlers. Before final review, update learnings/ if required and update the next phase document only if new concrete platform work is discovered.
```

## Tasks

1. Review the Phase 17 band reference model, tests, and gap report.
2. Choose the smallest generic model shape for field equality conditions or command preconditions.
3. Add runtime enforcement tests for direct-call bypass cases.
4. Design a transaction/command declaration shape for multi-record workflows.
5. Implement only the command behavior needed to prove invitation acceptance or band creation safely, if the model shape is settled.
6. Add scoped uniqueness declarations and validation/runtime checks where feasible.
7. Add ordered-child relation support or a generic position constraint helper.
8. Update the band reference fixture to use new capabilities only where they are generic.
9. Run typecheck, tests, format check, and build.
10. Update `learnings/` and this phase plan if actual results change future scope.
11. Commit and push the phase changes.
