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

## Key decisions from Phase 75: `recordMatchesCurrentUser` now honours `TARGET_FIELD`

- `ReadModelService.recordMatchesCurrentUser` (`src/runtime/read-model-service.ts`)
  compared a `currentUser`-scoped source's lookup field directly against
  `context.userId`. That is correct for an identity `LOOKUP` (the field's
  stored value *is* the target user's id) but can never hold for a
  `LOOKUP ... TARGET_FIELD` field, whose stored value is a natural key on the
  target object instead — the exact gap Phase 68 found and Phase 72 could
  only warn about (`ADL_LOOKUP_TARGET_FIELD_CURRENT_USER_SOURCE_UNHONOURED`).
- The fix: when the matching field declares `targetField`, read the
  **current user's own record** by identity (`readLookupTargetById`, the same
  helper every other identity lookup in this file already uses) and compare
  the candidate record's stored value against *that record's* `targetField`
  value, not against `context.userId`. The current user's record must itself
  pass read policy (`canReadSourceRecord`) before its field value is trusted
  for the comparison; if the record cannot be found, or the caller may not
  read it, the match fails closed (`false`) rather than throwing or granting
  an unproven match.
- This made `sourceAllowsRecord`, `recordMatchesCurrentUser`, and the
  `records.filter(...)` call in `searchAuthorisedSourceRecords` async (the
  filter became a `Promise.all` map-then-filter, since a plain array
  `.filter()` cannot await per-record). Every caller of `sourceAllowsRecord`
  already awaited an ancestor call, so no other signature needed to change.
- With the runtime path genuinely fixed, the Phase 72 warning
  (`ADL_LOOKUP_TARGET_FIELD_CURRENT_USER_SOURCE_UNHONOURED`) was removed from
  `validate-model.ts` along with its `MODEL_VALIDATION_CODES` entry: it warned
  about a defect that no longer exists, and a diagnostic that outlives the
  behaviour it names is worse than no diagnostic.
- **Out of scope, left as a known gap:** `OfflineDatasetService`'s own
  `recordMatchesCurrentUser` (`src/runtime/offline-dataset-service.ts`,
  covering `SYNC ... SCOPE currentUser` on an object's own sync declaration,
  not a read-model source) has the identical identity-only defect and was
  deliberately not touched — it was outside this phase's assigned scope.
  Whoever picks it up next should mirror this fix's shape exactly, including
  the fail-closed behaviour when the current user's own record cannot be read.
- **Also out of scope:** `adl-field-renderer.ts`'s `<select>`-based lookup
  editor (`loadLookupOptions`/`renderInput`) renders `<option value="{record
  id}">` and matches the currently selected option by `option.meta.guid ===
  storedValue`, which is the same identity assumption `adl-list-view.ts`/
  `adl-form-view.ts` had for *display* — except this one is a *write* path:
  choosing an option would still save the record's id into a `TARGET_FIELD`
  field, not the target field's natural-key value. This is a materially
  different (and more invasive) fix than the display-only one Phase 75 made
  and was not attempted here.

## Key decisions from the Giggle Band cross-band availability overlay

- **A source's `SCOPE allAvailableContexts` only reaches past the selected
  context if the read model itself is `CONTEXT ALL`.** Found building
  `MyAvailabilityWithGigs` (a `HomeUpcomingEvents`-shaped union: `SOURCE event
  OBJECT Event SCOPE allAvailableContexts` plus `SOURCE availability OBJECT
  Availability SCOPE currentUser`) for a view declared `CONTEXT REQUIRED
  Band`. Copying the read model's own context declaration from its
  consuming view (`CONTEXT REQUIRED Band`, matching the view) instead of from
  `HomeUpcomingEvents` (`CONTEXT ALL Band`) silently dropped every event from
  a band other than the one selected — the exact cross-band records the
  source scope exists to admit.
- The mechanism is `getAllowedContextIds` (`src/runtime/context-scope.ts`):
  when a context is **selected**, it returns only that one id and never
  consults `contextRoles`/`contextGrants`, regardless of what any source
  scope asks for. `resolveExecutionContext` (this file) only clears the
  selection — falling back to every context the caller has a role or grant
  in — when `readModel.context?.mode === "all"`. A `REQUIRED`/`OPTIONAL`
  read model keeps the original context untouched, so `recordMatchesContextScope`
  intersects `allAvailableContexts` against a set of exactly one id.
- **A read model's own context requirement is independent of its consuming
  view's.** `BandMemberAvailabilityBoard` stayed `CONTEXT REQUIRED Band` (a
  band must still be selected to open the page) while the read model it
  calls for the overlay section is `CONTEXT ALL Band` (so that section's
  query itself reaches every band). Nothing enforces these two match, and
  Phase 15/63's existing `join`-strategy read models never needed them to
  differ; a `union` read model that intentionally wants a caller's *entire*
  cross-context footprint, attached to a view that still requires one
  selected context to render at all, is the case where they legitimately
  should not.
- Consequence for testing: a read model exercising this needs a fixture user
  who is a member of at least two contexts, with a record in the *second*
  one, and an assertion against the read model's raw output (not just the
  consuming view) — the wrong `CONTEXT` mode compiles and validates cleanly
  and only shows up as a silently short row set.

## Key decisions from Phase 91: a projected `LOOKUP` field keeps its display

- **A projected field inherits its source field's `lookup`, exactly as it
  already inherited that field's `type`.** `resolveReadModelField`
  (`src/compiler/resolve-model/read-model.ts`) already copied
  `sourceField.type` onto the output field; Phase 91 copies
  `sourceField.lookup` alongside it into
  `ResolvedReadModelField.lookup`. There is no authoring syntax for it and
  there must not be — it is derived, and a resolved model whose projected
  `lookup` disagrees with the field it projects is now a validation error
  (`ADL_READ_MODEL_FIELD_LOOKUP_MISMATCH`). That code is unreachable from
  `.adl`/`.adlj`; it exists because `ApplicationRuntime` validates whatever
  *resolved* model it is handed, including one deserialised from JSON.
- **Resolution happens in `ReadModelService`, after limiting, into a separate
  `display` channel.** `RuntimeReadModelRow.display?: Record<string, string>`
  carries the label; `values` still carries the stored id. Substituting into
  `values` instead would silently change what `WHERE` filters, `ORDER BY`,
  expression fields and row actions see. `attachLookupDisplayLabels` runs on the
  already-limited row set and caches per `(targetObject, targetField,
  displayField, value)`, because a roster projects the same handful of ids
  across many rows.
- **Projection is policy-checked per *source* record; a lookup target is not a
  source.** `projectRow` applies `canReadSourceRecord` and `applyReadPolicy` to
  each source record — but the lookup target is a record on *another* object
  with its own policy, and nothing in the projection path covered it. So
  denormalising a display value during projection would genuinely have leaked.
  `resolveLookupDisplayLabel` therefore reads the target itself, checks
  `recordMatchesObjectScope`, and takes the display field from
  `applyReadPolicy`'s output so a field-level `HIDE`/`MASK` is honoured rather
  than read around. A `targetField` lookup is a match by field value, so it
  additionally clears `search` + `requireObjectScopeForSearch` — the Phase 68
  rule, applied to a third feature.
- **Every refusal degrades to no label, never to an error.** Denied, deleted,
  out-of-scope, absent, or a non-primitive display value all return `undefined`,
  and the renderer falls back to the stored value the caller already holds.
  `evaluateFieldText` prefers the label over a declared `FORMAT`: a format
  pattern describes the stored id, not the name, so applying one could only
  produce an invalid-value diagnostic for a value nobody sees.
- **The consumers are the presentation runtime and the generic dashboard
  renderer**, both of which now read `display` first: `BoundPresentationRow`
  carries it through `readModelRowToPresentationRow` into row fragments and into
  a calendar item's title/summary; `adl-dashboard-view.ts`'s `readValue` prefers
  it. `authoritative-reporting.ts`'s `shapeReportRow` and
  `edit-surface-runtime.ts`'s picker filter deliberately still use `values` — a
  report is data and a filter matches what is stored.
- **`adl-list-view.ts`'s resolver was deliberately not converged.** It resolves
  labels for *object* records fetched by `search`, not for read-model rows, and
  it already goes through the shared `lookup-resolution.ts` helper over
  policy-checked `runtime.read`/`runtime.search`. `ReadModelService` cannot use
  that helper: it takes an `ApplicationRuntime`, and `ReadModelService` is one of
  that runtime's own collaborators, so the import would be a cycle. The two
  paths converge on the *rule* (policy-checked read, degrade to the stored
  value), not on one function.

## Phase 101: a projected lookup label is a *field* read, and a `User` source is a liability

- **`resolveLookupDisplayLabel` now goes through
  `PolicyEngine.applyDisplayFieldReadPolicy`, not `applyReadPolicy`.** A policy
  may legitimately grant a lookup target's display field and nothing else (both
  reference apps' `UserPolicy` now does), and `applyReadPolicy` refuses at the
  **row** gate before any field is considered — returning `values: {}`, which
  this resolver correctly reads as "no label" and degrades to the raw id. The
  degradation is silent by design, so the whole application renders
  `user-c52bac75-…` where names belong with nothing failing. Explicit row-level
  `DENY`/`HIDDEN`/`MASK` rules still suppress the label (they carry no `fields`,
  so they match a field request too); only the object's default deny is escaped.
- **Preferring a projected lookup over a second source is the safer modelling
  choice, and sometimes the only working one.** A secondary source resolved by
  `resolveJoinedSource` still has to clear `canReadSourceRecord` — a *row* read
  on the joined object — so a read model that sources `User` breaks the moment
  `User`'s policy stops granting rows. Projecting the upstream row's own
  `LOOKUP` field instead (`FIELD Member FROM member.User`) needs only the
  display field's own read decision. Jointly Care's `CircleMemberRoster` and
  Giggle Band's `CurrentUserAvailability` were both converted this way in Phase
  101; the roster additionally stopped projecting `user.Email` onto a
  screenshotted screen.
- **A read model can be the leak.** `CircleMemberRoster` projected a required
  `Email` field from a `SCOPE all` `User` source, which no amount of policy
  narrowing on `User`'s *own* screens would have caught. When auditing what an
  object exposes, enumerate every read model that sources or projects it, not
  just its own views.

## Practical guidance

- Add new read-model behavior through resolved-model declarations and `ReadModelService`; keep parser syntax and backend execution strategies separate.
- When adding source scopes or dataset selection, preserve the distinction between dataset membership and policy authorization. A record being in a local dataset must not imply the user can read it.
- If future phases need multi-object event feeds, extend the read-model declaration shape explicitly rather than overloading the current lookup-join behavior.
- Before trusting that a resolved-model field is load-bearing, grep every
  runtime reader of it, not just the validator. `TARGET_FIELD` proves a field
  can be fully compile-time-checked and still be dead at runtime.
- Adding a derived field to a resolved-model shape changes `modelFingerprint`
  for **every** app whose model reaches it. Phase 91 added
  `ResolvedReadModelField.lookup` and had to bump *two* reference apps
  (Giggle Band 1.7.0 -> 1.8.0, Jointly Care 1.3.0 -> 1.4.0), each with its own
  empty-object migration hop and golden-fingerprint update, even though only
  Giggle Band's rendering visibly changed. Enumerate the affected apps by
  grepping every `readModels` declaration before assuming one app is the only
  one.
