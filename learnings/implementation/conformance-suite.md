# Conformance Suite and Inspection Tooling

Read this before changing runtime semantics, resolved-model defaults, policy
decision behavior, or the executable conformance corpus.

## Key decisions from Phase 23

- The conformance corpus is versioned JSON under `conformance/`. It carries
  stable case ids, spec references, operation input, runtime context, and
  expected output.
- Shared models may live in a suite-level `models` map and be referenced by
  `modelRef`. This keeps data-driven cases readable while preserving a
  runtime-agnostic corpus.
- `src/conformance/runner.ts` is the TypeScript semantic harness. It executes
  corpus cases through public compiler/runtime surfaces and returns normalized
  pass/fail results. It is not a second runtime.
- The harness supports expression, model resolution, model validation,
  inspection, policy decision explanation, CRUD/search, lifecycle transition,
  command execution, decision tables, read models, offline dataset evaluation,
  sync-mode write denial, and startup compatibility cases.
- Dynamic record ids are normalized to setup aliases in conformance results, so
  cases can assert behavior without depending on generated GUID text.
- `explainResolvedModel` returns the resolved model plus origin entries for
  platform defaults, derived defaults, and source-supplied values. Supplying the
  partial source model gives the most precise origin classification.
- `explainPolicyDecision` and `explainPolicyRequest` expose the winning decision,
  reasons, request, context summary, and precedence category without changing
  authorization behavior.
- The three written spec layers live under `docs/spec/`: language syntax,
  resolved-model contract, and runtime semantics.

## Key decisions from Phase 29

- Presentation conformance cases live under `conformance/presentation/` and run
  through the same `tests/conformance-suite.test.ts` loader as the expression
  and runtime suites.
- The conformance runner supports `evaluatePresentationView` as a runtime
  operation. Cases seed records through public runtime create steps, then call
  `ApplicationRuntime.evaluatePresentationView` and assert renderer-neutral
  sections, controls, lists, rows, fragments, icons, state, diagnostics, and
  empty states.
- Presentation conformance remains DOM-free. Browser component tests can cover
  rendering, but the cross-runtime corpus pins model resolution, validation,
  inspection, and evaluator semantics.
- Inspection conformance can select presentation origin paths. `explainResolvedModel`
  now includes presentation defaults and reference-bearing declarations such as
  local state, icon-map fields, control state references, list sources, row
  fields, and fragment style defaults.

## Key decisions from Phase 51

- **Corpus files are discovered, not listed.** `tests/conformance-suite.test.ts`
  globs `conformance/*/*.json`. A corpus file that exists but is not run is
  indistinguishable from one that passes, and the suite is the cross-runtime
  contract — adding a case must not also require remembering to register it.
- Four operations were added: `compareModelFingerprints`, `migratePersistedState`,
  `authorityReplay`, and a `persistedModel` input on `startupCompatibility`.
- **A case must never hard-code a derived digest.** A literal `sha256-…` in the
  corpus would pin the entire resolved-model shape and break on any unrelated
  model addition, teaching a second runtime nothing. `compareModelFingerprints`
  asserts the *relation* between two models' fingerprints; `persistedModel` names
  the model that wrote persisted state and lets the runner derive the metadata.
  Reach for one of those instead of a literal, always.
- `migratePersistedState` reports the resulting records **read back from storage**
  rather than as returned by the migration, so a case proves what was persisted
  rather than what was intended. A refusal reports the same shape as a success,
  because the state a refusal left behind *is* the fail-closed guarantee.
- `authorityReplay` normalises an outcome to its classification plus record ids
  and values. Revisions, timestamps and actor ids are generated, so asserting the
  whole record would make every case a snapshot.
- Authority cases seed their setup **through the same replay path**, so nothing
  in a case bypasses the authority to arrange its preconditions.
- An expected value of `"$absent"` asserts the key is **not present**. Reach for
  it whenever the guarantee under test is that something was withheld: partial
  matching proves what a result contains, never what it omits.

## Defects the Phase 51 expansion revealed

Growing the corpus from 28 cases to ~470 found eleven real defects. Every one was
fixed in the runtime and pinned by a case; none was absorbed by weakening a case.
Recorded because the *shape* of these repeats:

1. **A digest that included its own selector.** `modelVersion` was inside the
   model fingerprint, so re-spelling `1.1` as `1.1.0` — the same version —
   changed the digest, the guard refused, and the only remedy it could name was
   itself a validation error. Excluded the version from the digest.
2. **String equality where the codebase compared component-wise.**
   `planModelMigration` tested `===` on versions while validation used
   `compareModelVersions`. Same class of bug as (1), found independently by two
   agents. Anything used as a map key or set member is now normalised first.
3. **Classification by prose.** `explainPolicyPrecedence` decided "was this a
   default deny?" by substring-matching the human-readable reason message, so a
   rule *named* "the default deny probe" made an explicit refusal report itself
   as `defaultDeny`. Now keyed on structure (the synthesised reason is the only
   one with no `ruleName`).
4. **A transaction that threw without aborting.** `IndexedDbObjectStorageBackend.commitTransaction`
   raised its own refusals without `abort()`, so IndexedDB auto-committed the
   writes already issued. Request errors abort on their own — a refusal you raise
   yourself has to say so. This one made a migration's own "persisted data is
   unchanged" diagnostic capable of lying.
5. **Validators that could never fail.** A named field validator whose kind did
   not suit the field type, or which omitted its bound, was silently inert with
   nothing reported at any layer — `MIN 5` on a text field did nothing. Now a
   compile-time error. A second runtime could have implemented it any way at all.
6. **A hard-coded policy flag.** The authority's missing-record conflict passed
   `manual: false` literally, so an object declaring manual conflict resolution
   had the update-versus-delete race resolved automatically, while the
   stale-revision path on the same object escalated.
7. **A grammar with no way to satisfy it.** `SCHEMA_VERSION` inside a `MIGRATION`
   block parsed, and was the worked example in the spec and in the parser's own
   doc comment, but `OBJECT` had no `SCHEMA_VERSION` directive — so the only
   legal value was the one that changes nothing, and the documented example was
   uncompilable.
8. **A number formatted for parsing.** `decimalFromNumber` used `toString()`,
   which switches to exponential below `1e-6`, so `0.0000001` failed the decimal
   grammar and reported `DECIMAL_OVERFLOW` — for a value inside the range, and
   for a reason that was an artifact of one language's formatting rather than of
   ADL.
9. **One temporal kind compared by spelling.** `time` was compared as raw text
   while `datetime` normalised through `Date.parse`, so `09:00 < 09:00:00`.
10. **A dead-ending migration chain that validated clean.** Bumping
    `MODEL_VERSION` and forgetting the `MIGRATION` block was discovered at
    startup on the one install still holding old data, though it is entirely
    statically decidable.
11. **A repository phase number in a cross-runtime error message** ("reserved for
    Phase 21 expansion"). A second runtime has no phases.

Two further inconsistencies were found, recorded in the spec, and deliberately
*not* changed, because altering equality semantics repo-wide is beyond a
conformance phase: ordering coerces text↔temporal while equality does not (and
field references never carry a temporal kind, so `SomeDateField == DATE '…'` is
always false while `>=` works), and datetime equality is textual while ordering
is instant-based. Both are now stated in `runtime-semantics#expression-errors`
as known sharp edges rather than left for a second implementer to discover.

## Key decisions from Phase 52

Phase 51 made the corpus broad; Phase 52 made it *articulate*. The binding
constraint had stopped being size and become what a case could say.

- **A setup step names its outcome, and its outcome is asserted.** An authority
  `setup` entry takes an `alias` and an `expect` (default `accepted`). Referring
  to `{"$ref": "<alias>.records.0.meta.revision"}` is how a case says "the
  revision this seed produced" without naming a format. Before this, five cases
  hard-coded `"rev-1"` — `ObjectStore.nextRevision()`'s output — and a conforming
  runtime minting ULIDs would have failed all five while being entirely correct.
- **A seed that fails must fail its case.** `runAuthorityReplayCase` used to
  discard setup outcomes, so a refused seed left the scenario running against an
  empty store and a rejection-expecting case passed because nothing was there.
  Exactly one existing case turned out to be seeding a deliberate refusal; every
  other seed is now *proved* accepted rather than assumed.
- **`syncWrite` reports the decision and the queue together.** A decision alone
  could never distinguish `localPrivate` from `localFirst`: a runtime could
  report `queueable: false` and queue the operation anyway. Reporting the queue
  the write left behind is what makes the mode contractual. Verified by mutation
  — making `SyncQueue.enqueue` treat `localPrivate` as `localFirst` fails six
  cases.
- **`input.storage` selects the migration's storage behaviour**
  (`transactional`, `nonTransactional`, `failingCommit`, in
  `src/conformance/storage-behaviours.ts`). The default backend always commits,
  so the fail-closed half of `ADL_MIGRATION_FAILED` — the half that matters —
  had no way into the contract.
- **`readPersistedRecords` observes storage, not a read.** Every runtime read is
  shaped, so "computed values are not persisted" was unprovable through the
  runtime: the reference implementation never returns an unshaped record. This
  does not weaken the disclosure boundary — disclosure is about what a *read*
  hands a caller — but a case must never treat what it sees here as a payload
  the runtime was entitled to return.
- **A literal `records` seed is for storage-shaped preconditions only.** Its
  reason for existing is `cacheReadonly`, whose every write path is refused by
  design, so no case could previously seed one to prove it is readable. Anything
  the runtime can arrange must still be arranged through `setup`; a seed that
  bypasses validation, policy or sync gating proves those layers were skipped
  rather than that they agreed.
- **The no-generated-values rule is checked, not asserted.**
  `tests/conformance-suite.test.ts` scans every case for text the reference
  runtime mints (`rev-N`, `cmd-txn-N`, `sha256-…`) and for `expected` blocks that
  assert a minted key at all (`revision`, `guid`, `createdAt`, …). Literal
  `records` seeds are exempt: supplying a revision to storage is input, not a
  claim. Run against the pre-Phase-52 corpus the check flags exactly the six
  offending cases.
- **Prove an extension discriminates.** `tests/conformance-runner.test.ts` runs
  every new capability twice, once where it must pass and once where it must
  fail. An assertion that cannot fail reads as coverage while constraining
  nothing, which is worse than no assertion at all.
- **Offline dataset records are re-sorted by alias before being reported.**
  `OfflineDatasetService` sorts by `(objectName, recordId)` over *generated*
  ids, so any expectation containing two records of the same object came back in
  an order that varied between runs — a case could pass and then fail with
  nothing changed. The runner now applies a canonical order over the aliased
  ids. Dataset ordering is not contractual and is now stated as such in
  `runtime-semantics#offline-datasets`.
- **Pair a case with its own baseline.** The tombstone group is written as
  before/after twins: identical setup, one extra `delete` step, different
  expected result. The pair is the discrimination proof, and it costs one extra
  case to know that the assertion is about the delete rather than about a
  scenario that was never reachable.

## Key decisions from Phase 61

Phase 52 stopped cases from *naming* a revision. Phase 61 found the thing that
mattered more: the corpus had no way to describe the situation in which the
reference runtime's revision minting was actually wrong, so a runtime that
reissued revisions after a restart passed every case while breaking the
optimistic-concurrency check the whole sync loop rests on.

- **A restart is a scenario, so the corpus has to be able to say it.**
  `RuntimeConformanceStep.restartRuntime` rebuilds the `ApplicationRuntime` over
  the **same storage** before the step runs. That is an ordinary process restart
  — the authority redeploying, a browser tab reloading — and it was previously
  unsayable, which is why a counter reset in every constructor survived a corpus
  of several hundred cases. Generalise the lesson: when a guarantee is about what
  survives something, the corpus needs a way to *do* that something, or the
  guarantee is only ever asserted inside the one process that trivially satisfies
  it.
- **`readRecordRevisions` reports behaviour, not text.** It answers with
  `{ writes, distinctRevisions, everyWriteChangedTheRevision, revisionReissued,
  currentRevisionIsTheLastWritten }` for one record, accumulated from every
  revision the case's steps saw for it. A case can therefore state "a write
  changes the revision" and "no revision is ever handed back twice" — the actual
  contract — without a literal anywhere near it.
- **It deliberately reports nothing about order.** A revision is opaque and
  equality-compared (`runtime-semantics#record-revisions`), so a case asserting
  that revisions increase would pin one implementation's convention as the
  cross-runtime contract, which is the same mistake as spelling `rev-1` out. The
  reference runtime happens to carry a sequence; a conforming one minting ULIDs
  or UUIDs must pass the same cases.
- **The history matters, not just the last pair.** `revisionReissued` is computed
  over the whole observed history rather than consecutive pairs, because a
  reissued revision is a lost update whether or not it came back immediately.
  `everyWriteChangedTheRevision` is the consecutive-pair question and is a
  different one.
- **The generated-value guard has to keep pace with what the runtime mints.**
  `tests/conformance-suite.test.ts` scans cases for reference-runtime text, and
  that scan is only as good as its list of shapes. When the minted format
  changes, the guard changes with it — otherwise it goes on refusing a format
  nothing produces while admitting the one that is now generated. Note also that
  the phase document's claim of "41 `rev-N` assertions in `conformance/`" was
  stale: at the start of Phase 61 the corpus held 25 occurrences, every one of
  them a literal `records` **seed input** in two model-migration files, which the
  guard exempts by design. The corpus's real protection was the guard, not the
  absence of the literal.

## Gaps the corpus still cannot express

Recorded so a later phase does not have to rediscover them.

**Closed in Phase 51 because it was too serious to defer:** absence could not be
asserted at all. `partialDeepMatch` walks only the expected object's keys, so no
case could prove that a hidden or policy-denied field is *omitted* from returned
values — the actual disclosure guarantee — and a runtime returning every hidden
field verbatim would have passed the whole suite. An expected value of
`"$absent"` now asserts that the key is not present.

**Closed in Phase 52:** `baseRevision` naming, setup-outcome assertion,
`localPrivate` queue exclusion, `ADL_MIGRATION_FAILED` and atomic rollback, the
`delete` setup step, direct storage seeding, and computed-value non-persistence.

**Closed in Phase 58:** nothing joined the queue to the wire. The `syncReconcile`
operation now drives the real `AuthoritySyncClient` against a real
`AuthorityService` over an in-process transport, so a case can state what the
device wrote locally, what the authority held, and what the drain left in the
queue *and* on every record. `readPersistedRecords` reports `syncStatus` and
`syncRejectedCreate`, and `RuntimeConformanceStep` gained `executeCommand`, so a
refused command's whole record set is corpus-stated. Its own successors:

- **One reconcile round per case.** Sequences like accept → diverge → reconcile
  again need a second drain phase.
- **One resolution, applied to every settled entry.** `resolve` cannot name an
  entry, because the queue id is generated, so two entries cannot be resolved
  differently in one case.
- **No delivery state.** The in-process authority always answers, so
  `undelivered`, `attempts` and retry-id behaviour stay unreported.
- **No operation for `discardRefusedRecord`.** The corpus can state the discard
  *licence* (`syncRejectedCreate`) but not the discard, its tombstone, or that it
  queues nothing.
- **Sync state crossing the wire cannot be observed.** Nothing distinguishes "the
  authority's copy was ignored" from "it happened to agree", because the
  authority's own writes are on the `sync` channel and are `synced` anyway. It
  stays a TypeScript and real-PostgreSQL proof.

Still open:

- **`metadata.modelFingerprint` cannot be asserted.** The only runtime-neutral
  way to seed it is `persistedModel: {"modelRef": …}`, and no sentinel says "the
  fingerprint that model derived". A rollback case can prove `modelVersion` was
  left alone but not the fingerprint. Wants a `{"$modelFingerprint": "<ref>"}`
  expected-value sentinel.
- **Diagnostic messages are not reported** by `migratePersistedState`, so "a
  diagnostic reduces a storage fault to its name and never discloses data" stays
  TypeScript-only (`tests/model-migration.test.ts`). That is a disclosure
  guarantee of exactly the kind `"$absent"` exists for, and it needs a way to
  assert what a message does *not* contain rather than what it does.
- **Diagnostic ordering across categories is unwritten.** Several cases rely on
  migration diagnostics preceding per-record schema diagnostics; `docs/spec/`
  names no such order.
- Arrays must match by exact length, which makes 42-cell calendar cases mostly
  placeholders and invites off-by-one authoring errors.
- Eight declared presentation diagnostic codes are unreachable through
  `evaluatePresentationView`, because model validation rejects those models
  first. A second runtime is unconstrained on them.

## Runtime gaps Phase 52 found and deliberately did not close

Both are new capability rather than defects in implemented behaviour, so neither
was fixed here and neither was pinned by a case — a case written against current
behaviour would absorb the gap into the cross-runtime contract.

- **An `onlineRequired` write never reaches the authority.**
  `SyncQueue.enqueue` skips every non-`localFirst` object and
  `AuthoritySyncClient.reconcile` pushes only from that queue, so an
  `onlineRequired` create made *while online* is written locally, logged, and
  then never sent. There is no other push path. The Giggle Band reference app's
  `BandInvitation` is `SYNC ONLINE_REQUIRED`, so this is reachable in the
  reference application, not only in principle.
- **`localPrivate` writes are accepted by the authority** and then filtered out
  of every bootstrap, so an accepted record exists that nobody can read back.
  Recorded before Phase 52 and still open.
- **A row vanishing from a read model carries no signal.**
  `resolveJoinedSource` returns the same "nothing" for a deleted record, a
  missing lookup value, a source-scope mismatch and a read-policy denial, and
  `executeRows` then drops the whole row. Defensible — a half-projected row
  would be worse, and a signal would itself be a disclosure — but it is now
  stated in the spec rather than left for a second implementer to infer.
- **`ADL_STORAGE_ERROR` for an already-deleted delete is coarse**, and
  indistinguishable from deleting an id that never existed, while the authority
  path has a dedicated already-deleted conflict outcome. Pinned as-is.

## Practical guidance

- Add or update conformance cases whenever a semantic behavior changes. Each
  case must have a stable id and a `specRef` pointing at the relevant spec
  section.
- Keep expected outputs focused on the semantic surface being pinned. The
  harness uses partial matching for expected objects but exact ordering for
  arrays.
- Do not make conformance JSON import TypeScript modules or runtime internals.
  Use resolved expressions, partial models, runtime context data, and operation
  inputs as plain JSON.
- If implementation and intended semantics disagree, fix the implementation only
  when it is a defect in already-implemented behavior; otherwise update the spec
  and corpus to match current behavior.
