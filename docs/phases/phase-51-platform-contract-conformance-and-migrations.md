# Phase 51 - Platform Contract: Conformance Depth and Model Migrations

> Moved up from Phase 51 to Phase 49 by the Phase 48 handoff, then back to Phase
> 51 by that handoff's follow-up, which inserted real passkey identity (Phase 49)
> and offline session grace (Phase 50) ahead of it. Nothing about this phase's
> value changed; two phases that gate deployment became executable once the
> identity method was decided (`docs/adr/0008-passkey-identity-and-offline-session-grace.md`).
> The original reason for moving it up still holds and now applies to three
> contract changes rather than one: Phase 48 changed the create intent, Phase 49
> changes the identity shape, and Phase 50 adds an app-level model property. This
> phase codifies and migrates all three. Phase 48's
> own rationale for placing this phase after it was that "this phase changes the
> contract, that phase codifies it" — which argues for codifying it *next*, while
> the change is fresh, rather than after two phases that optimise and operate a
> subsystem with no users. The two phases it overtook are, by their own evidence,
> an optimisation of an unpopulated projection and an operational surface that
> needs a deployment to matter; this phase's conformance half is a repository-wide
> gap independent of any deployment, and its migration half is a prerequisite for
> a deployment ever holding data. Scope is unchanged except where the Phase 48
> findings below correct it.
>
> **Phase 50 handoff (confirmed).** Phase 50 landed the declared offline grace,
> the model-derived session lifetime, persistent cookies, session rotation, the
> browser sync gate and cached identity, and the self-service device list. With
> Phase 49 it closes the gate that stopped a deployment holding real user data.
> This phase is the highest-value remaining gap **repository-wide**, and Phase 50
> sharpened the argument rather than merely leaving it intact:
>
> - **The migration half is now the last pre-deployment blocker.** Phases 49 and
>   50 together satisfy the standing rule, so a deployment *may* now hold real
>   user data — and the moment one does, a model change destroys it, because
>   there is still no migration path on either side. Every prior phase could say
>   "no deployment exists yet, so this is not urgent". That sentence has just
>   stopped being available.
> - **Phase 50 supplied a demonstrated instance of the gap, with a security
>   consequence.** See the third evidence item below: a model *content* change is
>   not a model *version* change, so the guard never fires, and an author who
>   shortens `OFFLINE_GRACE` silently shortens every device's session while every
>   device still believes it has the old window. This is no longer an abstract
>   "models should be able to evolve" argument.
> - **The conformance half gained a third uncovered contract change**, and the
>   first one that is a model property rather than a runtime behaviour.
>
> The alternatives were weighed and are genuinely lower value: Phase 52
> (membership projection) and Phase 53 (retention scheduling and administration
> UI) are optimisation and operation of a system that already functions, and
> Phase 54 is reference-app and documentation hygiene. None of the three risks
> data. Phase 50 did produce one input to Phase 53 — rotation writes a session row
> per restart of the grace and nothing prunes revoked or expired rows — which is
> recorded there rather than used to re-sequence, because revoked and expired rows
> are excluded from every user-facing surface and unbounded row growth is an
> operational concern, not a correctness or disclosure one.
>
> **Correction from Phase 48.** The previous evidence asserted that "after Phase 46
> and 47 there is a real deployment with real PostgreSQL accepted records and real
> browser IndexedDB state". Phase 48 established, with evidence, that no deployment
> exists: no deployment artifact, container image, CI pipeline or hosting
> configuration in the repository; the only committed environment file is a sample
> with `CHANGE_ME` placeholders; and the browser only syncs when built with
> `VITE_ADL_AUTHORITY_URL`, which nothing sets. The migration gap is therefore a
> **pre-deployment blocker**, not an active data-loss risk — which is a better
> position to fix it from, not a reason to defer it.

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
  three-layer spec; phases 24-48 added presentation, matrix, calendar, semantic
  status, authority replay, scoping and record-identity semantics without a
  matching growth in contract cases. A second runtime implemented against this
  suite today would not be constrained to ADL's actual semantics.
- **The newest contract changes are uncovered.** Phase 48 made the create intent
  carry the client's record id, made a colliding id a rejection rather than an
  overwrite, and made a malformed id a refusal enforced independently at the HTTP
  edge and in the runtime. Phase 50 added `app.offlineGraceDays` with a default
  of 30, a 1-365 bound, and the `ADL_APP_OFFLINE_GRACE_INVALID` diagnostic —
  the **first resolved-model property added since the suite was written**, and
  therefore the first case of a defaulted, validated app-level value the suite
  has to be able to express at all. None of this is expressible today, and it is
  exactly the kind of semantics a second runtime would get wrong.
- **A model content change is not a model version change — verified in Phase
  50.** `resolveApplicationModel` sets `modelVersion: input.modelVersion ??
  ADL_MODEL_VERSION` (`resolve-model.ts`), `ADL_MODEL_VERSION` is the constant
  `"0.1.0"` in `src/model/defaults.ts`, and there is **no ADL syntax to set it**:
  the parser has no version directive and `compile-adl.ts` never populates the
  field. `startup-compatibility.ts:31` compares only that string against
  persisted metadata. So editing `OFFLINE_GRACE 30 DAYS` to `7 DAYS`, or any
  other model content, leaves the version identical and the guard silent. For
  the grace specifically that has a security consequence, because the authority
  derives its session lifetime from that value: it starts issuing 7-day sessions
  while every already-running device still believes it has 30 and only discovers
  otherwise when a sync is refused. Phase 50 deliberately did not fix this — its
  non-goals assign migration across a model version change here — but a migration
  path is worth little if nothing makes a change *be* a version change, so
  deciding how a model version is derived or declared belongs in this phase's
  scope.
- **There is no migration path for persisted data.** Phase 11 deliberately
  shipped a version guard only: its task list says "Avoid implementing full
  migrations; add only the smallest placeholder or interface if needed to keep
  diagnostics clean". `src/runtime/startup-compatibility.ts` contains no
  migration logic. Before Phase 46 this was harmless because all data was
  disposable demo data. Phases 46 and 47 built the paths that will hold real
  PostgreSQL accepted records and real browser IndexedDB state, and a model change
  means a wipe on both sides of them. No deployment holds data yet (see the
  correction above), so this is the last moment at which the migration path can be
  built without also having a live migration to perform.

This phase depends on the Phase 46/47 persistence paths existing on both the
server and the client, and on the existing startup compatibility guard.

## Scope

- Grow the conformance suite to cover the semantics added since Phase 23:
  expression evaluation breadth, validation and decision tables, lifecycle guards
  and command preconditions, computed fields and read-model projections, context
  scope and policy decisions, sync-mode behaviour, presentation resolution
  including status, matrix and calendar semantics, and authority outcome
  classification — the last of which now includes Phase 48 record identity: a
  create carrying its own id, a collision refused rather than merged, and a
  malformed id refused before storage. Add app-level resolution and validation
  cases for Phase 50's `app.offlineGraceDays`: the default when undeclared, the
  declared value when present, and `ADL_APP_OFFLINE_GRACE_INVALID` for a
  non-positive, fractional or out-of-range value.
- **Decide how a model version is derived or declared**, so that a model content
  change can be one. This is a prerequisite for the migration work rather than an
  addition to it: today `ADL_MODEL_VERSION` is a platform constant with no ADL
  syntax behind it, so the compatibility guard never fires on a model edit and a
  migration path would have nothing to trigger it. Either derive the version from
  the resolved model's content or give ADL a way to declare it; whichever is
  chosen, changing `OFFLINE_GRACE` must stop being silent.
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
- Preserve Phase 44 atomicity, Phase 45 retention/scope, Phase 48 record-identity
  rules, and the disclosure boundaries throughout: migration diagnostics stay
  metadata-only. Membership-projection scoping is now Phase 52 and follows this
  phase, so there is nothing of it to preserve yet.
- **Preserve Phase 50's session and grace behaviour.** The authority derives its
  session lifetime from `app.offlineGraceDays` at startup, so anything that
  changes how a model version or model content reaches the process must keep
  `resolveSessionLifetime` running before the session adapter and HTTP edge are
  composed. A migration that shortens the declared grace must not retroactively
  invalidate sessions already issued under the longer one without saying so —
  those devices are offline by definition and cannot be told.
- **A model version change must not become a reason to destroy the cached
  identity.** `{ userId, lastVerifiedAt }` in IndexedDB is what stops a signed-in
  user losing their own data on an offline reload. It is not a record and carries
  no schema of its own; clearing it as part of a persisted-state migration would
  reintroduce the exact defect Phase 50 closed.

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
- Band-app modelling gaps and documentation hygiene (Phase 54).
- The membership projection (Phase 52) and retention scheduling (Phase 53).
- New ADL syntax for storage, SQL, or migration mechanics beyond declaring a
  model migration.

## Dependencies

- Phase 23 conformance suite and three-layer spec.
- Phase 11 model versioning guard and startup compatibility checks.
- Phase 44 atomicity, Phase 45 scope/retention.
- Phase 46/47 server and client persistence paths, and the Phase 48 create-intent
  contract this phase codifies.
- Phase 50's `app.offlineGraceDays`, the model-derived session lifetime, and the
  cached browser identity — the first two are codified here, the third is
  preserved.

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
- Sync-mode behaviour and authority outcome classification, including Phase 48
  record identity and collision refusal.
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
   in the existing format — including app-level resolution and validation, which
   Phase 50's `app.offlineGraceDays` is the first property to need.
3. Decide and implement how a model version is derived or declared, so a model
   content change is a version change and the compatibility guard fires on one.
   Do this before the migration work: a migration path needs something to trigger
   it.
4. Author conformance cases per layer, recording any semantic defect found rather
   than adjusting the case.
5. Fix revealed runtime defects explicitly and record them in learnings.
6. Implement model migration for server accepted records and browser persisted
   records through the existing compatibility guard, fail-closed, atomic on the
   server.
7. Add real-backend and browser tests: successful migration, unappliable
   migration refusal, mid-migration failure rollback, and no-data-loss
   verification.
8. Update the three-layer specification, the runbook migration procedure, and
   learnings.
9. **Required next-phase planning handoff:** before Phase 51 closes, review
   `docs/phases/phase-52-authority-membership-projection-and-scoped-access.md` and
   revise it if this phase's results change its scope, constraints, deliverables,
   or tasks. The handoff must justify Phase 52 as the highest-value remaining gap
   **repository-wide**, not merely the next gap in the subsystem this phase
   touched; if a higher-value gap exists elsewhere, say so and re-sequence. Then
   verify, commit, and push Phase 51.
