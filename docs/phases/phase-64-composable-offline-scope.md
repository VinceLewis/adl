# Phase 64 - Composable Offline Scope

> **This is the final planned phase.** It carries no next-phase handoff and must
> not write one. Phase 64 finishes what Phase 62 started; after it, offline
> dataset scoping is closed and no further phase is planned or should be
> invented. See `learnings/process/phase-execution.md` for why the rolling
> handoff was stopped.
>
> **This phase is completion, not discovery.** Phase 62 made offline bounds
> declarable and then could not apply one to the object that most needed it.
> That is an unfinished delivery, and the reference app carries the compromise
> today. Nothing here was found by looking for new work.

## Objective

Let an object declare *which* records a device keeps and *how much* of them
independently, so a bound can be applied without changing the context scope to
get it.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **A bound and a context scope cannot be declared together.** `SyncScope`
  (`src/model/resolved-model.ts:135`) is a flat enumeration of eight values in
  which `recent` and `custom` are peers of `currentUser` and `currentContext`
  rather than modifiers of them. `validateSyncScopeSelection`
  (`src/compiler/validate-model.ts:7542`) refuses a window on any scope but
  `recent` (`:7557`) and a predicate on any scope but `custom` (`:7581`). So
  **"my records, recent" is unsayable**: `SCOPE currentUser WINDOW Date 90 DAYS`
  is a validation error today.
- **The reference app already pays for this, twice.**
  `src/reference/giggle-band/domain.adl:129` declares `Availability` as
  `SYNC LOCAL_FIRST SCOPE currentUser`. It grows without bound — one record per
  user per date — and is the clearest candidate in the model for a window. It
  cannot have one, because moving it to `recent` would silently widen it from one
  user's records to every available context's. Meanwhile `:105` declares `Event`
  as `SCOPE recent WINDOW Date 90 DAYS LIMIT 200`, which took the window only by
  widening from `currentContext` to all available contexts. Phase 62 chose the
  object that could absorb the side effect, not the object that needed the bound.
- **The runtime is already factored for this.** Phase 63 split context from bound
  deliberately: `recordSatisfiesDeclaredBound`
  (`src/runtime/offline-dataset-service.ts:241`) evaluates the bound and gates
  every route, while `recordMatchesSyncScope` (`:311`) is now the context half
  alone. Both still switch on `scope`, which is the only thing tying a bound to a
  particular scope value at runtime.
- **The parser needs no change.** `parseSync` accepts `WINDOW` and `WHERE` as
  options on any `SYNC` line already; nothing in `src/parser/parser.ts` ties
  either clause to a scope word. This phase is mostly the *removal* of validation
  restrictions, not new syntax.
- **`recent` and `custom` are exactly sugar for a pair.** Verified against the
  runtime: `recent` evaluates as available-contexts **and** window, and `custom`
  as available-contexts **and** predicate. Both are therefore expressible as
  `allAvailableContexts` plus a bound, which is what makes retaining them as
  spellings safe rather than a second way to say a different thing.

This phase depends on `SyncScope`, `validateSyncScopeSelection`,
`resolveSyncWindow` (`src/compiler/resolve-model.ts:658`),
`OfflineDatasetService.recordSatisfiesDeclaredBound`, `recordMatchesSyncScope`
and `computeRecentLimitRecordIds`, the conformance corpus, and
`docs/spec/language.md` plus `docs/spec/runtime-semantics.md`.

## The Decision, Already Made

Recorded here so the executing session does not re-derive it. Deviate only if the
code contradicts it, and say so if you do.

**A sync scope selects context. A window and a predicate are independent bounds
that may accompany any scope.** `SyncScope` keeps its current eight values and
its current meaning; what changes is that `window` and `predicate` stop being
tied to `recent` and `custom`.

- `recent` and `custom` are **retained as spellings**, not removed. `recent`
  continues to mean available-contexts with a window defaulted to 30 days over
  `_updatedAt`; `custom` continues to mean available-contexts with a required
  predicate. Every existing `.adl` file and every existing conformance model must
  resolve to exactly the model it does today, including the `objectSync` reason
  still reporting `scope: "recent"` and `scope: "custom"`.
- **Do not normalise `recent` away** into `allAvailableContexts` plus a window.
  It is tempting and it is the wrong trade: it would change resolved-model
  values, the model fingerprint, and the `scope` field of every `objectSync`
  reason, breaking conformance cases across `conformance/runtime/*.json` for no
  behavioural gain.
- A window and a predicate may both accompany the same scope. Both must pass.

Rules to retire, keep and add:

| Rule | Fate |
| --- | --- |
| `OBJECT_SYNC_WINDOW_SCOPE_INVALID` / `SYNC_WINDOW_SCOPE_INVALID` | **Retire.** A window is legal on any scope. |
| `OBJECT_SYNC_PREDICATE_SCOPE_INVALID` / `SYNC_PREDICATE_SCOPE_INVALID` | **Retire.** A predicate is legal on any scope. |
| `OBJECT_SYNC_PREDICATE_MISSING` / `SYNC_PREDICATE_MISSING` | **Keep.** `custom` still means "selects by a predicate" and is still meaningless without one. |
| Window field/type/days/limit validation | **Keep unchanged.** |

## Scope

- Make `window` and `predicate` legal alongside any sync scope, in both the
  object-level and top-level validators, retiring the two pairs of scope-pairing
  diagnostics above and keeping the rest.
- Make `recordSatisfiesDeclaredBound` gate on the **presence** of a window and a
  predicate rather than on the scope value, so a bound declared with any scope is
  honoured, and both are checked when both are declared.
- Fix `computeRecentLimitRecordIds` (`src/runtime/offline-dataset-service.ts:172`).
  It currently skips any object whose `scope !== "recent"` and, for those it does
  process, picks limit candidates using `recordMatchesAvailableObjectContext`
  regardless of the declared scope. Both are wrong once a limit can accompany
  `currentUser`: the candidate set must be filtered by the object's *own* context
  matcher, or a `LIMIT` on a `currentUser` object would rank one user's records
  against every other user's. **This is the only substantive runtime behaviour
  change in the phase and the place a defect is most likely to hide.**
- Rename what is now misnamed. `computeRecentLimitRecordIds`,
  `recordMatchesRecentWindow` and `recordMatchesRecentDays` describe a scope that
  is no longer the only thing they serve; `state.recentLimitRecordIds` likewise.
  Rename for what they do, not for the scope that used to imply them.
- Resolve the reference app compromise: give `Availability` the window it needed
  (`SCOPE currentUser WINDOW Date <n> DAYS`), and reconsider whether `Event`
  should return to `SCOPE currentContext WINDOW Date 90 DAYS LIMIT 200` now that
  keeping a bound no longer costs a context widening. Decide deliberately and
  record the reasoning either way; do not leave `Event` widened merely because
  Phase 62 left it that way.
- Update `docs/spec/language.md` — the claim at the `WINDOW` clause that "a
  window is only consulted by `SCOPE recent`" (`:160`) and the matching sentence
  about predicates are both made false by this phase — and the scope table in
  `docs/spec/runtime-semantics.md#what-each-sync-scope-selects`.
- Conformance cases for a bound on a context scope that is not `recent` or
  `custom`, including a `LIMIT` on a `currentUser` object with records belonging
  to more than one user.

## Constraints

- **Every existing `.adl` file and conformance model must resolve to exactly the
  model it does today.** This phase only removes restrictions and adds
  combinations; it changes no existing declaration's meaning. A conformance case
  that has to change is a signal the design drifted, not a case to update.
- Phase 63's rule stands unchanged: a read-model source may widen an object's
  context, never its declared bound. The bound gate must keep applying to every
  route, and `boundedBy` must keep reporting on read-model source reasons — now
  driven by whether a bound is declared rather than by the scope value.
- Do not add a second way to declare a bound. There is one `WINDOW` shape and one
  predicate expression, both from Phase 62.
- Dataset membership is not authorization and must not become it.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  a case may not name a value the runtime mints.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 50 session lifetime, Phase 54 membership scoping, Phase 57 command
  replay, Phase 58 record sync state, Phase 59 batch semantics, Phase 60
  edit-surface semantics, Phase 61 revision integrity, Phase 62 offline scope
  declarations and Phase 63 dataset bounds.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- `window` and `predicate` legal with any sync scope, enforced by presence in the
  runtime and no longer refused by the validator.
- A corrected limit computation that ranks candidates within the object's own
  declared context scope.
- Renamed `recent*` runtime members that no longer serve only `recent`.
- The reference app declaring a bound on `Availability`, and a recorded decision
  about `Event`'s context scope.
- Conformance cases for a window on `currentUser`, a predicate on
  `currentContext`, a window and predicate declared together, and a `LIMIT` on a
  user-scoped object with multiple users' records.
- Specification updates in `docs/spec/language.md` and
  `docs/spec/runtime-semantics.md`.
- Learnings updates in `implementation/offline-dataset-runtime.md`,
  `implementation/sync-policy.md` and `implementation/adl-parser.md` — the last
  because the Phase 62 note that a clause's legality is a validator decision is
  exactly what let this phase be small.

## Acceptance Criteria

- `SYNC LOCAL_FIRST SCOPE currentUser WINDOW Date 90 DAYS LIMIT 50` compiles,
  validates, and produces a dataset holding only the signed-in user's records
  inside the window, limited within that user's own records — proven by a test
  with two users' records that fails if the limit ranks across users.
- A predicate on a non-`custom` scope is honoured rather than refused, and
  `SCOPE custom` without a predicate is still refused.
- `grep -rn "recentLimitRecordIds\|MatchesRecent" src/` shows no name implying a
  scope the member no longer exclusively serves.
- Every existing conformance case passes **unmodified**, and
  `npm run test:integration` is clean.
- The Phase 63 guard still holds: a read-model source does not admit a record its
  object's bound excludes, and a cross-context source still admits another user's
  `Availability`.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots.

## Non-goals

- Removing or renaming `recent` and `custom`.
- Source-level bound declarations on read models. Phase 63 recorded this as the
  move to make *if* a dashboard ever needs to reach past its object's bound;
  nothing asks for it.
- Relationship-aware sync scope (`SCOPE relatedTo ...`).
- Bulk ingestion and the `import` policy action.
- Any change to sync modes, conflict strategies or revision semantics.
- **A next-phase handoff.** See the closing note.

## Dependencies

- `SyncScope` and `ResolvedObjectSyncPolicy`.
- `validateSyncScopeSelection` and the `MODEL_VALIDATION_CODES` entries above.
- `OfflineDatasetService.recordSatisfiesDeclaredBound`, `recordMatchesSyncScope`,
  `computeRecentLimitRecordIds`.
- The conformance corpus and both specification documents.

## Parallel Execution Plan

This phase is small enough that fan-out is likely to cost more than it saves.
Prefer a single pass. If it is parallelised:

Serial spine first, in one pass with no consumers:

1. The validator change, the runtime bound gate, the limit computation and the
   renames. These are four edits to two files that all depend on each other; do
   them together.

Fan out only after the spine, with disjoint file ownership and each agent
verifying only its own test files:

- Conformance corpus cases.
- Reference app (`domain.adl`, `band-app.ts`) and the `Event` decision.
- Specification and learnings.

Keep serial: `src/compiler/validate-model.ts`,
`src/runtime/offline-dataset-service.ts`, `src/model/resolved-model.ts`,
reference app fixtures, and specification updates.

Barriers: one `npm run test:integration`, then one `npm run verify:push` with
manual screenshot inspection.

Hazards this repository has confirmed. `src/compiler/validate-model.ts` and
`src/conformance/runner.ts` each contain a NUL byte, so plain `grep` treats them
as binary and returns nothing silently — use `grep -a`, and check `grep -c`
against `grep -ac` on any file just written; write the escape `\0`, never the
byte. Check this document's evidence before executing it: Phase 62 found two of
Phase 61's points wrong and Phase 63 found two stale line references in Phase
62's.

## Tasks

1. Retire the two scope-pairing diagnostics; keep the predicate-missing rule and
   all window field/value validation.
2. Gate the runtime bound on the presence of a window and a predicate rather than
   on the scope value, checking both when both are declared.
3. Fix the limit computation to rank candidates within the object's own declared
   context scope, and prove it with two users' records.
4. Rename the `recent*` runtime members that outlived the scope they were named
   for.
5. Give `Availability` a window; decide `Event`'s context scope deliberately and
   record why.
6. Update both specification documents and the learnings.
7. Verify, commit, and push.

## Closing Note — Do Not Write A Phase 65

There is no Phase 65 and none should be invented. When this phase lands, the
offline dataset scoping work that began at Phase 62 is complete, and the
repository stops.

The next phase, if there is one, comes from the user after they have used the
system, scoped the next application, and named concrete features or defects. Do
not derive it from the code, and do not write a "candidates weighed" section
here or a successor document. `learnings/process/phase-execution.md` records why:
every phase from 12 to 63 was generated by the previous phase's handoff, and a
handoff written by the session that just changed a subsystem will always find its
next target in that subsystem.
