# Phase 50 - Platform Contract: Conformance Depth and Model Migrations

## Objective

Make the two claims ADL makes about itself true: that the conformance suite is
the cross-runtime contract, and that a model can evolve without destroying
persisted data.

## Evidence and Dependency

- **The conformance suite is thin for its stated role.** ADR 0004 names the
  conformance suite as the cross-runtime contract and ADR 0005 makes the
  TypeScript runtime the semantic reference, but the suite is three files with 28
  cases in total: `conformance/runtime/core.json` (18),
  `conformance/presentation/ui.json` (6), and
  `conformance/expressions/basic.json` (4). Phase 23 delivered the suite and the
  three-layer spec; phases 24-49 added presentation, matrix, calendar, semantic
  status, authority replay and scoping semantics without a matching growth in
  contract cases. A second runtime implemented against this suite today would not
  be constrained to ADL's actual semantics.
- **There is no migration path for persisted data.** Phase 11 deliberately
  shipped a version guard only: its task list says "Avoid implementing full
  migrations; add only the smallest placeholder or interface if needed to keep
  diagnostics clean". `src/runtime/startup-compatibility.ts` contains no
  migration logic. Before Phase 46 this was harmless because all data was
  disposable demo data. After Phase 46 and 47 there is a real deployment with
  real PostgreSQL accepted records and real browser IndexedDB state, and a model
  change means a wipe on both sides.

This phase depends on the Phase 46/47 deployment having real persisted state on
both the server and the client, and on the existing startup compatibility guard.

## Scope

- Grow the conformance suite to cover the semantics added since Phase 23:
  expression evaluation breadth, validation and decision tables, lifecycle guards
  and command preconditions, computed fields and read-model projections, context
  scope and policy decisions, sync-mode behaviour, presentation resolution
  including status, matrix and calendar semantics, and authority outcome
  classification.
- Define and implement model migration for persisted state on both sides: server
  accepted-record projection and browser IndexedDB records, driven by the
  resolved model's version metadata and executed through the existing
  compatibility guard rather than a second versioning scheme.
- A migration authoring and verification path: how a model change declares its
  migration, how it is applied, how it is verified, and what happens when it
  cannot be applied.

## Constraints

- Conformance cases assert ADL semantics, not implementation details. A case must
  be expressible against any conforming runtime; it must not depend on
  TypeScript internals, file layout, or private APIs.
- Growing the suite must not change runtime behaviour. If a case reveals a
  semantic defect, fix it explicitly and record it, rather than adjusting the
  case to match current behaviour.
- Migration is a runtime and persistence concern, not an ADL language construct
  for SQL or storage engines. It must not become a transpiler step.
- A migration must be fail-closed: an unapplied or unappliable migration must
  refuse to serve or read stale persisted state rather than silently operating on
  it. Never destroy persisted data as a fallback path.
- Server migration must respect Phase 44 atomicity: an accepted-record migration
  commits atomically and cannot leave the projection half-migrated. Browser
  migration must not fabricate operation-log, audit or queue side effects, per
  the existing trusted sync-projection boundary.
- Preserve Phase 45 retention/scope, Phase 48 membership scoping, and the
  disclosure boundaries throughout: migration diagnostics stay metadata-only.

## Deliverables

- A substantially expanded conformance suite with cases for every semantic layer
  added since Phase 23, and an updated three-layer specification where cases
  reveal gaps or ambiguity.
- Model migration support for server accepted-record projection and browser
  persisted records, wired through the existing startup compatibility guard,
  with fail-closed behaviour.
- A documented migration authoring and verification procedure, real-backend and
  browser tests, runbook and specification updates, and learnings.

## Acceptance Criteria

- The conformance suite covers each semantic layer added since Phase 23, and
  every case passes against the TypeScript reference runtime.
- Any semantic defect the new cases reveal is fixed in the runtime and recorded,
  not absorbed by weakening the case.
- A model version change with a declared migration migrates existing server
  accepted records and existing browser records, and the application operates
  normally afterwards with no data loss, proven against real PostgreSQL and real
  IndexedDB.
- A model version change with no applicable migration is refused fail-closed on
  both sides with a clear diagnostic, and no persisted data is destroyed.
- A server migration failure rolls back atomically and leaves the projection in
  its pre-migration state.
- Migration diagnostics, logs and status expose no accepted records, audit
  payloads, tokens or outcome bodies.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`; run `npm run verify:push` if
  presentation conformance cases change renderer output.

## Non-goals

- A second runtime implementation in another language: this phase makes the
  contract adequate for one, it does not build one.
- Automatic migration inference for arbitrary model changes, or schema
  migration for the authority projection tables themselves, which remain ordered
  SQL files applied out of band.
- Band-app modelling gaps and documentation hygiene (Phase 51).
- New ADL syntax for storage, SQL, or migration mechanics beyond declaring a
  model migration.

## Dependencies

- Phase 23 conformance suite and three-layer spec.
- Phase 11 model versioning guard and startup compatibility checks.
- Phase 44 atomicity, Phase 45 scope/retention, Phase 48 membership scoping.
- Phase 46/47 real persisted state on both server and client.

## Parallel Execution Plan

This phase parallelises better than any other in the sequence: conformance cases
are independent files, and migration is a separate workstream.

Serial spine first:

1. Conformance case schema extensions, if the existing case format cannot express
   the new layers, and the migration declaration and execution signatures. One
   agent, skeleton-first, no consumers.

Fan out after the spine, one agent per semantic layer, each writing its own
conformance file:

- Expression evaluation breadth.
- Validation, decision tables, lifecycle guards, command preconditions.
- Computed fields and read-model projections.
- Context scope and policy decisions.
- Sync-mode behaviour and authority outcome classification.
- Presentation resolution, semantic status, matrix, calendar.

In parallel with those, two migration agents:

- Server accepted-record migration inside the Phase 44 commit boundary.
- Browser persisted-record migration through the compatibility guard.

Keep serial:

- The conformance runner and case schema, which every case file consumes.
- Any runtime fix a case reveals: route these through one agent so two fixes
  never race on the same semantic surface.
- Specification updates, which must reconcile findings from all layers at once.
- `src/index.ts` exports.

Barriers: collect every layer's findings before the specification update, because
that update genuinely needs all results together. Then one integration run and,
only if presentation output changed, one `verify:push`.

Use worktree isolation for the migration agents; conformance case agents write
disjoint files and do not need it.

## Tasks

1. Inventory current conformance coverage against every semantic layer shipped
   since Phase 23 and produce the explicit gap list this phase must close.
2. Extend the case schema and runner only where a new layer cannot be expressed
   in the existing format.
3. Author conformance cases per layer, recording any semantic defect found rather
   than adjusting the case.
4. Fix revealed runtime defects explicitly and record them in learnings.
5. Implement model migration for server accepted records and browser persisted
   records through the existing compatibility guard, fail-closed, atomic on the
   server.
6. Add real-backend and browser tests: successful migration, unappliable
   migration refusal, mid-migration failure rollback, and no-data-loss
   verification.
7. Update the three-layer specification, the runbook migration procedure, and
   learnings.
8. **Required next-phase planning handoff:** before Phase 50 closes, review
   `docs/phases/phase-51-reference-app-gaps-and-documentation-hygiene.md` and
   revise it if this phase's results change its scope, constraints, deliverables,
   or tasks. The handoff must justify Phase 51 as the highest-value remaining gap
   repository-wide. Then verify, commit, and push Phase 50.
