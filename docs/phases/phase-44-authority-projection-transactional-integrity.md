# Phase 44 - Authority Projection Transactional Integrity

## Objective

Make accepted records, runtime audit, operation outcomes, access audit, and the
new Phase 43 administration audit durably consistent in PostgreSQL under one
authoritative commit boundary.

## Evidence and Dependency

Phases 39–43 establish TypeScript runtime replay, PostgreSQL projections,
opaque identity/session and access lifecycle, production HTTP controls, and
policy-shaped reporting. Phase 43 can safely read the existing audit
projections, but current `AuthorityService` wiring does not yet prove that an
accepted runtime write, its runtime audit projection, and its actor-bound
outcome are committed or rolled back together. Report/admin review therefore
needs a stronger durable projection contract before broader operational use.

## Scope

- Define a PostgreSQL authority unit-of-work that commits accepted records,
  runtime audit entries, actor-bound operation outcomes, and required access or
  administration audit events atomically.
- Make authority replay use that unit-of-work without changing resolved-model,
  policy, lifecycle, command, context, or sync intent semantics.
- Add projection integrity checks, migration/index adjustments where evidence
  requires them, failure recovery behaviour, and restore verification.
- Document exactly which projections are transactional for replay, invite
  claim/revocation, session response, report/export, and admin review.

## Constraints

- The runtime remains the semantic authority; PostgreSQL transactions must not
  reimplement policy, validation, lifecycle, or command logic in SQL.
- Do not add ADL SQL, transaction, report, provider, role, or database syntax.
- Do not expose raw accepted records, audit payloads, tokens/verifiers, or
  outcomes in diagnostics, logs, metrics, or recovery status.
- Preserve opaque session identity-only behaviour, actor-bound idempotency, and
  Phase 42 HTTP controls. In-memory stores remain test wiring only.

## Deliverables

- Typed authority unit-of-work and PostgreSQL adapters for accepted-state,
  runtime-audit, outcome, access-audit, and administration-audit writes.
- Replay and access/admin integration that is all-or-nothing on database
  failure, with safe retry/idempotency behaviour.
- Projection integrity/recovery tests, migration/runbook updates, threat-model
  update, and learning notes.

## Acceptance Criteria

- A failed record/audit/outcome write leaves no accepted partial projection;
  successful replay has exactly one actor-bound outcome and corresponding
  accepted/audit projection.
- Multi-record commands keep existing all-or-nothing semantics through the
  PostgreSQL authority boundary, including audit projection.
- Retry after an interrupted transaction neither leaks a partial outcome nor
  duplicates accepted audit/access/admin events.
- Reporting and administration observe only committed, retention-valid data;
  restore checks detect missing or inconsistent projection sets without
  printing protected JSON.
- Tests cover transaction failure at each write stage, concurrent/idempotent
  retry, command rollback, invite claim/revocation, report/export/admin audit,
  model/version mismatch, and restore-integrity checks.
- Run `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run
  build`; run `npm run verify:push` only if browser rendering, shell controls,
  reference screens, presentation output, or CSS changes.

## Non-goals

- New reporting UI, BI connectors, generic SQL, identity flows, a new sync
  protocol, database engine, or ADL language syntax.
- Distributed transactions across external identity providers, email delivery,
  or arbitrary operator database access.

## Tasks

1. Inventory every existing authority projection writer and identify the exact
   current transaction/partial-failure boundary.
2. Define and implement a typed PostgreSQL authority unit-of-work; integrate
   replay accepted-state, runtime audit, and actor-bound outcome persistence.
3. Integrate access lifecycle and Phase 43 administration/report audit writes
   where they need the same transaction boundary.
4. Add migration/index/integrity checks only where the implementation evidence
   requires them; preserve least-privilege migration versus traffic roles.
5. Add unit, PostgreSQL-adapter, HTTP integration, concurrency/idempotency,
   rollback, and restore-recovery tests.
6. Update the production runbook, server authority documentation, threat
   model, specifications if required, and learnings.
7. **Required next-phase planning handoff:** before Phase 44 closes, replace
   the Phase 45 placeholder with a complete evidence-based executable phase
   document covering the next demonstrated authority/runtime gap. Define its
   objective, scope, constraints, deliverables, acceptance criteria,
   verification, non-goals, dependencies, and its required planning handoff;
   then verify, commit, and push Phase 44.
