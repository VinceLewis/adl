# Phase 13 - Context Runtime and Policy

## Objective

Implement runtime support for resolving business contexts and enforcing context-scoped roles and relationship-aware policies.

For the band-management reference app, this means the runtime can distinguish global identity from selected band context, can resolve whether a user is a band member or band admin, and can deny direct runtime calls that attempt to access data outside the allowed context.

## Scope

Add runtime context resolution and policy integration over the existing local runtime and storage abstraction. Do not build a production auth provider, server API, PostgreSQL backend, sync server, or full band app in this phase.

The browser remains untrusted. Any UI context picker added later must call the same runtime services and must not become the only enforcement point.

Phase 12 delivered business context, object scope, view context, and read-model declarations through the TypeScript/JSON partial and resolved model contracts. Phase 13 should consume those resolved declarations and the `tests/fixtures/band-context-model.ts` fixture rather than adding textual ADL parser syntax. Read-model execution and dashboard rendering remain Phase 15 work.

## Expected Deliverables

- Runtime context service or equivalent runtime helper
- Runtime context shape that can carry selected contexts and context roles
- Policy evaluation support for context-scoped roles
- Relationship-aware policy checks for scoped objects
- Runtime tests proving direct-call enforcement

## Acceptance Criteria

- Runtime calls can receive or derive a selected context instance, such as current `Band`.
- Runtime can resolve roles through a context membership object.
- A user can be Admin in one context and Member in another without gaining global Admin rights.
- Create/search/read/update/delete/transition operations enforce object scope where configured.
- Policy denial happens even when UI is bypassed.
- Existing non-context models keep working.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, docs/phases/phase-12-business-context-model.md, and docs/phases/phase-13-context-runtime-and-policy.md as the source of truth.

Execute Phase 13 only. Implement runtime support for business context resolution, context-scoped roles, and relationship-aware policy enforcement. Keep UI selection, server sync, PostgreSQL, and the band app out of scope. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-14-context-ui-and-navigation.md if required.
```

## Tasks

1. Review Phase 12 model outputs, `tests/fixtures/band-context-model.ts`, `RuntimeContext`, `PolicyEngine`, `ObjectStore`, `ApplicationRuntime`, and storage boundaries.
2. Define how selected context IDs and resolved context roles are represented in runtime calls.
3. Implement a context resolver that can:
   - list contexts available to the current user
   - validate a requested context
   - resolve context roles from membership records
4. Integrate context role checks into policy evaluation without treating them as global roles.
5. Enforce object scope on runtime operations for scoped objects.
6. Add tests for:
   - valid selected context
   - invalid selected context
   - user Admin in one context and Member in another
   - read/search filtering by scope
   - write denial outside scope
   - lifecycle transition denial outside scope
7. Preserve policy decision explanations.
8. Run typecheck, tests, and build.
9. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
10. Review what happened in this phase and update `docs/phases/phase-14-context-ui-and-navigation.md` if actual results require changed scope, constraints, deliverables, or tasks.
11. Commit all repository changes for this phase and push the current branch.
