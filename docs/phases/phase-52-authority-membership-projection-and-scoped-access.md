# Phase 52 - Authority Membership Projection and Scoped Access Paths

> Renumbered from Phase 46, then 48, then 49, then 50, and now Phase 52 by the Phase 48
> handoff, which moved the platform contract phase ahead of it. Each move had the
> same cause: this work is an optimisation and integrity refactor of a subsystem
> with no production users, so anything with a user-visible or repository-wide
> effect outranks it. Its evidence and scope are unchanged; only its position in
> the sequence moved. Phase 47 independently confirmed the core evidence — the
> membership record written by a real invite claim lands in
> `adl_authority_records`, and `adl_authority_context_memberships` stayed empty —
> and Phase 48 confirmed that no deployment exists, so the scans below are slow in
> principle rather than slow in production today.

> **Phase 51 handoff (re-sequencing recommended; see below).** Phase 51 landed
> declared model versions, content fingerprints, declarative `MIGRATION` blocks,
> fail-closed migration on both the authority projection and browser IndexedDB,
> and grew the conformance corpus from 28 cases to roughly 470. It fixed eleven
> runtime defects the new cases revealed and pinned every one.
>
> This phase's own evidence is intact and unchanged: the membership projection
> still has no writer, and the three `listRecords()` scans are still O(all
> accepted records). Nothing Phase 51 did touches them.
>
> **But this phase is probably no longer the highest-value remaining gap.** By
> the standard this repository has applied since Phase 46 — a user-visible or
> repository-wide effect outranks an optimisation of a subsystem with no
> production users — the corpus's remaining *expressive* gaps now outrank it, and
> the reason is specific rather than general. ADR 0004 makes the conformance
> suite the cross-runtime contract. Phase 51 made that suite broad, and in doing
> so established that its binding constraint is no longer size but what it can
> *say*. Four things it still cannot say:
>
> - **`localPrivate` is indistinguishable from `localFirst`.** `queueable` is
>   observable only inside a refusal payload, so "allows local writes but never
>   queues them" — the entire distinction — cannot be pinned. A second runtime
>   could implement one as an alias for the other and pass.
> - **`ADL_MIGRATION_FAILED` and atomic rollback have zero corpus coverage**,
>   because the in-memory backend always supports transactions and never throws.
>   These are named in Phase 51's own acceptance criteria and are proven only by
>   unit and real-PostgreSQL tests, not by the contract.
> - **`baseRevision` cannot be named**, so five authority cases hard-code
>   `"rev-1"` and thereby pin a revision *format* no spec defines. Those cases
>   would fail a correct second runtime that minted ULIDs.
> - **Setup outcomes are discarded** in `authorityReplay`, so a seed that was
>   itself rejected leaves a case passing for the wrong reason.
>
> Phase 51 closed the most serious of these gaps in flight rather than deferring
> it — absence assertion (`"$absent"`), without which no case could prove that a
> hidden or policy-denied field is *omitted* rather than masked, and a runtime
> leaking every hidden field would have passed the suite. The four above are a
> coherent phase's worth of work and are recorded in
> `learnings/implementation/conformance-suite.md`.
>
> **Recommendation:** insert that work as the next phase and renumber this
> document and those after it, per the repository-wide handoff rule in
> `learnings/process/phase-execution.md`. It was not done inside Phase 51 because
> it is genuinely separate work rather than a loose end, and because renumbering
> three documents is a decision the phase plan's owner should make deliberately.
>
> Two smaller findings belong to **this** phase's subsystem when it runs, and are
> added to its scope below:
>
> - `migrateAcceptedState` takes **no advisory lock**. Two authority processes
>   starting simultaneously against one projection would each plan and apply the
>   same hop. The steps are total and both commits are atomic, so no corruption
>   could be constructed, but it is untested and unguarded.
> - The authority accepts `localPrivate` writes and then filters those records out
>   of every bootstrap, so an accepted record can be written that nobody can ever
>   read back. `cacheReadonly` is refused symmetrically. Either refuse it or
>   document the asymmetry.

## Objective

Populate and use the context-membership projection so authority membership
resolution, access checks, and administration membership review are scoped and
bounded in SQL, instead of scanning every accepted record in memory, while the
runtime remains the semantic authority and the per-row runtime read stays the
disclosure boundary.

## Evidence and Dependency

`adl_authority_context_memberships` has existed since Phase 39
(`0001_authority_projection.sql`, with a `(application_id, user_id, context_name)`
index) but has **no writer** — the same "defined-but-unpopulated projection"
state that `adl_authority_audit_events` was in before Phase 44. Because it is
empty, every membership and access decision instead loads and filters the whole
record set in memory:

- `AuthorityService.bootstrap` (`authority-service.ts:82`) calls
  `storage.listRecords()` and filters/sorts all records per bootstrap.
- `AuthorityAdministrationService.memberships` (`authoritative-reporting.ts:385`)
  calls `storage.listRecords()`, then filters by object and context field in
  memory — the same class of gap Phase 45 fixed for runtime audit, still present
  for memberships.
- `AuthorityAccessLifecycleService` scans `storage.listRecords()` twice
  (`access-lifecycle.ts:236` membership-manager check, `:293` target-context
  access check) on every administration/invite/revocation call.

`PostgresObjectStorageBackend.listRecords` (`postgres-object-storage.ts:67`)
returns all application rows, so each of these is O(all accepted records). As the
record set grows, membership resolution, access checks, invite/revocation, and
membership review degrade together, and a bounded membership review page can be
dominated by unrelated records. This is a demonstrated follow-on from Phase 45's
projection-scoping work and depends on Phase 44 atomicity and the Phase 45 scope
precedent.

## Scope

- Write the context-membership projection transactionally whenever a membership
  record is created, revoked, or otherwise changed, inside the existing
  unit-of-work / access-lifecycle commit boundaries (no second source of truth:
  the accepted membership record stays authoritative; the projection is a
  derived, scope-indexed read model).
- Replace the in-memory `listRecords()` scans for membership resolution, the
  administration membership review, and the access-lifecycle membership-manager
  and target-access checks with context/user-scoped projection reads, keeping the
  per-row runtime read and policy as the disclosure boundary.
- Extend `AuthorityProjectionIntegrity` and restore verification for membership
  projection consistency (every projection row backed by a live accepted
  membership record, and no accepted membership record missing its projection
  row), metadata-only.

- Take an advisory lock (or equivalent) around accepted-state migration in
  `migrateAcceptedState`, so two authority processes starting simultaneously
  against one projection cannot both plan and apply the same model migration.
  Phase 51 left this unguarded and untested; the steps are total and each commit
  is atomic, so this is a robustness gap rather than a demonstrated corruption.
- Decide and implement the `localPrivate` asymmetry at the authority: a
  `localPrivate` write is currently accepted and then filtered out of every
  bootstrap, so it becomes an accepted record nobody can read. `cacheReadonly` is
  refused symmetrically. Either refuse it with `ADL_SYNC_POLICY_DENIED` or state
  in the spec why it is accepted.

## Constraints

- The runtime stays the semantic authority. The projection narrows candidates
  and speeds resolution; it must not authorise, re-derive roles, or reimplement
  policy/validation/lifecycle/scope in SQL, and must not become an ADL construct.
- Do not weaken Phase 44 atomicity or Phase 45 scope/retention: the membership
  projection commits in the same transaction as its accepted record change and
  access-audit event, so a failure rolls all of them back together.
- Do not expose raw accepted records, membership PII beyond existing status
  DTOs, tokens/verifiers, or audit/outcome bodies in review, integrity, logs, or
  metrics. Review stays bounded, actor-bound, and metadata/status only.
- Preserve opaque session identity-only behaviour, Phase 42 HTTP controls, and
  in-memory stores as test wiring only.

## Deliverables

- A populated context-membership projection (writer wired into membership
  create/revoke paths) plus a migration only if the existing table/indexes are
  insufficient for the scoped reads.
- Scoped projection reads replacing the in-memory scans in membership
  resolution, administration membership review, and the two access-lifecycle
  checks, with the runtime read retained as the disclosure boundary.
- Integrity/restore updates for membership-projection consistency, runbook /
  server-authority / threat-model updates, tests, and learning notes.

## Acceptance Criteria

- Membership resolution, access checks, and membership review no longer call
  `storage.listRecords()`; they read the membership projection scoped by
  context/user, and behaviour (including denied/hidden rows and invalid context
  selection) is unchanged from Phase 45.
- The membership projection is written and revoked atomically with its accepted
  record and access-audit event; a failed projection write rolls the whole
  change back (proven by a fault-injection test).
- Integrity verification covers membership-projection consistency and detects a
  missing or orphaned projection row as an inconsistency without printing
  protected JSON.
- Phase 44 atomicity, Phase 45 audit scope/retention, and idempotency remain
  intact, proven by regression tests, including the real PostgreSQL integration
  suite (`npm run test:integration`, throwaway Docker Postgres).
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`; run `npm run verify:push` only if
  browser rendering, shell controls, reference screens, presentation output, or
  CSS change.

## Non-goals

- New reporting UI, BI connectors, generic SQL, identity flows, a new sync
  protocol, database engine, or ADL language syntax.
- Conformance depth and model migrations, which are now Phase 51 and precede this
  phase.
- A scheduler/HTTP surface for `AuthorityRetentionService.prune` (retention
  wiring is Phase 53, not this phase's scoping objective).
- Cross-store distributed transactions with external identity providers or email
  delivery, and arbitrary operator database access.

## Dependencies

- Phase 44 unit-of-work and projection integrity.
- Phase 45 runtime-audit context scoping, application-scoped outcomes, and
  retention safeguards.
- Phase 41 identity/access lifecycle and Phase 43 administration review surfaces.
- Phase 46 deployment slice: `AuthorityService.bootstrap` is now driven by a real
  client over HTTP, so membership resolution is on the hot path for every
  reconnect rather than only in tests.

## Parallel Execution Plan

Fan out (independent, read-only or non-overlapping files):

- Task 1 inventory: one agent per scan site (`authority-service.ts:82`,
  `authoritative-reporting.ts:385`, `access-lifecycle.ts:236`, `:293`), each
  returning the exact scope and disclosure boundary that site must preserve.
- The documentation bundle in task 6 (runbook, `docs/server-authority.md`,
  threat model, learnings) once the code shape is settled.

Keep serial (shared or ordered state):

- The migration/index change, if evidence requires one: migration files are
  ordered and must not be authored concurrently.
- The projection writer inside the unit-of-work commit boundary, then the four
  scoped reads that depend on its shape. Writer first, readers after.
- `AuthorityProjectionIntegrity` changes, which the restore path also consumes.

Barrier before verification: run `npm run test:integration` once after the
readers land. Each concurrent run provisions its own throwaway Postgres
(`tests/integration/global-setup.ts:31,48` gives a PID-unique container name and
an ephemeral port, so parallel runs are safe but pay a container each).

## Tasks

1. Inventory how membership records are written, revoked, resolved, and reviewed
   today, and pin every `listRecords()` scan and the exact scope/disclosure
   boundary each one must preserve.
2. Write the context-membership projection transactionally in the membership
   create/revoke paths inside the existing commit boundaries; confirm no second
   source of truth and that the accepted record stays authoritative.
3. Replace the membership/access/review scans with context/user-scoped
   projection reads, keeping the per-row runtime read and policy as the
   disclosure boundary.
4. Extend `AuthorityProjectionIntegrity` and restore verification for
   membership-projection consistency; add migration/index changes only where
   evidence requires them.
5. Add unit, PostgreSQL-adapter, HTTP integration, and integrity/restore tests,
   plus Phase 44/45 atomicity and scope regression tests, all against real
   PostgreSQL.
6. Update the production runbook, server authority documentation, threat model,
   specifications if required, and learnings.
7. **Required next-phase planning handoff:** before Phase 52 closes, review
   `docs/phases/phase-53-retention-scheduling-and-administration-ui.md` and
   revise it if this phase's results change its scope, constraints,
   deliverables, or tasks. The handoff must justify Phase 53 as the
   highest-value remaining gap **repository-wide**, not merely the next gap in
   the subsystem this phase touched; if a higher-value gap exists elsewhere, say
   so and re-sequence. Then verify, commit, and push Phase 52.
