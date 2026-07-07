# Business Contexts and Backend Boundaries

Read this before changing ADL context/scope modelling, scoped roles, relationship-aware policies, cross-context views, sync dataset design, or backend persistence assumptions.

## Key decisions

- ADL needs a first-class business context concept separate from request identity. Examples include band, project, workspace, account, tenant, or any other selected business scope.
- A context is not just a lookup field. It can affect navigation, row filters, role meaning, policy enforcement, sync datasets, offline snapshots, and dashboard/read-model behaviour.
- Context-scoped roles are distinct from global roles. A user can be Admin in one context instance and Member in another.
- ADL language constructs should declare business semantics: context object, membership relation, scoped objects, scoped roles, views that require or span contexts, and named read-model intent.
- Runtime behaviour remains separate: how the selected context is derived, persisted, validated, auto-selected, shown in UI, or supplied from routes is a runtime/UI concern.
- Calendars should not be assumed as a core ADL view primitive. A date picker is a field widget; event lists grouped by date are often more data-dense than calendar grids.
- The local database is part of the correct offline-first architecture. PostgreSQL may be a later authoritative backend, but it is not a language dependency and should not be required before the local runtime shape is stable.
- ADL should model backend-neutral constraints such as scoped uniqueness, relationships, referential behaviour, policy checks, sync windows, and read-model definitions. A PostgreSQL backend can enforce these with relational features later, but SQL DDL/query text should not become the normal authoring surface.

## Practical guidance

- Keep parser syntax, resolved model declarations, and runtime behaviour separate when adding context features.
- Prefer model-level concepts like `Context`, `ObjectScope`, `ContextMembership`, `ContextRole`, and `Query`/`ReadModel` over app-specific names like `Band`.
- For cross-context dashboards, model the query/read-model intent and policy boundary first. Let the runtime decide whether to compute it from local storage, a cached API response, a remote query, or a materialised table.
- Do not add specialised calendar UI before proving that a normal list/detail/form/dashboard composition cannot satisfy the business workflow.
