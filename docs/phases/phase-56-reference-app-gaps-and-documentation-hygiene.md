# Phase 56 - Reference App Gaps and Documentation Hygiene

> Renumbered from Phase 51 by the Phase 47 handoff, then 52, 53, 54, 55, and now
> Phase 56 by the Phase 52 handoff. It remains last, and its evidence and scope
> are unchanged; only its position in the sequence moved.

> **Phase 55 handoff (kept in sequence; accepted).** Phase 55 gave retention an
> execution path — a schedulable one-shot entry, an optional in-process interval,
> a dry run, four per-projection guards and a metadata-only run log under a
> per-application advisory lock — and put the Phase 43 reporting and
> administration reads behind browser surfaces for the first time.
>
> **This phase is now the highest-value remaining gap repository-wide, and it is
> the only phase document left.** That is not the whole justification, so here is
> the rest: Phase 55's browser project found five defects in the signed-in path
> that no other layer could see, two of which made the deployed application a dead
> end for a real user. That is direct evidence that the *reference app*, and the
> documentation describing it, is where the remaining risk lives — which is
> exactly this phase's subject. Nothing Phase 55 touched on the server side is
> left incomplete, and no user-visible defect remains open.
>
> Five adjustments this phase's results make to the work below:
>
> - **`EXPORT` policy is a gap of the same shape as `StreamingLink`'s sync mode,
>   and it is now half-closed.** Phase 43 delivered CSV export; the reference app
>   declared no `EXPORT` rule on any object, so a Phase 43 capability was
>   unreachable in the only application this repository has. Phase 55 added
>   `allowBandAdminExportEvents` and `allowAvailabilityOwnerExport` because its own
>   acceptance criterion required a demonstrable export. **The triage in Task 1
>   must now cover every runtime action against every object**: a declared
>   capability with no modelled permission is a gap, and this one was invisible
>   until somebody tried to use it. Check `import` and `search` the same way.
> - **The gap report needs a new category.** It currently lists platform
>   capabilities the app wants and cannot express. This phase should also record
>   platform capabilities the app *can* express and does not — the export rules
>   above, `StreamingLink`'s mode — because both leave a delivered feature
>   undemonstrable, and only the first kind is currently tracked.
> - **`docs/architecture/target-architecture.md:232` still numbers this work as
>   "Phase 55".** It is Phase 56. Fold this into Task 7's reconciliation; the
>   sequencing drift the evidence already describes is wider than that section.
> - **Two learning documents were added or extended and are now required reading
>   for this phase**: `learnings/implementation/retention-scheduling-and-administration-ui.md`
>   (its "What the browser project found that nothing else could" section bears
>   directly on how this phase should verify reference-app work) and the reference
>   app entry in `learnings/index.md`.
> - **The demo seeds local data that the authority then rejects, and the user is
>   shown every rejection.** `src/ui/main.ts` calls
>   `seedBandReferenceRuntimeIfEmpty` unconditionally, including when
>   `VITE_ADL_AUTHORITY_URL` is set. Those seeded writes enter the sync queue, the
>   authority refuses them — the seeded identity may not create a `User` or a
>   `Band` — and every refusal lands in the "Changes that need your attention"
>   panel. Phase 55's screenshots show the panel filled with `ADL_POLICY_DENIED`
>   entries before the operator has done anything at all. This is not a defect in
>   sync recovery, which is reporting the verdicts it was given correctly; it is
>   the reference app writing demo data into a deployment that has a real source
>   of truth. It is pre-existing — the `passkey` project has the same condition —
>   and it is not a disclosure or an integrity risk, which is why Phase 55 did not
>   re-sequence for it. But it is the first thing a real operator sees, it makes
>   every authority-configured screenshot hard to read, and it is a reference-app
>   decision rather than a platform one, so it belongs here. Decide whether a demo
>   with an authority configured should seed at all, and fix the fixture rather
>   than the recovery surface.
> - **Verification must include a browser pass over the reference app with an
>   authority configured, not only the default visual projects.** Phase 55 added
>   an `administration` Playwright project on port 5373 with its own throwaway
>   authority. The default `desktop`/`mobile` projects run with no authority, so
>   they cannot see the signed-in path at all — which is precisely how the five
>   defects survived. Any reference-app change this phase makes to context
>   selection, shell chrome or sync behaviour must be checked against the
>   `administration` and `passkey` projects too.

## Objective

Close the platform capability gaps the Giggle Band reference app has been
documenting since Phase 18, and bring the planning and architecture
documentation back into line with what the repository actually contains.

## Evidence and Dependency

- **Documented platform gaps are still open.**
  `docs/reference/band-app-gap-report.md` lists behaviours that remain "platform
  design candidates" after Phase 18 promoted the rest: a context grant for
  pending invitations separate from membership; reverse joins or multi-hop
  read-model sources through `BandMember` for availability projection; a
  command-created context grant so band creation can create its context and
  initial membership in one command; generic set-list reorder helpers and
  compaction after removal; batch commands for song import, batch set-list item
  creation and drag-reorder updates; and ADL `SHELL`, `TOP_BAR` and `NAV_DRAWER`
  source syntax, the browser shell being generic but not model-declared.
- **`StreamingLink` is declared with a mode that has no producer.**
  Recorded by the Phase 53 mode-by-mode audit. `src/reference/giggle-band/domain.adl:207`
  declares `SYNC CACHE_READONLY`, which means the data is owned elsewhere and
  cached read-only on a device: no local write and no authority replay may create
  one, and Phase 53 confirmed both refusals are correct and deliberate. But the
  app presents `StreamingLink` as ordinary band data with an entry-shaped list
  view, so no user of the deployed app can ever populate it. Either the object is
  band-authored and the mode is wrong, or it is genuinely externally owned and
  the app needs to say where it comes from. Decide which, and fix the model
  rather than the platform.
- **Planning documentation has drifted.**
  `docs/architecture/target-architecture.md` still ends its "Sequencing" section
  at "Phase 20 ... Phase 23" and says "Server implementation should wait until
  the expression/logic model is stable", eleven phases after the server shipped.
  `docs/server-authority.md:51` has an empty `## Deferred work` heading with no
  content beneath it. Both are read at the start of phases per `AGENTS.md` and
  `learnings/index.md`, so stale content actively misleads the next execution.

This phase depends on the Phase 51 and 52 conformance suite, which must be extended
alongside any new generic capability, and on the Phase 46/47 real deployment,
which determines which gaps still matter.

## Scope

- Triage the open band-app gaps against the delivered platform: implement those
  that are genuine generic capabilities, and explicitly close as unnecessary any
  that Phase 46-50 or earlier work has already made moot.
- Decide `StreamingLink`'s sync mode. It is declared `cacheReadonly` and offered
  as user-entered band data, which cannot both be true; the platform behaviour is
  correct and settled by Phase 53, so the fix is in the model.
- Decide whether the browser demo seeds local data when an authority is
  configured. It currently does, and every seeded write is then refused by the
  authority and presented to the user as a change needing their attention before
  they have made one.
- Implement the surviving gaps as generic model and runtime capabilities, not as
  app-specific hooks or Giggle-specific code paths.
- Reconcile the planning and architecture documentation: target architecture
  sequencing, the empty deferred-work heading, the superseded-document banners,
  and the phase-execution learning.

## Constraints

- Every capability must be generic. A gap must be closed as a model/runtime
  capability that any ADL application can declare, never as reference-app code,
  an app-specific hook, or UI-only behaviour.
- Policy enforcement stays in runtime services. A new context grant or scoped
  write must not create a path that bypasses policy, validation, lifecycle or
  context scope, and must not let a command grant its caller access they could
  not otherwise obtain.
- Batch and reorder commands must remain atomic and idempotent under the existing
  command transaction semantics, and must be replayable through authority intent
  replay without a new protocol.
- New ADL syntax (`SHELL`, `TOP_BAR`, `NAV_DRAWER`) must resolve into the
  existing presentation resolved model and must not imply a new renderer, a
  transpiler step, or native UI.
- Every new capability requires conformance cases, per the Phase 51 and 52 contract.
- Documentation changes must not rewrite the record of completed phases. Correct
  forward-looking guidance; leave historical phase task lists as they are.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope/retention, and
  Phase 54 membership scoping.

## Deliverables

- A triage record stating, for each documented gap, whether it is implemented in
  this phase or closed as unnecessary, with the reason.
- Generic model and runtime support for the surviving gaps, with conformance
  cases and an updated specification.
- Updated `docs/reference/band-app-gap-report.md` reflecting the closed gaps, and
  a reference app that exercises the new capabilities.
- Reconciled `docs/architecture/target-architecture.md`,
  `docs/server-authority.md`, superseded-document banners, and
  `learnings/process/phase-execution.md`.

## Acceptance Criteria

- Each gap in the report is either implemented generically or explicitly closed
  with a recorded reason; none remains in an undecided state.
- A pending invitation grants a non-member the access needed to respond without
  granting membership, and without the caller having to supply the context.
- Availability projects into selected-band member views through a declared
  multi-hop read-model source, with context scope and read policy still enforced.
- Band creation creates the context and its initial membership in one command
  transaction, atomically, without the command escalating its caller's access.
- Set-list reorder and compaction after removal work through generic ordered
  helpers, preserving the existing positive-position and uniqueness constraints.
- Batch song import, batch set-list item creation and drag-reorder updates
  execute as atomic idempotent commands and replay correctly through the
  authority.
- Shell, top bar and nav drawer are declared in ADL source and resolve through
  the existing presentation model with no renderer-specific behaviour.
- Every new capability has conformance cases and specification coverage.
- `docs/architecture/target-architecture.md` sequencing describes the real
  current state, `docs/server-authority.md` has no empty heading, and no
  forward-looking document contradicts the repository.
- Every runtime action a delivered capability depends on is either granted by the
  reference model or explicitly recorded as intentionally ungranted, so no
  shipped capability is undemonstrable in the only application here.
- Opening the reference app against a configured authority presents no rejected
  changes the user did not make, so the recovery surface means what it says.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push` with
  screenshot inspection: shell declarations change rendering. `verify:push`
  includes the `administration` and `passkey` projects, which are the only ones
  that exercise the signed-in path — inspect their screenshots too, not only the
  `desktop` and `mobile` ones.

## Non-goals

- New reference applications, or Giggle-specific features that are not generic
  platform capabilities.
- CRDT/Automerge replication, a new sync protocol, database engine, or identity
  provider selection.
- Rewriting completed phase documents, or reintroducing anything listed as out of
  scope in the target architecture without a superseding ADR.
- A second runtime implementation.

## Dependencies

- Phase 18 platform gap work and the band app gap report.
- Phase 30-38 UI and presentation phases for shell and reorder surfaces.
- Phase 35 command transaction semantics.
- The Phase 51 and 52 conformance suite and specification.

## Parallel Execution Plan

The gap items are largely independent capabilities, which makes this the widest
fan-out in the sequence, but they land in shared model and runtime files, so
isolation matters more here than elsewhere.

Serial spine first:

1. Triage, then the resolved-model type and validation extensions for every
   surviving gap at once. One agent, skeleton-first: types, defaults and
   validation signatures only, no consumers. Doing this in one pass avoids six
   agents editing `resolved-model.ts` concurrently.

Fan out after the spine, one agent per capability:

- Pending-invitation context grant.
- Multi-hop read-model sources and reverse joins.
- Command-created context grant for band creation.
- Ordered reorder helpers and compaction.
- Batch commands.
- `SHELL`/`TOP_BAR`/`NAV_DRAWER` parser and presentation resolution.

In parallel, independent of all of the above:

- The documentation reconciliation bundle.

Keep serial:

- `resolved-model.ts`, `resolve-model.ts` and `validate-model.ts` after the
  spine: if a capability needs a further change there, queue it through one
  agent rather than editing concurrently.
- The reference app model and fixtures, which every capability wants to touch.
- The specification update, which needs all capability results together.
- `src/index.ts` exports.

Barriers: collect all capability results before the specification and reference
app updates. Then one integration run, then one `verify:push` with manual
screenshot inspection.

Use worktree isolation for every capability agent.

## Tasks

1. Triage each documented gap against the delivered platform and record
   implement-or-close with reasons, including `StreamingLink`'s sync mode and a
   pass over every runtime action (`export`, `import`, `search`, and the rest)
   against every object, looking for delivered capabilities the model never
   grants permission for — the pattern Phase 55 found with CSV export.
2. Extend the resolved model, resolution and validation for every surviving gap
   in one serial pass.
3. Implement each surviving capability generically, with runtime enforcement in
   runtime services.
4. Add ADL source syntax for shell, top bar and nav drawer, resolving into the
   existing presentation model.
5. Add conformance cases and specification coverage for every new capability.
6. Update the reference app to exercise the new capabilities, settle the demo
   seeding question above, and update the gap report to reflect what is now
   closed.
7. Reconcile `docs/architecture/target-architecture.md`,
   `docs/server-authority.md`, the superseded-document banners, and
   `learnings/process/phase-execution.md`.
8. **Required next-phase planning handoff:** before Phase 56 closes, write
   `docs/phases/phase-57-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. If no gap
   justifies a further phase, record that conclusion explicitly instead. Then
   verify, commit, and push Phase 56.
