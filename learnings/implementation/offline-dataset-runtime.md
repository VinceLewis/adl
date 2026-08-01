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

> **Superseded by Phase 64.** A bound now composes with any scope, so "my
> records, recent" is sayable and `Availability` declares it. The finding below
> is kept because it is what made Phase 64 necessary and it still describes what
> `recent` and `custom` mean.

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

## Key decisions from Phase 63

The over-inclusion recorded below as "the gap that remains, if any" was confirmed
as a defect and closed. Phase 62 is what made it matter: once an author could
declare a window, a read-model source silently defeating it stopped being
harmless. Reproduced in the reference app Phase 62 shipped — an `Event` dated
2019, seven years outside the declared `WINDOW Date 90 DAYS`, stayed on the
device admitted by `CalendarPlanningItems` alone, with the `objectSync` reason
correctly absent. The window worked and the source put the record back.

**The rule: a read-model source may widen an object's context, never its declared
bound.**

- The *context* half of a sync scope (`all`, `currentUser`, `currentContext`,
  `allAvailableContexts`, and the available-contexts component of `recent` and
  `custom`) stays widenable by a source scope. That is the Phase 57 behaviour
  verified below and it must not be narrowed.
- The *bound* — the `recent` window, the `custom` predicate — is evaluated once
  per record in `recordSatisfiesDeclaredBound` and gates `getDatasetReasons`
  before any reason is computed. A record failing it reports **no reasons at
  all**, so no route admits it.
- `recordMatchesSyncScope` for `recent` and `custom` is now the context half
  alone, because the bound half already ran. Do not re-add the bound there; it
  would evaluate the predicate twice per record.
- A `readModelSource` reason carries `boundedBy: "window" | "predicate"` when the
  sourced object declares one. Without it a reader cannot tell a dashboard that
  is deliberately short offline from one that is wrong.

### Why there is no diagnostic for this

Considered and rejected: a warning when a read-model source names an object that
declares a bound. It would fire on every legitimate model combining the two —
twice on the reference app alone — and a warning an author cannot action or
silence becomes wallpaper. The phase's constraint was that a bound and a source
must not contradict each other *silently*, satisfied by either the runtime
honouring the bound or the compiler reporting it. The runtime honours it, so no
contradiction remains expressible and there is nothing for a diagnostic to say.

The mirror risk is real and worth knowing: an author who declares a window on an
object a dashboard sources will see that dashboard bounded offline too. That is
what they declared, it is specified in
`docs/spec/runtime-semantics.md#what-a-read-model-source-may-widen`, the
`boundedBy` reason makes it inspectable, and the read model still returns
everything when executed online. If a future phase needs a dashboard to reach
past its object's bound, that is a source-level bound declaration and it should
reuse the Phase 62 `WINDOW` shape rather than reopening this rule.

## Key decisions from Phase 64

Phase 62's own note below — "`recent` replaces context scoping rather than
narrowing it" — was the unfinished delivery, and this closed it. **A sync scope
selects a context; a window and a predicate are independent bounds that may
accompany any scope, and each other.**

- The two scope-pairing refusals are gone, and their four
  `MODEL_VALIDATION_CODES` entries with them: a code no rule can emit is dead
  surface. `custom` without a predicate is still refused — that direction of the
  Phase 62 rule is intact, because `custom` selects by a predicate and nothing
  else. Window field/type/day/limit validation is unchanged.
- The runtime gates on a bound's **presence**, not on the scope word.
  `recordSatisfiesDeclaredBound` checks the window if one is declared and the
  predicate if one is, and both when both are. `recent` and `custom` are retained
  as spellings and resolve to exactly the models they did before, including the
  `objectSync` reason still reporting `scope: "recent"`.
- `resolveSyncWindow` is now the only place a scope still implies a bound: a bare
  `SCOPE recent` still derives 30 days over `_updatedAt`. Normalising `recent`
  away into `allAvailableContexts` plus a window was considered and refused —
  it would change resolved values, the model fingerprint and every `objectSync`
  reason for no behavioural gain.

### A limit ranks a selection, so it is the one bound a source is not measured against

The defect the phase predicted, and the shape of it was not the predicted shape.
`computeRecentLimitRecordIds` picked limit candidates with
`recordMatchesAvailableObjectContext` regardless of the declared scope — invisible
while a limit could only accompany `recent`, whose context half is exactly that.
On a `currentUser` object it would rank one user's records against every other
user's. Fixed by filtering candidates through `recordMatchesSyncScope`, the same
matcher that decides the object's `objectSync` reason.

That fix raises a question the phase document did not: what happens to a record
another route holds, which is therefore not a candidate? Excluding it would have
been the literal reading of "the bound gates every route", and it is wrong — it
would have emptied `BandMemberAvailabilityBoard` offline the moment `Availability`
took a limit, and broken the phase's own acceptance criterion that a cross-context
source still admits another user's `Availability`. **A limit is evaluated only
against records the object's own scope selects.** The day span and the predicate
are per-record and still gate every route; a limit is a ranking, and ranking a
sourced record against a selection it is not part of would make a bound narrow a
context, which Phase 63 reserved to nothing at all.

`boundedBy` gained `windowAndPredicate` for the case an object declares both.

### The reference app compromise, resolved both ways

`Availability` took `SCOPE currentUser WINDOW Date 90 DAYS LIMIT 400` — the bound
it needed and could not have. Its `Date` is a future-dated calendar date and the
day span only excludes records *older* than the span, so the limit is what bounds
the direction this object actually grows; the span bounds the history.

`Event` went back to `SCOPE currentContext WINDOW Date 90 DAYS LIMIT 200`.
Phase 62 had widened it to `recent` for one reason only — a window was refused on
any other scope — and nothing about the model ever wanted every available band's
events held by the object's own scope. `HomeUpcomingEvents` declares
`SOURCE event OBJECT Event SCOPE allAvailableContexts`, so the cross-band events
are still held, by the route that means it, with `boundedBy: "window"` on the
reason. This is the general shape worth remembering: when an object's scope was
widened to buy something unrelated, narrowing it back is safe exactly when a read
model already asks for the widened set deliberately.

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

**Phase 63 update.** That over-inclusion was confirmed and bounded, but only for
a *declared bound*; a source scope still admits on its own strength for context,
which remains correct. See the Phase 63 section above.

The general rule this is an instance of: a gap recorded in a phase document's
non-goals is an assertion made at planning time, and
`learnings/process/phase-execution.md` requires checking it before executing on
it. Two of the four gaps Phase 57 listed were checked; one was wrong.

## Practical guidance

- Do not use dataset membership as proof that a user can read a record. Always route user-facing local reads through `ApplicationRuntime.searchLocalDataset(...)`, `ApplicationRuntime.read(...)`, `executeReadModel(...)`, or another policy-enforcing runtime service.
- When adding read-model behavior, remember that source scopes can expand the offline dataset beyond an object's own sync scope. This is deliberate when a dashboard declares cross-context inputs.
- Keep future remote authority responsibilities separate from `ObjectStorageBackend`. The local backend stores records; deciding what should be present locally belongs in runtime dataset/sync services.
