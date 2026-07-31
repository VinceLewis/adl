# Phase 58 - Record Sync State and Refused-Write Visibility

> **Phase 57 handoff (accepted).** Phase 57 made a model-declared command replay
> to the authority as a command: one queue entry, one `command` intent, one
> operation id, with a client-supplied record id per step and per iteration item
> so the authority's re-execution adopts the ids the device already holds. It
> also fixed the selected contexts an operation replays against, and refused at
> compile time a command whose steps disagree about sync queueability.
>
> **This phase is the highest-value remaining gap repository-wide, and Phase 57
> is part of why.** That is the justification, and here is the rest of it.
>
> Phase 57 completed the *server-visible* half of the sync loop: work the device
> did offline now reaches the authority intact. It did nothing for the
> *device-visible* half, and it made one part of it materially worse.
>
> A refused write leaves its local records behind. That is deliberate — Phase 47
> ruled that no recovery primitive invents a winner, and a compensating local
> rollback would be a third primitive that does — and it was survivable while the
> unit of refusal was one record. Phase 57 made the unit of refusal a whole
> command: a refused `CreateBand` now strands a band *and* its founder
> membership, a refused `ImportSongs` strands every song in the batch. The user
> is told the change was refused, and is not told that the rows it wrote are
> still here and will never leave.
>
> Underneath that is a larger and older defect, which the search for this phase
> found and which is not specific to commands at all: **the platform declares a
> per-record sync state and never produces one.** Three of the five values in
> `SyncStatus` have no writer anywhere in the runtime, `_syncStatus` is a
> required platform metadata field that can only ever hold two of them, and the
> one shell control named for it shows something else entirely. A record that was
> refused, a record in conflict, a record queued and waiting, and a record that
> was never going anywhere are all `"local"` and all look identical.
>
> Nothing else in the repository is close. The remaining recorded gaps are each
> real and each strictly smaller: `import` is a policy action with no invocation
> site (a capability nobody can reach — no deployed behaviour is wrong); there is
> no policy action for administering a context (narrower, and the administration
> surfaces are already role-gated); relationship-aware sync scope is an addition
> rather than a defect. Two candidates were investigated and **disproved** during
> this handoff, and that is recorded below so a later phase does not chase them
> again.

## Objective

Give every record an honest, produced sync state, and make a write the authority
refused visibly local rather than silently indistinguishable from a write that
simply has not been sent yet.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **Three of five declared sync states have no producer.**
  `SyncStatus = "local" | "pending" | "synced" | "conflict" | "rejected"`
  (`src/model/resolved-model.ts`). Across the whole of `src/`, the only writers
  are `syncStatus: "local"` when a record is built
  (`src/runtime/object-store.ts:800`, `:819`, `:836`) and
  `syncStatus: "synced"` when a remote record is reconciled
  (`src/runtime/object-store.ts:278`, and `src/server/access-lifecycle.ts:505`).
  `"pending"`, `"conflict"` and `"rejected"` are written nowhere. This is the
  same class of defect Phase 56 named for `import`: a declared capability with no
  call site. Here it is worse, because the field is *required* and every record
  carries a value that is silently only ever one of two.
- **The gap is reachable from a model.** `_syncStatus` is a required platform
  metadata field (`src/model/defaults.ts:291`, "Local synchronisation state for
  the record"), and `OfflineDatasetService` resolves it as an expression input
  (`src/runtime/offline-dataset-service.ts:559`). A model that filters or
  displays on `_syncStatus` is reading a field whose vocabulary the runtime does
  not honour.
- **The one control named for it shows connectivity instead.** The reference app
  declares `CONTROL syncStatus KIND syncStatus PLACEMENT topBar`
  (`src/reference/giggle-band/ui.adl:12`, wired into `TOP_BAR` on line 14), and
  `AdlAppElement.renderShellControl` (`src/ui/components/adl-app.ts:1617`)
  renders `context.online ? "Online" : "Offline"` for it. It never reads a
  record. So the platform's only shipped sync-state surface answers a different
  question from the one it is named after, and no surface answers the record
  one.
- **A refused write's residue has no path out.** `AuthoritySyncClient.reconcile`
  keeps the queue entry and its verdict; `resolveRecovery` with `keepServer`
  removes the entry. The local records are untouched by both, and a bootstrap
  cannot remove a record the server never had. After the user dismisses the
  verdict, nothing anywhere records that those rows were refused.
  `learnings/implementation/offline-operation-identity.md` records this for a
  create; `learnings/implementation/command-intent-replay.md` records that
  Phase 57 multiplied it by the step count.
- **Phase 57 supplies the missing input.** A queued command entry carries
  `LocalCommandOperation.records` — every record the command wrote — precisely so
  a verdict can be reported over all of them. Nothing consumes it yet beyond the
  recovery item's `recordCount`. The data needed to mark a whole refused
  command's records already exists on the entry.

### Two candidates investigated and disproved

Recorded so they are not chased again, per
`learnings/process/phase-execution.md` ("verify a phase's evidence before
executing it").

- **"Offline dataset selection does not know about read-model joins"**, listed as
  a remaining gap in the Phase 57 non-goals, does not reproduce. A scratch run
  over the Giggle Band model created a bandmate's `Availability` and evaluated
  `ApplicationRuntime.evaluateOfflineDataset` as the founder: the bandmate's
  record **is** offline-eligible, with reason
  `readModelSource/BandMemberAvailability/availability/all`. The `SCOPE all`
  source path in `recordMatchesReadModelSourceContext`
  (`src/runtime/offline-dataset-service.ts:324`) admits it. If a gap remains here
  it is over-inclusion, not the under-inclusion that would have made
  `BandMemberAvailabilityBoard` wrong offline.
- **"The multi-hop join projects the wrong rows"** also does not reproduce. The
  same scratch run executed `BandMemberAvailability` online and got exactly two
  correctly paired rows — `user-founder`/`Available` against the founder's own
  record, `user-mate`/`Unavailable` against the bandmate's.

This phase depends on Phase 47 (the recovery primitives and the rule that
neither invents a winner), Phase 48 (client-supplied record ids, and the finding
that a rejected create leaves its row behind), and Phase 57 (the command entry's
record list, and the enlarged blast radius that makes this worth doing now).

## Scope

- Produce the declared sync states. A record whose write is queued and unanswered
  is `pending`; a record whose operation the authority refused is `rejected`; a
  record whose operation the authority answered with a conflict is `conflict`;
  reconciled accepted state stays `synced`; a record with no queued operation and
  no verdict stays `local`.
- Apply a command's verdict to **every** record it wrote, using the record list
  the Phase 57 queue entry already carries.
- Keep the state after the queue entry is gone. Dismissing a verdict removes the
  entry; the record must still know it was refused, so this state lives on the
  record rather than being derived from the queue.
- Surface it. The `syncStatus` shell control must answer the question it is named
  for, and a record that is refused or in conflict must be distinguishable in the
  surfaces that list records. Decide deliberately whether connectivity keeps a
  control of its own, and say so.
- Give a refused record a deliberate way out that is a local action and not a
  recovery primitive: discarding it is a local delete the user asks for, and it
  must not be dressed up as a sync resolution.
- Make `_syncStatus` honest as an expression input, so a model filtering on it
  gets the vocabulary the specification promises.

## Constraints

- **No new recovery primitive.** Phase 47's rule stands: `keepServer` and
  `resubmitMine` are the only two, and neither invents a winner. Marking a record
  as refused is reporting, not resolving.
- **Do not delete user rows on inference.** Phase 48's rule stands: before
  writing code that removes local rows to repair a defective state, establish
  that the state exists somewhere that survives. Discarding a refused record is a
  user action, never a sweep.
- A record's sync state is device-local and must never be asserted by a client to
  the authority, nor accepted from one. It is not part of the intent contract.
- The state must survive a reload. It belongs with the record in
  `ObjectStorageBackend`, not only in memory.
- Reconciliation must be able to clear it: a `resubmitMine` that the authority
  accepts must leave the record `synced`, with no residue of the earlier verdict.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope/retention,
  Phase 54 membership scoping, Phase 56 capabilities and Phase 57 command replay.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  authority-touching behaviour must be proven against real PostgreSQL under
  `tests/integration/`.

## Deliverables

- Runtime production of `pending`, `conflict` and `rejected` record sync states,
  covering a command's whole record set as one.
- Persistence of the state across a reload, and its clearing on acceptance.
- A `syncStatus` shell control that reports record sync state, and record-level
  presentation of a refused or conflicted record wherever records are listed.
- A user-initiated discard for a refused local record, distinct from the two
  recovery primitives.
- `_syncStatus` honest as an expression and offline-dataset input.
- Conformance cases, specification updates, and real-PostgreSQL integration
  coverage.
- Learnings updates: `implementation/usable-sync-slice.md`,
  `implementation/offline-operation-identity.md` and
  `implementation/command-intent-replay.md` each record this residue as an open
  gap and must be updated to record its closure.

## Acceptance Criteria

- A record whose write is queued and unanswered reports `pending`, and reports
  `synced` once the authority accepts it.
- A record whose write the authority refused reports `rejected`, and still
  reports it after the user dismisses the verdict and after a reload.
- Every record a refused command wrote reports `rejected`, not just the one the
  queue entry was filed under.
- A conflicted record reports `conflict`, and a `resubmitMine` the authority
  accepts leaves it `synced` with no residue.
- The `syncStatus` shell control reports record sync state, and a refused record
  is visibly distinguishable from an unsynced one in a list.
- Discarding a refused record removes it locally and is not reachable through the
  recovery primitives.
- A model expression over `_syncStatus` observes the produced vocabulary.
- Nothing about a record's sync state crosses the wire in either direction,
  proven by a test.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `administration` and `passkey` screenshots as well as `desktop`/`mobile`.

## Non-goals

- A local rollback or compensating transaction for a refused command. The
  decision that a refused command leaves its records in place is Phase 57's and
  stands; this phase makes that state *visible*, not automatic.
- CRDT/Automerge replication, a new sync protocol, or a second runtime.
- The other recorded gaps (`import` with no call site, an administration policy
  action, relationship-aware sync scope). Each is real; none belongs in the
  middle of this one.

## Dependencies

- Phase 47 conflict and rejection recovery primitives.
- Phase 48 offline operation identity.
- Phase 53 sync-mode delivery.
- Phase 57 command intent replay and the command entry's record list.

## Parallel Execution Plan

Serial spine first:

1. The record sync-state transitions in one pass — where `pending`, `conflict`
   and `rejected` are written, how a command's record set is covered, how the
   state is persisted and cleared. Types, signatures and the transition table
   only, with no consumers. `src/model/resolved-model.ts`,
   `src/runtime/object-store.ts` and `src/server/sync-client.ts` are all in this
   pass; every downstream stream depends on the shape, so predicting it would
   waste them.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- Shell control and record-level presentation (`src/ui/components/`, shell
  chrome, CSS).
- The discard action and its runtime path.
- `_syncStatus` as an expression and offline-dataset input.
- Conformance cases, the runner extension and the specification.
- Real-PostgreSQL integration coverage.

Keep serial: `src/model/resolved-model.ts`, `src/index.ts`,
`src/ui/components/register.ts` and shell chrome, ordered migration SQL, the
conformance runner and case schema, reference app fixtures, and specification
updates that must reconcile all streams.

Barriers: one `npm run test:integration` after the runtime and UI streams are
both in, then one `npm run verify:push` with manual screenshot inspection.

Two files in this repository contain a NUL byte, so plain `grep` treats them as
binary and returns nothing silently: `src/compiler/validate-model.ts` and
`src/conformance/runner.ts`. Tell every agent to use `grep -a`.

## Tasks

1. Define and implement the record sync-state transitions in one serial pass,
   including how a command's whole record set is covered and how the state is
   persisted and cleared.
2. Apply a verdict to every record a command wrote, using the queue entry's
   record list.
3. Make the `syncStatus` shell control report record sync state, and decide
   deliberately what happens to the connectivity indicator it currently is.
4. Present a refused or conflicted record distinguishably wherever records are
   listed.
5. Add a user-initiated discard for a refused local record, outside the recovery
   primitives.
6. Make `_syncStatus` honest as an expression and offline-dataset input.
7. Add conformance cases and specification coverage; update
   `learnings/implementation/usable-sync-slice.md`,
   `offline-operation-identity.md` and `command-intent-replay.md`, each of which
   currently records this as an open gap.
8. Add real-PostgreSQL integration coverage for the states a verdict produces,
   including a refused command covering every record it wrote.
9. **Required next-phase planning handoff:** before Phase 58 closes, write
   `docs/phases/phase-59-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. If no gap
   justifies a further phase, record that conclusion explicitly instead. Then
   verify, commit, and push Phase 58.
