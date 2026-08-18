# Command Read Steps

Read this before changing command step kinds, the command value-expression
vocabulary (`stepField`/`stepMeta`), command step-ordering validation, or
anything that lets a command read an existing record rather than only create or
update one.

## The gap this closes (Phase 71)

Before Phase 71, ADL's `COMMAND`/`STEP` grammar had exactly two step kinds,
`create` and `update`. Every value a step wrote had to come from a literal, a
command `INPUT`, a runtime property, or a field/metadata of a record *this same
command's own earlier step had just written*. There was no way for a command to
read an **existing** record — one it did not itself just create or update — and
seed a later step's write from it. "Duplicate this record, but with a blank
date" could only be built client-side, by a presentation form pre-filling
itself from a read the UI performed separately (which is how Giggle Band's
`duplicateGig` action works, and remains adequate for that UI-triggered case —
Phase 71 did not migrate it).

Phase 69 evaluated this gap while building row-action record identity, decided
it was a separate, larger capability, and named it as a candidate. Phase 71 is
the user-commissioned phase that closed it.

## The decision: a `read` step, reusing the existing step-binding expressions

A `read` step (`STEP <name> READ <Object> ID <expr>`) reads one existing record
by id and binds it under the step's own name, exactly the way a `create`/
`update` step's own written record is already bound. **No new
`ResolvedCommandValueExpression` kind was added.** A later step reads a `read`
step's bound fields with the identical `{ kind: "stepField" }` / `{ kind:
"stepMeta" }` expressions that already read an earlier `create`/`update` step's
record — `stepRecords: Map<string, StoredObjectRecord>` in
`CommandService.execute` never distinguished *how* a name got bound, only that
it did, so extending what can populate that map was the entire surface area.

This was the single biggest simplification available: the alternative
(`ADL_Codex...` early sketches, and Phase 69's own evaluation) assumed a new
expression kind like `{ kind: "lookupField", recordId: ..., field: string }`
would be needed. It would not have been *wrong*, but it would have doubled the
vocabulary a model author and every future tool has to know, for a distinction
(step wrote this record vs. step read this record) that no consumer of the
value actually cares about.

### Shape

`ResolvedCommandReadStep` (`src/model/resolved-model.ts`):

```ts
interface ResolvedCommandReadStep {
  name: string;
  action: "read";
  object: string;
  recordId: ResolvedCommandValueExpression;
  preconditions: ResolvedExpression[];
  forEach?: never; // never iterates — see below
}
```

Deliberately has **no** `authority`, `values`/`patch`, or (usable) `forEach`:

- **No `authority`.** `authority: "command"` lets a *write* step bypass the
  caller's own write policy, with the command's own preconditions substituted
  as the authorization boundary. A read step writes nothing, so there is no
  write to authorize, and — this is the actual design point, not just an
  omission — **no equivalent bypass is offered for the read either.** A read
  step always goes through the caller's own read policy. See "Policy" below.
- **No `values`/`patch`.** A read step writes nothing.
- **No working `forEach`.** Iterating reads (`FOR EACH` over a repeated input,
  reading many records) were evaluated and explicitly deferred: it is a real
  future capability but was not needed to prove the core mechanism, and adding
  it later is additive (a `forEach` field back on the type, an `evaluateExpression`
  case reading a per-item id), not a redesign. `forEach?: never` on the type is
  what makes `reportIteratingStepReference`/`validateCommandStepIteration`
  keep treating `ResolvedCommandStep.forEach` as a plain optional field across
  every step kind, rather than needing to narrow by `action` at each call site
  that already handled `create`/`update` uniformly.

### Grammar

`STEP <name> READ <Object> ID <expr>` — header takes only `ID`, no `AUTHORITY`,
no `FOR EACH`/`FOR_EACH`, no `ESTABLISHES CONTEXT`. The step body accepts only
`REQUIRE` (a precondition, evaluated against the record the step read) and
`END.STEP` — never `VALUE`/`SET`/`PATCH`. Both restrictions are enforced by the
parser itself (`src/parser/parser.ts`'s `parseCommandStep`), branching on
`action` exactly the way it already branches the header-option and
error-message text for `create` vs. `update`, so a model author gets a parse
error at the point of the mistake rather than a resolved-model shape a later
layer has to reject.

## Policy: the same gate a direct read would use, no looser

`CommandService.planStepRead` calls `ObjectStore.read(objectName, recordId,
context)` — the exact same method `ApplicationRuntime.read` calls for a direct
API/UI read. This means a command's `read` step gets:

- **Object scope** (`requireObjectScopeForRecord`): a record scoped to a
  business context the caller cannot reach is refused exactly as it would be
  for a direct read.
- **Row policy** (`policyEngine.requireAllowed(..., "read", ...)`): a denial
  throws `PolicyDeniedError`, which propagates out of `CommandService.execute`
  before any write is planned — nothing commits, because planning happens
  entirely before `ObjectStore.commitPlannedTransaction` is ever called.
- **Field-level read shaping** (`policyEngine.applyReadPolicy`): a masked
  field comes back as `MASKED_POLICY_FIELD_VALUE`; a hidden field is omitted.
  If a later step's `STEP <name> FIELD <maskedField>` reads that field, it gets
  the *masked* value, not the real one — a command cannot see more of a source
  record than the caller invoking it could see by reading it directly.
- **Computed fields** (`applyComputedFieldsToRecord`), applied before the
  policy shaping above, exactly as a direct read gets them.

**This is the actual design point of the whole feature, not an incidental
detail.** The obvious wrong shortcut — read straight from `ObjectStore.storage`
or reuse the update step's existing `getRecordForRuntime` helper (which an
`update` step already uses to fetch its own target for precondition checking,
and which deliberately applies **no** read policy at all, because the write
path immediately after it is what authorizes the change) — would have let a
command bypass per-record read authorization just by phrasing a read as a step
instead of a direct call. `getRecordForRuntime` remains correct for its
existing use (an update step's own target, authorized by the write that
follows), and is the wrong tool for a step whose entire purpose is disclosing a
record's contents to later steps.

## Step ordering: forward references are refused at compile time, for free

`src/compiler/validate-model.ts`'s `validateCommandStep` already validated
every step in declared order, accumulating a `previousStepsByName` map that
`stepField`/`stepMeta` reference validation looks up (`ADL_COMMAND_STEP_REFERENCE_UNKNOWN`
when the name is absent). Because a `read` step populates that exact map the
same way a `create`/`update` step already did, **no new step-ordering
validation code was needed at all** — a `create` step declared before a `read`
step it references fails the existing check, because the `read` step simply
has not been added to the map yet when the earlier step is validated. This is
the same "reuse the existing mechanism rather than add a parallel one" pattern
Phase 69 used for row-action record identity (`RECORD_ID_JOIN_FIELD`).

## Failure semantics: whole-command failure, not a new shape

A `read` step's target record not existing is a `StorageError`
(`ADL_STORAGE_ERROR`), raised in `CommandService.planStepRead` the same way an
`update` step already raises one when `getRecordForRuntime` returns `null` for
its own target — this is not a new failure shape, it is the existing "a step's
target record must exist" check reached by a second route. A read denied by
policy is a `PolicyDeniedError` (`ADL_POLICY_DENIED`), propagating exactly as
any other step's policy denial does. Either way nothing commits: planning for
every step happens before `ObjectStore.commitPlannedTransaction` is ever
invoked, so a failure at step 1 of 5 leaves nothing written by steps 1
through 4 either.

## What a read step contributes to the wider command machinery — nothing

A read step is deliberately inert everywhere a write matters:

- **Not in `plannedWrites`.** `CommandService.execute`'s per-step loop branches
  on `step.action === "read"` before calling `planStepWrite`, and calls
  `planStepRead` instead, which is never added to the write-tracking arrays.
- **Not in the command's result** (`RuntimeCommandResult.steps`), which is
  built only from `plannedWrites`.
- **Not in the operation log.** Only a write produces an operation-log entry;
  a read step contributes none of its own (though `ObjectStore.read` does
  produce an *audit* event, gated by the object's own `audit.operations` — see
  the caveat below).
- **Not in the record-id manifest for authority replay**
  (`LocalCommandOperation.recordIds` / `AuthorityCommandRecordId[]`). The
  manifest names only the records a command *creates* — see
  [[command-intent-replay]] — and a read step creates nothing, so it never
  needs an entry there. This also means the "positional and named" manifest
  matching that guards creates is entirely unaffected by read steps: they are
  simply invisible to it.
- **Not in `validateCommandStepSyncCoherence`** (the `ADL_COMMAND_STEP_SYNC_MODE_MIXED`
  check): a read step writes nothing, so it has no write-delivery mode to
  disagree with the command's other steps about, and is skipped in that
  check's loop regardless of its target object's own declared sync mode.

## A pre-existing gap this phase found but did not fix: `read` auditing has no partial-model surface

While proving the read step goes through the same audited path a direct read
would, it turned out audit configuration for `read`/`search` operations is
**unreachable from `PartialApplicationModel` at all**: `ResolvedApplicationModel.audit`
(the app-level gate `AuditService.record` checks first, `model.audit.operations.includes(operation)`)
is always `createDefaultAuditModel()` (`src/compiler/resolve-model.ts`), with
no field on `PartialApplicationModel` to override it, and `DEFAULT_AUDIT_OPERATIONS`
(`src/model/defaults.ts`) excludes `"read"` and `"search"`. An object's own
`audit.operations` can only *narrow* what the app-level gate already allows
through (both are ANDed), never widen it — so declaring `audit: { operations:
["read"] }` on an object has no effect: `read` is never audited by any model
built from a partial model or ADL source, even though `AuditOperation` and
`ObjectStore.read`'s call to `auditService.record("read", ...)` both clearly
intend it to be reachable. This is pre-existing, not introduced by this phase,
and out of scope to fix here (it is an app-level audit-configuration gap, not
a command or read-step gap) — recorded so a future phase does not have to
rediscover it while trying to assert on a command read step's audit trail.

## Consistency, not a new consistency model, under offline replay

A `read` step re-reads its target at the point it executes — locally when a
device runs the command offline, or at the authority when a queued command is
replayed later. If the source record changed between those two executions, the
values a replayed `read` step sees can differ from what the device saw
locally, and so can the record it seeds. **This is not a new risk the read step
introduces**: an `update` step's own target is already re-read fresh at
whichever point it executes (`getRecordForRuntime` is called at plan time, not
snapshotted at queue time), for exactly the same reason — the authority
re-executes the whole command from its own current state, by design (see
[[command-intent-replay]], "the authority re-executes ... policy, validation,
lifecycle, scope, constraints and command preconditions all run server-side
exactly as they ran locally"). A read step is simply a second way to reach a
behaviour that already existed. A model author building a command with a
`read` step that may be queued offline should be aware of it, exactly as they
already should be for a command with an `update` step.

## Practical guidance

- When a command needs to reference "a record" from a value expression, check
  whether the record is one this command already wrote (`stepField`/`stepMeta`
  against a `create`/`update` step already covers it) before reaching for a
  new binding mechanism — a `read` step plus the existing reference syntax is
  usually the answer, not a new expression kind.
- Any new command step kind that reads rather than writes should go through
  `ObjectStore.read`, never `getRecordForRuntime` (which applies no read
  policy and exists specifically for a write step's own pre-write existence
  check) or a raw storage lookup.
- The `previousStepsByName` step-ordering validation in `validate-model.ts` is
  generic over step action already — a new step kind that participates in the
  `stepField`/`stepMeta` binding namespace gets forward-reference protection
  for free, with no new validation code, as long as it is added to that map
  the same way every other step already is.
