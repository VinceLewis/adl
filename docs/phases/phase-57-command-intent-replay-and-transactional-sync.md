# Phase 57 - Command Intent Replay and Transactional Sync

> **Phase 56 handoff (accepted).** Phase 56 closed every gap the Giggle Band
> reference app had been documenting since Phase 18, as seven generic
> capabilities: context grants, multi-hop read-model joins, command-established
> contexts, reorderable and self-compacting ordered collections, batch commands,
> the `contextMember` policy principal, and navigation-drawer chrome. It also
> settled the `StreamingLink` sync mode, stopped the demo seeding into a
> deployment that has a real source of truth, and reconciled the planning and
> architecture documentation.
>
> **This phase is the highest-value remaining gap repository-wide, and Phase 56
> is what made it so.** That is the justification, and here is the rest of it.
>
> Before Phase 56, "a command replays as one intent per step" was a recorded
> cost with no demonstrated victim. `AcceptBandInvitation` split into an update
> and a create usually converged, and
> `learnings/implementation/offline-operation-identity.md` filed the lost
> atomicity as "separate pre-existing work".
>
> Phase 56 delivered two capabilities that depend on the transaction the split
> destroys, and one of them is now demonstrably broken across the sync boundary
> rather than merely weaker:
>
> - `CreateBand` uses `ESTABLISHES CONTEXT`, which is transaction-local by
>   design. Replayed as separate intents, the authority refuses the membership
>   create for a band the same command just created — the caller is not a member
>   of a context whose only membership record is the one being refused. There is
>   no ordering, retry or policy change that escapes this; the transaction *was*
>   the mechanism.
> - A batch command replayed as N intents can land partially. The whole reason
>   batch commands exist is that fifty independent transactions have no shared
>   success or failure.
>
> Both are pinned in `tests/command-authority-replay.test.ts`, including the
> negative case, and both work correctly when submitted as the `command` intent
> the authority already supports. **The authority side exists. What does not
> exist is a client that emits it.**
>
> Two further findings from Phase 56 belong in this phase's scope because they
> are the same subject:
>
> - `AuthorityService` shaped an accepted write's response against the caller's
>   *pre-write* access, so a command that made the caller a member returned a
>   rejection for records that had already committed. Phase 56 fixed this
>   (`shapingContext`), and the fix is a hint about the wider problem: identity
>   and access change *during* a transaction, and the replay path assumes they do
>   not.
> - `sync-client.ts` derives `selectedContexts` from the caller's context **at
>   sync time**, not at operation time. For an offline queue drained later that
>   is already a latent correctness problem independent of commands.
>
> Nothing else in the repository is close. The remaining recorded gaps —
> `import` having no runtime call site, no policy action for administering a
> context, offline dataset selection not knowing about read-model joins, sync
> scope having no relationship-aware option — are each real and each strictly
> smaller, and none of them makes a shipped capability incorrect in a
> deployment.

## Objective

Make a model-declared command replay to the authority as a command, so the
atomicity, ordering and identity a command has locally survive the sync boundary
intact.

## Evidence and Dependency

- **The client cannot express a command.** `LocalOperationKind` in
  `src/model/resolved-model.ts` is `"create" | "update" | "delete" |
  "transition"`. `ObjectStore.commitPlannedTransaction` records one ordinary
  operation-log entry per write, tagged with `commandName`, `commandLabel`,
  `commandStep` and a shared `commandTransactionId`, and `SyncQueue` enqueues
  each separately. `toIntent` in `src/server/sync-client.ts:429` maps each to a
  per-record intent and can never produce `kind: "command"`.
- **The authority can already accept one.** `AuthorityOperationIntent` has a
  `command` variant (`src/server/authority-types.ts`), `AuthorityService.apply`
  dispatches it to `runtime.executeCommand`, and `authority-http.ts` accepts it
  over the wire. `tests/command-authority-replay.test.ts` proves a
  context-establishing command and a batch import are both accepted through it,
  and that the same work split into per-record intents is refused.
- **Record identity is the hard part, and half of it is solved.** Phase 48
  established that a create carries the id the client already holds, so accepted
  state converges onto the local row instead of arriving as a second one. A
  command intent re-executes the command *server-side*, so every record it
  creates would be minted server-side and diverge from the ids the device is
  already holding. `learnings/implementation/offline-operation-identity.md`
  states the requirement precisely: "If a future phase makes commands replayable
  as commands, each step needs a client-supplied id."
- **An iterating step multiplies the problem.** A `FOR EACH` step writes one
  record per item, so "the id for step N" is now "the id for item M of step N".
  Whatever carries ids must be shaped for that, and it must survive a partial
  local execution being replayed after a reload.
- **Context selection is captured at the wrong time.** `toIntent` reads
  `selectedContexts` from the context passed at drain time. A queue drained after
  the user switched contexts, or after a reload, replays writes against a
  selection that was not in force when they were made.

This phase depends on Phase 48 (client-supplied record ids), Phase 53 (which
modes queue and reach the authority), Phase 54 (membership projection), and the
Phase 56 capabilities that made the gap material.

## Scope

- Add a `command` local-operation kind, so a locally executed command produces
  one queue entry describing the whole command rather than one per write.
- Carry the record ids the local execution minted, per step and per iteration
  item, so the authority's re-execution adopts them instead of minting its own.
- Emit the `command` intent from `AuthoritySyncClient`, and reconcile the
  authority's accepted records back onto the local rows.
- Capture the context a command was executed in at execution time, and replay it
  with that context rather than the one in force when the queue drains.
- Decide and implement what a rejected or conflicted command does to the local
  records all of its steps wrote, since they now succeed or fail together.
- Keep every existing per-record intent path working unchanged for writes that
  did not originate in a command.

## Constraints

- **No new transport or protocol.** The `command` intent, the HTTP edge and the
  outcome store already exist; this phase fills the client half.
- The authority remains the enforcement point. A command intent must re-run
  policy, validation, lifecycle, scope, constraints and command preconditions
  server-side exactly as a local execution does. A client-supplied id is a name,
  never an authorisation.
- Idempotency must hold for the whole command under one `operationId`: a retry
  returns the stored outcome and writes nothing twice, including every item of an
  iterating step.
- A client-supplied id must be shape-checked and refused when already taken,
  exactly as Phase 48 does for a create. A command must not become a way to
  claim ids that a direct create would be refused.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope/retention,
  Phase 54 membership scoping, and the Phase 56 capabilities.
- Every semantic change needs conformance cases, per the Phase 51/52 contract,
  and authority behaviour must be proven against real PostgreSQL under
  `tests/integration/`.

## Deliverables

- A `command` local operation and queue entry carrying the command name, input,
  execution context and per-step/per-item record ids.
- `AuthoritySyncClient` emitting `kind: "command"` for command-originated work,
  with per-record intents unchanged for everything else.
- Authority-side adoption of client-supplied ids across every step and iteration
  of a replayed command.
- Reconciliation and recovery behaviour for a command outcome that covers all of
  its records together.
- Conformance cases, specification updates, and real-PostgreSQL integration
  coverage.
- An updated `learnings/implementation/offline-operation-identity.md`, which
  currently names this as future work.

## Acceptance Criteria

- A command executed offline replays as exactly one `command` intent and one
  `operationId`.
- `CreateBand` executed offline is accepted by the authority on reconnect, and
  the founder's membership exists server-side — the case that fails today.
- Every record a replayed command creates keeps the id the device minted,
  including every item of a `FOR EACH` step, so nothing arrives as a duplicate
  row.
- A rejected command leaves no partially accepted state at the authority, and the
  device's recovery surface presents the command as one rejected change rather
  than as several unrelated ones.
- Replaying the same command twice writes nothing twice and returns the stored
  outcome.
- A command replays against the context it was executed in, not the one in force
  when the queue drained.
- A write that did not originate in a command replays exactly as it does today,
  proven by the existing tests continuing to pass unchanged.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `administration` and `passkey` screenshots as well as `desktop`/`mobile`.

## Non-goals

- CRDT/Automerge replication, a new sync protocol, or a second runtime.
- Making lifecycle transitions or ad-hoc multi-record writes transactional across
  the sync boundary; this phase is about model-declared commands only.
- The other recorded gaps (`import` with no call site, an administration policy
  action, join-aware offline dataset selection, relationship-aware sync scope).
  Each is real; none belongs in the middle of this one.

## Dependencies

- Phase 48 offline operation identity and client-supplied record ids.
- Phase 35 command transaction semantics.
- Phase 53 sync-mode delivery.
- Phase 56 batch commands and command-established contexts.

## Parallel Execution Plan

Narrower than Phase 56: this is one mechanism threaded through a chain, and most
of it is sequential by nature.

Serial spine first:

1. The operation/queue/intent shape in one pass — `LocalOperationKind`, the
   `command` operation-log entry, the queue entry, and the id manifest carried
   with it. Types and signatures only, no consumers. Everything downstream
   depends on this shape, so predicting it would waste every parallel stream.

Fan out after the spine:

- Client emission: `ObjectStore`/`OperationLog`/`SyncQueue` recording a command
  as one entry.
- `AuthoritySyncClient` intent construction and outcome reconciliation.
- Authority-side id adoption in `AuthorityService`/`CommandService`.
- The recovery surface presenting a command outcome as one change.
- Conformance cases and specification.

Keep serial:

- `src/model/resolved-model.ts`, `src/index.ts`, ordered migration SQL, the
  conformance runner and case schema, and the reference app.

Barriers: one `npm run test:integration` after the authority and client streams
are both in, then one `npm run verify:push` with manual screenshot inspection.

Use worktree isolation for any two agents that would write the same directory.

## Tasks

1. Extend the operation, queue and intent shapes for a command, including the
   per-step and per-item record id manifest, in one serial pass.
2. Record a locally executed command as one operation-log and queue entry,
   capturing its execution context.
3. Emit the `command` intent from the sync client and reconcile the whole
   accepted record set back onto local rows.
4. Adopt client-supplied ids for every record a replayed command writes, refusing
   a malformed or already-taken id as a create does.
5. Define and implement rejection/conflict recovery for a command as a unit.
6. Add conformance cases and specification coverage; update
   `learnings/implementation/offline-operation-identity.md`.
7. Add real-PostgreSQL integration coverage for command replay, including
   idempotent retry and a refused id collision.
8. **Required next-phase planning handoff:** before Phase 57 closes, write
   `docs/phases/phase-58-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. If no gap
   justifies a further phase, record that conclusion explicitly instead. Then
   verify, commit, and push Phase 57.
