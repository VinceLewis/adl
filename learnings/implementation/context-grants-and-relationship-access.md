# Context Grants and Relationship-Aware Access

Read this before changing business-context availability, the object-scope gate,
policy principals, read-model joins, or anything that decides whether one user
may see another user's records.

## The object-scope gate runs before policy, and that is load-bearing

`requireObjectScopeForRecord` / `requireObjectScopeForValues` (`context-scope.ts`)
run *ahead of* `PolicyEngine` on every scoped object, in `ObjectStore.create`,
`read`, `update`, `delete`, `search` and in `LifecycleEngine.transition`. They
consult only `getAllowedContextIds`.

This is why the Phase 18 invitation rules never worked. `BandInvitationPolicy`
declared `allowInviteeReadOwnInvitation` and `allowInviteeAcceptInvitation`, both
correct, and neither could ever fire: the invitation is scoped to the very
context the invitation exists to get the invitee into, so the scope gate refused
them before any rule was consulted. The gap report described this as "the command
requires the caller to supply the context", which understated it — supplying the
context would not have helped, because `withSelectedContext` validates against
membership the invitee does not have.

**When a policy rule appears not to fire on a scoped object, check the scope gate
before checking the rule.**

## Grants widen the gate; they never confer roles

`ResolvedBusinessContext.grants` declares an object whose records associate a
user with a context instance, plus an optional condition. `getAllowedContextIds`
unions grant-derived ids with role-derived ids — and that is the *only* place
they meet.

- `runtimeContextHasScopedRole` reads `contextRoles` directly and never
  `contextGrants`, so no grant can become a role.
- `RuntimeAvailableContext` reports `roleEntries` and `grantEntries` separately,
  so "invited" and "joined" stay distinguishable to a caller and a renderer.
- `resolveContextMembers` counts membership only, so a grant-holder is nobody's
  co-member and no roster leaks to them.

Keep those three separations. Collapsing any one of them turns "may be
considered" into "may act", which is the whole distinction.

## A command can establish a context, for one transaction

`ResolvedCommandCreateStep.establishesContext` adds a `RuntimeContextGrant` to
the *in-flight* step context after the create step plans its write. Later steps
then pass the scope gate for an instance that did not exist when the transaction
opened, which is what creating a context and its first membership atomically
requires.

It reuses the grant mechanism rather than inventing a second one, it is discarded
with the call, and it reaches only the instance just created. Note that
`AUTHORITY command` bypasses **policy** only — it never bypasses the scope gate,
validation, sync policy or constraints — which is exactly why this was needed.

## `contextMember` is a principal, not an expression

Authorising "this record belongs to somebody I share a context with" as a
`ResolvedExpression` node would have rippled through the evaluator, the
validator, the fingerprint, inspection and every conformance case. As a
`PrincipalMatch` it touches the policy engine, the resolved model, the parser and
validation, and nothing else.

Two consequences worth knowing before using it:

- **Policy evaluation is synchronous; membership resolution is not.** The roster
  is resolved onto `RuntimeContext.contextMembers` by
  `ApplicationRuntime.withContextMembers` before evaluation, only when the model
  declares such a principal, and is never cached across calls — a cached roster
  would keep admitting a member whose membership was just revoked.
- **It cannot gate `search`.** The object-level search check is evaluated with no
  record, so there is nothing for the principal's field to read. Grant `SEARCH`
  to a wider principal and let the per-record read filter do the work.

Server code that calls `runtime.policyEngine` directly rather than through a
runtime entry point must call `withContextMembers` itself, or such a rule will
deny — safe, but a false denial. `access-lifecycle.ts` and
`authoritative-reporting.ts` do this.

## `self` is a third principal, and it is not a narrower `contextMember`

`SELF` (Phase 103) matches `record.meta.guid === context.userId` and nothing
else. It is not the `contextMember.field: "id"` extension Phases 91, 99 and 101
kept nominating, and it does not replace it: `contextMember` on `User` keyed on
the record's own id would say "whoever this record belongs to is in a context
with me", which on a `Band` context grants a caller read over every co-member's
`User` record — a band-scoped directory. `SELF` grants exactly one row to
exactly one caller. The two answer different questions and the second one is
still unbuilt.

Both share the one structural limit that matters here: **neither can gate
`search`**, because the object-level search check is evaluated with no record.
For `contextMember` that is a restriction to work around (grant `SEARCH` wider,
filter per record). For `SELF` it is the safety property — it is why adding a
row-level self-grant to a `User` object cannot reopen the directory Phase 101
closed, whatever else the policy says.

## Every consumer that de-selects a context must re-resolve *both*

A `CONTEXT ALL` consumer drops the selected instance for that business context —
that is what makes it cross-context — and in doing so drops everything derived
from the selection. Re-resolving only the **roles** is the bug that keeps
getting written, because roles are the obvious half.

`ReadModelService.resolveExecutionContext` resolved roles and grants.
`resolveActiveViewContext` in the browser shell (`adl-app/data.ts`) resolved
roles only. Two code paths, one question, two answers, for four phases. The
visible consequence was a shipped reference application rendering an enabled
`Accept` button on a row it had correctly fetched and then refusing every click:
the read path could see the invitation, the command path could not act on it.

The failure is *silent in both directions*, which is why it lasted. The list
renders, so the screen looks right. The click is refused with
`Policy denied update on object 'X' outside its runtime context scope.` — a
scope-gate message, not a policy-rule one, which reads like a missing selection
rather than like a missing resolution.

Three things follow:

- **Resolve both from the same de-selected base context**, so the two cannot
  disagree about which selection was dropped.
- **Keep them in separate fields.** `withContextGrants` is a separate method from
  `withContextRoles` on purpose. Merging grant entries into `contextRoles` would
  turn "may be considered" into "may act", which is the one separation this whole
  document exists to preserve. There is a test for it
  (`expectContextAllViewContextCarriesNoRoles`) precisely because the merged
  version *looks* like it works.
- **A branch that can be rewritten without a single assertion moving is
  untested.** Adding grant resolution to that branch changed nothing across 64
  files and 1,212 tests. That silence was the defect's whole life support.

## A grant reaches the *record*, and the authority still wants the context named

Phase 105's remaining gap, measured against real PostgreSQL rather than reasoned:
fixing the shell does **not** fix the same command replayed through the
authority.

`AuthorityService.resolveContext` deliberately keeps a narrow resolution for a
replay — it iterates `intent.selectedContexts` and nothing else, on the stated
grounds that "a write must land in a context the client actually named". A
`CONTEXT ALL` screen names none, so `operation-log.ts` records
`selectedContexts: {}`, `toIntent` (`src/server/sync-client.ts`) sends `{}`, and
the object-scope gate refuses. Measured: the queued entry really does carry `{}`,
and the replay really is rejected `ADL_POLICY_DENIED`.

So an invitee's `Accept` commits locally and is refused on delivery in any
deployment that has an authority, in **both** shipped applications
(`BandInvitation` and `CircleInvite` are both `SYNC onlineRequired`).
`tests/integration/authority-invitation-accept.test.ts` pins that, with a
control proving the same identity and the same intent commit when the band *is*
named — so it is a statement about the selection and not about the caller.

The tempting fix is to widen replay resolution. Do not: it would authorise every
command against a context different from the one its own view was rendered with,
on every channel including `sync`. The shape that is probably right is the
opposite one — a row action on a cross-context view carrying *its own row's*
context instance into the operation, since the row is only visible because the
caller can reach that instance. Unbuilt.

## A granted context needs the context's own root record on the device

`mergeGrantedContexts` (`context-service.ts`) will not report an instance as
available unless it can read the *context object's* record:

```ts
const contextRecord = await this.storage.read(businessContext.object, contextId);
if (contextRecord === null || contextRecord.meta.deletedAt !== undefined) continue;
```

Reasonable — the picker needs a label, and a deleted context is not available.
But combine it with the section above and the two rules collide. `bootstrap`
selects by **read policy**; no policy in either reference application lets a
pending invitee read the `Circle`/`Band` record itself, and Giggle Band's own
`allowAuthenticatedReadBandName` is deliberately *field-scoped*, which a
whole-record bootstrap read cannot match. So the invitation arrives on the device
and the context it is an invitation *to* does not.

Measured in a real browser against a real authority (Phase 105,
`tests/visual/invitation-accept.spec.ts`): the invitee's device holds exactly one
record, their own `pending` `CircleInvite`, `listAvailableContexts("Circle", …)`
returns `[]`, and the `CONTEXT ALL` view falls to
`No Circle contexts are available for this view.` before it ever reaches its
list. There is no row and no button to click.

This is the third layer of the same defect and the deepest: fixing the shell's
resolution (above) and the authority's replay (also above) would still leave it.
The general construct that closes it is the one Jointly Care's
`MyPendingCircleInvites` comment has been asking for since Phase 79 — a read
principal meaning "a grant admits me to this context" — because that, and only
that, would put the context record on the device without opening a directory.

## Bootstrap selects by read policy, not by sync scope

`AuthorityService.bootstrap` filters candidates by `runtime.read` and excludes
only `localPrivate`. So a policy rule that lets a band member read a fellow
member's `Availability` also puts those records on the device, even though
`Availability` declares `SYNC ... SCOPE currentUser`.

That makes the multi-hop projection work end to end in the browser. It also means
the sync-scope vocabulary and the policy vocabulary have diverged: no declared
scope expresses "records whose owner shares a context with me", which is exactly
the shape the policy principal needed. `offline-dataset-service.ts` has the same
blind spot for declared read-model joins.

## Read-model joins: the search gate applies to both cardinalities

A declared join matches records by field value rather than reading one by a known
id, so `ReadModelService` requires the `search` action on the joined object for
`one` as well as `many`. An undeclared lookup source still requires only `read`,
because it reads a single record whose id an already-loaded record handed it.

A record the caller may not read must be indistinguishable from no match: `one`
drops the row, `many` drops that branch.

## Accepted state and a denial for the same operation

`AuthorityService` used to shape an accepted write's response against the
caller's *pre-write* access. A command that made the caller a member of a context
committed both records and then returned a rejection, because at the moment the
context was resolved the caller was not yet a member of a context that did not
yet exist.

`shapingContext` now re-resolves — using the same widened resolution `bootstrap`
uses, and for the same reason: shaping is a read. **Replay itself keeps its
narrow resolution**; only the description of what was written is re-derived.

The general lesson: when a write can change who the caller is, the context that
authorised it is not the context that should describe it.
