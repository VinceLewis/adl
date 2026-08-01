# Read Model Runtime Implementation

Read this before changing read-model execution, read-model-backed dashboards, read-model source scopes, or offline dataset work that depends on read-model inputs.

## Key decisions from Phase 15

- Dashboard views can reference a read model through `ResolvedView.readModel`. When a view has a read model, its fields and sort keys are validated against read-model output fields rather than object fields.
- Read-model sources have backend-neutral scopes: `all`, `currentContext`, `allAvailableContexts`, and `currentUser`. Defaults are derived from the read model context: `all` context defaults sources to `allAvailableContexts`, required/optional context defaults to `currentContext`, and context-free read models default to `all`.
- `ApplicationRuntime.executeReadModel(...)` is the public runtime entry point. UI components should not query `ObjectStorageBackend` directly.
- `ReadModelService` reads raw records internally only to perform backend-neutral lookup joins and filtering. It still enforces object scope, search/read policy, and field-level read shaping before returning projected rows.
- Cross-context read models with `context.mode: "all"` deliberately remove the selected context and resolve all available context roles through `RuntimeContextService`, matching Phase 14 view navigation behavior.
- The current implementation treats the first source as the primary row source. Additional sources are resolved by lookup fields on already-loaded source records. It does not implement arbitrary joins, aggregates, SQL, or union-style reporting.
- Read models now have an explicit execution strategy. `join` is the default and
  preserves the primary-source plus lookup-source behavior above. `union`
  searches each declared source independently and projects one row per source
  record, preserving the source alias and record identity for renderer actions.
  Use union read models for mixed planning feeds such as Event plus Availability
  calendar rows; do not fake those source identities in the browser renderer.
- Read-model rows return projected `values` plus source record identities. They do not expose raw source records to the UI.
- The generic dashboard renderer presents read-model rows as a dense event list. It is not a calendar or scheduler widget.

## Key decisions from Phase 63

- A read-model source scope decides **which context** an object is held for
  offline. It does not decide **how much** of the object a device keeps: the
  sourced object's own `recent` window or `custom` predicate bounds every route,
  including this one. `ResolvedReadModelSource` carries no bound of its own, so
  there was nothing to widen a bound *deliberately* — only by accident, which is
  what Phase 63 stopped. See [[offline-dataset-runtime]].
- Read-model **execution** is unaffected. `executeReadModel` does not consult the
  offline dataset, so a bounded object still projects every row it has online.
  The bound is about what a device holds, not what a read model returns.
- If a future phase needs a dashboard to reach past its object's bound, declare
  the bound on the source and reuse the Phase 62 `WINDOW` shape. Do not reopen
  the rule that an undeclared source inherits the object's bound.

## Practical guidance

- Add new read-model behavior through resolved-model declarations and `ReadModelService`; keep parser syntax and backend execution strategies separate.
- When adding source scopes or dataset selection, preserve the distinction between dataset membership and policy authorization. A record being in a local dataset must not imply the user can read it.
- If future phases need multi-object event feeds, extend the read-model declaration shape explicitly rather than overloading the current lookup-join behavior.
