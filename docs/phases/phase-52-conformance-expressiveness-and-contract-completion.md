# Phase 52 - Conformance Expressiveness and Contract Completion

> Inserted by the Phase 51 handoff and accepted, which renumbered the former
> phases 52, 53 and 54 to 53, 54 and 55. Phase 51 grew the conformance corpus
> from 28 cases to roughly 470 and, in doing so, established that its binding
> constraint is no longer its *size* but what it can *say*. Several behaviours
> named in Phase 51's own acceptance criteria have no corpus coverage at all,
> and a second runtime could get two of them badly wrong while passing the whole
> suite. This phase closes that, and only that.

## Objective

Make the conformance corpus able to state the guarantees ADL actually relies on,
so that passing the suite means what ADR 0004 says it means.

## Evidence and Dependency

Phase 51 closed the most serious expressiveness gap in flight, because leaving it
open would have meant declaring the contract adequate while it could not express
a disclosure guarantee: absence is now assertable with `"$absent"`, and
`conformance/runtime/context-policy.json` proves that hidden and policy-denied
fields are *omitted* from a read rather than merely masked. The gaps below
survived that pass and are recorded in
`learnings/implementation/conformance-suite.md`.

- **`localPrivate` is indistinguishable from `localFirst`.** `SyncWriteDecision`
  carries `queueable`, and "allows local writes but excludes them from the sync
  queue" is the entire distinction between the two modes. The corpus can only
  observe `queueable` inside an `ADL_SYNC_POLICY_DENIED` payload — that is, only
  when the write was *refused*. Three cases in
  `conformance/runtime/sync-authority.json` prove `localPrivate` writes are
  allowed; none can prove they are not queued. **A second runtime could
  implement `localPrivate` as an alias for `localFirst` and pass the entire
  suite.**
- **`ADL_MIGRATION_FAILED` and atomic rollback have zero corpus coverage.**
  `InMemoryObjectStorageBackend` always supports transactions and never throws,
  and `ModelMigrationConformanceCase` cannot ask for anything else. Both
  behaviours are named in Phase 51's acceptance criteria and are currently proven
  only by `tests/model-migration.test.ts` and
  `tests/integration/authority-model-migration.test.ts` — real proofs, but
  TypeScript-only ones, so the cross-runtime contract is silent on the
  fail-closed guarantee that matters most.
- **`baseRevision` cannot be named, so five cases pin a revision format no spec
  defines.** `runAuthorityReplayCase` never calls `resolveRefs` on its input and
  its `RunState` stays empty, yet every `update`, `delete` and `transition`
  intent requires `baseRevision`, and a *successful* one requires the record's
  current revision produced by a setup intent. `authority.update.accepted.001`,
  `authority.delete.accepted-tombstone.001`,
  `authority.create.collision-leaves-original-untouched.001`,
  `authority.create.collision-survives-a-tombstone.001` and
  `authority.delete.already-deleted-conflict.001` therefore hard-code
  `"rev-1"`, which comes from `ObjectStore.nextRevision()`. Nothing in
  `docs/spec/` defines that shape, so a conforming runtime minting ULIDs would
  fail those five cases while being entirely correct. This directly violates the
  Phase 51 constraint that a case "must be expressible against any conforming
  runtime".
- **Setup outcomes are discarded, so a case can pass for the wrong reason.**
  `runAuthorityReplayCase` awaits each setup replay and throws the result away. A
  setup intent that was itself rejected — a mistyped object name, a policy the
  seeding session does not hold — leaves the case running against an empty store,
  and a rejection-expecting case then passes because nothing was there rather
  than because the rule under test fired.
- **Several behaviours are unreachable because setup is too narrow.**
  `RuntimeConformanceStep` supports only `create`, `update` and `transition`, so
  nothing involving a tombstone can be seeded: that `resolveJoinedSource` drops
  deleted records, that a deleted membership row stops granting a context role,
  and that a deleted context object leaves the available set are all unassertable.
  No runtime case can seed storage directly either, so the spec's claim that
  computed values are **not persisted** cannot be proven — the runtime never
  returns an unshaped record. `startupCompatibility` and `migratePersistedState`
  already accept a literal `records` seed; `RuntimeConformanceCase` does not.
- **`cacheReadonly` records cannot be seeded at all**, so
  `runtime-semantics#offline-datasets`'s sentence that "`cacheReadonly` records
  can be included for reads" is untestable: every seeding path goes through
  `runtime.create`, which `cacheReadonly` refuses.

This phase depends on the Phase 51 corpus, runner and spec sections, and on the
Phase 48 record-identity rules the authority cases exercise.

## Scope

- Extend `AuthorityConformanceCase` so a setup intent can be aliased and its
  outcome referenced, and re-express the five cases that hard-code `"rev-1"` so
  the corpus stops pinning a revision format. Mirror the existing
  `RuntimeConformanceCase` `$ref` mechanism rather than inventing a second one.
- Assert setup outcomes. A setup intent must be `accepted` by default, with an
  explicit opt-out for cases that deliberately seed a refusal.
- Give the corpus a way to observe a sync-write decision on the **allowed** path,
  so `localPrivate`'s defining property — allowed but never queued — becomes
  contractual rather than an implementation detail of one runtime.
- Let a migration case select its storage behaviour (transactional,
  non-transactional, failing-on-commit) so `ADL_MIGRATION_FAILED`, the atomic
  rollback, and the non-transactional refusal are covered by the contract and not
  only by TypeScript tests.
- Add a literal `records` seed and a `delete` setup step to runtime cases, and
  cover the behaviours those unlock, including computed-value non-persistence and
  the `cacheReadonly` read path.
- Update the three-layer specification wherever a newly expressible behaviour has
  no prose behind it, and record the result in `learnings/`.

## Constraints

- **A case must remain expressible against any conforming runtime.** This phase
  exists partly because five cases currently are not. Nothing added here may pin
  a generated identifier's format, a digest's text, a timestamp, or any other
  value the reference runtime happens to produce.
- Growing expressiveness must not change runtime behaviour. If a newly
  expressible case reveals a semantic defect, fix the defect explicitly and
  record it, rather than adjusting the case — the Phase 51 rule, which found
  eleven defects by being followed.
- Seeding must not bypass the boundary under test. Authority cases seed through
  the replay path; a literal `records` seed is for storage-shaped preconditions
  only and must never be used to manufacture a state the runtime would refuse to
  reach, unless that unreachability is itself the point (`cacheReadonly`).
- Preserve the disclosure boundaries throughout. `"$absent"` exists so the corpus
  can prove withholding; nothing added here may make it easier to assert a
  payload that should never have been returned.
- The corpus stays plain JSON with no imports, file paths or private APIs, and
  presentation conformance stays DOM-free.

## Deliverables

- Runner and case-schema extensions for setup aliasing, setup-outcome assertion,
  sync-decision observation, migration storage selection, literal record seeding
  and a `delete` setup step.
- The five revision-format-dependent cases re-expressed, and new cases covering
  `localPrivate` queue exclusion, `ADL_MIGRATION_FAILED`, atomic rollback, the
  non-transactional refusal, tombstone-dependent behaviours, computed-value
  non-persistence and the `cacheReadonly` read path.
- Specification updates where newly expressible behaviour has no prose, and a
  `learnings/` update replacing the "still open" list in
  `learnings/implementation/conformance-suite.md` with what remains.

## Acceptance Criteria

- No conformance case depends on the format of a generated revision, id, digest
  or timestamp. Demonstrate this deliberately rather than asserting it.
- `localPrivate` and `localFirst` are distinguishable by the corpus alone: a
  runtime implementing one as an alias for the other fails at least one case.
- `ADL_MIGRATION_FAILED`, atomic rollback and the non-transactional refusal each
  have a passing conformance case.
- A setup intent that fails causes its case to fail, rather than silently
  changing what the case tests.
- Any semantic defect the new cases reveal is fixed in the runtime and recorded,
  not absorbed by weakening the case.
- Every case passes against the TypeScript reference runtime, and every `specRef`
  resolves to a real heading — the Phase 51 anchor check stays green.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`; run `npm run verify:push` only if
  renderer output changes, which it should not.

## Non-goals

- A second runtime implementation. This phase makes the contract adequate for
  one; it does not build one.
- New runtime capability. Every behaviour named here already exists and is
  already proven by TypeScript tests; what is missing is the contract's ability
  to state it.
- Resolving the two recorded equality/ordering inconsistencies (ordering coerces
  text↔temporal while equality does not; datetime equality is textual while
  ordering is instant-based). Both are stated in
  `runtime-semantics#expression-errors` as known sharp edges. Changing equality
  semantics repository-wide is its own phase with its own evidence.
- **Deciding whether the authority should accept a `localPrivate` write at all.**
  Phase 53 carries that question, and it is a different one: this phase makes the
  *client-side* mode distinguishable to the corpus, while Phase 53 decides
  whether the authority's acceptance of a record it then filters out of every
  bootstrap is correct. Do not resolve it here — a case written against the
  current behaviour would pin whichever answer Phase 53 has not yet chosen.
- The authority membership projection (Phase 53), retention scheduling (Phase
  54), and reference-app and documentation hygiene (Phase 55).

## Dependencies

- Phase 51's corpus, runner operations, spec sections and anchor check.
- Phase 48's record-identity contract, which the authority cases exercise.
- Phase 44 atomicity and Phase 45 scope, which the migration cases must not
  weaken.

## Parallel Execution Plan

The serial spine is larger here than in Phase 51 relative to the fan-out, because
almost everything in scope is a change to one shared file.

Serial spine first, in one pass with no consumers:

1. All runner and case-schema extensions in `src/conformance/runner.ts`: setup
   aliasing and `resolveRefs` over authority input, setup-outcome assertion, the
   sync-decision operation, migration storage selection, the literal `records`
   seed, and the `delete` setup step.

Fan out after the spine, one agent per case group, each writing its own file or
an agreed disjoint section of one:

- Re-expressing the five revision-dependent authority cases.
- `localPrivate` queue exclusion and sync-decision cases.
- Migration failure, rollback and non-transactional refusal cases.
- Tombstone-dependent cases across read models, context membership and datasets.
- Computed-value non-persistence and the `cacheReadonly` read path.

Keep serial: `src/conformance/runner.ts`, the case schema, any runtime fix a case
reveals, `src/index.ts` exports, and the specification update, which must
reconcile every group's findings at once.

Barriers: collect all findings before the specification update. Then one
integration run. `verify:push` only if renderer output changed.

## Tasks

1. Extend the runner and case schema per the serial spine above, and prove each
   extension discriminates — an assertion that cannot fail is worse than none.
2. Re-express the five cases that hard-code `"rev-1"`, and confirm by inspection
   that no remaining case depends on a generated value's format.
3. Add setup-outcome assertion and confirm it catches a deliberately broken seed.
4. Author the new case groups, recording any semantic defect found rather than
   adjusting the case.
5. Fix revealed runtime defects explicitly through one serial pass, and record
   them.
6. Update the three-layer specification and `learnings/`.
7. **Required next-phase planning handoff:** before Phase 52 closes, review
   `docs/phases/phase-53-authority-membership-projection-and-scoped-access.md`
   and revise it if this phase's results change its scope, constraints,
   deliverables, or tasks. The handoff must justify Phase 53 as the highest-value
   remaining gap **repository-wide**, not merely the next gap in the subsystem
   this phase touched; if a higher-value gap exists elsewhere, say so and
   re-sequence. Then verify, commit, and push Phase 52.
