# Phase 46 - Authority Membership Projection and Scoped Access Paths

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
- A scheduler/HTTP surface for `AuthorityRetentionService.prune` (retention
  wiring is separate operational work, not this phase's scoping objective).
- Cross-store distributed transactions with external identity providers or email
  delivery, and arbitrary operator database access.

## Dependencies

- Phase 44 unit-of-work and projection integrity.
- Phase 45 runtime-audit context scoping, application-scoped outcomes, and
  retention safeguards.
- Phase 41 identity/access lifecycle and Phase 43 administration review surfaces.

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
7. **Required next-phase planning handoff:** before Phase 46 closes, replace the
   Phase 47 placeholder with a complete evidence-based executable phase document
   covering the next demonstrated authority/runtime gap. Define its objective,
   scope, constraints, deliverables, acceptance criteria, verification,
   non-goals, dependencies, and its required planning handoff; then verify,
   commit, and push Phase 46.
