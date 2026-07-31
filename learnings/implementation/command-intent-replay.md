# Command Intent Replay

Read this before changing how a locally executed command is queued, the
`command` local-operation kind, the command intent's record-id manifest, the
authority's re-execution of a command, or anything that decides which selected
contexts an operation replays against.

## The defect this closes

Before Phase 57 a command executed locally produced one ordinary operation-log
entry and one queue entry **per write**, each tagged with `commandName`,
`commandStep` and a shared `commandTransactionId`. `toIntent` in
`src/server/sync-client.ts` mapped each to a per-record intent, so the client
could never emit `kind: "command"` even though `AuthorityService` had accepted
that variant since Phase 40.

Phase 48 recorded the consequence as "separate pre-existing work" because the
split usually converged. Phase 56 made it stop converging:

- `CreateBand` uses `ESTABLISHES CONTEXT`, which is transaction-local by design.
  Replayed as separate intents the authority refuses the membership create for a
  band the same command just created — the caller is not a member of a context
  whose only membership record is the one being refused. No ordering, retry or
  policy change escapes this. **The transaction was the mechanism.**
- A batch command replayed as N intents lands partially, which is the one thing
  batch commands exist to prevent.

## Decisions from Phase 57

- **The queue carries the transaction, not its pieces.** `LocalOperationKind`
  gained `"command"`, and `ObjectStore.commitPlannedTransaction` records every
  step in the operation log for local history while queueing exactly one entry
  for the whole command. `recordOperation` gained a `queue` flag rather than a
  second code path, so a step's log entry is still written by the same call that
  writes every other one.
- **`AuditOperation` deliberately excludes `command`.** Audit is per record: a
  command is audited as the writes it made, step by step, each already carrying
  `commandName`/`commandStep`/`commandTransactionId`. Adding a `command` audit
  event would have described the same work twice at two granularities.
- **`command` had to go into `DEFAULT_OPERATION_LOG_OPERATIONS`.** The operation
  log gates the sync queue — `OperationLog.record` returns `undefined` for a kind
  the model does not log, and `SyncQueue.enqueue(undefined)` is a no-op. A
  command that was not logged would execute locally, write its records, and have
  no delivery path at all, while its steps are deliberately not queued either.
  This coupling predates the phase; it is called out because the failure it
  produces is silent.
- **The intent carries the command's input, not its writes.** The authority
  re-executes, so policy, validation, lifecycle, scope, constraints and command
  preconditions all run server-side exactly as they ran locally. What crosses the
  wire is the work that was asked for.
- **What crosses the wire is the *prepared* input.** `CommandService.prepareInput`
  has already applied declared defaults and refused unknown inputs, and it is
  idempotent over its own output. Sending the raw input would let a default
  changing between queueing and replay change how many writes the command plans,
  which is precisely what the record-id manifest cannot survive.

### Record identity

- **Every record a command creates is named by the client**, per step and per
  iteration item, in `LocalCommandOperation.recordIds`. Without this the
  re-execution mints its own ids and every created record comes back naming a row
  the device does not have — the Phase 48 duplication defect reached by a
  different route. `learnings/implementation/offline-operation-identity.md`
  stated the requirement before the capability existed.
- **Only creates are named.** An update step names an existing record through its
  own `ID` expression, and any such expression reaching for a created record's id
  (`STEP x META guid`) resolves to the adopted id for free. A derived
  ordered-collection write is likewise an update on a record that already exists,
  so the manifest covers the *requested* writes only, never the expanded plan.
- **Adoption reuses the Phase 48 create path, deliberately.**
  `CommandService.planStepWrite` passes the id to
  `ObjectStore.planCreateForTransaction`, so every Phase 48 guarantee applies per
  step: the shape check runs first and discloses nothing, the collision check runs
  *after* scope, policy and field policy so the path is never an existence oracle,
  and a collision is `ADL_RUNTIME_RECORD_ID_TAKEN` — a terminal rejection, not a
  conflict. A client-supplied id is a name, never an authorisation.
- **Matching is positional *and* named.** `SuppliedRecordIds` consumes the
  manifest in planning order and requires each entry's `step`, `objectName` and
  `itemIndex` to match the write it names. Positional alone would attach item 3's
  id to item 4 if the two executions disagreed about a list; named alone could not
  tell two writes of the same iterating step apart. Any divergence, in either
  direction, is `ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH`. An id adopted against a
  different record than the one it names is a silent identity swap, which is
  strictly worse than a refusal.
- **A manifest that names one id twice is refused before any write is planned,
  and finding out why took real PostgreSQL.** `planCreateForTransaction` detects
  a taken id by reading storage, and every write in a command is planned *before*
  any of them is committed — so the second plan's lookup cannot see the first
  plan's id. Both plans passed and the duplicate landed as a primary-key
  violation at commit, which is not a `RuntimeError`: `classifyFailure` returned
  null, `replay` rethrew, the client saw a transport failure, and the queue entry
  stayed replayable for ever. This is precisely the failure
  [[offline-operation-identity]] describes — "a durable rejection is only
  reachable by detecting the collision first" — reached by a route Phase 48 did
  not have, because Phase 48 only ever had one create in flight.

  `SuppliedRecordIds` now refuses an internally duplicated manifest in its
  constructor. It is checked there rather than alongside the storage lookup
  because it is pure input validation: the caller supplied both ids, so refusing
  them discloses nothing about what exists, and the existence-oracle ordering
  that governs the storage check does not apply. It raises
  `ADL_RUNTIME_RECORD_ID_TAKEN`, the same code a taken id raises, because the
  question and the caller's remedy are the same. It is keyed by object *and* id:
  storage is keyed per object, so the same id under two different objects is not
  a collision and must not be refused as one.

  **The general rule: a check that reads storage cannot see uncommitted work in
  its own transaction.** Any per-record guard that a command applies N times
  needs a second, in-transaction check over what the transaction has already
  planned.

  **The hermetic suite cannot reproduce this defect's symptom, only its
  verdict.** With the check disabled, `InMemoryObjectStorageBackend` raises
  `ADL_STORAGE_ERROR` — a `RuntimeError`, so `classifyFailure` turns it into a
  durable rejection and the retry-forever behaviour never appears. Only real
  PostgreSQL produces a primary-key violation that is *not* a `RuntimeError`.
  The hermetic case pins the code and the zero-writes guarantee; the
  real-PostgreSQL integration case is the only proof that the infinite-retry
  path is closed. This is the third time in this repository that the hermetic
  backend has been too forgiving to show a real failure mode.
- **A missing manifest is refused in the service as well as at the edge.**
  `AuthorityService` is constructed directly by tests and tooling, so an
  edge-only check would be no check at all on that path — the same reasoning
  Phase 48 applied to `recordId`. The HTTP edge additionally bounds the manifest
  length, because an unbounded manifest is an unbounded transaction and the
  body-size limit alone would let a small request ask for a very large one.

### Which object a command entry is filed under

A queue entry carries one object's sync declaration; a command has as many as it
has steps.

- **The most demanding mode wins** (`commandModeRank`: `onlineRequired` >
  `localFirst` > everything else). A command containing an `onlineRequired` step
  was accepted on the belief that the authority was reachable, so it must be
  delivered now rather than held like a `localFirst` write.
- The entry's `objectName`/`recordId` therefore name a *representative* record,
  not the subject of the change. The recovery surface must never present them as
  the change — "Update BandMember" for a rejected `CreateBand` is worse than
  saying nothing.
- **A command whose steps disagree about queueability is refused at compile
  time** (`ADL_COMMAND_STEP_SYNC_MODE_MIXED`). Queue it and the authority refuses
  the `localPrivate` step on every reconnect; do not queue it and the steps that
  should have synced silently never do. Both are wrong, and the disagreement is
  statically decidable.

### Selected contexts belong to the operation

- `toIntent` read `selectedContexts` from the context passed at **drain** time,
  so a queue drained after a context switch or a reload replayed writes against a
  selection that was not in force when they were made. `OperationLog.record` now
  captures the selection on **every** operation kind, not only on commands: the
  bug was never specific to commands, and fixing it for one kind would have left
  it live for the other four.
- **The empty selection is recorded, and that is the whole point.** The first
  implementation wrote `selectedContexts` only when the context had one, so
  "nothing was in force" was indistinguishable from "this entry predates the
  capture" — and the second reading falls back to the drain-time selection. A
  scratch end-to-end run caught it immediately: an offline `CreateBand` made
  outside any context was rejected on reconnect as
  `ADL_RUNTIME_CONTEXT_ERROR` for a band the drain-time selection happened to be
  pointing at. `{}` now means no selection; absent means a pre-phase entry, and
  only that falls back.
- The general rule: **when a field starts carrying state that used to be read
  from elsewhere, an absent value must mean "no answer recorded", never "the
  empty answer".** Otherwise the fallback quietly reinstates the defect for
  exactly the inputs that look like nothing.

### Recovery

- A rejected or conflicted command is presented as **one** change, named after
  the command, with the record count it covers. It is one operation id and one
  verdict, so presenting it as several unrelated failures would be a lie about
  what the authority decided.
- **A rejected command leaves its local records in place**, exactly as a rejected
  create does today. This was chosen over a local rollback: `keepServer`
  ("Dismiss") remains the only resolution for a terminal verdict, and a
  compensating local transaction would be a third recovery primitive that invents
  a winner, which Phase 47 rules out. The residue is real and is now larger — a
  refused command strands every row all of its steps wrote, not one — and it is
  recorded below as the gap it is.
- `resubmitMine` on a conflicted command resends the whole command under a fresh
  operation id, unchanged from every other kind. `stateTransitionWins` resolves to
  `keepServer` for a command, because a command is not a lifecycle transition.

## Gaps this phase leaves open

- ~~**A refused command's local rows have no convergence path.**~~ **Closed in
  Phase 58.** The rows still stay — a compensating local rollback would be the
  third recovery primitive Phase 47 rules out — but the user is now told. The
  verdict is applied to **every** record the command wrote, using the
  `command.records` list this phase put on the entry precisely so it could be
  (`command.recordIds` says which of them the command created). Each such record
  reports `syncStatus: "rejected"`, keeps reporting it after the verdict is
  dismissed and after a reload, and a record the command *created* can be thrown
  away by the user, because a refused create is the only case in which the
  authority has no copy to contradict the removal. See [[record-sync-state]].
- **Only model-declared commands are transactional across the boundary.** An
  ad-hoc multi-record write, and a lifecycle transition with side effects, still
  replay as independent per-record intents and can still land partially.
- **The manifest cannot express a write the re-execution plans differently.** By
  design — divergence is refused rather than reconciled — but it means a model
  change that alters how many records a command plans invalidates any queue
  entry made under the old model. The model-version startup guard is what stands
  between that and a confusing rejection; nothing yet says so at the point of
  replay.

## What the conformance corpus still cannot say about this

Recorded so a later phase does not have to rediscover them.

- **Emptiness of a map cannot be asserted.** `partialDeepMatch` walks only the
  expected object's keys, so `"selectedContexts": {}` asserts presence and
  object-ness and nothing more. The case for "a command executed outside a
  context carries no selection" has to name each context that is *not* there
  (`{"Crew": "$absent"}`), which does not scale. Wants an `"$empty"` sentinel;
  arrays already get exact length for free.
- ~~**Nothing joins the queue to the wire.**~~ **Closed in Phase 58** by the
  `syncReconcile` conformance operation, which drives the real
  `AuthoritySyncClient` against a real `AuthorityService` over an in-process
  transport: a case states what the device wrote locally, what the authority held,
  and what the drain left in the queue *and* on every record. "One verdict settles
  every step" is now corpus-stated rather than TypeScript-only. Its successors are
  recorded in [[conformance-suite]]: one reconcile round per case, one resolution
  applied to every settled entry, no delivery-failure state, and no operation for
  `discardRefusedRecord`.
- **The operation log is not observable.** "A command's steps are logged but not
  queued" is half-provable: the corpus shows they are not queued, never that they
  are logged. Wants a `readOperationLog` operation.

## Practical guidance

- A scratch end-to-end run against the real `AuthorityService` over
  `InMemoryObjectStorageBackend` found the empty-selection defect in minutes,
  before any test file existed. The full loop — execute offline, inspect the
  queue, print the intent, replay, read the server rows back — is cheap and
  answers "does the mechanism work" far earlier than a suite does.
- A fake that echoes back whatever ids it was given proves nothing about
  adoption; this is the same warning
  `learnings/implementation/offline-operation-identity.md` records against the
  Phase 47 hermetic fake, and it applies per step here rather than once.
- When a phase changes an intent variant, `npx tsc --noEmit` finds the typed call
  sites but not raw JSON bodies in integration tests. Grep for `kind: "command"`
  as well.
- `src/compiler/validate-model.ts` and `src/conformance/runner.ts` both contain a
  NUL byte, so plain `grep` treats them as binary and returns nothing silently.
  Use `grep -a`.
