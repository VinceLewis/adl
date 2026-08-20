# Band Reference App Gap Report

The Giggle Band reference app lives in `src/reference/giggle-band/`. `app.yaml`
lists its ADL sources; `domain.adlj` holds the domain, read models, commands
and policies, and `ui.adlj` holds the shell and the composed views.
`src/reference/band-app.ts` is the browser/runtime integration module and seed
fixture.

The browser demo runs through the existing Vite app at:

```text
/?demo=giggle-band
```

With no authority configured it is a purely local demo over IndexedDB, and it
seeds itself. With `VITE_ADL_AUTHORITY_URL` set it seeds nothing and its data
arrives from the authority — see [Demo seeding](#demo-seeding).

This document exists to say what the reference app has proved the platform can
do, and — more usefully — what it has proved the platform could not. Phase 56
closed the second list.

## What The Model Proves

- `Band` is a first-class business context, and `BandMember` resolves
  context-scoped `BandAdmin` and `BandMember` roles. A user can be an admin in
  one band and a member in another.
- `Event` models gigs, rehearsals, and unavailable rows with `EventType`.
- The cross-band home dashboard uses `HomeUpcomingEvents`, an
  all-available-context union read model over `Event` and `Availability`.
- The home dashboard presentation is authored in `ui.adlj` and rendered through
  the generic composed-view browser component: row template, event-type icon
  map, local toggles, date/time formatting, and the invitation empty state all
  come from the resolved presentation model.
- The application shell — navigation items, groups, ordering, visibility
  conditions, top bar and navigation drawer — is declared in `ui.adlj`, not
  derived and not hardcoded.
- Band-scoped objects are protected by runtime context scope and context-role
  policy checks, and `Availability` is user-owned data with a `currentUser`
  offline scope.
- Sync modes and scopes are explicit and, since Phase 56, every declared mode
  has a producer (see [Modes and actions](#modes-and-actions)).

## Triage

Phase 18 promoted the first round of Phase 17 gaps into generic capabilities:
field-equality policy conditions for user-owned data, the generic
`AcceptBandInvitation` command transaction, backend-neutral scoped-uniqueness
constraints, ordered positions, and object-level validation.

The gaps that survived that round were carried in this document from Phase 18
until Phase 56, which triaged every one of them. Each is recorded below as
**implemented** or **closed**, with the reason. None is left undecided.

| Gap (as documented before Phase 56) | Outcome | Reason |
| --- | --- | --- |
| Pending invitations for non-members need a context grant separate from membership; the command currently requires the caller to supply the invitation's band context. | **Implemented** | Genuine platform gap, and worse than documented: the refusal was not a policy mismatch but the object-scope gate, which runs *upstream* of policy. The invitee's `allowInviteeReadOwnInvitation` and `allowInviteeAcceptInvitation` rules were unreachable — the model could write them and they could never fire. Closed with `CONTEXT_GRANT`, a declared route into a context that confers no roles. |
| Availability projection into selected-band member views needs reverse joins or multi-hop read-model sources through `BandMember`. | **Implemented** | Genuine platform gap. Read-model joins followed a lookup field forwards and read exactly one record by id, so a projection through a junction object was structurally inexpressible and could not fan out. Closed with declared `JOIN ... ON ... CARDINALITY one\|many` source joins. |
| Band creation needs a command-created context grant or equivalent scoped-write model to create the context and its initial membership in one command. | **Implemented** | Genuine platform gap. The membership record is scoped to a context instance that did not exist when the transaction opened, so the scope gate refused it. Closed with `ESTABLISHES CONTEXT` on a create step, which puts the new instance in reach for the remainder of that transaction only. |
| Ordered set-list behaviour needs generic reorder helpers and compaction after removal. | **Implemented** | Genuine platform gap. Closed as declared properties of the `ORDERED` constraint (`REORDER shift`, `COMPACT onDelete`) rather than as new runtime API, so a reorder stays ordinary `update` intents and a compacting delete stays a `delete` intent — replayable through authority intent replay with no protocol change. |
| Batch commands are not modelled for mass song import, batch set-list item creation, or drag-reorder updates. | **Implemented** | Genuine platform gap. Closed with repeated command inputs (`INPUT ... LIST`) and iterating steps (`FOR EACH`), so a batch is one command transaction rather than N independent ones. |
| ADL `SHELL`, `TOP_BAR` and `NAV_DRAWER` source syntax is still future work; the browser shell is generic but not model-declared. | **Closed as stale, then partly implemented** | `SHELL`, `NAV`, `CONTROL` and `TOP_BAR` were delivered by Phase 31 and have been used by the app's UI source since; this entry was simply never updated. What was genuinely missing was `NAV_DRAWER`: `navDrawer` was already a legal control placement that parsed, resolved and validated, and then rendered nowhere. Implemented. |
| Remote sync remains backend-neutral; a future server must provide context-scoped datasets, conflict handling, email dispatch, and authoritative policy re-checks. | **Closed as delivered** | Phases 39-55 delivered all of it except email dispatch, which ADR 0008 replaced with invite-based recovery rather than deferring. Not a gap. |

Phase 56 also added one capability this list never asked for, because closing the
availability gap exposed it: a **`contextMember` policy principal**. A multi-hop
join can put a fellow band member's availability in front of a caller, but no
existing policy vocabulary could authorise that. `ROLE BandMember` would have
granted every availability record in the system, not those of people the caller
shares a band with. Adding the join without the principal would have meant either
an over-grant or a read model whose rows all fail the read check.

## Modes and actions

A gap report that only lists what the app *wants and cannot say* misses the other
half. This section lists capabilities the platform ships and the app can express
— where an unexercised one leaves a delivered feature undemonstrable in the only
application this repository has.

Phase 55 found the first of these: the platform shipped CSV export in Phase 43,
no object declared an `EXPORT` rule, and the feature was therefore unreachable
here. Phase 56 audited every runtime action against every object.

- **`export`** — granted on `Event` (to `BandAdmin`) and `Availability` (to the
  record's owner). Deliberately not granted elsewhere: the administration chrome
  offers every read model to any signed-in caller, and a read model whose sources
  include an object with no export rule denies the whole export. That is the
  correct fail-closed direction, but it means only the `Event`/`Availability`
  read models are exportable end to end. Recorded, not a defect.
- **`import`** — declared in `PolicyAction`, accepted by the parser and the
  validator, and **invoked by nothing**: there is no runtime call site for it
  anywhere in `src/runtime` or `src/server`. No model can demonstrate it because
  there is nothing to demonstrate. This is a platform gap, not a reference-app
  one, and it is recorded as such rather than papered over with a rule that would
  never be consulted.
- **`transition`** — fully implemented and enforced, but no object in this model
  declares a `LIFECYCLE`, so the reference app exercises none of it. A band
  domain has no natural state machine; forcing one in would be a worse example
  than leaving this honest.
- **`cacheReadonly`** — `StreamingLink` used to declare it while being offered as
  ordinary user-entered band data. Both could not be true: no local write and no
  authority replay may create a `cacheReadonly` record, so nobody using the
  deployed app could ever populate one. Phase 56 settled it in the model —
  `StreamingLink` is band-authored and now declares `LOCAL_FIRST`/`currentContext`
  with `BandAdmin` write rules — which leaves `cacheReadonly` correct, tested by
  conformance, and unexercised by this app. That is the honest trade: the app has
  no externally-owned data, and inventing some to demonstrate a mode would be
  fiction.
- **Administration surfaces** (audit review, membership review, invite listing,
  session revocation, recovery and retention status) are authorised by a
  synthetic `update` check on the context's membership object. In this model that
  resolves to `BandMember` UPDATE, which `BandAdmin` holds — so they work, but by
  reuse rather than by a grant that names administration. There is no policy
  action for "administer a context". Recorded as a platform observation.

## Demo seeding

With an authority configured, the demo used to seed local records anyway. Those
writes entered the sync queue, the authority refused them — the seeded identity
may not create a `User` or a `Band` — and the operator was shown a panel full of
`ADL_POLICY_DENIED` changes "needing their attention" before making a single
change.

Nothing was wrong with the sync recovery surface; it reported the verdicts it was
given. What was wrong was manufacturing them. Since Phase 56 the demo seeds only
when no authority is configured. With one, it starts empty and signed out and its
data arrives through bootstrap, which is what a real deployment does.

## Remaining platform observations

Not gaps this reference app can close, recorded so a later phase can weigh them:

- **A command does not replay to the authority as a command.** This is the
  largest one, and Phase 56 made it matter. `sync-client.ts` converts a locally
  executed command into one ordinary create/update intent per step —
  `LocalOperationKind` has no `command` variant — so the atomicity a command has
  locally is lost at the sync boundary. `AuthorityService` supports a `command`
  intent and handles the whole command in one transaction; nothing emits one.

  Before this phase that cost was theoretical: a two-step invitation acceptance
  replayed as two independent writes usually converged. It is no longer
  theoretical. `CreateBand` uses `ESTABLISHES CONTEXT`, which is transaction-local
  by design, so split into separate intents the authority refuses the membership
  create for a band the same command just made — the caller is not a member of a
  context whose only membership record is the one being refused. And a batch
  import split into N intents can land partially, leaving no way to say what
  arrived.

  `tests/command-authority-replay.test.ts` pins all of it, including the negative
  case, so this cannot be rediscovered by accident. Making commands replayable as
  commands needs client-supplied ids for every step's record, which Phase 48
  already established for creates.

- **A bare `selectedContexts` on a runtime context opens the object-scope gate
  unconditionally.** `getAllowedContextIds` returns the selected id with no
  availability check, so grants and membership are only load-bearing where the
  selection was validated. Every production path does validate — the authority
  and the UI both go through `validateSelectedContext` — so this is not reachable
  today, but it means a hand-built context is trusted. Pre-existing and untouched
  by Phase 56.
- **`docs/spec/runtime-semantics.md` was not extended this phase.** Its "Read
  Models" section still describes only lookup-relationship resolution and says
  nothing about declared joins, grants, `contextMember`, reorder/compaction,
  repeated inputs or established contexts. `docs/spec/resolved-model.md` and
  `docs/spec/language.md` do state all of it, and the conformance cases point
  there; runtime-semantics should be brought into line.
- **`ITEM_INDEX` is expressible and unexercised by this app.** It yields a
  zero-based index and `SetListItem.Position` starts at 1, so every natural
  batch here supplies explicit positions instead — which is also the more honest
  modelling, because appending to an existing collection needs a base position a
  command cannot query. It is covered by conformance and unit tests rather than
  by a contrived reference-app use.

- **`import` is a declared policy action with no runtime call site.** It parses
  and validates and can never fire.
- **`ResolvedPrincipalSelector.match` is itself unvalidated.** There is no
  `ADL_POLICY_PRINCIPAL_MATCH_INVALID`; an unrecognised match value is accepted
  silently. Pre-existing, and untouched by Phase 56 because adding it would be a
  new constraint on existing models.
- **Offline dataset selection does not know about read-model joins.**
  `offline-dataset-service.ts` derives dataset membership from read-model
  sources and has no notion of a declared join, so a `many`-joined source's
  records may be absent from the offline dataset the same read model needs. This
  does not affect the browser against an authority — `AuthorityService.bootstrap`
  selects by **read policy**, not by sync scope, so records a caller may read do
  reach the device — but it does affect `evaluateOfflineDataset` planning.
- **Sync scope has no relationship-aware option.** `Availability` is
  `SYNC LOCAL_FIRST SCOPE currentUser`. The `contextMember` principal now lets a
  band member *read* a fellow member's availability, and bootstrap therefore
  delivers it, but no declared sync scope expresses "records whose owner shares a
  context with me" — the exact shape the policy principal needed. The scope
  vocabulary and the policy vocabulary have diverged.
- There is no policy action for administering a context; administration reuses
  the membership object's `update` rule.
- The administration and reporting chrome renders for any signed-in caller
  whenever an authority is configured, rather than being declared by the app.
