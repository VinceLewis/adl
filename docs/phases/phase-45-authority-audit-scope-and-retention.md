# Phase 45 - Authority Audit Scope and Retention

## Objective

Make authority runtime-audit review context-scoped in the projection itself and
give the runtime-audit and operation-outcome projections a safe, bounded
retention lifecycle, now that Phase 44 actually populates them.

## Evidence and Dependency

Phase 44 made `adl_authority_audit_events` a populated transactional projection.
Two gaps are now demonstrated by the code:

- `PostgresAuthorityAdministrationStore.listRuntimeAudit` ignores context
  (`_contextName`, `_contextId`) and returns the most-recent rows for the whole
  application; `AuthorityAdministrationService.runtimeAudit` then policy-filters
  each row through a runtime read. As the table fills, a context administrator's
  page can be dominated by other contexts' events that are filtered out, so a
  bounded page can come back sparse or empty even when their context has audit
  history. Scoping belongs in the projection, not only in a post-filter.
- Neither the runtime-audit projection nor `adl_authority_operation_outcomes`
  has a retention path. Phase 42 added retention only for session/invite
  verifiers, and outcomes are not even application-scoped (see
  `AuthorityProjectionIntegrity.countOutcomes`). Both grow without bound.

These are follow-on gaps from Phase 44 and depend on its unit-of-work,
integrity verification, and the runtime remaining the semantic authority.

## Scope

- Add a context/scope dimension to the runtime-audit projection so review is
  filtered and bounded in SQL for one authorised business context, preserving
  the existing per-row runtime read as the final disclosure boundary.
- Application-scope operation outcomes and define retention/pruning for runtime
  audit and outcomes with explicit legal-hold and minimum-retention safeguards.
- Provide integrity/restore coverage for the new scope and retention state.

## Constraints

- The runtime stays the semantic authority; scoping and retention are
  persistence concerns and must not reimplement policy, validation, lifecycle,
  or command logic in SQL, nor become an ADL language construct.
- Do not weaken Phase 44 atomicity: audit still commits with its accepted record
  and outcome. A retention/pruning job must never delete accepted records,
  in-retention audit, or in-retention outcomes, and must honour legal hold.
- Do not expose raw accepted records, audit payloads, tokens/verifiers, or
  outcomes in review, diagnostics, logs, metrics, or retention status. Review
  pages stay bounded, actor-bound, and metadata-only.
- Preserve opaque session identity-only behaviour and Phase 42 HTTP controls.
  In-memory stores remain test wiring only.

## Deliverables

- A context-scoped runtime-audit projection (migration + writer + reader) whose
  review query is scoped in SQL, with the runtime read retained per row.
- Application-scoped outcomes and a documented, safeguarded retention/pruning
  path for audit and outcomes, with metadata-only status.
- Integrity/restore updates, migration/runbook/threat-model updates, tests, and
  learning notes.

## Acceptance Criteria

- A context administrator's runtime-audit review returns only their context's
  events, bounded and actor-bound, with per-row runtime read still enforced; an
  inaccessible row is never an existence oracle.
- Outcomes are application-scoped; integrity verification covers scope
  consistency and detects a retention/pruning mistake as an inconsistency
  without printing protected JSON.
- Retention/pruning never removes accepted records, in-retention audit, or
  in-retention outcomes, and refuses to act under legal hold; behaviour is
  covered by tests including boundary and hold cases.
- Phase 44 atomicity and idempotency remain intact under the new scope/retention
  changes, proven by regression tests.
- Run `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run
  build`; run `npm run verify:push` only if browser rendering, shell controls,
  reference screens, presentation output, or CSS change.

## Non-goals

- New reporting UI, BI connectors, generic SQL, identity flows, a new sync
  protocol, database engine, or ADL language syntax.
- Cross-store distributed transactions with external identity providers or email
  delivery, and arbitrary operator database access.

## Dependencies

- Phase 44 unit-of-work, projection integrity, and access-lifecycle atomicity.
- Phase 42 production HTTP/operations controls and retention precedent.
- Phase 43 reporting/administration review surfaces.

## Tasks

1. Inventory how runtime audit and outcomes are written, read, and scoped today,
   and pin the exact review and retention boundaries.
2. Add the context/scope dimension to the runtime-audit projection and make the
   review query scope in SQL while keeping the per-row runtime read.
3. Application-scope outcomes and implement safeguarded retention/pruning for
   audit and outcomes with legal-hold and minimum-retention checks.
4. Extend `AuthorityProjectionIntegrity` and restore verification for scope and
   retention consistency; add migration/index changes only where evidence
   requires them.
5. Add unit, PostgreSQL-adapter, HTTP integration, retention-boundary, and
   integrity/restore tests, plus Phase 44 atomicity regression tests.
6. Update the production runbook, server authority documentation, threat model,
   specifications if required, and learnings.
7. **Required next-phase planning handoff:** before Phase 45 closes, replace the
   Phase 46 placeholder with a complete evidence-based executable phase document
   covering the next demonstrated authority/runtime gap. Define its objective,
   scope, constraints, deliverables, acceptance criteria, verification,
   non-goals, dependencies, and its required planning handoff; then verify,
   commit, and push Phase 45.
