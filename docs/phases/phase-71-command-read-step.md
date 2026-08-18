# Phase 71 - Command Read Step

> This phase is not derived from re-reading a subsystem a prior phase touched.
> Phase 69 evaluated exactly this gap — a `COMMAND`/`STEP` grammar with no way
> to read an *existing* record's fields to seed a later step's write — named
> it as a candidate, and deliberately did not take it on: "It would need a new
> `ResolvedCommandValueExpression` kind..., parser syntax..., resolution,
> validation..., runtime evaluation..., and its own conformance coverage — a
> new capability across the parser, resolved model, validator, and runtime,
> not a small extension of this phase's `rowActionValues` mechanism." Per
> `learnings/process/phase-execution.md`'s "Rolling Handoff Stopped At Phase
> 63" rule, no phase after 64 is code-derived; this one was commissioned
> directly by the user, by name, citing Phase 69's own evaluation as the
> starting point — the same condition that authorised Phase 69 and Phase 70.
> Consistent with those phases' own closing notes, this phase does not invent
> a further handoff either; see "Planning Handoff" below.

## Objective

Let a command read an existing record — one it did not itself just create or
update in the same transaction — and use its fields to seed a later step's
`create`/`update` write, so "duplicate this record, but override one field"
can be expressed inside the command language itself, not only faked
client-side by a presentation form pre-filling from a separate read.

## Evidence and Dependency

Re-verified against the current code (main at `b473158`, Phase 70) before
writing this document, per `learnings/process/phase-execution.md`'s rule to
check a phase's evidence before executing it.

- `ResolvedCommandStep` (`src/model/resolved-model.ts`) was exactly
  `ResolvedCommandCreateStep | ResolvedCommandUpdateStep` — no third variant.
- `ResolvedCommandValueExpression` had exactly seven kinds: `literal`,
  `input`, `runtime`, `stepField`, `stepMeta`, `item`, `itemIndex` —
  `stepField`/`stepMeta` already reference "a field/metadata property of a
  record an earlier step in this command bound", but the only thing that
  could ever populate that binding was a `create` or `update` step's own
  written record (`CommandService.execute`'s `stepRecords.set(step.name,
  cloneJson(write.record))`, gated on `frame === undefined`, i.e. a
  non-iterating write).
- `src/parser/parser.ts`'s `parseCommandStepAction` accepted exactly `"create"`
  and `"update"`; `parseCommandStep`'s header-option and step-body messages
  were both hard-coded to that pair.
- `src/runtime/command-service.ts`'s `planStepWrite` had exactly two branches,
  `if (step.action === "update") {...}` and a create fallthrough; nothing read
  an existing record except an `update` step's own target, fetched via
  `ObjectStore.getRecordForRuntime` — a lookup that applies **no** read
  policy at all (confirmed by reading `object-store.ts`: `getRecordForRuntime`
  is `getActiveRecord` plus a `cloneJson`, nothing else), which is correct for
  its actual job (an update step's own pre-write existence check, authorized
  by the write immediately after it) and would have been the wrong,
  policy-bypassing tool to reuse for a step whose entire purpose is disclosing
  a record's contents to later steps.
- `src/compiler/validate-model.ts`'s `validateCommandStep` already builds
  `previousStepsByName` incrementally, in step declaration order, and
  `stepField`/`stepMeta` reference validation already looks a step up in that
  map and reports `ADL_COMMAND_STEP_REFERENCE_UNKNOWN` when it is absent
  (which is true both for an unknown step name and for a step that has not
  been validated — i.e. has not yet executed — yet). This is the existing
  forward-reference protection Phase 69 anticipated a new step kind could
  reuse "for free" if it participated in the same binding.
- `ObjectStore.read` (`src/runtime/object-store.ts`) is the runtime's one
  policy-gated read path: object scope
  (`requireObjectScopeForRecord(..., "read")`), row policy
  (`policyEngine.requireAllowed(..., "read", ...)`), computed fields
  (`applyComputedFieldsToRecord`), then field-level read shaping
  (`policyEngine.applyReadPolicy`). `ApplicationRuntime.read` calls exactly
  this method for a direct API/UI read, confirming it is the right
  enforcement path to reuse from `command-service.ts` rather than a parallel
  check.

None of Phases 65 through 70 touched `command-service.ts`'s step-execution
loop, `resolve-model.ts`'s `resolveCommandStep`, or `validate-model.ts`'s
`validateCommandStep`/`validateCommandValueExpression` in a way that changed
this evidence; Phase 70 touched `command-service.ts` only to fix a raw NUL
byte in an unrelated composite-key template literal (line 522,
`SuppliedRecordIds.requireDistinct`), confirmed unrelated by reading the diff.

## The Decision

### A `read` step, reusing `stepField`/`stepMeta` rather than a new expression kind

The obvious design — sketched by Phase 69's own evaluation — was a new
`ResolvedCommandValueExpression` kind, something like `{ kind: "lookupField",
recordId: ResolvedCommandValueExpression, field: string }`. Building the
actual mechanism first (rather than the syntax) showed this was unnecessary:
`CommandService.execute`'s `stepRecords: Map<string, StoredObjectRecord>`
already exists purely to answer "what record did step X bind", and nothing
about `stepField`/`stepMeta`'s evaluation (`stepRecords.get(expression.step)?.values[expression.field]`)
or their compile-time validation (`previousStepsByName.get(expression.step)`,
forward-reference-checked) cares *how* a step bound its record — only that it
did. Adding a `read` step that populates the identical map, the identical way
(`if (frame === undefined) { stepRecords.set(step.name, cloneJson(record)); }`),
means `VALUE VenueName STEP source FIELD VenueName` is legal syntax the moment
`source` is any earlier step, `read` included, with **zero** new expression
evaluation, compile-time reference validation, or step-ordering code. This
keeps one vocabulary meaning one thing (a step binds a record; later steps
read fields of it) rather than teaching a model author, and every future tool,
a second spelling for an adjacent concept — the exact reasoning Phase 69 used
to justify reusing `RECORD_ID_JOIN_FIELD` instead of inventing `recordId`/`_id`.

`ResolvedCommandReadStep` (`src/model/resolved-model.ts`):

```ts
interface ResolvedCommandReadStep {
  name: string;
  action: "read";
  object: string;
  recordId: ResolvedCommandValueExpression;
  preconditions: ResolvedExpression[];
  forEach?: never;
}
```

No `authority`, `values`/`patch`, or working `forEach` — see
`learnings/implementation/command-read-steps.md` for why each is absent
rather than merely unused.

### Grammar

```adl
COMMAND DuplicateEvent LABEL 'Duplicate event'
  INPUT SourceEventId TEXT REQUIRED
  INPUT NewDate DATE REQUIRED
  STEP source READ Event ID INPUT SourceEventId
  END.STEP
  STEP duplicate CREATE Event AUTHORITY command
    VALUE VenueName STEP source FIELD VenueName
    VALUE ContactName STEP source FIELD ContactName
    VALUE AmountCents STEP source FIELD AmountCents
    VALUE EventDate INPUT NewDate
  END.STEP
END.COMMAND
```

`STEP <name> READ <Object> ID <expr>` is the whole header — `parseCommandStep`
(`src/parser/parser.ts`) now branches its header-option loop and step-body
loop on `action`, exactly the way it already branched `ESTABLISHES CONTEXT`
to `create`-only: `AUTHORITY` and `FOR EACH`/`FOR_EACH` are refused on a
`read` step's header with a dedicated error message
("COMMAND STEP header option ID or end of line"), and `VALUE`/`SET`/`PATCH`
are refused in a `read` step's body ("COMMAND STEP directive REQUIRE or
END.STEP") — only `REQUIRE` (a precondition evaluated against the record the
step read) and `END.STEP` are legal there. This is a grammar-level guarantee,
not merely a resolved-model or validator one: a model author gets a parse
error at the point of the mistake.

`EventDate` above is deliberately `INPUT NewDate`, not `STEP source FIELD
EventDate` — proving a later step can override rather than blindly copy a
field the `read` step made available, which the phase brief named as a
required proof.

### Policy: `ObjectStore.read`, the same path a direct read would take

`CommandService.planStepRead` calls `this.objectStore.read(step.object,
recordId, stepContext)` — not `getRecordForRuntime`, and not a new,
parallel policy check. This is the phase's actual enforcement decision, not
an implementation detail: object scope, row policy, and field-level read
shaping (mask/hidden) all apply to a `read` step exactly as they would to the
caller reading the same record directly through the API or UI. A masked
field's masked value, not its real one, is what a later step's `STEP source
FIELD <maskedField>` sees. There is no `AUTHORITY command` equivalent for a
`read` step, deliberately: `authority: "command"` lets a *write* step bypass
the caller's own write policy with the command's own preconditions
substituted as the boundary; a read step writes nothing, so there is nothing
for such a bypass to authorize, and offering one anyway would let a command
see more of an existing record than the caller invoking it could see by
reading it directly — the exact failure mode the phase brief named as the
thing to avoid.

### Step ordering: forward references are refused, using the existing check

`validate-model.ts`'s `validateCommandStep` already validates every step in
declared order, adding each to `previousStepsByName` only after it has been
validated. Because `resolveCommandStep`/`validateCommandStep` treat a `read`
step's `recordId` as an ordinary command value expression
(`validateCommandValueExpression`, extended to run for `read` steps the same
way it already ran for an `update` step's `recordId`), and because a later
step referencing `read`'s binding uses the same `stepField`/`stepMeta`
reference-validation code every other step reference already uses, **no new
step-ordering validation was written.** A `create` step declared before the
`read` step it references fails `ADL_COMMAND_STEP_REFERENCE_UNKNOWN` — the
existing "unknown or later step" diagnostic — because the referenced step
simply is not yet in the map. This is proven directly by
`tests/model-validation.test.ts`'s forward-reference case (reversing a valid
command's step order) and by the conformance corpus's own forward-reference
model.

### Failure: read-target-missing and read-denied both fail the whole command

- **Missing record**: `planStepRead` raises `StorageError`
  (`ADL_STORAGE_ERROR`) when `ObjectStore.read` returns `null` — the same
  code and the same reasoning an `update` step's own "target no longer
  exists" check already uses (`planStepWrite`'s `getRecordForRuntime`
  branch). This is not a new failure shape; it is the existing "a step's
  target record must exist" check reached by a second route.
- **Policy denial**: `ObjectStore.read` throws `PolicyDeniedError`
  (`ADL_POLICY_DENIED`) itself; nothing in `command-service.ts` needs to
  catch or re-classify it.

Either way, nothing commits. `CommandService.execute` plans every step before
calling `ObjectStore.commitPlannedTransaction` even once, so a `read` step
failing at step 1 of N leaves nothing written by steps that would have
followed it, matching how this codebase already treats any step failure (a
`create`/`update` step's precondition failure, an `update` step's missing
target, a constraint violation discovered while planning a later step).

### What a `read` step contributes to the wider command machinery: nothing

By design, so every other command mechanism keeps meaning exactly what it
already meant:

- Not in `plannedWrites`, so not in the command's committed records, its
  `RuntimeCommandResult.steps`, or its operation-log entry.
- Not in the record-id manifest (`LocalCommandOperation.recordIds` /
  `AuthorityCommandRecordId[]`) a locally executed command queues for
  authority replay — the manifest names only the records a command *creates*,
  and a `read` step creates nothing. See
  `learnings/implementation/command-intent-replay.md`.
- Not counted in `validateCommandStepSyncCoherence`
  (`ADL_COMMAND_STEP_SYNC_MODE_MIXED`): a `read` step writes nothing, so it
  has no write-delivery mode to disagree with the command's other steps
  about, whatever its own target object's declared sync mode is.

### Consistency under replay: not a new consistency model

A `read` step re-reads its target at the point it executes — locally when a
device runs the command, or at the authority when a queued command is
replayed later. If the source record changed in between, a replayed `read`
step can see different values than the device saw locally. This is explicitly
**not** a new risk: an `update` step's own target is already re-read fresh at
whichever point it executes, for exactly the same "the authority re-executes
the whole command from its own current state" reason
`learnings/implementation/command-intent-replay.md` already documents. A
`read` step is a second way to reach a behaviour this codebase already has,
not a new one. Recorded plainly in `docs/spec/runtime-semantics.md` and
`learnings/implementation/command-read-steps.md` rather than left for a model
author or a future implementer to discover the hard way.

### A pre-existing gap found, not fixed: `read` auditing has no partial-model surface

While proving a `read` step goes through the same audited path a direct read
would, `ResolvedApplicationModel.audit` (the app-level gate
`AuditService.record` checks first) turned out to be **unconditionally**
`createDefaultAuditModel()` — there is no field on `PartialApplicationModel`
to override it, and the default excludes `"read"`/`"search"`. An object's own
`audit.operations` can only narrow what the app-level gate already allows
(both are ANDed), never widen it, so declaring `audit: { operations: ["read"] }`
on an object has no observable effect: no model built from a partial model or
ADL source can ever audit a read today. This is pre-existing (it long
predates this phase and is unrelated to command steps specifically), and
fixing app-level audit configurability is out of this phase's scope — but it
is exactly the kind of thing `learnings/process/phase-execution.md` asks to
be recorded rather than silently rediscovered, so it is written up in
`learnings/implementation/command-read-steps.md` and this phase's unit test
for the successful case asserts on `operationLog` (which a `read` step
correctly never touches) rather than on `auditService`, with a comment
explaining why.

## Scope

- `src/model/resolved-model.ts`: `ResolvedCommandReadStep`,
  `PartialCommandReadStepModel`, both step-model unions widened.
- `src/parser/ast.ts`: `CommandStepDeclarationAst.action` widened to include
  `"read"`.
- `src/parser/parser.ts`: `parseCommandStepAction` accepts `READ`;
  `parseCommandStep`'s header-option loop and step-body loop both branch on
  `action` to restrict a `read` step's legal clauses.
- `src/compiler/compile-adl.ts`: `commandStepToPartial` gains a `read` branch.
- `src/compiler/resolve-model.ts`: `resolveCommandStep` gains a `read` branch.
- `src/compiler/validate-model.ts`: `validateCommandStep` accepts `"read"` as
  a valid action, skips the authority check and `validateCommandStepIteration`
  call for it, validates its `recordId` the way an `update` step's already
  is, and treats its (always empty) `values` map as a no-op loop;
  `validateCommandStepSyncCoherence` skips `read` steps entirely.
- `src/runtime/command-service.ts`: `execute`'s per-step loop branches on
  `step.action === "read"` before calling `planStepWrite`; new
  `planStepRead` method calls `ObjectStore.read` and binds the result into
  `stepRecords`; `planStepWrite`'s parameter type narrowed to
  `ResolvedCommandCreateStep | ResolvedCommandUpdateStep` now that it is only
  ever called for those two kinds.
- `docs/spec/language.md`, `docs/spec/resolved-model.md`,
  `docs/spec/runtime-semantics.md`: `read` step syntax, resolved-model shape,
  and runtime semantics documented under "Commands" in each.
- Tests: `tests/parser.test.ts` (positive parse, two grammar-restriction
  failures), `tests/model-validation.test.ts` (accepts a valid `read` step;
  forward-reference, unknown-field, unknown-object diagnostics),
  `tests/runtime.test.ts` (successful read-then-create with an overridden
  field; missing-record failure; policy-denial failure),
  `tests/command-authority-replay.test.ts` (a `read` step re-executes and is
  re-authorized at the authority, using a standalone minimal model rather
  than Giggle Band — an `owner`-match read policy proves the authority
  re-checks the read under the session-verified caller, not merely trusts
  what the device claims it already read).
- Conformance: `conformance/runtime/command-read-step.json` — a
  `commandReadStep` model and three `executeCommand`/`validateModel` cases,
  plus a separate `commandReadStepForwardReference` model for the
  compile-time case, following the established "one dedicated model per
  distinct scenario, not one overloaded model" convention this suite already
  uses (`command-established-contexts.json`, `batch-commands.json`).
- `learnings/implementation/command-read-steps.md` (new): the full design
  record. `learnings/implementation/runtime-services.md` and
  `learnings/implementation/command-intent-replay.md`: short pointers to it.
  `learnings/index.md`: the new document added to the two relevant
  "Before tasks that..." lists and to "Current Learning Documents".

## Constraints

- No new `ResolvedCommandValueExpression` kind. `stepField`/`stepMeta` must
  remain the only way a later step reads an earlier step's bound record,
  whatever kind of step bound it.
- A `read` step must never be authorizable through `authority: "command"` or
  any equivalent bypass. It must always be checked against the caller's own
  read policy, through `ObjectStore.read`, never `getRecordForRuntime` or a
  parallel check.
- A `read` step must contribute no write, no operation-log entry, no
  record-id manifest entry, and no entry in a command's `RuntimeCommandResult.steps`.
- Do not implement iterating `read` steps (`FOR EACH` reading many records) in
  this phase. Evaluated and deliberately deferred — see "Scope" above and
  `learnings/implementation/command-read-steps.md`.
- Do not migrate Giggle Band's `duplicateGig` from its current
  presentation-layer implementation to this command-native mechanism. Named
  by the task brief as optional and lower priority; not done here (see
  "Reference app" below) because it is not cheap enough to be free and the
  existing feature already works.
- Do not fix the app-level `read`/`search` audit-configuration gap found
  while proving policy enforcement. Recorded in `learnings/implementation/command-read-steps.md`
  as a real, pre-existing, currently-live gap for whoever next needs it.

## Deliverables

Listed under "Scope" above; repeated here as the phase's completion checklist.

- `ResolvedCommandReadStep` / `PartialCommandReadStepModel` and their unions.
- Parser grammar for `STEP <name> READ <Object> ID <expr>` with header- and
  body-level restrictions enforced at parse time.
- `compile-adl.ts` and `resolve-model.ts` branches wiring the new AST/partial
  shape through to the resolved model.
- `validate-model.ts` support for the `read` action, reusing existing
  step-reference and forward-reference validation unchanged.
- `command-service.ts` runtime execution: `planStepRead`, policy-gated via
  `ObjectStore.read`, binding into the existing `stepRecords` map.
- Spec documentation in all three `docs/spec/` files.
- Unit tests across the parser, validator, and runtime layers, plus an
  authority-replay test proving server-side re-enforcement.
- A generic conformance fixture (not Giggle Band) proving: field copying,
  field overriding, read-policy denial failing the whole command, and the
  compile-time forward-reference refusal.
- The `learnings/` update described above.

## Acceptance Criteria

- A command with a `read` step and a later `create` step referencing its
  bound fields (`STEP <name> FIELD <field>`) resolves, validates, and
  executes, producing a new record whose referenced fields match the source
  record's values.
- A field the later step sources from `INPUT`/`LITERAL`/`RUNTIME` instead of
  `STEP <name> FIELD <field>` is **not** copied from the source record —
  proven by a value that differs from the source and matches the override
  instead.
- A `read` step whose target record does not exist fails the whole command
  (`ADL_STORAGE_ERROR`), and nothing the command would have written exists
  afterward.
- A `read` step denied by the caller's read policy fails the whole command
  (`ADL_POLICY_DENIED`), and nothing the command would have written exists
  afterward — proven against both the hermetic runtime and a real
  `AuthorityService.replay`, so the enforcement is proven server-side, not
  only client-side.
- A step referencing a `read` step that executes later in the same command
  is a compile-time error (`ADL_COMMAND_STEP_REFERENCE_UNKNOWN`), not a
  runtime crash or a silently `null` value.
- A `read` step's header rejects `AUTHORITY` and `FOR EACH`/`FOR_EACH`; a
  `read` step's body rejects `VALUE`/`SET`/`PATCH` — both as parse errors,
  not resolved-model or runtime-only diagnostics.
- `npm test` passes with the new and existing cases. `npm run typecheck` and
  `npm run format:check` are clean.
- `npm run test:integration` result recorded either way (see "Testing"
  below).
- `npm run verify:push` is not run; justified below.
- Every existing conformance case and unit test unrelated to command read
  steps is unmodified and still passes.

## Testing

- `npm test`: 971 tests pass (52 files) — Phase 70's baseline of 956 plus 15
  new: 1 in `parser.test.ts` (a positive `it`; two `expectParseFailure` calls
  were added inside an existing `it` and so add assertions, not test count),
  4 in `model-validation.test.ts`, 3 in `runtime.test.ts`, 3 in
  `command-authority-replay.test.ts`, and 4 new conformance cases discovered
  automatically by `tests/conformance-suite.test.ts`'s glob.
- `npm run typecheck`: clean.
- `npm run format:check`: clean (after `prettier --write` on the two files
  its formatting touched).
- `npm run test:integration`: **run, against real PostgreSQL via Docker** —
  157 tests pass (15 files), no regressions. No dedicated `read`-step
  PostgreSQL case was added: this phase's runtime and authority-level unit
  tests already prove the new behaviour with `InMemoryObjectStorageBackend`,
  matching the existing style of every other test in
  `tests/command-authority-replay.test.ts`, and a `read` step introduces no
  new PostgreSQL projection, migration, unit-of-work, or HTTP-edge behaviour:
  the write side of `CommandService.execute` (`commitPlannedTransaction`) is
  completely unchanged by this phase, and the new `planStepRead` path calls
  `ObjectStore.read`, a method every existing integration-tested read already
  exercises against real PostgreSQL through `ApplicationRuntime.read`. Given
  Docker was available, the full integration suite was still run as a
  regression check rather than merely justified away — if a future phase
  finds a `read`-step-specific interaction with real PostgreSQL (none is
  anticipated), it should add dedicated coverage under `tests/integration/`
  at that point.
- `npm run verify:push`: **not run.** This phase changes no DOM rendering,
  shell chrome, CSS, or browser component file, and does not touch Giggle
  Band's `domain.adl`/`ui.adl`/`band-app.ts` — no shipped presentation
  declaration references the new step kind, so Giggle Band's rendered output
  is unchanged. `tests/band-reference-app.test.ts` (which exercises Giggle
  Band's resolved model) already ran and passed as part of `npm test`.

## Non-goals

- Iterating `read` steps (`FOR EACH` reading many records). Evaluated and
  deferred; the type (`forEach?: never`) and grammar restrictions make this
  an additive follow-up, not a redesign, if it is ever needed.
- Migrating Giggle Band's `duplicateGig` action to this command-native
  mechanism. Explicitly optional and lower priority per the task brief; the
  existing presentation-layer implementation continues to work and was not
  touched.
- Fixing the app-level `read`/`search` audit-configuration gap found while
  proving policy enforcement (see "The Decision" above). Recorded as a
  pre-existing, currently-live gap in `learnings/implementation/command-read-steps.md`.
- Any change to `create`/`update` step semantics, the record-id manifest
  format for creates, or the sync-mode-mixed check's treatment of write
  steps. All unchanged; a `read` step is additive to the step-kind union,
  not a modification of the existing two.

## Dependencies

- `src/model/resolved-model.ts` (`ResolvedCommandStep`,
  `ResolvedCommandValueExpression`, `PartialCommandStepModel`).
- `src/parser/ast.ts` (`CommandStepDeclarationAst`), `src/parser/parser.ts`
  (`parseCommand`, `parseCommandStep`, `parseCommandStepAction`,
  `parseCommandValueExpression`).
- `src/compiler/compile-adl.ts` (`commandStepToPartial`).
- `src/compiler/resolve-model.ts` (`resolveCommandStep`).
- `src/compiler/validate-model.ts` (`validateCommandStep`,
  `validateCommandValueExpression`, `validateCommandStepIteration`,
  `validateCommandStepSyncCoherence`).
- `src/runtime/command-service.ts` (`CommandService.execute`,
  `planStepWrite`, `evaluateExpression`, `evaluateRecordIdExpression`,
  `requireStepPreconditions`).
- `src/runtime/object-store.ts` (`ObjectStore.read`, read-only reference to
  confirm the exact enforcement path reused).
- `src/runtime/policy-engine.ts` (`applyReadPolicy`, `requireAllowed`,
  read-only reference).
- `src/server/authority-service.ts` (`AuthorityService.replay`, `apply`,
  read-only reference to confirm command replay needed no change).

## Parallel Execution Plan

Single-capability phase whose layers form a strict producer/consumer chain —
resolved-model shape, then parser/compile-adl/resolve-model (which must agree
on the exact same AST/partial/resolved shapes), then validator (which
consumes the resolved shape), then runtime (which consumes the validated
resolved shape), then tests and conformance (which can only be written
against the actual runtime/validator behaviour, not predicted ahead of it).
Matches Phase 65's, Phase 68's, and Phase 69's own conclusion for work this
shape: a single serial pass costs less than coordinating a fan-out, because
almost every file in the chain is both a consumer of the previous step and a
producer for the next one, leaving no genuinely independent stream to fan out
onto. The one candidate for a fan-out — writing unit tests across
`parser.test.ts`, `model-validation.test.ts`, and `runtime.test.ts` in
parallel once the runtime landed — was not taken, because the three test
files needed to agree on one shared example scenario (the `DuplicateEvent`
command) to keep the phase's documentation and tests telling one consistent
story rather than three unrelated ones.

Barriers: `npm test` once, after every layer and every test file landed
together. `npm run test:integration` and `npm run verify:push` are not
needed; see "Testing" above.

## Tasks

1. Re-verify the gap against current code (done above; it reproduces exactly
   as Phase 69's evaluation described).
2. `src/model/resolved-model.ts`: add `ResolvedCommandReadStep`,
   `PartialCommandReadStepModel`, widen both step-model unions.
3. `src/parser/ast.ts` and `src/parser/parser.ts`: grammar for `STEP <name>
   READ <Object> ID <expr>`, header- and body-level restrictions.
4. `src/compiler/compile-adl.ts` and `src/compiler/resolve-model.ts`: `read`
   branches wiring AST through to the resolved model.
5. `src/compiler/validate-model.ts`: `read` action support in
   `validateCommandStep`, `validateCommandValueExpression`'s `recordId`
   check, and `validateCommandStepSyncCoherence`'s exclusion.
6. `src/runtime/command-service.ts`: `planStepRead`, the `execute` loop
   branch, `planStepWrite`'s narrowed parameter type.
7. `docs/spec/language.md`, `docs/spec/resolved-model.md`,
   `docs/spec/runtime-semantics.md`: document the grammar, resolved shape,
   and runtime semantics.
8. Unit tests: `tests/parser.test.ts`, `tests/model-validation.test.ts`,
   `tests/runtime.test.ts`, `tests/command-authority-replay.test.ts`.
9. `conformance/runtime/command-read-step.json`.
10. `npm test`, `npm run typecheck`, `npm run format:check`.
11. `learnings/implementation/command-read-steps.md` (new) and its pointers
    in `learnings/implementation/runtime-services.md`,
    `learnings/implementation/command-intent-replay.md`, and
    `learnings/index.md`.
12. Planning handoff (below).
13. Commit and push.

## Planning Handoff

Per `learnings/process/phase-execution.md`'s "Rolling Handoff Stopped At
Phase 63" rule, unchanged since Phase 64: a next phase after the rolling
handoff's stop must come from the user after they have used the system,
scoped the next application, and named concrete features or defects — not be
derived from the code. Phase 71, like Phase 69 and Phase 70 before it, is
exactly that: a user-commissioned follow-up to a gap Phase 69 had already
found and evaluated, not a gap this phase's own agent went looking for.

Nothing found while executing this phase rises to that bar on its own. The
one candidate — the app-level `read`/`search` audit-configuration gap (see
"The Decision" and "Constraints" above) — is real, but it is not something
the user has named as wanted, and nothing currently shippable is blocked on
it; per the same standing rule that kept Phase 69 from claiming the
COMMAND-step read gap as its own handoff, it is recorded in
`learnings/implementation/command-read-steps.md` as a candidate rather than
claimed here. No Phase 72 is written. The next phase, if there is one, again
awaits the user's next concrete instruction rather than a re-reading of this
phase's own code.

## Closing Note

This phase closes the exact gap Phase 69 evaluated and named — a command
could not read an existing record to seed a later step's write — using the
mechanism already in the codebase (`stepField`/`stepMeta` against
`stepRecords`) rather than the new expression kind Phase 69's evaluation
assumed would be needed, and enforces the read through the same policy gate
(`ObjectStore.read`) a direct API/UI read already uses, with no bypass. It
does not migrate Giggle Band's `duplicateGig`, does not add iterating reads,
and does not fix the pre-existing audit-configuration gap it found along the
way. See "Planning Handoff" above.
