# Record Sync State and Refused-Write Visibility

Read this before changing how a record's `syncStatus` is produced or cleared,
before adding a surface that reports what a device is holding, before touching
`ObjectStore.setRecordSyncState`, `listRefusedRecords`, `summariseRecordSyncState`
or `discardRefusedRecord`, and before adding any local removal of a row the
authority refused.

See also [[usable-sync-slice]] for the recovery primitives this sits beside,
[[offline-operation-identity]] for why a refused create leaves a row behind, and
[[command-intent-replay]] for the record list a command's verdict is applied
over.

## The defect this closes

`SyncStatus` declared five values and the runtime wrote two. `"pending"`,
`"conflict"` and `"rejected"` had no producer anywhere in `src/`, while
`_syncStatus` was a **required** platform metadata field, so every record carried
a value that could only ever be `local` or `synced`. A record that was refused,
one in conflict, one queued and waiting, and one that was never going anywhere
were all `"local"` and all looked identical.

The one shipped surface named for it made this worse rather than visible: the
`syncStatus` shell control rendered `context.online ? "Online" : "Offline"` and
never read a record at all.

## Every value now has a producer, and the rule is stated once

`ObjectStore.writtenSyncStatus` is the only place a write decides a record's
sync state, and it answers in three cases:

- **`sync` channel → `synced`.** On that channel the writer *is* the authority;
  its own state is accepted state by definition and it is waiting for nobody.
  This reuses the signal `SyncPolicyService` already uses to recognise a write
  arriving through the authority rather than from a device, rather than inventing
  a second notion of "am I the server".
- **Device write on a queueable object → `pending`.** The same commit queues it,
  so it is pending until the authority answers. This is true whether or not an
  authority is reachable, or configured at all — the write is queued and
  unanswered either way. The local demo therefore reports its records as
  `pending`, which is what they are; reporting them as settled would be a lie
  about work the device is still holding.
- **Anything else → `local`.** `localPrivate` and `cacheReadonly` records have no
  delivery path by design. They are not waiting, and not late.

A command's steps are not queued individually but its entry is, so every record a
queueable command wrote is `pending` too. Model validation refuses a command
whose steps disagree about queueability, so the step's own object always answers
for the whole transaction.

## A verdict is recorded on the record, not only on the queue entry

`AuthoritySyncClient` writes the authority's answer onto every record the
operation covered, through `ObjectStore.setRecordSyncState`. That method is
reporting, not writing: no value changes, no revision is minted, nothing is
audited and nothing is queued. Routing it through the ordinary write path would
audit it, queue it, and mint a revision the authority never issued.

It has to live on the record because the queue entry is discarded the moment the
user dismisses the verdict. A refused write whose only trace was that entry
became indistinguishable from a write nobody had sent yet — which is exactly the
state this phase existed to end.

**A command's verdict covers every record its steps wrote**, taken from the
entry's `command.records`, with `command.recordIds` — the manifest, which names
creates and only creates — identifying which of them the operation *created*. One
operation id, one verdict, every row it produced. Marking only the record the
entry is filed under would mark a representative record, which Phase 57 already
warns is not the subject of the change.

## `syncRejectedCreate` is the discard licence, and it is one bit for a reason

Discarding a refused row is safe only when no authority copy exists, and that is
true only when the refused write was the record's own create. A record whose
*update* was refused is still held by the authority: removing it locally deletes
something the next bootstrap restores, which is a silent no-op dressed up as a
repair — and if such a removal were ever queued it would destroy server data.

So the verdict records which case it is. `PlatformRecordMetadata.syncRejectedCreate`
is set alongside `rejected` on a record the refused operation created. It is
deliberately **not** a declared `_`-metadata field: a model has no business
addressing it, and unlike `_syncStatus` it describes the last verdict rather than
the record's state.

**Only the authority spends it, and getting this wrong was a real defect.** The
first implementation cleared the licence on any later write, on the reasoning
that a fresh write supersedes the last verdict. The hermetic suite found what
that costs: edit a refused create and the edit queues as an *update*, which the
authority refuses because it has no such record, leaving the row `rejected` with
`discardable: false` — permanently stranded, one edit away from every refused
create, which is precisely the residue this phase existed to end. The licence is
a claim about the authority ("it holds no copy"), so only the authority can
settle it: it survives local writes and is spent by an accepted operation or a
reconciliation. That includes the collision case, where the create was refused
*because* the id already named a record the authority holds — the bootstrap hands
the device that record, and discarding the row would then delete the authority's
record rather than the user's refused work.

The key is removed rather than set to `undefined` (`withoutRejectedCreate`).
Under `exactOptionalPropertyTypes` a persisted `syncRejectedCreate: undefined`
would be a third state between "refused create" and "not one".

## Discarding is a local action, never a third recovery primitive

`keepServer` and `resubmitMine` remain the only two, and neither invents a
winner. `discardRefusedRecord` settles nothing with the authority and sends
nothing to it: it is the user saying "throw away the row my refused change left
here". It writes a tombstone rather than erasing the row, so a later create
cannot silently resurrect the id, and that tombstone is **not queued** — the
authority never had the record, so telling it to delete one would be a request
about a record that does not exist there.

It refuses anything else with `ADL_RUNTIME_RECORD_NOT_DISCARDABLE`. Phase 48's
rule still stands and is what shapes this: before writing code that removes local
rows to repair a defective state, establish that the state exists somewhere that
survives. A user pressing Discard is that establishment; a sweep is not.

## A resolution has to settle the record, not only the queue entry

The second defect found in this phase, and by the real-PostgreSQL suite rather
than the hermetic one. `reconcileRemoteRecord` keeps an outstanding verdict so a
bootstrap cannot wipe a conflict the user still has to decide — but `synchronize`
is reconcile → bootstrap → `applyAutomaticRecovery`, so an automatic `keepServer`
removed the entry *after* the last bootstrap and nothing ever restored `synced`.
A record the model resolved by itself sat there wearing a conflict badge with no
action attached, for ever.

The user-driven path hid this, because the browser bridge bootstraps again after
a manual `keepServer`. An asymmetry between the automatic and manual paths is
worth suspecting whenever one of them is "the same thing, without the UI".

`resolveRecovery` now settles the covered records itself on a `keepServer`:
`synced` for a conflict, because the authority's state stands and the bootstrap
has already written it, and deliberately *nothing* for a rejection, whose records
must keep saying they were refused.

## The bootstrap is what clears a refused update, and that falls out for free

`synchronize` is reconcile → bootstrap → applyAutomaticRecovery. A record the
authority still holds is re-reconciled by that bootstrap and comes back `synced`,
so an update-rejection's mark clears itself on the next successful sync. A
refused *create* is precisely the record no bootstrap can return, so its mark
stays — and it is exactly the stranded residue the user needs to see. The
distinction needed no extra machinery.

## `syncStatus` and `connectivity` are two controls because they are two questions

The `syncStatus` shell control now reports the device's record sync state, and a
new `connectivity` control kind reports whether the authority is reachable. Both
are in the platform's default shell, because before this phase the `syncStatus`
control *was* the connectivity indicator and dropping it would have taken
online/offline away from every model that declares no shell.

Auditing a declared capability runs in both directions: Phase 56 found `import`
declared with no call site; this phase found a control with a call site that
answered a different question from its name. Check both.

## Practical guidance

- The scratch end-to-end loop is still the fastest way to know whether the
  mechanism works: execute a command locally, take its manifest, replay that
  manifest to the authority under a different operation id so the device's own
  ids are taken, reconcile, and read the records back. It showed both records
  `rejected` and discardable, surviving dismissal, in minutes — before any test
  file existed.
- When you change what a write leaves in `meta.syncStatus`, expect fallout in
  tests that asserted `"local"` as though it were a constant. Updating those
  expectations is the phase's work; weakening them is not.
- A record's sync state is device-local in both directions. The client never
  sends it, and `reconcileRemoteRecord` *imposes* `synced` rather than adopting
  whatever the authority's copy of the field happened to say.
- **Known cost, accepted for now.** `summariseRecordSyncState` and
  `listRefusedRecords` each walk `storage.listRecords()`, and the browser shell
  calls both once per refresh — two full scans per render cycle. That is
  comfortable at demo scale and wrong at real scale. The fix when it matters is
  one scan answering both, or an index maintained by the writes themselves;
  neither belonged in the phase that was making the state exist at all.
