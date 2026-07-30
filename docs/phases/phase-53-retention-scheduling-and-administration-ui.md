# Phase 53 - Retention Scheduling and Administration UI

> Renumbered from Phase 49 by the Phase 47 handoff, then 50, then 51, and now
> Phase 53: the Phase 48 handoff moved the platform contract phase (now Phase 51)
> ahead of it, and that handoff's follow-up inserted passkey identity (Phase 49)
> and offline session grace (Phase 50), both of which gate deployment. This phase
> still follows the membership projection, because its administration surface
> consumes those scoped membership reads. Evidence and scope are
> unchanged; only its position in the sequence moved.

## Objective

Turn the two administration capabilities that exist only as services into
operable surfaces: run retention on a schedule with operator visibility, and give
the Phase 43 reporting and administration reads a browser surface instead of raw
HTTP.

## Evidence and Dependency

- **Retention never runs.** Phase 45 built `AuthorityRetentionService` with a
  safeguarded `prune` path (`src/server/authority-retention.ts`), and the
  membership-projection phase (now Phase 52) explicitly listed a scheduler or HTTP
  surface for it as a non-goal. Nothing invokes it: there is no scheduler, no
  administrative endpoint, and no operator procedure, so the runtime-audit and
  operation-outcome projections would grow without bound in any real deployment
  created by Phase 46. Phase 48 established that no such deployment exists yet,
  which is why this phase sits behind work whose value does not depend on one.
- **Administration is HTTP-only.** Phase 43 delivered
  `AuthorityReportingService` (including `exportCsv`,
  `authoritative-reporting.ts:152`) and `AuthorityAdministrationService`, exposed
  at `/v1/reports/execute`, `/v1/reports/export`, and the `/v1/admin/*` routes
  (`authority-http.ts:146,151,174-194`). `src/ui/components/` contains no
  reporting or administration component, so audit review, membership and invite
  status, recovery status and session revocation are reachable only with a
  hand-built request. After Phase 46 there is a real deployment whose operator
  has no way to use them.

This phase depends on Phase 45 retention safeguards, Phase 52 scoped membership
reads, and the Phase 46/47 client transport and session UI.

## Scope

- A retention execution path with an operator-triggerable administrative surface
  and a schedulable process entry, including dry-run reporting of what would be
  pruned, metadata-only status, and honouring the Phase 45 legal-hold and
  minimum-retention safeguards.
- Retention observability: structured security log events and metrics counters
  for runs, deletions by projection, skips due to hold, and failures.
- Browser administration surfaces over the existing Phase 43 endpoints: report
  execution and CSV export, access-audit and runtime-audit review, membership and
  invite status, recovery status, and session revocation.

## Constraints

- Retention must never delete an accepted record, in-retention audit, or
  in-retention outcome, and must honour legal hold. A scheduled run must be
  idempotent and safe to overlap or retry.
- Retention status, logs and metrics stay metadata-only: no accepted records, no
  audit payloads, no tokens or verifiers, no outcome bodies.
- Administration UI must add no authority: every read and action goes through the
  existing endpoints, and the server keeps deriving identity, roles and scope.
  The UI must not become a second policy or scope implementation.
- Administration review stays bounded, actor-bound and metadata/status only.
  Export must not become an arbitrary query surface or a way to widen disclosure
  beyond the caller's normal runtime reads.
- Session revocation from the UI must be reversible only through normal identity
  flows and must not let an operator escalate their own access.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope/retention, and
  Phase 52 scoped membership reads.

## Deliverables

- Retention execution surface, schedulable entry point, dry-run mode, safeguards,
  observability, and operator runbook procedure.
- Administration and reporting UI components for reports/export, audit review,
  membership and invite status, recovery status, and session revocation.
- Real-backend tests for scheduled retention and each administration surface,
  plus runbook, `docs/server-authority.md`, threat-model and learnings updates.

## Acceptance Criteria

- Retention runs on a schedule against a real deployment, prunes only
  out-of-retention runtime-audit and outcome rows, and leaves accepted records,
  in-retention rows and held rows untouched, proven against real PostgreSQL.
- A dry run reports what would be pruned without deleting anything, and neither
  mode prints protected data.
- Overlapping or repeated retention runs are safe and produce no double-deletion
  or partial-state failure; a failure mid-run leaves the projections consistent.
- Retention runs, deletions by projection, hold skips and failures appear in
  metrics and the structured log with no protected payloads.
- An authorised operator executes a report, exports it as CSV, reviews access and
  runtime audit, reviews membership and invite status, checks recovery status and
  revokes a session, entirely from the browser.
- An unauthorised or wrongly scoped caller sees no additional data through any UI
  surface than the endpoint already permits, and denied rows remain
  indistinguishable from absent rows.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push` with
  screenshot inspection.

## Non-goals

- New report semantics, BI connectors, generic SQL exposure, or an arbitrary
  query builder.
- New identity flows, provider selection, or changes to the Phase 46 identity
  switch.
- Conformance depth or model migrations, which are Phase 51 and precede this
  phase; band-app modelling gaps (Phase 54).
- External job runners, message queues, or distributed scheduling
  infrastructure: a single schedulable process entry is sufficient.

## Dependencies

- Phase 45 retention safeguards and application-scoped outcomes.
- Phase 43 reporting and administration services and endpoints.
- Phase 46 deployment slice and Phase 47 session/identity UI.
- Phase 52 scoped membership reads.

## Parallel Execution Plan

Two independent workstreams: retention (server/ops) and administration UI
(browser). They share only `src/index.ts` and the metrics/log surfaces.

Serial spine first:

1. Retention status and administration view-state types, plus metrics counter
   names. One agent, skeleton-first.

Fan out after the spine:

- Retention execution surface, dry-run and safeguards.
- Retention scheduling entry and observability wiring.
- Administration UI: one agent per surface group (reports/export, audit review,
  membership/invite/recovery status and session revocation).
- Documentation bundle: runbook retention procedure,
  `docs/server-authority.md`, threat model, learnings.

Keep serial:

- Metrics and structured-log registration, which both retention streams touch.
- `src/ui/components/register.ts` and shell chrome for the UI streams.
- `src/index.ts` exports.

Barriers: one integration run after retention and the first UI surface land, then
a single `npm run verify:push` at the end. Retention tests mutate projection
state, so run them in their own database rather than sharing one with the
administration tests when they execute concurrently.

Use worktree isolation for the administration UI streams.

## Tasks

1. Inventory the retention service surface, its safeguards, and every
   administration and reporting endpoint with the exact disclosure boundary each
   one enforces; confirm the evidence above against current code.
2. Build the retention execution surface with dry-run, safeguards, idempotency
   and metadata-only status, and a schedulable process entry.
3. Add retention observability: metrics counters and structured log events for
   runs, deletions, hold skips and failures.
4. Build the administration and reporting UI over the existing endpoints, adding
   no authority and no second scope implementation.
5. Add real-backend tests: scheduled and dry-run retention including hold and
   minimum-retention cases, overlap and failure safety, and each administration
   surface including an unauthorised and a wrongly scoped caller.
6. Update the runbook with the retention operating procedure,
   `docs/server-authority.md`, the threat model, and learnings.
7. **Required next-phase planning handoff:** before Phase 53 closes, review
   `docs/phases/phase-54-reference-app-gaps-and-documentation-hygiene.md` and
   revise it if this phase's results change its scope, constraints, deliverables,
   or tasks. The handoff must justify Phase 54 as the highest-value remaining gap
   repository-wide. Then verify, commit, and push Phase 53.
