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

## Key decisions from Phase 68: `LOOKUP ... TARGET_FIELD` was dead code

- `TARGET_FIELD` was validated at compile time
  (`ADL_LOOKUP_TARGET_FIELD_UNKNOWN` in `validate-model.ts`) and carried all
  the way into `ResolvedLookup.targetField`, but nothing at runtime ever
  branched on it. The one place a lookup field's *value* gets resolved to a
  target *record* — as opposed to merely naming a target *object* — is
  `ReadModelService.resolveJoinedSource`, used for a read-model source that
  declares no explicit `JOIN` (the "implicit lookup join" described in the
  Phase 15 section above). It always did an identity `storage.read`,
  regardless of `targetField`. A feature can be validated end-to-end and still
  be completely inert if the one runtime consumer of the field never checks
  it — grep for every reader of a resolved-model field before trusting that a
  compile-time check implies a load-bearing runtime effect.
- The fix keeps the identity path byte-for-byte identical (`readLookupTargetById`
  is exactly the old inline `storage.read` + null/`deletedAt` check, pulled
  into its own method) and adds a second path,
  `findLookupTargetByField`, taken only when the lookup that produced the
  value declared `targetField`. That path reuses
  `searchAuthorisedSourceRecords` — the same authorised candidate set a
  declared join already loads — rather than inventing a second way to load
  and filter records.
- **Matching by field value is a search, whichever feature spells it.**
  `applyDeclaredJoinedSource`'s own comment already made this argument for a
  declared `JOIN`: loading candidates to match by field value must clear the
  `search` policy action, not just `read`, or a caller who may not enumerate
  an object could still fish records out of it one field-match at a time.
  `TARGET_FIELD` resolution is the same operation and now clears the same
  gate — proven by
  `read-model.join.target-field-lookup-requires-search-on-target-object.003`
  in `conformance/runtime/read-model-joins.json`, which mirrors cases `.008`
  and `.009` for declared joins.
- **Ambiguity gets the same answer this file already gives a declared join.**
  `TARGET_FIELD`'s value is documented as expecting the target field to be
  `UNIQUE` on the target object, but nothing enforces that at compile time —
  deliberately, because `applyDeclaredJoinedSource`'s `cardinality: "one"`
  makes the identical bet (`matches[0]`, no validation that the join key is
  actually unique) and there is no reason for the two features to disagree.
  If a future phase wants to close this gap, close it for both at once rather
  than making one of two structurally identical operations stricter than the
  other.
- **Two identity-only `LOOKUP` consumers were found and deliberately left
  alone.** `recordMatchesCurrentUser` (this file and its
  `OfflineDatasetService` equivalent) matches a lookup field's raw value
  against `context.userId` for `currentUser` scope, and the browser UI's
  lookup-label display (`adl-list-view.ts`, `adl-form-view.ts`) reads a lookup
  field's target by identity to show a label. Both predate `TARGET_FIELD` and
  neither honours it; both degrade gracefully rather than returning wrong
  data (a "current user" match silently fails; a UI label falls back to the
  raw stored value). Fixing them was out of scope for Phase 68 — see that
  phase's Non-goals — and they remain a known, undocumented-until-now gap for
  whoever declares `TARGET_FIELD` next.

## Practical guidance

- Add new read-model behavior through resolved-model declarations and `ReadModelService`; keep parser syntax and backend execution strategies separate.
- When adding source scopes or dataset selection, preserve the distinction between dataset membership and policy authorization. A record being in a local dataset must not imply the user can read it.
- If future phases need multi-object event feeds, extend the read-model declaration shape explicitly rather than overloading the current lookup-join behavior.
- Before trusting that a resolved-model field is load-bearing, grep every
  runtime reader of it, not just the validator. `TARGET_FIELD` proves a field
  can be fully compile-time-checked and still be dead at runtime.
