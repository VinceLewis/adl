# Phase 53 - Sync Mode Delivery and Authority Coherence

> Inserted by the Phase 52 handoff and accepted, which renumbered the former
> phases 53, 54 and 55 to 54, 55 and 56. Phase 52 gave the conformance corpus a
> way to observe a sync-write decision together with the queue that write left
> behind, and the first thing it showed was that a whole sync mode has no
> delivery path at all. This phase closes the gap between what a `SYNC` mode
> declares and what the client and authority actually do with it.

## Objective

Make every declared sync mode's relationship to the authority complete and
stated: a write the runtime accepts either has a path to the authority or is
declared not to have one, and a record the authority accepts either has a path
back to a device or is refused.

## Evidence and Dependency

- **An `onlineRequired` write never reaches the authority.**
  `SyncQueue.enqueue` (`src/runtime/sync-queue.ts:56`) skips every object whose
  mode is not `localFirst`. `AuthoritySyncClient.reconcile`
  (`src/server/sync-client.ts:77`) iterates `syncQueue.getReplayable()` and
  nothing else, and `src/ui/authority-sync.ts` has no other push path. So an
  `onlineRequired` create made **while online** — the only time the mode permits
  one — is validated, policy-checked, persisted locally, written to the
  operation log, and then silently never sent. The class comment on
  `AuthoritySyncClient` states the `localPrivate` exclusion explicitly and is
  silent about `onlineRequired`, which reads as an oversight rather than a
  decision.
- **This is reachable in the reference application.**
  `src/reference/giggle-band/domain.adl:80` declares `BandInvitation` with
  `SYNC ONLINE_REQUIRED SCOPE currentContext`. A band invitation created in the
  deployed Giggle Band app is therefore written locally and never delivered, and
  no surface tells anyone. Phase 46 and Phase 47 made this a real deployment
  with a real client, so this is a live data-delivery defect rather than a
  latent one.
- **`localPrivate` has the opposite asymmetry.** The authority *accepts* a
  `localPrivate` write and then filters those records out of every bootstrap
  (`src/server/authority-service.ts:85`), so an accepted record can exist that no
  device will ever read back. `cacheReadonly` is refused symmetrically. This was
  recorded before Phase 52 and deferred by it, because a conformance case
  written against current behaviour would have pinned whichever answer this
  phase has not yet chosen.
- **The corpus can now state the answer.** Phase 52 added the `syncWrite`
  operation, which reports a write's decision *and* the resulting sync queue, so
  whatever this phase decides becomes assertable rather than an implementation
  detail. `conformance/runtime/sync-write-queue.json` deliberately does not
  assert the online `onlineRequired` queue, precisely so this phase is free to
  decide it.

This phase depends on Phase 47's sync client and recovery model, Phase 48's
record-identity contract, and Phase 52's `syncWrite` corpus operation.

## Scope

- Decide and implement what happens to an accepted `onlineRequired` write. The
  two candidate semantics are: queue it like `localFirst` (the mode then differs
  only in refusing offline writes), or send it synchronously and fail the write
  when delivery fails (the mode then means "this write is not complete until the
  authority has it"). Whichever is chosen, it must be stated in
  `docs/spec/runtime-semantics.md` and pinned by conformance cases.
- Decide and implement the `localPrivate` asymmetry at the authority: either
  refuse the write with `ADL_SYNC_POLICY_DENIED`, symmetrically with
  `cacheReadonly`, or state in the specification why an accepted record that no
  bootstrap returns is correct.
- Audit the remaining mode/authority pairs for the same class of gap, so this is
  a systematic pass rather than two point fixes: for each of the four modes,
  state what the client sends, what the authority accepts, and what a bootstrap
  returns, and make any silence deliberate.
- Surface delivery state where a mode's writes can fail to deliver. A write that
  cannot reach the authority must be visible to the user in the same way a
  rejected or conflicted queue entry already is; silently-undelivered is the
  defect being fixed, and re-creating it under a different name would not be a
  fix.
- Conformance cases for every decided behaviour, and the specification updates
  that go with them.

## Constraints

- Do not weaken the Phase 47 recovery model. A rejection or conflict must stay
  visible and recoverable; a transport failure is not a verdict and must leave
  the operation replayable.
- Do not weaken Phase 44 atomicity or Phase 48 record identity. In particular,
  the client continues to name a record and the authority continues to refuse a
  colliding id.
- Whatever is decided must be expressible against any conforming runtime.
  Phase 52's rule stands: no case may pin a generated revision, id, digest or
  timestamp, and `tests/conformance-suite.test.ts` now checks this mechanically.
- If a case reveals a semantic defect, fix the defect and record it rather than
  adjusting the case.
- Offline behaviour must not regress: `localFirst` still queues offline and
  `onlineRequired` still refuses offline writes.

## Deliverables

- The `onlineRequired` delivery path, implemented and specified.
- The `localPrivate` authority decision, implemented and specified.
- A mode-by-mode statement in `docs/spec/runtime-semantics.md` of what each sync
  mode sends, what the authority accepts, and what a bootstrap returns.
- Conformance cases covering each decided behaviour, extending
  `conformance/runtime/sync-write-queue.json` and the authority corpus.
- Reference-app verification that a Giggle Band invitation now reaches the
  authority, and a `learnings/` update.

## Acceptance Criteria

- An `onlineRequired` write made while online reaches the authority, or is
  refused; it is never accepted locally and silently dropped. Proven by a test
  that drives the real client against the real authority, not only by a unit
  test of the queue.
- A `localPrivate` write's treatment at the authority is symmetrical with a
  stated rule, and the corpus distinguishes it from every other mode.
- Every sync mode has a stated answer for send, accept and bootstrap, with no
  mode left silent.
- A write that cannot be delivered is visible to the user rather than lost.
- Phase 47 recovery, Phase 48 identity and Phase 44 atomicity regression tests
  still pass, including the real PostgreSQL integration suite.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`; run `npm run verify:push` if any
  delivery-state surface changes browser rendering.

## Non-goals

- A new sync protocol, transport or wire format. This phase closes gaps in the
  existing one.
- The authority membership projection (Phase 54), retention scheduling
  (Phase 55), and reference-app and documentation hygiene (Phase 56).
- Background or automatic reconciliation scheduling. When delivery happens is a
  separate question from whether a path exists at all.
- Revisiting the conflict-resolution strategies, which Phase 47 settled.

## Dependencies

- Phase 47's sync client, queue recovery model and browser bridge.
- Phase 48's record-identity contract.
- Phase 52's `syncWrite` conformance operation and the sync-mode specification
  text it added.

## Parallel Execution Plan

Serial spine first, in one pass with no consumers:

1. The decision itself, written into `docs/spec/runtime-semantics.md` as the
   mode-by-mode table, because every downstream stream needs to agree on it.
2. `SyncQueue` / `SyncPolicyService` / `AuthoritySyncClient` changes, which are
   one connected path and must not be split across agents.

Fan out after the spine:

- Authority-side `localPrivate` handling and its integration tests.
- Conformance cases for the decided client behaviour.
- Conformance cases for the decided authority behaviour.
- The delivery-state UI surface and its browser tests.
- Reference-app verification of the `BandInvitation` path.

Keep serial: `src/index.ts` exports, `src/ui/components/register.ts` and shell
chrome, the conformance runner if it needs extending, and the specification
update.

Barriers: one `npm run test:integration` run after the authority and client
changes land. `npm run verify:push` exactly once at the end, and only if a
delivery-state surface changed rendering.

## Tasks

1. Inventory every sync mode against send, accept and bootstrap, and record what
   each does today before changing anything.
2. Decide the `onlineRequired` semantics and the `localPrivate` authority
   answer, and write both into the specification first.
3. Implement the client-side delivery path and the authority-side decision.
4. Add conformance cases for every decided behaviour, recording rather than
   absorbing any defect they reveal.
5. Add the delivery-state surface and prove an undeliverable write is visible.
6. Verify the reference app's `BandInvitation` path end to end.
7. **Required next-phase planning handoff:** before Phase 53 closes, review
   `docs/phases/phase-54-authority-membership-projection-and-scoped-access.md`
   and revise it if this phase's results change its scope, constraints,
   deliverables, or tasks. The handoff must justify Phase 54 as the
   highest-value remaining gap **repository-wide**, not merely the next gap in
   the subsystem this phase touched; if a higher-value gap exists elsewhere, say
   so and re-sequence. Then verify, commit, and push Phase 53.
