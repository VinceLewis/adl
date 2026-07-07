# Phase 12 - Business Context Model

## Objective

Add first-class business context, object scope, view context, and read-model declarations to the resolved model without implementing runtime context selection yet.

The first real ADL application is expected to be a band-management app. Its core shape requires a signed-in user context, a selected band context, band-scoped roles, and a home/dashboard view that crosses all bands available to the user. This phase prepares the model for that shape.

## Scope

Extend the resolved model, partial model, defaults, validation, and examples. Keep parser syntax small and only add textual ADL syntax if it can be done cleanly after the model shape is proven.

This phase is about declarations, not behaviour. Do not build UI context pickers, runtime context resolution, cross-context queries, server sync, PostgreSQL schema generation, or a band-app clone in this phase.

## Expected Deliverables

- Resolved model support for business contexts
- Resolved model support for context membership
- Resolved model support for object scope
- Resolved model support for view context mode
- Initial read-model/query declaration shape
- Defaults and validation for the new model concepts
- Focused tests for model resolution and diagnostics

## Acceptance Criteria

- A model can declare a context such as `Band`.
- A model can declare membership such as `BandMember(user, band, role)`.
- An object can declare that its rows are scoped by a context field.
- A view can declare whether it requires one context, optionally uses one, or spans all available contexts.
- A query/read model can declare sources and output fields without embedding SQL.
- Model validation rejects missing context objects, missing membership fields, invalid scope fields, and invalid view context references.
- Existing examples and tests remain valid without declaring contexts.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, and docs/phases/phase-12-business-context-model.md as the source of truth.

Execute Phase 12 only. Add first-class business context, object scope, view context, and read-model declarations to the resolved model. Keep parser syntax and runtime behaviour separate. Do not implement UI context selection, runtime context resolution, server sync, PostgreSQL generation, or the band app. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-13-context-runtime-and-policy.md if required.
```

## Tasks

1. Review current resolved model, partial model, resolver defaults, validator rules, parser compiler boundary, and examples.
2. Add model interfaces for:
   - business context
   - context membership
   - context selection policy as declaration only
   - object scope
   - view context
   - query/read-model declaration
3. Add partial-model support and deterministic resolution defaults.
4. Add validator rules for context object references, membership references, role fields, scope fields, view context references, and query source/output references.
5. Keep all new fields optional so existing MVP models still resolve unchanged.
6. Add focused tests for valid and invalid context declarations.
7. Add a small TypeScript or JSON fixture that models `User`, `Band`, `BandMember`, and one band-scoped object.
8. If parser syntax is added, keep it declarative and add parser/compiler tests. Otherwise record parser syntax as a follow-up in the next phase document.
9. Run typecheck, tests, and build.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-13-context-runtime-and-policy.md` if actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
