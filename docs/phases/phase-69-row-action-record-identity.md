# Phase 69 - Row Action Record Identity

> **Why this phase exists at all, after the rolling handoff stopped at Phase
> 64.** `learnings/process/phase-execution.md` records that a next phase after
> 64 must come "from the user after they have used the system, scoped the next
> application, and named concrete features or defects" — not be derived from
> the code. This phase is exactly that: while adding a "revoke invitation"
> admin surface to the Giggle Band reference app, the agent found that a
> presentation `LIST` row's `ACTION ... INPUT ... FROM <expr>` has no way to
> reach the row's own record identity, recorded it as a platform gap in
> `learnings/implementation/ui-presentation-model.md` (`53b7f97`), and the user
> then commissioned closing it directly. The gap is real, it was found from
> real-world use of the system (not from re-reading a subsystem a prior phase
> touched), and the user named it explicitly — the two conditions the rolling
> handoff's stopping rule requires before code may drive another phase.

## Objective

Let a presentation `LIST`/detail view's row-level `ACTION` reference the row's
own record identity as an expression source for `INPUT ... FROM <expr>` (and
`WHEN`), so a row action can target the exact record it renders from — update,
delete, or any other command — not only create-with-prefilled-values or
navigation, which were the only two shapes reachable before this phase.

## Evidence and Dependency

Re-verified against the current code while writing this document, per
`learnings/process/phase-execution.md`'s rule to check a phase's evidence
before executing it. The gap described in
`learnings/implementation/ui-presentation-model.md` still holds exactly as
recorded, and Phase 68 (which touched `read-model-service.ts`, the file
adjacent to this one) did not touch anything relevant here:

- `evaluateActionInput` (`src/runtime/presentation-runtime.ts`) evaluates every
  `INPUT ... FROM <expr>` against `{ values: row.values, ...state }` only.
  `BoundPresentationRow.id` and `BoundPresentationRow.sources[].recordId` —
  which do carry the real guid — are computed in `evaluateRow` but were never
  merged into the scope `evaluateActionInput`/`evaluateActionVisibility`
  evaluate against, for either an object-backed row
  (`objectRecordToPresentationRow`) or a read-model-backed row
  (`readModelRowToPresentationRow`).
- No projected field carries a record's own id under any name. An object's
  `FIELD`/computed field and a read model's `FIELD ... FROM <source>.<field>`
  both evaluate over already-projected values, never a record's own id.
- `RECORD_ID_JOIN_FIELD` (`"id"`, `src/model/resolved-model.ts`) is the one
  place this codebase already reserves an identifier to mean "this record's
  own id" — but strictly inside `READ_MODEL SOURCE ... JOIN ON` key matching
  (`joinKeyForRecord` in `read-model-service.ts`). It never reached a
  projected field, a row value, or an action input.
- Confirmed live, before this phase's fix: an `ACTION` control with
  `input: { NoteId: { kind: "field", field: "id" } }` compiled to
  `ADL_PRESENTATION_CONTROL_INPUT_FIELD_UNKNOWN` at model validation (`id` was
  not a recognised field on the source object or read model), and — had
  validation been bypassed — would have evaluated to `null` at runtime, since
  `row.values` never carries the key `id`.
- Every existing presentation `ACTION` in the Giggle Band reference app is
  still either `CREATE`-shaped or read/navigation-only, for exactly this
  reason. `RevokeBandInvitation` (added in `90bf1f7`, alongside the gap
  write-up) remains callable only through
  `ApplicationRuntime.executeCommand` directly, not from `MyInvitationList`'s
  Revoke button — closing that button's wiring is an explicitly separate,
  already-queued follow-up task and is **not** done by this phase (see
  Non-goals).

This phase depends on `src/runtime/presentation-runtime.ts`
(`evaluateRow`, `evaluateActionControl`, `evaluateActionInput`,
`evaluateActionVisibility`, `BoundPresentationRow`,
`objectRecordToPresentationRow`, `readModelRowToPresentationRow`),
`src/compiler/validate-model.ts` (`validatePresentationList`,
`validatePresentationActionControl`, `getPresentationListFieldReferences`),
`src/model/resolved-model.ts` (`RECORD_ID_JOIN_FIELD`, unchanged), and
`src/runtime/command-service.ts` (`ResolvedCommandUpdateStep.recordId`
resolution — read only, to confirm what a command step's `ID INPUT` actually
expects).

## The Decision

### Mechanism: reuse `RECORD_ID_JOIN_FIELD` (`"id"`) as a reserved row-action
### expression field, resolved to the row's primary source's raw record id

`RECORD_ID_JOIN_FIELD` already means "this record's own id" everywhere a
`JOIN ON` clause can use it. Reusing the same token for row-action expressions
keeps one name meaning one thing across the resolved model, rather than
inventing a second spelling (`recordId`, `_id`, …) for an identical concept.
Concretely:

- `presentation-runtime.ts` gains `rowActionValues(row)`: a helper that
  returns `{ ...row.values, [RECORD_ID_JOIN_FIELD]: row.sources[0]?.recordId }`
  — the row's projected fields plus its identity, with identity placed last so
  it always wins over a same-named field (there is no such field in any
  shipped model; see Constraints). `evaluateRow`'s row-action loop now passes
  `rowActionValues(row)` to `evaluateActionControl` instead of raw
  `row.values`, so both `INPUT ... FROM <expr>` and `WHEN <expr>` can
  reference `id`.
- **`row.sources[0].recordId`, not `row.id`.** `BoundPresentationRow.id` is a
  synthetic display/sort key — `"Object:guid"` for an object row,
  `"readModel:source:guid|source:guid"` for a read-model row
  (`readModelRowToPresentationRow`/`objectRecordToPresentationRow`) — and no
  command step's `ID INPUT` could ever resolve that composite string to a real
  record. `sources[0]` is the row's *primary* source in both shapes (an object
  row has exactly one source; a read-model row's sources preserve the source
  Map's insertion order, and the first declared source is already documented
  as primary — `learnings/implementation/read-model-runtime.md`, Phase 15).
  `sources[0].recordId` is the actual `meta.guid` `ObjectStore` and
  `CommandService.planStepWrite`'s `evaluateRecordIdExpression` expect.
- **Scoped to row actions only, not filters or row fragments.** `id` is added
  to the row's values only at the point row actions are evaluated. A `LIST
  WHERE` filter or a `ROW` fragment still sees only projected field values,
  matching what they saw before this phase. Broadening this to every
  row-scoped expression (filters, conditional fragments, status maps) was
  considered and rejected: it would have widened this phase's blast radius
  into subsystems the task did not ask for, for a use case ("filter or format
  by a record's own id") nobody has needed yet. If one arises, extending the
  same `rowActionValues` merge to those call sites is a small, well-precedented
  follow-up, not a redesign.
- **Compile-time validation matches runtime exactly.** `id` is added to the
  field-reference map row actions validate `INPUT`/`WHEN` expressions against
  (`validatePresentationList`'s new `rowActionExpressionFieldsByName`,
  typed `text`), but *not* to the map used for `list.filter` or
  `validatePresentationRowTemplate`. Before this change, `getPresentationListFieldReferences`
  already gave list validation this same "one map shared by filter, row
  template, and actions" shape, so making the vocabulary asymmetric was a
  deliberate, minimal deviation rather than a wholesale rewrite of that
  function — matching the precedent `createCalendarActionFieldReferences`/
  `mergePresentationExpressionFields` already set for calendar actions having
  their own field vocabulary distinct from the calendar's row fields.
- **No parser or grammar change.** `INPUT NoteId FROM id` was already legal
  syntax before this phase: `parsePrimaryExpression` treats any identifier as
  `{ kind: "field", field: <name> }` with no reserved-word list at all (see
  `tests/parser.test.ts`'s new case, which pins that the parser accepted this
  syntax *before* this phase's actual fix, in `resolve-model.ts`/
  `presentation-runtime.ts`/`validate-model.ts`). This is exactly what
  `AGENTS.md`'s "runtime consumes the resolved model, not parser AST nodes"
  boundary predicts: the capability is a resolved-model-and-runtime
  expression-evaluation feature, not a syntax feature.

### The COMMAND-step read-existing-record gap: evaluated, not taken on

A related, narrower gap exists: ADL's `COMMAND`/`STEP` grammar has no way to
read an *existing* record's fields to seed a new record — only `create` and
`update` step kinds exist, and a create step's `VALUE x STEP y FIELD z` can
only reference a record *this same command's own earlier step just wrote*, not
an arbitrary existing record read by id. Evaluated per this phase's brief:

- It would need a new `ResolvedCommandValueExpression` kind (something like
  `{ kind: "lookupField", recordId: ResolvedCommandValueExpression, field:
  string }`), parser syntax for it, resolution, validation (does the named
  field exist on the target object? is `recordId` itself well-typed?), runtime
  evaluation in `CommandService.evaluateExpressionMap`/
  `evaluateRecordIdExpression`, and its own conformance coverage — a new
  capability across the parser, resolved model, validator, and runtime, not a
  small extension of this phase's `rowActionValues` mechanism. Nothing in this
  phase's design reduces that cost: exposing a row's own identity to a
  presentation expression and reading an arbitrary other record's field inside
  a command step are different surfaces (presentation-runtime vs.
  command-service) with different consumers and different validation shapes.
- It also did not block anything shippable this session — the brief records
  that a presentation-layer `ACTION CREATE ... INPUT ... FROM ...` already
  covers the one real use case named ("duplicate previous gig").
- Conclusion: **not taken on in this phase.** It is a bigger lift than "cheap
  given the row-identity fix's design," so per the brief it is scoped out and
  named as a candidate for a future phase (see Planning Handoff) rather than
  gold-plated into this one.

## Scope

- `src/runtime/presentation-runtime.ts`: `rowActionValues` helper; `evaluateRow`'s
  row-action loop uses it in place of raw `row.values`.
- `src/compiler/validate-model.ts`: `validatePresentationList` builds a
  row-action-only field-reference map that adds `id` (reusing
  `RECORD_ID_JOIN_FIELD`, already imported in this file) and passes it to
  `validatePresentationActionControl` for row actions specifically.
- `docs/spec/language.md`: "Composed View Presentation" documents `id` as a
  row `ACTION`'s reserved identity token, what it resolves to, and that it is
  unavailable to `LIST WHERE`/`ROW`.
- Tests: `tests/presentation-runtime.test.ts` (object-backed and
  read-model-backed row-identity behaviour, end to end, plus a regression
  guard showing the pre-fix evaluation path resolves to `null`),
  `tests/parser.test.ts` (pins that the parser already accepted `FROM id`
  before this phase's actual fix).
- Conformance: `conformance/presentation/ui.json` gains a `rowIdentityPresentation`
  model and two cases — one proving `evaluatePresentationView` resolves each
  row's action input to that row's own aliased record id, one proving
  `executeCommand` with that exact input updates only the targeted record.
- Reference app: **none.** Giggle Band's `domain.adl`/`ui.adl` are under
  concurrent edit by another agent this session (confirmed via `git log`
  showing `a68efde` landing mid-session) and are deliberately not touched —
  wiring `MyInvitationList`'s Revoke button is the separate, already-queued
  follow-up the user will run next, per the task brief.

## Constraints

- Do not change `BoundPresentationRow.id`'s shape or any existing consumer of
  it (sort tie-breaking, matrix row keys, calendar grouping). Only a new
  helper (`rowActionValues`) reads `sources[0]`; nothing about `row.id` itself
  changes.
- Do not widen `id` availability to `list.filter`, `ROW` fragments, matrix
  cell expressions, or calendar cell/action expressions. Those call sites are
  unchanged and every existing test asserting their behaviour must still pass
  unchanged.
- Do not add a compile-time requirement that a source object/read model must
  not declare a field literally named `id`. No shipped model does (checked:
  no `conformance/`, `tests/`, or `src/reference/` fixture declares one), so
  the override-by-placement behaviour in `rowActionValues` is untested-but-safe
  rather than silently wrong; document it rather than forbid it, matching how
  this repository already treats an analogous ambiguity in Phase 68's
  `TARGET_FIELD` first-match behaviour.
- Do not touch `src/reference/giggle-band/domain.adl`,
  `src/reference/giggle-band/ui.adl`, `src/reference/band-app.ts`, or
  `tests/band-reference-app.test.ts` — another agent is concurrently editing
  Giggle Band content this session.
- Do not implement the COMMAND-step read-existing-record capability (see "The
  COMMAND-step read-existing-record gap" above). Name it as a candidate next
  phase instead.

## Deliverables

- `src/runtime/presentation-runtime.ts`: `rowActionValues` and its use in
  `evaluateRow`.
- `src/compiler/validate-model.ts`: row-action-scoped `id` field reference in
  `validatePresentationList`.
- `docs/spec/language.md`: `id` documented under "Composed View Presentation".
- `tests/presentation-runtime.test.ts`: two new cases (`createRowIdentityObjectModel`,
  `createRowIdentityReadModelModel`) proving per-row distinct identity,
  end-to-end command targeting of the correct record, and a regression guard.
- `tests/parser.test.ts`: one new case pinning that `INPUT ... FROM id` parsed
  correctly before this phase's actual (resolved-model/runtime/validator)
  fix.
- `conformance/presentation/ui.json`: `rowIdentityPresentation` model plus
  `presentation.row-action-uses-record-identity` and
  `presentation.row-action-record-identity-targets-correct-record`.
- `learnings/implementation/ui-presentation-model.md`: the gap section
  rewritten to record the fix and the mechanism, per Task 7 below.

## Acceptance Criteria

- A `LIST` row `ACTION`'s `INPUT <name> FROM id` resolves to that row's own
  record id, proven for both an object-backed list and a read-model-backed
  list, with two rows in the same list resolving to two different ids that
  each match their own record — not the same value, and not the other row's.
- Invoking a command with exactly the input a row action computed mutates the
  record the row was rendered from and no other record.
- `list.filter` and `ROW` fragments cannot reference `id` — a model that tries
  still fails `ADL_PRESENTATION_FILTER_FIELD_UNKNOWN` /
  `ADL_PRESENTATION_ROW_FIELD_UNKNOWN`, unchanged from before this phase.
- The parser accepts `INPUT ... FROM id` with no grammar change, proven by a
  test that does not depend on the runtime/validator fix in this phase.
- `npm test` passes with the new and existing cases. `npm run typecheck` and
  `npm run format:check` are clean.
- `npm run test:integration` is not run: this phase touches only
  `presentation-runtime.ts` (in-memory runtime evaluation) and
  `validate-model.ts` (compile-time validation) — no authority, PostgreSQL,
  migration, unit-of-work, or HTTP edge behaviour is affected. Recorded here
  per this phase's evidence-check obligation rather than silently skipped.
- `npm run verify:push` is not run. This phase changes no DOM rendering,
  shell chrome, CSS, or browser component file, and it does not touch Giggle
  Band's `domain.adl`/`ui.adl` — no shipped presentation declaration
  references the new `id` token, so Giggle Band's rendered output is
  unchanged. `tests/band-reference-app.test.ts` (which exercises Giggle
  Band's resolved model) already ran and passed as part of `npm test`. Given
  the session's concurrent Giggle Band edits, running the Playwright
  screenshot pass now risks capturing another agent's in-flight, unrelated
  changes as false positives against this phase's diff.
- Every existing conformance case and unit test that does not touch row-action
  identity is unmodified and still passes.

## Non-goals

- Wiring Giggle Band's `MyInvitationList` Revoke button to
  `RevokeBandInvitation` using this capability. Explicitly named in the task
  brief as a separate, already-queued follow-up the user runs next.
- The COMMAND-step read-existing-record capability (reading an arbitrary
  existing record's fields into a new record's `VALUE` expressions). Evaluated
  above and found to be a genuinely separate, larger capability; named as a
  planning-handoff candidate below rather than implemented here.
- Widening `id` (or any row identity) into `list.filter`, `ROW` fragments,
  matrix cells, or calendar cells/actions. See Constraints.
- A compile-time diagnostic forbidding a field literally named `id`. See
  Constraints.
- Fixing the three pre-existing raw-NUL-byte composite-key separators found
  incidentally in `src/compiler/validate-model.ts`, `src/conformance/runner.ts`,
  and `src/runtime/command-service.ts` while investigating this phase (`grep`
  silently returns nothing on all three files; `grep -ac` does not — the exact
  failure mode `learnings/process/phase-execution.md` documents from Phase 58,
  and apparently not fully swept from the repository at the time). `awk` and
  this phase's own `Read`/`Edit` tool calls were unaffected and used
  throughout instead. Left unfixed here as unrelated to this phase's scope;
  recorded in `learnings/` as a real, currently-live defect for whoever next
  needs `grep` to work on those files.

## Dependencies

- `src/runtime/presentation-runtime.ts` (`evaluateRow`, `evaluateActionControl`,
  `evaluateActionInput`, `BoundPresentationRow`,
  `objectRecordToPresentationRow`, `readModelRowToPresentationRow`).
- `src/compiler/validate-model.ts` (`validatePresentationList`,
  `validatePresentationActionControl`, `getPresentationListFieldReferences`,
  `expressionTypeField`).
- `src/model/resolved-model.ts` (`RECORD_ID_JOIN_FIELD`, unchanged).
- `src/runtime/command-service.ts` (`evaluateRecordIdExpression`, read-only
  reference to confirm the expected shape of a step's `recordId`).
- `src/runtime/read-model-service.ts` (`joinKeyForRecord`'s existing
  `RECORD_ID_JOIN_FIELD` precedent; unchanged).

## Parallel Execution Plan

Single-capability phase touching two files with a direct producer/consumer
relationship (the runtime fix and its matching validator fix must agree on
exactly the same reserved token and exactly the same scope), plus tests that
can only be written against the fix's actual resolved-model/runtime shape, not
predicted ahead of it. Matches Phase 65's and Phase 68's own conclusion for
work this size: a single serial pass costs less than coordinating a fan-out.

Barriers: `npm test` once, after the runtime fix, the validator fix, and all
new tests land together. `npm run test:integration` and `npm run verify:push`
are not needed (see Acceptance Criteria).

## Tasks

1. Re-verify the gap against current code (done above; it reproduces exactly
   as `learnings/implementation/ui-presentation-model.md` describes).
2. Implement `rowActionValues` in `src/runtime/presentation-runtime.ts` and
   use it in `evaluateRow`'s row-action loop.
3. Implement the matching row-action-scoped `id` field reference in
   `src/compiler/validate-model.ts`'s `validatePresentationList`.
4. Add `tests/presentation-runtime.test.ts` cases (object-backed,
   read-model-backed, regression guard) and `tests/parser.test.ts`'s parser
   case.
5. Add `conformance/presentation/ui.json`'s `rowIdentityPresentation` model
   and its two cases.
6. Update `docs/spec/language.md`.
7. Update `learnings/implementation/ui-presentation-model.md`'s gap section to
   record the fix, the mechanism, and why `sources[0].recordId` rather than
   `row.id` was the right value to expose.
8. **Planning handoff.** `MyInvitationList`'s Revoke button is the
   immediate, user-named next step, but it is explicitly out of this phase's
   scope (the brief calls it "a separate, already-queued follow-up task the
   user will run next") — so it is not this phase's handoff to claim, and
   doing so would just be restating the brief. The COMMAND-step
   read-existing-record capability, evaluated and scoped out above, is a real
   gap but has not been named by the user as something to build, and nothing
   currently shippable is blocked on it (see "The COMMAND-step
   read-existing-record gap"). Per `learnings/process/phase-execution.md`,
   the standing condition for resuming a self-derived rolling handoff — a
   second reference application in a different domain, or a stated capability
   target — still has not been met. No Phase 70 is written. The next phase,
   if there is one, again awaits the user's next concrete instruction (very
   likely the `MyInvitationList` Revoke wiring itself, since this phase's
   whole purpose was to unblock it) rather than a re-reading of this
   subsystem's own code.
9. Commit and push.

## Closing Note

This phase closes one named, twice-evidenced platform gap (row actions could
not target their own record) and stops. It deliberately does not also close
the reference-app follow-up that motivated it, and it deliberately does not
take on the separate COMMAND-step read-existing-record gap it evaluated along
the way. See Task 8.
