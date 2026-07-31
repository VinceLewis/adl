# Sync Mode Delivery and Authority Coherence

Read this before changing which sync modes queue, the client's delivery path,
the authority's acceptance of a mode, delivery-state presentation, or anything
that decides whether an accepted write reaches the authority.

See also [[sync-policy]] for the write gate, [[usable-sync-slice]] for the
recovery model this sits beside, and [[authority-server]] for the replay path.

## The defect this phase closed

`SyncQueue.enqueue` admitted `localFirst` alone, and `AuthoritySyncClient` sent
only what the queue held. An `onlineRequired` write — permitted only while
online — was therefore validated, policy-checked, persisted locally, written to
the operation log, and then **never sent to anyone**, with no surface saying so.
It was live in the reference application: `BandInvitation` declares
`SYNC ONLINE_REQUIRED`, so every Giggle Band invitation was written to the
device and lost.

The lesson generalises past this one mode: **a write the runtime accepts must
have either a delivery path or a stated reason it has none.** A mode with
neither is a data-loss bug wearing a mode's name.

## Every mode now answers three questions

Send, accept, bootstrap — for each of the four modes. The table lives in
`docs/spec/runtime-semantics.md#each-modes-relationship-to-the-authority` and is
the thing to update first when a mode changes.

- `localFirst` — queued, delivered on the next reconcile; accepted; returned.
- `onlineRequired` — queued, delivery attempted at once and retried by every
  later reconcile; accepted; returned.
- `cacheReadonly` — never sent (no accepted local write exists); refused;
  returned, because a cached record is read-only on a device, not invisible to
  it. No replay can create one, so such records originate on the authority.
- `localPrivate` — never sent; refused with `ADL_SYNC_POLICY_DENIED`; not
  returned, and unreachable anyway because the write is refused before storage.

## `localPrivate` is refused by the *channel*, not by the authority

The obvious implementation is a check in `AuthorityService.apply`. It is the
wrong one: a `command` intent writes several objects through the runtime, so an
intent-level check would miss every object a command touched.

Instead `SyncPolicyService` refuses a `localPrivate` write when
`context.channel === "sync"`, which is the channel `AuthorityService` resolves
its own context under. One rule, in the runtime service where sync policy
already lives, covering every path into the authority including commands. It is
also why the rule is statable in the runtime conformance corpus with the
existing `syncWrite` operation rather than needing a new one.

`cacheReadonly` was already symmetrical for free: it is readonly on every
channel, so the authority's own runtime refuses it without a special case.

## `queueable` is derived, not enumerated

`SyncWriteDecision.queueable` is now `!readonly && isQueueableSyncMode(mode)`.
Deriving it from `readonly` is what keeps the existing contract that a refused
write is queue-neutral: an offline `onlineRequired` write still reports
`queueable: false`, because it is not being written at all.

## Undelivered is a delivery state, never a verdict

`SyncQueueEntryDelivery` sits alongside `SyncQueueEntryRecovery` on the queue
entry and means the opposite thing:

- A **recovery** is the authority's verdict. The entry stops being replayable.
- A **delivery** failure is a transport failure. The entry stays replayable, is
  still sent by the next reconcile, and is cleared the moment the authority
  answers — a verdict outranks the failure that preceded it.

Retrying an undelivered entry deliberately **reuses the operation id**. A
transport failure settles nothing, so if the request did reach the authority
before the response was lost, the same id returns the stored outcome instead of
applying the operation twice. This is the opposite of `beginRetry`, which mints
`<opId>-r<n>` precisely because the authority *did* answer.

`markPendingUndelivered` covers the case where the client declines to sync at
all — an expired offline grace. Not attempting a delivery leaves the same write
undelivered as a failed attempt does, and it must be just as visible.

## The marker is recorded for `onlineRequired` only

A `localFirst` entry waiting offline is that mode working, not failing.
Reporting it as undelivered would present normal offline operation as an error,
so `SyncQueue.setDeliveryFailure` ignores any mode that
`requiresImmediateDelivery` says may wait. If a third mode ever needs immediate
delivery, that one predicate is the place to say so.

## Where the immediate delivery is triggered

The runtime cannot call the transport — that would invert the layering the whole
codebase depends on. So `AuthoritySyncClient.deliverPending` exists above the
runtime, and `adl-app` calls it from `runCommand`, the single wrapper every
mutating shell action already runs through. Two guards matter there:

- **A re-entrancy flag.** `refreshFromRuntime` itself runs through
  `runCommand`, so without it the delivery pass recurses.
- **A pending check before calling the bridge.** Only entries that are
  `requiresImmediateDelivery` *and* have no recorded delivery failure count.
  Without the first half every read refresh would call the bridge; without the
  second, an entry already shown as undelivered would be retried on every
  render instead of when the user asks.

Even if a caller forgets entirely, nothing is lost: the entry is in the queue,
so the next `synchronize` delivers it. Immediate delivery is a promptness
guarantee layered on a durable one, not the only path.

## What Phase 57 added to this

A queued entry carries one object's sync declaration, and from Phase 57 a
locally executed command is one entry covering as many objects as it has steps.
Two rules follow, both recorded in [[command-intent-replay]]:

- The entry is filed under the **most demanding** step object
  (`onlineRequired` > `localFirst`), so a command containing an `onlineRequired`
  step is delivered now rather than held. Its `objectName`/`recordId` therefore
  name a representative record, not the subject of the change.
- A command whose steps disagree about *queueability* is refused at compile time
  (`ADL_COMMAND_STEP_SYNC_MODE_MIXED`). Queue it and the authority refuses the
  `localPrivate` step on every reconnect; do not queue it and the steps that
  should have synced silently never do.

## Testing notes

- The hermetic suite proves the state machine; the real-PostgreSQL integration
  test proves the loop. `tests/integration/authority-deployment-slice.test.ts`
  drives the real client against the real authority over a real socket, and
  produces a genuine transport failure by binding a port and releasing it —
  a request to a port nothing listens on fails in the transport rather than
  being answered, which is the only way to exercise delivery failure without
  stubbing the transport out.
- `authorityBootstrap` was added to the conformance runner in this phase. Before
  it, the corpus could state what the authority *accepts* but not what a device
  *reads back*, so a mode could have been silently write-only and no case would
  have noticed.
