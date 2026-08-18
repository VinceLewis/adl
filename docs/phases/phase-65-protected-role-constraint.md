# Phase 65 - Protected Role Constraint ("Last Admin Standing")

> **Why this phase exists at all, after Phase 64 closed the roadmap.**
> `learnings/process/phase-execution.md` records that Phase 64 was deliberately
> the last *self-generated* phase: "the next phase, if there is one, comes from
> the user after they have used the system, scoped the next application, and
> named concrete features or defects. It is not to be derived from the code."
> That condition has now been met. A real sibling application built on ADL's
> ideas — `giggle-new`, a band-management app, not part of this repository —
> surfaced a concrete production defect: it only enforced "don't remove the
> last admin of a group" in client-side UI code, which is exactly the failure
> mode `AGENTS.md`'s policy-enforcement boundary exists to rule out. This phase
> is the user naming that gap and asking for it as a genuine, reusable ADL
> platform capability. It is not derived from the code, and it does not license
> deriving a Phase 66 from the code either — see the Planning Handoff below.

## Objective

Let any ADL application that models role-based group/team membership declare,
in the language, that a privileged role (e.g. `BandAdmin` on `BandMember`)
must never drop to zero active holders within a scope (e.g. per `Band`) —
enforced by the runtime on every write path that could cause it, not only by a
UI affordance that disables a button. Demonstrate it on ADL's own reference
app by protecting `BandMember`'s `BandAdmin` role.

## Evidence and Dependency

Checked against the code while writing this document.

- **Object constraints are the existing extension point for a cross-record,
  scope-aware invariant**, and there are exactly two kinds today.
  `ObjectConstraintKind` (`src/model/resolved-model.ts:206`) is `"unique" |
  "ordered"`. `ObjectStore.requireConstraintsForWrites`
  (`src/runtime/object-store.ts:1317`) is the single place both are enforced:
  it computes `finalRecords` — the object's records as this transaction would
  leave them, deletes removed and updates applied — and checks each planned
  write against them. This already runs for direct CRUD and for command-step
  writes alike, which is exactly the "runtime service, not UI" boundary
  `AGENTS.md` requires.
- **A policy rule cannot express this.** `PolicyEngine.evaluate`
  (`src/runtime/policy-engine.ts`) decides one record against one principal; it
  has no way to count sibling records in a scope, which is what "the last one"
  means. This is not a gap in the policy engine's condition vocabulary — it is
  the wrong layer, structurally, the same way `contextMember` needed a
  principal rather than an expression (`learnings/implementation/context-grants-and-relationship-access.md`).
- **The Giggle Band reference app has exactly the shape this guards.**
  `src/reference/giggle-band/domain.adl:54-61` declares `BandMember` with
  `FIELD Role TEXT REQUIRED IN ('BandAdmin', 'BandMember')` and `SCOPE Band
  FIELD Band`. `BandMemberPolicy` (`:464-471`) grants `ROLE BandAdmin` both
  `UPDATE` and `DELETE` on `BandMember` directly — no command wraps either
  write — so a band admin can demote or remove any member, including
  themselves, through ordinary CRUD today, with nothing but a UI affordance
  (which does not exist in this reference app either) standing between that
  and a bandless-of-admins group.
- **`requireConstraintsForWrites` skips deletes for the existing two kinds**,
  which is safe for them (a deleted record has nothing left to satisfy) but
  is exactly backwards for this guard, whose entire purpose is to fire on a
  delete. The existing per-write loop (`:1329-1335`) short-circuits `delete`
  before checking any constraint, so a third kind cannot be added inside that
  loop unchanged; it has to be checked before that short-circuit, using the
  write's `existing` values rather than its (possibly absent) final ones.
- **Command steps only support `create` and `update`** (`CommandStepAction`,
  `src/model/resolved-model.ts:213`) — there is no command-level delete step —
  so every deletion of a `BandMember` record reaches `ObjectStore.delete`
  directly, and `requireConstraintsForWrites` is the only enforcement point
  that sees every path.
- **Lifecycle transitions bypass object constraints entirely.**
  `ObjectStore.commitTransition` (`:1023`) never calls
  `requireConstraintsForWrites`, so unique and ordered constraints are already
  not enforced across a lifecycle transition today. `BandMember` has no
  lifecycle, so this is not reachable in the reference app and is left as the
  pre-existing gap it already was — not introduced or fixed by this phase.

This phase depends on `ObjectConstraintKind`, `ResolvedObjectConstraint`,
`ObjectStore.requireConstraintsForWrites`, `ObjectStore.getFinalConstraintRecords`,
the constraint parser (`parseObjectConstraint`, `src/parser/parser.ts:1091`),
`resolveObjectConstraint` (`src/compiler/resolve-model.ts:568`),
`validateObjectConstraint` (`src/compiler/validate-model.ts:1942`), the Giggle
Band reference app, and the conformance corpus.

## The Decision

A third `ObjectConstraintKind`, `"protectedRole"`, declared as:

```adl
CONSTRAINT lastBandAdminStanding PROTECTED_ROLE SCOPE Band FIELD Role VALUES ('BandAdmin') MIN 1
```

- `SCOPE` names zero or more fields forming the scope key (empty guards the
  whole object as one scope), mirroring `UNIQUE`'s and `ORDERED`'s `SCOPE`.
- `FIELD` names the role field; `VALUES` takes one or more literals — more
  than one guarded value lets a model protect a set of privileged roles at
  once, and lets a demotion *between* two guarded values (`Admin` to `Owner`)
  be told apart from a demotion *out of* the set.
- `MIN` is the minimum count of active, scope-matching, guarded-value-holding
  records required after the write; it defaults to `1`.

Enforcement lives in `ObjectStore.requireConstraintsForWrites`, checked for
every `update` and `delete` write (never `create`, which can only add), before
the existing delete short-circuit. The check fires only when the write's
*existing* record held a guarded value and the final state does not — deleted,
demoted out of the guarded set, or moved to a different scope key — which
keeps it from ever blocking a write on a record, or a scope, the guard was
never protecting. A scope that already holds fewer than `MIN` before this
transaction (data predating the constraint's own declaration) is not
retroactively repaired or used to block unrelated writes to that scope; the
guard only refuses the write that would make an *already-satisfied* scope fall
short. This mirrors the existing constraints' behaviour of checking the write
in front of them, not auditing the whole collection.

The runtime issue code is `ADL_RUNTIME_CONSTRAINT_PROTECTED_ROLE`, alongside
the existing `ADL_RUNTIME_CONSTRAINT_UNIQUE` and `ADL_RUNTIME_CONSTRAINT_ORDERED_*`.

## Scope

- Parser: `PROTECTED_ROLE` as a third `CONSTRAINT` kind, accepting `SCOPE`,
  `FIELD`, `VALUES (...)`, and optional `MIN`.
- Resolved model: `ResolvedProtectedRoleObjectConstraint` and the matching
  partial-model and AST types, defaulting `minCount` to `1`.
- Validation: the role field must exist (reusing the existing unknown-field
  diagnostic), `VALUES` must be non-empty
  (`ADL_OBJECT_CONSTRAINT_PROTECTED_ROLE_VALUES_EMPTY`), and `MIN` must be a
  positive integer (`ADL_OBJECT_CONSTRAINT_PROTECTED_ROLE_MIN_INVALID`).
- Runtime: enforcement in `ObjectStore.requireConstraintsForWrites` for every
  write path that reaches it — direct CRUD and command steps alike.
- Reference app: declare `lastBandAdminStanding` on `BandMember`, guarding
  `BandAdmin` per `Band`.
- Conformance cases proving refusal (delete of the sole guarded holder,
  demotion of the sole guarded holder), success (a second guarded holder
  remains; a create into an already-unguarded scope; a demotion between two
  guarded values), and scope isolation (one scope's refusal does not exempt
  another's).
- Specification updates in `docs/spec/language.md` (author-facing syntax) and
  `docs/spec/resolved-model.md` (resolved-model contract and enforcement
  rule).

## Constraints

- Do not touch `PolicyEngine`, lifecycle transitions, or the two existing
  constraint kinds' behaviour. `requireConstraintsForWrites`'s existing
  per-write loop for `unique`/`ordered` must see identical inputs and produce
  identical diagnostics for every model that declares neither this constraint.
- Do not make this constraint retroactive: a scope already below `MIN` before
  a given write must not have unrelated writes to that scope refused, and must
  not be silently repaired.
- Do not introduce a new operation kind or a new authority replay path. This
  is an ordinary constraint check inside the existing create/update/delete and
  command-transaction flow, so it replays through authority intent replay
  unchanged, exactly as `UNIQUE` and `ORDERED` already do.
- Enforcement must be reachable with zero UI code: prove it with direct
  `ApplicationRuntime.update`/`delete` calls, not only through a rendered
  affordance.
- Every semantic change needs conformance cases per the Phase 51/52 contract,
  and a case may not name a value the runtime mints.
- Preserve every constraint recorded in prior phase documents; this phase adds
  a constraint kind, it does not revisit sync, policy, authority, or offline
  dataset behaviour.

## Deliverables

- `PROTECTED_ROLE` constraint syntax, resolved model, validation, and runtime
  enforcement.
- `BandMember.lastBandAdminStanding` in `src/reference/giggle-band/domain.adl`.
- Unit tests: a generic (non-Band) runtime fixture proving the guard's rules in
  isolation (`tests/protected-role-constraint.test.ts`), a focused proof against
  the real Giggle Band model and its actual `BandMemberPolicy` rules
  (`tests/band-reference-app.test.ts`), model-validation diagnostic tests
  (`tests/model-validation.test.ts`), a compiled-model assertion
  (`tests/compile-adl.test.ts`), and parser round-trip and failure tests
  (`tests/parser.test.ts`).
- Conformance cases in `conformance/runtime/protected-role-constraint.json`.
- Specification updates in `docs/spec/language.md` and
  `docs/spec/resolved-model.md` (new `## Protected Roles` section).
- A `learnings/` update recording the design (see below).

## Acceptance Criteria

- Deleting or demoting the sole `BandAdmin` of a `Band` is refused by
  `ApplicationRuntime.delete`/`update` directly — proven without going through
  any UI code — with issue code `ADL_RUNTIME_CONSTRAINT_PROTECTED_ROLE`.
- The same operation succeeds once a second `BandAdmin` exists for that band,
  and is never blocked by another band's admin count.
- A create into a scope that already holds no guarded-role record is never
  refused by this constraint.
- `npm test` passes with the new and existing cases; `npm run test:integration`
  is clean (Docker was available and it ran); `npm run typecheck`, `npm run
  build`, and `npm run format:check` are clean.
- Every existing conformance case and unit test that does not touch this
  constraint is unmodified and still passes.

## Non-goals

- A UI affordance disabling the "remove"/"demote" control when it would
  violate the guard. The runtime enforcement is the guarantee; a future UI
  phase may add the affordance as a courtesy, but the platform boundary this
  phase closes does not depend on it existing.
- Enforcing this guard across lifecycle transitions. `BandMember` has no
  lifecycle and nothing in this phase's evidence shows the gap is reachable;
  recorded above as pre-existing and out of scope.
- A command-level delete step, or any other change to `CommandStepAction`.
- Any change to `PolicyEngine`, sync modes, authority replay, or offline
  dataset scoping.
- A next-phase handoff derived from this subsystem. See below.

## Dependencies

- `ObjectConstraintKind`, `ResolvedObjectConstraint`,
  `PartialObjectConstraintModel`.
- `ObjectStore.requireConstraintsForWrites`, `getFinalConstraintRecords`,
  `orderedScopeKey` (reused as the generic scope-key helper it already is).
- `parseObjectConstraint`, `resolveObjectConstraint`, `validateObjectConstraint`.
- The Giggle Band reference app and the conformance corpus.

## Parallel Execution Plan

Small enough that a single pass costs less than coordinating a fan-out. If
parallelised:

**Serial spine first**, in one pass, since every later step depends on the
resolved-model shape: parser AST type, `resolveObjectConstraint`,
`validateObjectConstraint`, and the `ObjectStore` enforcement function. These
touch the same small set of files (`src/parser/ast.ts`, `src/parser/parser.ts`,
`src/model/resolved-model.ts`, `src/compiler/resolve-model.ts`,
`src/compiler/validate-model.ts`, `src/runtime/object-store.ts`) and one
agent should do all of them together.

**Fan out** only after the spine compiles and typechecks:

- Reference app (`domain.adl`) and its focused runtime test.
- The generic runtime test fixture.
- Model-validation and parser tests.
- Conformance corpus cases.
- Specification updates.

**Keep serial**: `src/model/resolved-model.ts`, `src/compiler/validate-model.ts`,
and `src/runtime/object-store.ts` (the three files every fan-out stream reads
from but none should write to after the spine).

Barriers: one `npm run test:integration` after the fan-out lands, then
`npm run verify:push` only if any stream touched UI (none should — this phase
declares no new presentation, and `domain.adl` is data/policy only, not
`ui.adl`).

Hazard already confirmed by this repository: `src/compiler/validate-model.ts`
contains a deliberate NUL byte, so plain `grep` treats it as binary and
returns nothing silently — use `grep -a`, or the Read tool.

## Tasks

1. Add the parser, resolved-model, and validation support for `PROTECTED_ROLE`.
2. Add runtime enforcement in `ObjectStore.requireConstraintsForWrites`,
   checked for update and delete, never create, before the existing delete
   short-circuit.
3. Declare `lastBandAdminStanding` on `BandMember` in the Giggle Band
   reference app.
4. Add unit tests: generic fixture, Giggle Band-specific proof, model
   validation diagnostics, parser round-trip/failure, and a compiled-model
   assertion.
5. Add conformance cases and the `## Protected Roles` spec section.
6. Run `npm test`, `npm run typecheck`, `npm run format:check`, `npm run
   build`, and `npm run test:integration`. Run `npm run verify:push` only if a
   UI file changed (it should not have).
7. Write the `learnings/` update.
8. **Planning handoff.** Per `learnings/process/phase-execution.md`, a phase
   from 65 onward may not derive its successor from the subsystem it just
   touched, and the standing condition for resuming the rolling handoff at all
   — a second reference application in a different domain, or a stated
   capability target — has not been met by this phase. This phase closes
   exactly the one concrete gap the user named from real-world use. No
   repository-wide gap surfaced by writing it rises to the level Phase 46's
   rule requires, so no Phase 66 is written. The next phase, if there is one,
   again awaits the user naming a concrete feature or defect from real-world
   use — not a re-reading of this subsystem's own code.
9. Commit and push.

## Closing Note

This phase does not reopen the rolling handoff. It answers one named,
evidence-backed gap and stops. See Task 8.
