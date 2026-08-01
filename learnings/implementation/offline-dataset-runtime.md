# Offline Dataset Runtime

Read this before changing context-aware offline dataset selection, dataset-limited local reads, or future remote sync planning.

## Key decisions from Phase 16

- Sync scopes now include context-aware values: `currentUser`, `currentContext`, and `allAvailableContexts`. Existing `assignedToUser`, `ownedByUser`, `all`, `recent`, and `custom` remain valid.
- `recent` sync scopes resolve to an inspectable default window of `_updatedAt` over 30 days when no explicit window is declared. Explicit windows can set `field`, `days`, and `limit`.
- `OfflineDatasetService` evaluates local dataset membership from active local records, object sync mode/scope, resolved context availability, and read-model source scopes. It returns record references and reasons, not raw readable records.
- Dataset membership is separate from authorization. `searchLocalDataset(...)` applies a dataset record filter through `ObjectStore.search(...)`, so search permission, row read permission, context scope checks, and field shaping still run in the normal runtime path.
- `onlineRequired` records are excluded from offline datasets, even if they exist in local storage. Normal runtime reads of such cached records may still succeed when policy allows them.
- `cacheReadonly` records may belong to the local dataset and be read locally, but local writes remain blocked by `SyncPolicyService`.
- `localPrivate` records are eligible for local datasets according to their declared sync scope, but they are still excluded from the sync queue by existing sync policy behavior.
- `allAvailableContexts` dataset evaluation resolves membership-derived context roles with the selected context removed for that business context. This lets cross-context read-model dependencies include all available context records without turning context roles into global roles.
- `currentContext` dataset evaluation uses the selected context only. If no relevant context is selected, context-scoped records do not match.
- `custom` sync scope had no runtime evaluator and contributed no records. **Phase 62 closed this** — see below.

## Key decisions from Phase 62

Phase 62's subject was not the runtime, which already worked, but the language,
which could not reach it. `ResolvedSyncWindow` had carried `field`, `days` and
`limit` since Phase 16 and `OfflineDatasetService` had honoured all three, but
`Parser.parseSync` accepted only `MODE`, `SCOPE` and `CONFLICT`. A window was
reachable from a TypeScript `PartialApplicationModel` and from a JSON conformance
model, and from no `.adl` file at all.

- `SYNC ... WINDOW [<field>] [<n> DAYS] [LIMIT <n>]` is now declarable. Each part
  is optional, the order is fixed, and a bare `WINDOW` with no parts is a parse
  error rather than a no-op. The unit word after the day count is required,
  following `OFFLINE_GRACE`.
- `SYNC ... SCOPE custom WHERE <expression>` is now declarable. The predicate is
  an ordinary `ResolvedExpression` over the object's own fields plus
  `RUNTIME.userId` / `RUNTIME.now`, evaluated by the existing
  `evaluateExpressionAsBoolean` against `record.values` and the dataset's runtime
  context. It is not a second expression dialect, and adding it needed no new
  evaluator.
- **A declared scope must be one the runtime can honour, in both directions.**
  `custom` without a predicate and a predicate on any other scope are both
  validation refusals; so is a `WINDOW` on any scope but `recent`, because only
  `recent` ever consulted one. The refusals live in `validateApplicationModel`,
  not in the parser, so a JSON partial model is refused exactly as firmly as ADL
  source. This is the Phase 60 `unlink` rule applied to sync scope.
- A record whose predicate fails to evaluate is excluded and logged, not fatal —
  the same record-level treatment an unreadable window date already got. A
  `custom` scope whose predicate is somehow absent at runtime also selects
  nothing: a dataset is what leaves the authority's reach, so over-inclusion is
  the worse failure to default to.
- The 30-day `_updatedAt` default for a bare `SCOPE recent` is unchanged, and
  every existing `.adl` file resolves to exactly the model it did before.

### `recent` replaces context scoping rather than narrowing it

Worth knowing before planning any further dataset work: `recent` evaluates as
`availableContexts && window`, and `custom` as `availableContexts && predicate`.
Neither composes with `currentUser` or `currentContext` — the scopes are a flat
enumeration, not a scope plus modifiers. So **"my records, recent" is currently
unsayable**, and that constrained this phase's reference-app change:
`Availability` is `SCOPE currentUser` and had to stay that way, because moving it
to `recent` for the sake of a window would have silently widened it from one
user's records to every available context's.

`Event` took the window instead (`SCOPE recent WINDOW Date 90 DAYS LIMIT 200`),
which does widen it from `currentContext` to all available contexts — deliberate,
because `HomeUpcomingEvents` already declares
`SOURCE event OBJECT Event SCOPE allAvailableContexts`, so the dashboard was
already asking for those records by another route. Note the consequence: that
read-model source admits an event the window excludes, so the window bounds the
object's own scope and not every route into the dataset. That is the
over-inclusion already recorded below, not a new defect.

`DevicePreference.OfflineHomeLimit` is gone. It was a field a model author
invented because a per-device offline limit could not be declared, and nothing
ever read it. The model-declared window replaces it. A genuine per-device
*override* of a model-declared window remains a separate capability that no
evidence yet asks for.

## A recorded gap that turned out not to exist

Phases 56 and 57 both listed "offline dataset selection does not know about
read-model joins" as a remaining gap. It was checked during the Phase 57 handoff
and **does not reproduce**. A scratch run over the Giggle Band model created a
bandmate's `Availability` and evaluated `evaluateOfflineDataset` as the founder:
the bandmate's record is offline-eligible, with reason
`readModelSource/BandMemberAvailability/availability/all`. The `SCOPE all` source
path in `recordMatchesReadModelSourceContext` admits it, so the joined
`BandMemberAvailabilityBoard` is not silently empty offline. The same run
executed the read model online and got two correctly paired rows.

If a gap remains in this area it is **over**-inclusion — a `SCOPE all` source
pulls records into the dataset on the strength of the source scope alone — not
the under-inclusion that would have made a shipped view wrong. Do not re-plan a
phase around the original claim without re-checking it.

The general rule this is an instance of: a gap recorded in a phase document's
non-goals is an assertion made at planning time, and
`learnings/process/phase-execution.md` requires checking it before executing on
it. Two of the four gaps Phase 57 listed were checked; one was wrong.

## Practical guidance

- Do not use dataset membership as proof that a user can read a record. Always route user-facing local reads through `ApplicationRuntime.searchLocalDataset(...)`, `ApplicationRuntime.read(...)`, `executeReadModel(...)`, or another policy-enforcing runtime service.
- When adding read-model behavior, remember that source scopes can expand the offline dataset beyond an object's own sync scope. This is deliberate when a dashboard declares cross-context inputs.
- Keep future remote authority responsibilities separate from `ObjectStorageBackend`. The local backend stores records; deciding what should be present locally belongs in runtime dataset/sync services.
