# Phase 40 - Remote Dataset Bootstrap and Conflict Resolution

## Objective

Build on Phase 39's typed TypeScript authority boundary to let an authenticated
browser safely obtain and reconcile only its policy- and context-permitted
remote dataset. Make stale revisions, rejections, conflicts, and manual
resolution explicit and durable in the local sync experience.

## Scope

- A policy-shaped, authenticated bootstrap/pull transport over the Phase 39
  authority service; records, errors, audit, and conflict responses must not
  disclose records the current server-resolved identity cannot read.
- A PostgreSQL accepted-state reader backed by the Phase 39 record projection,
  including model/schema compatibility checks and pagination/cursors that do
  not permit cross-context enumeration.
- IndexedDB persistence for browser sync queue entries and reconciliation state,
  with startup compatibility checks for that new persisted state.
- Reconciliation of accepted records, rejected writes, conflict outcomes and
  manual-resolution outcomes into local records, operation log, sync queue, and
  existing sync presentation state.
- Deterministic conflict data and user-facing recovery entry points that remain
  server-authoritative. Use model conflict policy (`serverWins`, `clientWins`,
  `stateTransitionWins`, `manual`) rather than client-specific heuristics.
- Giggle Band tests for admin/member datasets, a remote change after offline
  work, conflict/manual resolution status, and no local-private transmission.

## Constraints

- Reuse `AuthoritySessionAdapter`, `AuthorityService`, typed operation outcomes,
  and the shared resolved-model runtime. Do not add ADL syntax for routes, SQL,
  sessions, cursors, or provider settings.
- Treat the browser as untrusted: every pull and resolution action derives
  identity, memberships and roles server-side and applies read policy before a
  response is emitted.
- Do not replace operation-intent replay with blind row replacement, Automerge,
  peer-to-peer replication, or a second runtime.
- Preserve `localPrivate`, `cacheReadonly`, and `onlineRequired` semantics.
- Add a PostgreSQL object-storage/transaction implementation if Phase 39's
  in-process test backend has not already been replaced; accepted records,
  audit and idempotent outcomes must commit atomically.

## Deliverables

- Authenticated bootstrap/pull contract and authority handler with cursor and
  policy/context shaping.
- PostgreSQL accepted-state read/storage transaction implementation and
  integration-test database lifecycle documentation.
- Persistent browser queue and reconciliation state behind existing runtime
  persistence boundaries.
- Runtime/client reconciliation service and compact sync status presentation.
- Integration and browser tests, documentation, and learnings.

## Acceptance Criteria

- A user receives only records and fields allowed by server-derived identity,
  context memberships, and ADL read policy; crafted context/user/role inputs do
  not expand the dataset.
- Reconnect reconciles queued local-first entries exactly once and persists the
  resulting accepted/rejected/conflict/manual state across browser reload.
- Stale base revisions are deterministic and model conflict policy selects the
  recovery state without leaking a protected server record.
- Local-private records and their operation data are never sent or included in
  bootstrap responses.
- PostgreSQL integration tests prove restart persistence, atomic accepted
  writes/audit/outcomes, membership isolation, and cursor isolation.
- `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run build`
  pass. Run and inspect `npm run verify:push` if browser rendering or CSS changes.

## Non-goals

- Account recovery, invite claiming, rate limiting, production deployment,
  background scheduling, reporting, CRDT/Automerge replication, or a complete
  conflict-resolution UI.

## Tasks

1. Inventory Phase 39 authority interfaces and browser local persistence.
2. Design typed, policy-shaped pull/bootstrap and conflict payloads.
3. Implement PostgreSQL accepted-state reads and transactional projection.
4. Persist sync queue/reconciliation state in IndexedDB with compatibility checks.
5. Implement reconciliation and recovery-state mapping.
6. Add Giggle Band security, PostgreSQL, and browser integration coverage.
7. Document setup/trust boundaries and update learnings.
8. **Required next-phase planning handoff:** before Phase 40 closes, replace the
   Phase 41 placeholder with a complete, evidence-based executable phase
   document. It must use the implemented authority bootstrap, persisted sync
   state, `StaticSessionAdapter` limitation, and access boundary results to
   define Phase 41's objective, scope, constraints, deliverables, acceptance
   criteria, tests/verification, non-goals, dependencies, and its required
   Phase 42 planning handoff. Then verify, commit, and push the phase.
