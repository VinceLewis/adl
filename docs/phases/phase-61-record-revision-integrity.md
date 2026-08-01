# Phase 61 - Record Revision Integrity Across Process Lifetime

> **Phase 60 handoff (proposed).** Phase 60 finished the edit-surface capability
> Phase 59 shipped: a child collection whose children have fields of their own is
> editable in the browser through the platform's real field renderer, an inline
> row edit carries a real patch and commits inside the staged batch, `unlink` is
> refused at compile time where no model could satisfy it, the resolver's default
> operation set is one every model can honour, and `EDIT_CONTAINER` is resolved
> from the form that opens.
>
> **This phase is the highest-value remaining gap repository-wide, and it was
> found while executing Phase 60**, by the agent writing real-PostgreSQL coverage
> for a batch containing an inline child edit. It was then verified
> independently, twice, before this document was written. Every alternative below
> was re-checked against the code at the same time.
>
> It wins because it is the only known defect in this repository that **silently
> accepts a write the platform promises to refuse**. Everything else outstanding
> is a capability that does not exist yet, or a declaration a model cannot use.
> This is the optimistic-concurrency check — the mechanism the whole offline sync
> loop rests on — failing open after an ordinary process restart.

## Objective

Make a record revision mean what every consumer already assumes it means: a
value that identifies one version of one record, never reissued, never moving
backwards, across process restarts and across every runtime that writes to the
same persisted state.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **The revision counter is process-local and never rehydrated.**
  `src/runtime/object-store.ts:153` declares `private nextRevisionId = 1`, and
  `nextRevision()` (`:1470`) returns `` `rev-${this.nextRevisionId++}` ``. Nothing
  seeds it from persisted state — `grep -an nextRevisionId src/runtime/object-store.ts`
  returns those two lines and nothing else.
- **Revisions therefore go backwards.** Verified directly: a record created and
  updated three times through one `ApplicationRuntime` over an
  `InMemoryObjectStorageBackend` reaches `rev-4`; a second `ApplicationRuntime`
  constructed over the **same backend** updates the same record and it comes back
  as `rev-1`. The record is persisted with its revision
  (`src/server/postgres-object-storage.ts:152,166` write the column), so this is
  durable state, not a display artefact.
- **The conflict check compares those strings for equality.**
  `src/server/authority-service.ts:340` (`intent.baseRevision`) and `:409`
  (`write.baseRevision`, the batch path) both refuse a write when
  `record.meta.revision !== baseRevision`. Equality is the whole test — there is
  no ordering, no monotonicity, no per-record derivation.
- **The two facts together are a silent lost update.** A device holds record X at
  `rev-3`. The authority restarts, resetting the counter. Other devices write X
  three times, so X is at `rev-3` again — a different version wearing the same
  name. The stale write now passes the equality check and is accepted, silently
  overwriting three edits with no conflict, no `manualResolution` and no audit of
  anything unusual. Nothing in the system can detect this after the fact, because
  the two versions are indistinguishable by the only value that distinguishes
  versions.
- **The device side has the same counter.** A browser `ObjectStore` is
  constructed per session over persisted IndexedDB records, so local revisions
  restart at `rev-1` over records already holding higher ones, and a queued
  write's `baseRevision` is whatever that counter produced.
- **`rev-N` is pinned as a contract, not only as an implementation.** The shape
  appears 41 times in `conformance/`, and in `tests/storage-backend.test.ts`,
  `tests/record-identity.test.ts`, `tests/browser-model-migration.test.ts`,
  `tests/authoritative-reporting.test.ts`, `tests/passkey-identity.test.ts`,
  `tests/access-lifecycle.test.ts` and two integration suites. Nothing parses it
  numerically (`grep` for `parseInt`/`Number(` against revision returns nothing),
  so the value is already opaque in behaviour — but the corpus asserts the
  literal, which is what makes this a cross-runtime contract change rather than
  an internal fix.

This phase depends on `ObjectStore`'s write planning, on `AuthorityService`'s two
conflict checks, on the persisted-record shape in both PostgreSQL and IndexedDB,
and on the conformance corpus, which must stop asserting a literal it should
never have depended on.

### Candidates weighed and not chosen

Recorded with their evidence, per `learnings/process/phase-execution.md`.

- **`SCOPE recent` and `SCOPE custom` select nothing at all.** This was the
  drafted Phase 61 before the revision defect was found, and it remains the
  strongest candidate after it. `SYNC ... WINDOW` has **no syntax**: `parseSync`
  (`src/parser/parser.ts:3281`) accepts only `MODE`, `SCOPE` and `CONFLICT`, and
  `grep -an window src/parser/parser.ts src/compiler/compile-adl.ts` returns
  nothing — while `ResolvedSyncWindow` exists, `validate-model.ts` carries eight
  diagnostics for it, and `offline-dataset-service.ts` fully implements it.
  Because `recordMatchesRecentWindow` (`:482`) returns `false` when the window is
  undefined, an ADL model declaring `SCOPE recent` holds **zero** records on a
  device. `SCOPE custom` returns `false` unconditionally (`:287`) and the
  resolved model has nowhere to say what it means. Neither appears anywhere in
  `docs/spec/` or the conformance corpus. Supporting evidence:
  `DevicePreference.OfflineHomeLimit` (`src/reference/giggle-band/domain.adl:241`)
  is declared, seeded and rendered, and `grep -rn OfflineHomeLimit src/ tests/`
  shows nothing reads it — a per-device offline limit invented in the model
  because the model could not declare a sync window. Real, and the right next
  phase; it loses here only because a declaration that selects nothing is
  visible, while a conflict check that fails open is not.
- **`import` is a policy action and a runtime channel with no producer.**
  Re-verified: `grep -ran 'action: "import"' src/` and
  `grep -ran 'channel: "import"' src/` both return nothing, while `PolicyAction`
  (`src/model/resolved-model.ts:123`) and `RuntimeChannel` (`:133`) include it.
  Still real; still a feature that does not exist rather than one that
  misbehaves.
- **A lifecycle transition with side effects is still not transactional.** After
  Phase 57 (`command`) and Phase 59 (`batch`) this is the last multi-record write
  class that replays per record, recorded as open in
  `learnings/implementation/command-intent-replay.md`. Real, but no surface in
  this repository yet demonstrates a loss from it.
- **No policy action for administering a context.** Narrower; the administration
  surfaces are already gated server-side by `requireAdministration`.
- **Relationship-aware sync scope** remains an addition rather than a defect.

## Scope

- Make a revision unique for the life of the persisted state it describes, not
  for the life of the process that minted it. Either derive it from the record's
  own prior revision, or make it globally unique by construction, or rehydrate
  the counter from persisted state — but the chosen rule must hold for the
  authority, for a browser session, and for two runtimes over one backend.
- State the revision contract explicitly in the specification: what a runtime may
  assume about a revision, what it may not, and specifically that a revision is
  **opaque** and is compared only for equality.
- Prove the failure and the fix at the level it actually bites: a real
  PostgreSQL integration test in which an authority restart cannot make a stale
  `baseRevision` pass the conflict check.
- Free the conformance corpus and the test suite from the literal `rev-N` shape
  wherever the assertion is about identity rather than about that literal.
- Decide, and record, what happens to persisted records already carrying
  colliding revisions. A migration is not obviously required — revisions are not
  compared across records — but "not required" must be reasoned rather than
  assumed, and recorded either way.

## Constraints

- The resolved model and the persisted record shape are contracts. `meta.revision`
  is already a string in both backends; keep it one.
- Every failure path must leave persisted state exactly as it was. There is no
  "reset revisions" path and there must not be.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 50 session lifetime, Phase 54 membership scoping, Phase 57 command
  replay, Phase 58 record sync state, Phase 59 batch semantics and Phase 60
  edit-surface semantics.
- The fix must not require a network round trip or a database sequence read per
  write. The device mints revisions offline; whatever rule is chosen has to work
  there too.
- Do not rewrite `revision`, actor or timestamps on an existing record as a side
  effect. `learnings/implementation/model-versions-and-migrations.md` records why:
  a schema change that looks like a user's change breaks every audit surface and
  every client holding the prior revision.
- Anything touching the authority must be proven against real PostgreSQL under
  `tests/integration/`. A fake that pattern-matches SQL is never the correctness
  proof.
- Every semantic change needs conformance cases per the Phase 51/52 contract.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- A revision rule that survives process restart, implemented in `ObjectStore` and
  honoured by every path that mints one.
- A specification statement of the revision contract in
  `docs/spec/resolved-model.md` and `docs/spec/runtime-semantics.md`, including
  that revisions are opaque and equality-compared.
- Conformance cases that assert revision **behaviour** — that an update changes
  it, that a restart cannot reissue one, that a stale base revision conflicts —
  without asserting a literal.
- A real-PostgreSQL integration test proving a stale `baseRevision` cannot pass
  the conflict check across an authority restart, for both the single-intent path
  (`authority-service.ts:340`) and the batch path (`:409`).
- Browser-side coverage that a session restart does not reissue revisions over
  persisted IndexedDB records.
- A recorded decision on already-persisted colliding revisions.
- Learnings updates in `implementation/authority-server.md`,
  `implementation/offline-operation-identity.md` and
  `implementation/storage-backend.md`.

## Acceptance Criteria

- A record updated through one runtime and then through a freshly constructed
  runtime over the same backend never receives a revision it has already had, and
  never receives one lower than its current one — proven by a test that fails
  against today's behaviour, where `rev-4` becomes `rev-1`.
- A stale `baseRevision` is refused across an authority restart, against real
  PostgreSQL, on both the intent path and the batch path.
- No conformance case asserts the literal `rev-N` shape where what it means to
  assert is identity.
- The revision contract is stated in the specification.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots.

## Non-goals

- Vector clocks, CRDTs or any change to the conflict *strategy*. This phase
  repairs the identity a strategy is applied to; `serverWins`, `clientWins`,
  `stateTransitionWins` and `manual` all keep their current meanings.
- Offline dataset scoping (`SCOPE recent`, `SCOPE custom`, `SYNC ... WINDOW`).
  Recorded above with full evidence as the phase after this one.
- Bulk ingestion and the `import` policy action.
- A new sync protocol, a second runtime, or a change to record identity
  (`meta.guid`), which Phase 48 settled.

## Dependencies

- `ObjectStore.nextRevision` and every planning path that calls it.
- `AuthorityService`'s two `baseRevision` comparisons.
- `PostgresObjectStorage` and `IndexedDbObjectStorageBackend`, which persist the
  value unchanged.
- The conformance corpus and the eight test files pinning the `rev-N` literal.

## Parallel Execution Plan

Serial spine first, in one pass with no consumers:

1. The revision rule itself in `src/runtime/object-store.ts`, plus any type or
   signature it needs, with no test or corpus updates yet. This is the one change
   every other stream's expected output depends on, so it must land first and
   alone.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- Conformance corpus and runner: replace literal `rev-N` assertions with
  behavioural ones.
- The hermetic test files pinning the literal (`tests/storage-backend.test.ts`,
  `tests/record-identity.test.ts`, `tests/browser-model-migration.test.ts`,
  `tests/authoritative-reporting.test.ts`, `tests/passkey-identity.test.ts`,
  `tests/access-lifecycle.test.ts`) — one owner per file, and give the
  whole-list assertions to exactly one of them.
- Real-PostgreSQL integration coverage for the restart scenario.
- Specification and learnings.

Keep serial: `src/runtime/object-store.ts`, `src/model/resolved-model.ts`,
`src/index.ts`, ordered migration SQL, the conformance runner and case schema,
and specification updates that must reconcile all streams.

Barriers: one `npm run test:integration` after the runtime and corpus streams are
both in, then one `npm run verify:push` with manual screenshot inspection.

Hazards this repository has confirmed. `src/compiler/validate-model.ts` and
`src/conformance/runner.ts` each contain a NUL byte, so plain `grep` treats them
as binary and returns nothing silently — use `grep -a`, and check `grep -c`
against `grep -ac` on any file just written. Two agents editing adjacent facts
will disagree, so give any derived, whole-list assertion to exactly one owner.
And Phase 60's own finding: **when you change what a value is, change every
reader of it in the same pass** — a getter moved without its renderer produced a
surface that described a mode nothing implemented.

## Tasks

1. Replace the process-local revision counter with a rule that survives restart,
   in `ObjectStore`, and verify it holds for two runtimes over one backend.
2. Specify the revision contract, including opacity and equality comparison.
3. Free the conformance corpus and the hermetic suite from the `rev-N` literal
   where the assertion is about identity.
4. Prove the restart scenario against real PostgreSQL, on the intent path and the
   batch path.
5. Cover the browser side: a session restart over persisted IndexedDB records.
6. Decide and record what happens to already-persisted colliding revisions.
7. **Required next-phase planning handoff:** before Phase 61 closes, write
   `docs/phases/phase-62-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. The offline
   dataset scoping evidence above is recorded in full so it does not need
   re-deriving. If no gap justifies a further phase, record that conclusion
   explicitly instead. Then verify, commit, and push Phase 61.
