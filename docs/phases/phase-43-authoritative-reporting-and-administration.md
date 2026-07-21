# Phase 43 - Authoritative Reporting and Administration

## Objective

Add policy-shaped authoritative reporting and narrowly scoped operational
administration on top of the PostgreSQL accepted-state, audit/access-audit, and
production controls established in Phases 39–42.

## Evidence and Dependency

The authority service already replays intent through runtime semantics and
bootstraps policy-shaped records. Phase 42 adds a deployable HTTPS-only HTTP
edge, actor-bound outcomes, redacted logs/metrics, and restore procedures for
all authority projections. It intentionally does not expose server reporting,
audit review, export authorization, or recoverable administration workflows.
Those are now the next product gap, but must retain the same policy boundary.

## Scope

- Define server-side read-model/report execution over accepted PostgreSQL state
  without exposing raw SQL or raw protected records.
- Add policy-controlled administration workflows for access-audit review,
  membership/invite status, recovery status, and narrowly scoped session/access
  response actions.
- Add export/report limits, audit events, pagination, retention-aware access,
  and anti-enumeration behavior for cross-context reports.
- Integrate report/admin endpoints with Phase 42 identity, CSRF, origin,
  request-shape, rate, logging, metrics, and operational controls.

## Constraints

- Runtime policy, context scope, field masking, and read-model semantics remain
  the authority. Reporting/admin HTTP code may not become a second policy
  engine or return raw projection JSON.
- Do not place report SQL, export formats, operational roles, providers, or
  database structures in ADL syntax. PostgreSQL remains an implementation
  projection.
- Preserve opaque-session identity-only behavior; do not add bearer roles,
  browser-stored credentials, or a generic database administration API.
- All reports, exports, audit views, and recovery views must be bounded,
  policy-shaped, audited, rate limited, and redacted in logs/errors/metrics.

## Deliverables

- Typed authoritative reporting/admin services and HTTP endpoints that consume
  the resolved model and Phase 42 boundary.
- Policy-shaped report/export and audit/access-audit administration behavior
  with pagination, limits, and explicit audit events.
- Database projection/query design, retention implications, operator runbook
  additions, threat-model update, and test fixtures.

## Acceptance Criteria

- A caller cannot use report/admin endpoints to disclose cross-context rows,
  masked fields, raw audit payloads, session/invite verifiers, outcomes, or
  records unavailable through normal runtime read policy.
- Exports/reports are bounded and policy-authorized server-side; crafted
  filters, contexts, cursors, roles, and requested fields cannot bypass scope.
- Administration actions are session/CSRF/origin/rate protected, emit redacted
  access audit, and take effect through existing authority services.
- HTTP/integration tests cover unauthenticated, revoked, cross-origin, CSRF,
  malformed, oversized, rate-limited, cross-context, masked-field, and export
  enumeration attempts.
- Run `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run
  build`; run `npm run verify:push` if browser rendering, shell controls,
  reference screens, presentation output, or CSS changes.

## Non-goals

- General SQL consoles, customer-defined SQL, BI connectors, spreadsheet UI,
  broad account management, new identity flows, or browser presentation work.
- New sync protocol, database engine, ADL syntax, or bypass of recovery and
  policy services.

## Tasks

1. Inventory accepted-record, runtime-audit, access-audit, recovery, and
   retention projections and define report/admin trust boundaries.
2. Implement policy-shaped authoritative report/read-model execution and
   bounded cursor/export behavior.
3. Implement narrowly scoped access/recovery administration through existing
   lifecycle/session services and record auditable events.
4. Extend the Phase 42 HTTP boundary, metrics, redacted logs, and runbooks.
5. Add threat-model, unit, HTTP integration, and operational recovery tests.
6. Update specifications, documentation, and learnings with reusable findings.
7. **Required next-phase planning handoff:** before Phase 43 closes, replace
   the Phase 44 placeholder with a complete evidence-based executable phase
   document. Define its objective, scope, constraints, deliverables,
   acceptance criteria, tests/verification, non-goals, dependencies, and its
   required next-phase planning handoff; then verify, commit, and push Phase 43.
