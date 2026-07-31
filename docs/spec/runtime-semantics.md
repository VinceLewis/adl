# ADL Runtime Semantics Specification

The TypeScript runtime is the current semantic reference. The conformance
corpus under `conformance/` is the executable cross-runtime contract.

## Runtime Context

Runtime calls receive `RuntimeContext` with user id, global roles, channel, and
optional selected contexts, context roles, groups, online state, request id, and
fixed `now`. Runtime services must not read parser AST nodes.

When tests or conformance cases require time, `context.now` supplies the time.
Expression evaluation of `runtime.now` fails when `now` is absent.

## Expressions

Expression evaluation is pure from the caller perspective. It returns either a
typed value or a structured `ADL_EXPRESSION_*` error.

Missing fields evaluate as null. Equality and inequality can compare nulls.
Relational comparisons with null return false. Boolean `and` and `or`
short-circuit and require boolean operands. Null coalescing returns the right
operand only when the left operand is null.

## Decimal Semantics

Number arithmetic uses fixed-scale decimal math with scale 4, maximum absolute
value `999999999999.9999`, and half-away-from-zero rounding. Results are
returned as JSON numbers only after fixed-scale calculation. Divide by zero
returns `ADL_EXPRESSION_DIVIDE_BY_ZERO`.

## Validation

Runtime writes validate required fields, unknown fields, type compatibility,
named validators, predicate validators, object validations, readonly fields,
computed-field write denial, direct lifecycle state updates, and lifecycle
state validity. Validation failures throw structured runtime validation errors.

Model startup validation runs before runtime services accept a model.

## Policy Decisions

Policy is deny-by-default. Explicit matching deny rules win over all other
matching rules. Presentation restrictions are ordered from most restrictive to
least restrictive: hidden, mask, readonly. Allow applies only when no deny or
presentation restriction wins.

Read shaping applies field-level policy after row read permission is granted.
Masked fields return the mask sentinel. Hidden and denied fields are omitted.
Field-level allow does not grant row read permission.

Policy decisions include structured reasons with policy name, rule name when
applicable, effect, and message. `explainPolicyDecision` reports the winning
effect and precedence category.

## CRUD And Search

Create and update prepare values, check context scope, check policy, check field
policy, check sync mode, validate constraints, persist, audit, record operation
log entries, compute read-time fields, and shape responses by read policy.

Read checks context scope and read policy before returning a policy-shaped
record. Search requires search permission first, then filters each candidate
through read permission, context scope, computed fields, and read shaping.

Delete persists a tombstone and excludes deleted records from normal read and
search paths. A tombstone retains the record's values in storage: deletion is a
state, not a purge, and the id it holds is never freed. Deleting an
already-deleted record is refused, because the record is no longer reachable
through the normal path — the runtime does not distinguish that refusal from
deleting an id that never existed, while the authority does return a distinct
already-deleted conflict.

Generic browser CRUD rendering is list-first by default. Object list views show
the list/table as the primary surface. Row selection and create controls open a
form using the resolved view's `editContainer` hint: `modal`, `drawer`, `page`,
or `splitPane`. Saving, cancelling, closing, deleting, or completing a
lifecycle transition from a non-split container returns to the originating list
context. `splitPane` keeps the list and form visible together and may select the
first available row, preserving the earlier dense workflow as an explicit
configuration.

CRUD container choices are presentation hints only. Runtime create, update,
delete, transition, validation, policy, sync, audit, and operation-log behavior
is unchanged and remains enforced by runtime services.

## Shell Rendering

Browser shell rendering consumes `ResolvedApplicationModel.shell`. The drawer
orders nav items by resolved `order`, renders resolved labels, semantic icons,
groups, and active-state metadata, and evaluates shell visibility from runtime
context such as online state or business-context availability/selection.

Shell visibility is presentation behavior only. Hiding a nav item or shell
control does not enforce policy. Runtime services still enforce context scope,
policy, lifecycle, validation, sync mode, audit, and operation-log semantics
when a user or API attempts an operation.

Top-bar business-context selectors are shell controls. When the resolved shell
uses `mobileContextSelector: "sheet"`, constrained browser layouts render a
compact selected-context label that opens a modal/sheet for selection instead
of relying on a cramped dropdown. Route, persisted, and selected context ids
are still validated through runtime context services before scoped reads or
writes run.

Optional shell controls degrade by capability. The current browser runtime
implements context selection and sync/online status. Controls such as logout,
theme switch, and PWA install prompt can be declared and inspected, but render
as unavailable unless the host runtime supplies that capability.

## Lifecycles

Lifecycle transition is a first-class runtime operation. The implemented order
is: active record lookup, object scope, current-state legality, transition
policy, sync policy, lifecycle guards, target validation, before hooks,
persistence, audit, operation log, after hooks, computed fields, and read-policy
shaping. Registered error hooks run when hook or transition work fails in the
transition flow.

Guards use resolved expressions over the candidate target values. Failed guards
throw `ADL_LIFECYCLE_ERROR` with the guard message.

## Commands

Commands validate input, apply default input values, evaluate command-level
preconditions, plan each declared step, enforce each step precondition, validate
and authorize planned writes according to step authority, enforce constraints
across the planned transaction, then commit all writes together.

Command authority can use the command precondition as the authorization boundary
for a step, but validation, scope, sync, constraints, audit, and operation logs
still run.

Multi-record commands require a storage backend that advertises transactional
commit support. Backends without that capability reject multi-write commands
before any planned write is persisted. Validation, policy, sync-mode write
checks, and constraint checks run before the backend commit. Audit events,
operation-log entries, and sync-queue entries are recorded only after the
storage commit succeeds.

Command-backed row side effects keep their normal low-level operation kind
(`create`, `update`, `delete`, or `transition`) and additionally carry command
intent metadata: command name, optional command label, command step, and a shared
command transaction id. This lets replay, audit, and diagnostics preserve the
business action without hiding the affected object records.

## Decision Tables

Decision-table inputs evaluate first against the source values. Row conditions
then evaluate over named input values. `first` match returns the first matching
row. `single` match throws when more than one row matches. If no row matches and
default outputs exist, the default row is returned.

## Computed Fields

Computed fields evaluate at read time for create, read, update, delete, search,
transition, and command responses. They evaluate in resolved dependency order
and may reference stored fields or earlier computed fields on the same object.
Computed values are not persisted.

A stored value under a computed field's name is not authoritative. Every
read-time evaluation overwrites it with the computed result, so persisted state
left behind by an earlier model — one in which the field was stored rather than
computed — can never be returned. A runtime is not required to remove such a
value from storage; it is required never to disclose it.

## Read Models

Read models execute through `ApplicationRuntime.executeReadModel`. The first
source is the primary source. Additional sources are resolved through lookup
relationships from already-loaded sources. Source records must pass object
scope, search/read policy, and source scope checks before projection.

Expression fields evaluate in declaration order over already-projected row
values, after source read policy shaping.

A deleted source record resolves to nothing, exactly as an unreadable or
out-of-scope one does. When the record that fails to resolve is a joined source,
the whole row is dropped rather than projected with the joined fields missing,
so a row can disappear from a read model while its primary record is still live
and still carries the reference. This is deliberate — a half-projected row would
be indistinguishable from a real one — but it means a read model is not a place
to observe why a row is absent.

## Presentation Evaluation

Composed views evaluate through `ApplicationRuntime.evaluatePresentationView`.
The runtime consumes `ResolvedView.presentation` and returns renderer-neutral
view data: sections, controls, command/navigation actions, lists, rows, row
actions, resource/date matrices, matrix cells, text/icon fragments, semantic
row and cell statuses, view legends, empty states, local state values, and
structured diagnostics.

Evaluation order is deterministic:

1. Initialize local view state from resolved state defaults.
2. Apply caller-provided local state and state updates with type checks.
3. Bind each list through policy-enforcing runtime APIs: object lists use
   `search`, and read-model lists use `executeReadModel`.
4. Apply presentation `WHERE` filters to already-shaped row values plus local
   state.
5. Apply presentation list ordering.
6. Evaluate list status candidates from direct status names or status maps.
   The effective status is the candidate with the highest declared precedence;
   ties use status declaration order.
7. Evaluate row templates, icon maps, display formats, conditional fragments,
   and empty states.
8. Bind each matrix through policy-enforcing runtime APIs. Row and cell sources
   may be objects or read models. Date columns are generated deterministically
   from the resolved date range. Blank/unset cells can receive an explicit
   semantic status without writing a persisted row.
9. Evaluate matrix cell statuses using the same precedence and declaration-order
   rules as list rows.
10. Evaluate legends from declared status order. Legends default to statuses
   present in evaluated rows and matrix cells; `include: all` includes all
   declared legend statuses.

Presentation filters are display filters only. They run after runtime read
authorization, context scoping, offline dataset constraints, and read-model
projection. They do not grant access to rows or fields and do not replace
policy enforcement on writes, commands, sync replay, imports, or APIs.

Row-template evaluation is read-only. It does not mutate stored records or local
view state.

Matrix cell cycling and matrix range editing are runtime operations. They do
not mutate browser-only state. The runtime resolves the matrix declaration,
finds the matching persisted cell row where one exists, computes create, update,
or delete behavior from the edit declaration, checks policy and sync mode, then
executes validated object operations. Range edits declare sequential validated
writes, so partial application behavior is explicit rather than hidden behind a
browser loop.

Semantic statuses are data, not CSS class names. Runtime status output includes
the stable status name, label, accessibility label, theme token, precedence, and
optional icon. Missing status maps, missing fields, unmapped values without a
default status, and unknown status names produce structured presentation
diagnostics.

Action-control evaluation is renderer-neutral. Runtime output includes action
intent, label, semantic icon, placement, target command or view, resolved input,
visible state, enabled state, and reasons. Action visibility predicates and
command preconditions can shape presentation output, but a visible or enabled
button is not authorization. Browser action dispatch routes navigation actions
to model view navigation and command actions through
`ApplicationRuntime.executeCommand`, where command preconditions, policy,
validation, sync, audit, and operation-log behavior remain authoritative.

Parent-child edit surfaces evaluate through
`ApplicationRuntime.evaluateEditSurface`. The runtime consumes
`ResolvedView.editSections` and returns renderer-neutral field sections and
child collection sections. Existing parent records load child rows through
policy-enforcing search on the child object, then filter rows whose declared
parent lookup field equals the parent record id. Child collection actions are
shaped by child-object policy and sync state for each operation.

Unsaved parents cannot be used as persisted relationship targets. Child changes
for a create workflow are represented as explicit staged operations and are
included in the evaluated edit surface. Saving the parent may then call
`ApplicationRuntime.applyStagedChildChanges`, which applies staged operations in
the supplied order through normal runtime create, update, and delete paths.
Those paths continue to enforce validation, policy, constraints, sync, audit,
and operation-log behavior. Cancelling a create/edit container discards the
caller-held staged operation list.

Relationship picker candidates evaluate through
`ApplicationRuntime.evaluateRelationshipPicker`. The runtime loads candidates
from the picker object source through policy-enforcing object search, or from
the picker read-model source through read-model execution. Picker search,
already-linked exclusion, and deterministic sorting run only after those
runtime reads have applied context scoping and read policy. Object-backed
pickers use the child object record id. Read-model-backed pickers use the
source reference for the child object.

`linkExisting` picker output is represented as explicit staged child operations.
Multi-select output is ordered deterministically by picker sort, display label,
and record id before the browser stages the selected child ids. Applying staged
links rejects duplicate child ids in the same batch and rejects stale attempts
to link a child row that is already linked to the same parent. Model-declared
constraints are still enforced by the normal create/update transaction path.

The deterministic formatter currently supports:

- dates with `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, and `EEE`
- times with `HH`, `H`, `hh`, `h`, `mm`, `ss`, and `a`
- datetimes as UTC combinations of supported date and time segments
- numbers as `plain`, `integer`, `fixed:N` for `N` from 0 to 4, and `0`,
  `0.0`, `0.00`, `0.000`, or `0.0000`
- text as primitive string conversion

Unsupported formats and missing row data produce structured
`ADL_PRESENTATION_*` diagnostics and fall back to raw or empty text where
possible.

Presentation evaluation does not consume or emit browser DOM structures. The
cross-runtime conformance corpus exercises this renderer-neutral output without
importing browser Web Components.

## Business Contexts

Selected contexts narrow scoped object operations. Context-scoped roles are
checked only for matching context instance ids and must not be merged into
global roles. Cross-context read models remove the selected context for that
business context and use available context roles.

Membership is resolved over **active** membership records only: deleting a
membership record revokes the context role it granted. A context is available
only while its context-object record is also active, so deleting the context
object removes the context from the available set even when the membership
record granting it survives. Both are checks against the current record set
rather than a cached grant, so revocation takes effect on the next resolution.

## Sync Modes

`localFirst` allows local writes and queues syncable operations.
`cacheReadonly` allows local reads of cached records but rejects local writes.
`onlineRequired` rejects writes only when `context.online === false`.
`localPrivate` allows local writes on every channel except `sync`, and excludes
them from the sync queue.

Policy checks run before sync-mode write checks.

A write decision carries `queueable`, and it is a claim about what the runtime
did, not a label: an allowed write is queued if and only if its decision says
`queueable`. `localPrivate` is `queueable: false` for **every** operation kind —
create, update, delete and transition — whether the context is online or
offline, and whether or not other operations are already queued. A runtime that
queued a `localPrivate` write would have implemented one mode twice.

A refused write is queue-neutral. Nothing a `cacheReadonly` or offline
`onlineRequired` write attempts may reach the queue, so a refusal can never cost
a device the operations it was already holding.

### Each mode's relationship to the authority

Every mode has a stated answer in every column. Silence in any of them is what
let an `onlineRequired` write be accepted locally and then never sent.

| Mode | Local write | Queued and delivered | Authority accepts a replay | Bootstrap returns it |
| --- | --- | --- | --- | --- |
| `localFirst` | allowed online and offline | yes — delivered on the next reconcile | yes | yes |
| `onlineRequired` | allowed only while `context.online !== false` | yes — delivery is attempted at once, and retried by every later reconcile until it lands | yes | yes |
| `cacheReadonly` | refused on every channel | never: there is no accepted local write to queue | no — `ADL_SYNC_POLICY_DENIED` | yes |
| `localPrivate` | allowed, except on the `sync` channel | never | no — `ADL_SYNC_POLICY_DENIED` | no |

Two entries in that table are reachable only from the authority's side and are
stated so a runtime does not have to guess:

- A `cacheReadonly` record is read-only on a device, not invisible to it, so a
  bootstrap discloses it under the same read policy as any other record. No
  replay can create one, so such records originate on the authority rather than
  on a device.
- No `localPrivate` record can reach the authority at all, because the write is
  refused on the `sync` channel before it is applied. A bootstrap therefore
  excludes `localPrivate` objects as a second, redundant guard rather than as
  the rule that keeps them local.

### `onlineRequired` delivery

An accepted `onlineRequired` write is queued exactly as a `localFirst` write is,
and delivered by the same path. The mode's whole difference from `localFirst` is
that it refuses the write while offline; once a write has been accepted, holding
no delivery path for it would mean accepting work the runtime could not
complete.

Delivery of a queued `onlineRequired` operation is attempted immediately rather
than deferred to the next reconcile, because the mode's premise is that the
authority is reachable now. An attempt that fails does not undo the accepted
write and does not settle the operation: the entry stays queued and replayable,
and every later reconcile sends it again until the authority answers.

### Delivery state

A transport failure is not a verdict and never becomes one. It is recorded
against the queue entry as an **undelivered** delivery state, distinct from the
`rejected`, `conflict` and `manualResolution` verdicts the authority issues:

- An undelivered entry is still replayable and is still sent by the next
  reconcile. A verdict-bearing entry is not.
- The delivery state is cleared when the entry is delivered, when the authority
  answers it, or when it is retried.
- An undelivered entry must be visible to the user, in the same surface as a
  settled one. A write the runtime accepted and cannot deliver is the failure
  mode this state exists to make impossible to hide.

An undelivered state is recorded only for a mode whose accepted writes may not
wait for a later connection — today `onlineRequired` alone. A `localFirst` write
that has not been delivered is holding, not failing: queueing until the device
reconnects is that mode's contract, and reporting it as undelivered would
present normal offline operation as an error.

## Offline Datasets

Offline dataset membership is separate from authorization. Dataset evaluation
returns record references and reasons. User-facing local reads still route
through policy-enforcing runtime search/read paths.

`onlineRequired` records are excluded from offline datasets.
`cacheReadonly` records can be included for reads. `localPrivate` records can be
included locally but are not queued for sync.

Deleted records are excluded from a dataset. A dataset's reported context roles
follow the same active-membership and active-context rules as context resolution
itself, so deleting a membership record or its context object empties the scope
it granted rather than leaving a dataset that outlives it.

Dataset ordering is not contractual. Records are returned grouped by object, but
the order within an object depends on record ids, whose shape no specification
defines.

## Inspection

`explainResolvedModel` returns the resolved model plus origin entries for
platform defaults, derived defaults, and source values. `inspectResolvedModel`
formats the same information as text. `explainPolicyDecision` formats policy
request, context, winning decision, reasons, and precedence.

Inspection includes presentation defaults and reference-bearing declarations
when a view has `presentation`: layout, density, local state type/default/
persistence, icon-map fields, status labels/accessibility labels/theme tokens/
precedence, status-map fields, legend status/include behavior, control
state/command/view/context references, action placement and input references,
list source and source kind, render style, density, empty-state text, list
status candidates, row actions, row layout and density, row field references,
icon-map references, and fragment style defaults. Invalid
presentation references remain validation diagnostics with `ADL_PRESENTATION_*`
codes rather than parser-AST explanations.

Inspection also includes shell defaults and references: top-bar context
selector placement, mobile context selector behavior, top-bar controls, nav
target views, nav labels, order, active-state view names, visibility, control
kinds, control placement, and control visibility. Invalid shell references
remain validation diagnostics with `ADL_SHELL_*` codes.

## Schema-Version Compatibility

Runtime startup checks persisted application model metadata and stored record
schema versions. Mismatches produce structured startup diagnostics and block
runtime use when severity is error.

## Model Migration

Startup compares persisted application metadata against the running model and
resolves exactly one of the situations below. Every one of them either proceeds or
refuses; none of them destroys persisted data.

| Persisted state | Outcome |
| --- | --- |
| Same version, same fingerprint | Proceeds. |
| Same version, no fingerprint recorded | Proceeds with `ADL_PERSISTED_MODEL_FINGERPRINT_MISSING` (warning) and backfills it. |
| Same version, different fingerprint | Refuses with `ADL_PERSISTED_MODEL_FINGERPRINT_STALE`. |
| Earlier version, a declared chain reaches it | Migrates, then proceeds, reporting `ADL_MODEL_MIGRATION_APPLIED` (info). |
| Earlier version, no chain reaches it | Refuses with `ADL_PERSISTED_MODEL_VERSION_MISMATCH`. |
| Later version than the model's | Refuses with `ADL_MIGRATION_PERSISTED_VERSION_AHEAD`. |

Versions are compared **component-wise**, so `1.1` and `1.1.0` are the same
version and neither migrates to the other. Anywhere a version is used as a key —
selecting a migration, walking a chain — it is normalised first.

`renameField` onto a key the record already carries replaces the occupant. An
author who renames into an occupied field is asserting that the source is the
surviving value; declare a `dropField` first if the intent is otherwise.

The stale-fingerprint case is the one that used to pass in silence. The model
that persisted the state is not the model now running, so no migration can be
selected and none can be assumed unnecessary; the remediation is to declare a
new `MODEL_VERSION` and a `MIGRATION` to it.

Persisted state ahead of the running model is refused rather than read, because
an older process silently reading newer records is how a downgrade destroys data
it does not understand.

Migration semantics:

- Records are migrated **before** their schema versions are checked. Making
  records that would otherwise fail that check pass it is the entire purpose.
- A record of an object no hop mentions is left byte-identical. It does not
  acquire a new revision or a reordered value map as a side effect of an
  unrelated migration.
- `revision`, actor and timestamps are preserved on migrated records. A
  migration is not an edit by anyone: rewriting them would make a schema change
  look like a user's change in every audit surface, and would break optimistic
  concurrency for a client holding the pre-migration revision.
- Record rewrites and the metadata row that declares them migrated commit
  together, atomically. A backend that cannot commit atomically is refused
  rather than migrated write by write: a half-applied migration is the one
  outcome no diagnostic can describe honestly afterwards.
- A migration that fails is rolled back and reported as
  `ADL_MIGRATION_FAILED`, leaving persisted state exactly as it was.
- Pending local operations are migrated by the same steps, minus `addField`: a
  patch is a set of changes rather than a whole record, so backfilling a default
  into one would assert a change the user never made. Nothing is created —
  no audit event, operation-log entry or queue entry is ever fabricated.
- Cached identity is not a record, carries no schema, and is never touched.

An authority refuses to start when it cannot reconcile its accepted-record
projection. A process that started anyway would answer bootstraps from records
shaped for a different model, and every device that pulled them would persist the
damage locally.

## Expression Errors

Every expression failure is one of these codes. A conforming runtime returns the
code; the message is advisory.

| Code | Raised when |
| --- | --- |
| `ADL_EXPRESSION_FIELD_UNSUPPORTED_VALUE` | A field reference resolves to a value that is not a supported expression value. |
| `ADL_EXPRESSION_RUNTIME_REFERENCE_MISSING` | A runtime property is referenced but absent from the runtime context. |
| `ADL_EXPRESSION_RUNTIME_REFERENCE_UNSUPPORTED` | A runtime property is referenced that this contract does not define. |
| `ADL_EXPRESSION_OPERATOR_UNSUPPORTED` | An operator is reserved and not yet supported (`in`). |
| `ADL_EXPRESSION_TYPE_MISMATCH` | Operand kinds cannot be combined or compared. |
| `ADL_EXPRESSION_DIVIDE_BY_ZERO` | Division or modulo by zero. |
| `ADL_EXPRESSION_DECIMAL_OVERFLOW` | A value or result exceeds the supported decimal magnitude. |
| `ADL_EXPRESSION_INVALID_TEMPORAL_VALUE` | A `date`, `datetime` or `time` value is not well formed. |

Two rules about this table are contractual because they are easy to get wrong:

- **Overflow means magnitude, never precision below the scale.** A value smaller
  than the decimal scale rounds toward zero like any other; it is not an
  overflow. Formatting a number for parsing must not introduce an exponential
  form that the decimal grammar then rejects — that would make the rule an
  artifact of one language's number formatting rather than of ADL.
- **Reserved-operator failures and internal faults share
  `ADL_EXPRESSION_OPERATOR_UNSUPPORTED` today.** A second runtime should treat
  the reserved-operator meaning as the contractual one.

### Value Kinds And Comparison

An expression value has one of seven kinds: `text`, `number`, `boolean`, `date`,
`datetime`, `time`, `null`.

- A literal's `valueType` reclassifies **only** the three temporal kinds and is
  otherwise ignored.
- A **field reference never carries a temporal kind**: its kind is inferred from
  the stored primitive, so a date-typed field evaluates as `text`.
- **Ordering** (`<`, `<=`, `>`, `>=`) coerces text to the other operand's
  temporal kind, in both directions.
- **Equality** (`==`, `!=`) does **not** coerce: operands of different kinds are
  unequal. Combined with the rule above, `SomeDateField == DATE '2026-01-31'` is
  therefore always false while `>=` on the same pair compares as intended. This
  is a known sharp edge, recorded rather than endorsed.
- `datetime` ordering normalises to the instant, so two spellings of the same
  instant in different offsets compare equal. `time` ordering normalises to
  milliseconds-of-day, so `09:00` and `09:00:00` compare equal. `date` ordering
  is textual over a fixed-width form, which is equivalent.
- Equality for temporal kinds remains **textual**, so two spellings of one
  instant are ordered equal but compared unequal. Also a known sharp edge.

## Authority Replay And Outcomes

A client replays an operation intent to the authority. Every intent carries an
`operationId` and, for a create, the **record id the client already holds** — an
authority-minted id would come back naming a record the client does not have,
stranding the local row it was replayed from.

A record id is untrusted input. It is an identifier and never an authorisation:
naming a record grants nothing, and the caller may not assert revision, actor,
timestamps, accepted state or scope. A usable id is 1 to 320 characters, carries
no surrounding whitespace, and contains no control characters. It is never
trimmed — the accepted record has to come back under the exact id the caller
holds, so a whitespace-padded id is refused rather than silently rewritten.

An `update`, `delete` or `transition` intent also carries a `baseRevision`: the
revision the client last saw. It must equal the record's **current** revision for
the intent to be applied — anything else takes the `conflict` path below, whether
it is a revision the authority superseded or one it never issued. An accepted
mutation **advances** the record's revision, so the revision an accepted outcome
returns is the one the next intent must carry.

A revision is **opaque**. No format is defined and none may be assumed: a client
round-trips the value the authority returned rather than constructing, parsing,
incrementing or ordering one. This is a contract obligation rather than a
convention. A caller that derived the next revision from the last would be
depending on a guarantee only one implementation makes, and so would a
conformance case that spelled a revision out instead of naming the outcome it
came from.

An outcome is one of four:

| Status | Meaning |
| --- | --- |
| `accepted` | Applied; the accepted records are returned. |
| `rejected` | Refused with a code. |
| `conflict` | The record moved; `recovery` names the resolution. |
| `manualResolution` | The record moved and the object asks a human to resolve. |

`recovery` follows the object's declared `CONFLICT` strategy: `serverWins`,
`clientWins`, `stateTransitionWins`, or `manual`, the last escalating the status
to `manualResolution`. **A missing or already-deleted record follows the same
declared strategy as a stale revision.** An object that asks for manual
resolution gets it for the update-versus-delete race too — that race is where a
local edit is about to be discarded entirely, so it is the last place to resolve
automatically.

Ordering on the create path is contractual, and two parts of it are security
decisions rather than conveniences:

    record id shape → context scope → policy → field policy → sync mode → id collision

- **Shape is checked before policy** because it is pure input validation and
  reveals nothing.
- **Collision is checked after policy** so that a caller who may not write the
  object cannot use id collisions as an existence oracle: an unauthorised caller
  colliding with a real id gets a policy denial, not a collision refusal.

A colliding id is refused, never merged and never overwritten, and the collision
check reads through tombstones — deleting a record does not free its id.

Replay is **idempotent and bound to the actor**: the same `operationId` from the
same actor returns the stored outcome verbatim, while a different actor reusing
that id is applied afresh.
