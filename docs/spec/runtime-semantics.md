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

A `self` principal matches when the request carries a record whose own id equals
the caller's user id, and never otherwise. It does not consult who created the
record, nor any declared field: `owner` answers "I created this" and `self`
answers "this is me". It fails closed on a request with no record and on an empty
caller id, so every gate evaluated without a record — the object-level `search`
check among them — is unreachable for it, and a `self` grant can therefore never
widen enumeration. An explicit matching `deny`, `hidden` or `mask` rule still
wins over a `self` allow, because deny and presentation restrictions are ordered
ahead of allow.

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
form using the `editContainer` hint of the **form view being opened**: `modal`,
`drawer`, `page`, or `splitPane`. The hint is read from that view rather than from
whichever view is active, so a container declared on a `FORM` view governs that
form from every entry point and a container declared on the `LIST` view does not
override it. The container the runtime opens and the container the renderer draws
are read from the same value, so presentation and behaviour cannot disagree.
Saving, cancelling, closing, deleting, or completing a
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
implements context selection, sync/online status, sign-out, theme switching,
and PWA installability. `themeSwitch` renders a dropdown over every theme in
the resolved model (always at least the three built-in base themes, plus any
the app declares), applies the chosen theme immediately, and persists the
choice device-locally so it survives a reload — no application-declared object
or field is needed for this, since the active theme is platform presentation
state rather than application data. With fewer than two declared themes the
control renders unavailable, the same shape a control with no host capability
behind it renders. PWA install captures the browser's `beforeinstallprompt`
event, prompts on the control's click, and reflects both an accepted/dismissed
choice and a later `appinstalled` event (or a device already running the app
installed) by disabling the control. Any control whose host capability the
runtime does not supply — PWA install on a browser that never offers
installability, for instance — renders as an unavailable control rather than
breaking the shell.

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

### Read steps

A `read` step is planned like any other step, in declared order, but it plans
no write: it evaluates its `recordId` expression, then reads that record
through the identical policy-gated path a direct API/UI read of the same
record would take — object scope, row policy, and field-level read shaping
(mask/hidden) all apply, exactly as `ObjectStore.read` already enforces for
every other reader. A conforming runtime must not offer a read step any
narrower or looser check than that path, and in particular must not let a
read step's own step authority (there is none to declare) stand in for it.

The record a read step reads is bound under the step's name for the remainder
of the command, exactly as a `create`/`update` step's own written record is —
a later step's value expressions read it with the same reference a
`create`/`update` step's record already supports. A read step is otherwise
inert: it contributes no entry to the transaction's planned writes, no
operation-log entry, no audit event beyond the read audit `ObjectStore.read`
itself already produces when the object's audit configuration includes
`read`, and no entry in a command's written-records list or its record-id
manifest for authority replay.

**Failure is whole-command failure.** A read step's target record not
existing, or the caller's read policy denying it, fails the command before any
write is planned or committed, and any state a policy denial or a missing
record would already disclose (row existence, masked fields) is disclosed no
more than an equivalent direct read would disclose — a read step is not a way
to probe for the existence of a record the caller could not otherwise read.
This is not a new failure shape: it fails the same way an `update` step's own
"does the target record still exist" check already fails a command, extended
to a step whose only purpose is that check.

**A read step's target is re-read at the point the step executes, whichever
device executes it.** Executed locally, that is the device's own local state;
replayed at the authority, that is the authority's state at replay time. This
is the same behaviour every other step's "read the record this step's
recordId names" already has — an `update` step re-reads its own target too —
so a read step introduces no new consistency model. A model author relying on
a read step inside a command that may be queued and replayed later should be
aware the source record could have changed between the two executions, exactly
as it already could for an `update` step's target.

### Command replay

A locally executed command produces **exactly one** sync-queue entry, whose
operation kind is `command`. Its per-step writes are still recorded in the
operation log and in audit, with the metadata above; they are simply not queued.

This is a contract about delivery, not about history. One entry per step is
precisely the shape that loses the transaction across the sync boundary: an
established context does not survive being split into separate intents, because
the caller is not a member of a context whose only membership record is the one
being refused, and a batch replayed as N intents can land partially. A conforming
runtime that queued a command's steps individually would have implemented a
different guarantee from the one the command declares locally.

The queued `command` operation carries:

- the command name and optional label;
- the **input** the command was executed with, because the authority re-executes
  the command rather than replaying its writes;
- the **record-id manifest**: the id the device minted for each record the
  command created, in planned order (see
  [command intents](#command-intents));
- every record the command wrote, so one verdict can be reported over all of
  them;
- a shared command transaction id linking the entry to the per-step operation-log
  entries it stands for.

A command's steps may name objects in different sync modes, but every step object
must agree on whether its writes reach the authority at all; the model rule is
`ADL_COMMAND_STEP_SYNC_MODE_MIXED` in
[resolved-model#commands](resolved-model.md). The single entry is filed under the
step object with the **most demanding** queueable mode — `onlineRequired` outranks
`localFirst` — so a command containing a write that may not wait for a later
connection is delivered immediately rather than held.

A command refused before it commits queues nothing, exactly as a refused
single-record write does. A command whose verdict is `rejected` or `conflict`
settles **as a unit**: the one entry carries the verdict, every operation-log
entry sharing its command transaction id takes the same status, and the local
records all of its steps wrote stay in place, exactly as a rejected create's
record does. There is no local rollback primitive; dismissing the change
(`keepServer`) remains the only resolution for a terminal verdict.

`command` is in the default operation-log operations because the operation log is
what feeds the sync queue. It is deliberately **not** an audit operation: audit
stays per record, so a command's effects are auditable as the creates and updates
they are, under the command metadata that names the business action.

## Staged Child Changes

A view's `editSections` describe how its CRUD form is composed; see
[resolved-model#view-presentation](resolved-model.md) for the resolved contract
and [language#edit-surfaces](language.md) for the source syntax. Evaluating an
edit surface resolves each section against the parent record: a `fields` section
reports the fields it groups, and a `childCollection` section reports the child
rows that already point at this parent, the operations the model permits, and the
picker if one is declared.

Evaluation is a read and enforces nothing new. Child rows are loaded through the
child object's ordinary policy-enforcing search and then filtered to the declared
parent field, and picker candidates come from the candidate object's `search` or
from `executeReadModel` before any picker-specific text matching, already-linked
exclusion or ordering is applied; see
[relationship pickers](#relationship-pickers) for which object that is. Action
visibility on a child row is shaped by
the child object's own policy and sync decisions, so a collection that lists an
operation the caller may not perform reports it as not enabled rather than
hiding the refusal until the write.

A staged `createChild` is completed before it is planned. The declared parent
field is set to the parent record, the child object's context-scope field is
seeded from the caller's currently selected context when the caller supplied no
value for it, and — in a collection with an `orderField` — the position is filled
in when the caller supplied none: the child is **appended**, taking one more than
the highest position among the parent's existing children. Several appends in one
batch count forward from that same starting point, in the order they were staged,
so they land after the existing children and after each other rather than all
claiming one slot. A caller-supplied position still wins, and is then subject to
the ordinary ordered-collection expansion below.

The other staged operations are planned from the child record they name, which
every one of them except `createChild` must supply; a staged operation carrying no
`childId` is refused with `ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED`, as is one
naming a section the view does not declare, one whose child object is not the
section's, and one whose operation the section does not list.

- `linkExisting` re-parents the named child, patching the declared parent field to
  this parent.
- `unlink` patches that same field to null. It is therefore declarable only where
  that field is optional; a section that lists it against a required parent field
  is refused at compile time with
  `ADL_VIEW_EDIT_SECTION_UNLINK_PARENT_FIELD_REQUIRED`, because the patch it plans
  would be rejected by the child object's own validation on every attempt.
- `remove` deletes the named child, and is subject to the child object's `delete`
  policy action. It is what a collection over a required parent field uses
  instead of `unlink`, and it is in the default operation set for that reason.
- `reorder` patches the section's `orderField` to the staged position, and is
  refused when the section declares no order field or the operation carries no
  position.
- `updateChild` **carries a patch**: the values it names are the fields it
  changes, and every other field of the child is left exactly as it was. A staged
  `updateChild` carrying no values is not an edit and is refused with
  `ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED` — the refusal is at the runtime,
  so a caller cannot spend a revision and a queue entry on a write that changes
  nothing. Being a staged operation, an accepted one is committed and queued
  inside the same batch as the section's other child changes rather than as a
  write of its own.

Applying a staged batch is a **single transaction**. Every staged operation is
planned first — running exactly the policy, validation, lifecycle, scope,
constraint and sync checks the direct write APIs run — and all of the planned
writes are then committed together. So:

- if any one staged change is refused, **none** of them is written and **none**
  of them is queued, including changes that would have succeeded on their own;
- the ordered-collection expansion applies to the batch as a whole, so a reorder
  and an insert commit one coherent set of positions rather than a sequence of
  intermediate ones;
- a successful batch produces **exactly one** sync-queue entry, whose operation
  kind is `batch`, covering every record the batch wrote. Its per-record writes
  are still recorded in the operation log and in audit; they are simply not
  queued.

The reasoning is the one [command replay](#command-replay) states. A transaction
replayed as independent per-record intents is not a transaction across the sync
boundary and can land partially at the authority however carefully it was
committed locally. What differs from a command is only the payload: a batch has
no model declaration to re-execute, so the queued entry carries the writes
themselves — a create carries the id the device minted, and an update or delete
carries the revision it was planned against.

At the authority a batch is applied as one transaction too. Each write goes
through the ordinary runtime create, update or delete path, so policy,
validation, lifecycle, scope and constraints all run server-side; a create's
supplied id is refused when taken; and an update or delete whose base revision
has moved on is a conflict. None of the writes lands unless all of them do. A
batch replayed with no writes is refused with `ADL_RUNTIME_BATCH_WRITES_MISSING`,
because a transaction that claims to have written nothing would record a durable
verdict about no records at all.

A batch's verdict settles **as a unit**, exactly as a command's does. The verdict
is recorded on every record the batch wrote — the entry's own `objectName` and
`recordId` name only a representative — so an accepted batch leaves all of them
`synced`, a conflicted batch leaves all of them `conflict`, and a refused batch
leaves all of them `rejected`. A record the batch _created_ additionally carries
the licence to be discarded locally, because a refused create is the only case in
which the authority holds no copy to contradict the removal. See
[record sync state](#record-sync-state) and [what a verdict covers](#what-a-verdict-covers).

`batch` is in the default operation-log operations for the reason `command` is:
the operation log is what feeds the sync queue, so a kind the model does not log
has no delivery path at all. Like `command`, it is deliberately not an audit
operation; audit stays per record.

## Relationship Pickers

A child collection may declare a `picker`, which is how a caller chooses what to
add to the collection. A picker has two modes, and the resolved declaration
decides which: a picker that names a `candidateField` **mints**, and one that does
not **links**.

- A **linking** picker offers the child records themselves. Choosing one stages
  `linkExisting`, which re-parents that child onto this parent, so the collection
  must support `linkExisting`.
- A **minting** picker offers records of the object its candidate field looks up.
  Choosing one stages a `createChild` whose values carry the chosen record's id in
  that field, so a new child is created naming it and the collection must support
  `createChild`. The requirement is
  `ADL_RELATIONSHIP_PICKER_CREATE_OPERATION_REQUIRED`; the linking one is
  `ADL_RELATIONSHIP_PICKER_LINK_OPERATION_REQUIRED`.

The **candidate object** — the object a picker's candidates are records of — is
therefore derived from the model rather than from the declared source: the child
object for a linking picker, the candidate field's lookup target for a minting
one. The declared source must agree. An object source must name the candidate
object and a read-model source must include it, and either failure is
`ADL_RELATIONSHIP_PICKER_SOURCE_UNKNOWN`. Because an omitted source resolves to
the child object, a minting picker whose candidate object is anything else has to
declare its source explicitly. A candidate field the child object does not carry
is `ADL_RELATIONSHIP_PICKER_CANDIDATE_FIELD_UNKNOWN`, and one that is not a lookup
field is `ADL_RELATIONSHIP_PICKER_CANDIDATE_FIELD_INVALID` — the picker writes a
chosen record's id into it, so there has to be a declared target for that id to
name.

Candidates are read first and filtered afterwards. An object source loads through
the candidate object's ordinary policy-enforcing search, and a read-model source
through read-model execution, before any picker search text, already-linked
exclusion, ordering or limit is applied — so read policy and context scoping are
never overridden by a picker's own narrowing. Each candidate reports the candidate
record's id, a label built from the picker's display fields joined with `" - "` —
or, when the picker declares none, from the candidate object's display field,
business key and first field — falling back to the record id when no display
value is present, the values it was read from, a source reference, and whether it
is already linked.
Object-backed candidates carry the candidate object's record id; read-model-backed
candidates carry the source reference for the candidate object in that row.
Ordering is deterministic: the picker's `sort`, then the label, then the record id.
When no candidate remains, evaluation reports a warning diagnostic
`ADL_RUNTIME_RELATIONSHIP_PICKER_EMPTY` carrying the picker's empty-state text.

`excludeAlreadyLinked`, which defaults to true, means a different thing in each
mode, because "already taken" is a different set:

- for a **linking** picker it is the ids of the children already pointing at this
  parent, plus the child ids that staged `linkExisting` operations in the same
  editing session already name;
- for a **minting** picker it is the **candidates** those children already name in
  the candidate field — a child's own id would not identify one — plus the
  candidates that staged `createChild` operations in the same session already
  name. So a candidate chosen twice before the parent is saved is offered once.

Evaluating a picker for a parent that does not exist yet excludes nothing from
storage; only the staged operations narrow it.

Applying staged links refuses two staged `linkExisting` operations naming the same
child in the same section (`ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE`), and
refuses a stale attempt to link a child that already points at this parent. That
check is about link operations only: what keeps a minting picker from creating the
same child twice is the exclusion above and the child object's own declared
constraints.

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

### Projected lookup display values

An output field that projects a `lookup` field carries that lookup, and a
conforming runtime resolves the target's display value onto the row so a surface
can show a name where the row holds an id.

- The resolved label travels **beside** the projected value, not instead of it.
  Filters, sort, expression fields and row actions still see the stored id (or,
  for a `targetField` lookup, the stored natural key); only what a person reads
  changes.
- Resolving a label is a **field** read on another object, and it is gated like
  one. Projection is policy-checked per *source* record, and a lookup target is
  not a source, so the runtime must clear the target object's scope and then the
  **display field's own** read decision before the value may be used. It must
  not require a whole-record read grant: a rule naming fields cannot match a
  whole-record request (see "Policy Decisions"), so an application that grants
  `read` on a display field and nothing else would otherwise have every label
  refused. An explicit row-level `deny`, `hidden` or `mask` rule carries no
  fields, so it matches the field request too and still suppresses the label; it
  is only the object's default deny that a field-scoped grant escapes. A
  `targetField` lookup matches by field value, which is a search however it is
  spelled, so it additionally requires the `search` action and the object-scope
  search check on the target object.
- Every refusal degrades to **no label**, never to an error and never to a value
  from elsewhere. A denied, deleted, out-of-scope or absent target leaves the
  surface rendering the stored value the caller already legitimately holds.

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
`ApplicationRuntime.applyStagedChildChanges`, which plans every staged operation
in the supplied order through the normal runtime create, update and delete
paths — so validation, policy, constraints, sync, audit and operation-log
behavior are all enforced exactly as they are for a direct write — and then
commits the whole set as one transaction. See
[staged child changes](#staged-child-changes) for what that guarantees.
Cancelling a create/edit container discards the caller-held staged operation
list.

Relationship picker candidates evaluate through
`ApplicationRuntime.evaluateRelationshipPicker`, whose semantics are stated in
[relationship pickers](#relationship-pickers): candidates load through
policy-enforcing object search or read-model execution first, and picker search,
already-linked exclusion and deterministic ordering apply only afterwards.

A picker's output is represented as explicit staged child operations, and which
operation depends on the picker's mode: a chosen candidate becomes a
`linkExisting` naming that child, or — for a picker that names a candidate field —
a `createChild` whose values carry the chosen record's id in that field. The
choices are staged in the picker's own deterministic candidate order.
Model-declared constraints are still enforced by the normal create/update
transaction path.

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

| Mode             | Local write                                   | Queued and delivered                                                                     | Authority accepts a replay    | Bootstrap returns it |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------- | -------------------- |
| `localFirst`     | allowed online and offline                    | yes — delivered on the next reconcile                                                    | yes                           | yes                  |
| `onlineRequired` | allowed only while `context.online !== false` | yes — delivery is attempted at once, and retried by every later reconcile until it lands | yes                           | yes                  |
| `cacheReadonly`  | refused on every channel                      | never: there is no accepted local write to queue                                         | no — `ADL_SYNC_POLICY_DENIED` | yes                  |
| `localPrivate`   | allowed, except on the `sync` channel         | never                                                                                    | no — `ADL_SYNC_POLICY_DENIED` | no                   |

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

### The context an operation replays against

A queued operation records the business contexts that were selected **when it
executed**, and is replayed against that selection rather than against whatever is
selected when the queue drains. A queue drained after the user switched contexts,
or after a reload, would otherwise replay writes under a selection that was never
in force for them. This applies to every operation kind, not only to `command`.

The recorded selection is written unconditionally, and its three states are
distinct:

| Recorded value  | Meaning                         | Replayed as                          |
| --------------- | ------------------------------- | ------------------------------------ |
| a non-empty map | those contexts were selected    | those contexts                       |
| an empty map    | nothing was selected            | nothing selected                     |
| absent          | the entry predates this capture | the selection in force at drain time |

The empty map is load-bearing. Collapsing it into "absent" makes "nothing was in
force" indistinguishable from "this entry is older than the capture", and the
fallback then attaches an unrelated context to an operation that was deliberately
made outside one.

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

## Record Sync State

Every stored record carries a sync state, exposed to models as the platform
metadata field `_syncStatus`. It has exactly five values, and every one of them
has a producer — a state nothing writes is a state no model can rely on:

| State      | Written when                                                                                                 | Cleared by                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `pending`  | a device write on a queueable object commits, because the same commit queued it                              | the authority answering the queued operation                       |
| `local`    | a device write on an object with no delivery path commits (`localPrivate`, and any other non-queueable mode) | nothing: the record is not waiting, and is not late                |
| `synced`   | a record is reconciled from the authority, **or** a write commits on the `sync` channel                      | the next device write, which makes the record `pending` or `local` |
| `rejected` | the authority refuses the operation that wrote the record                                                    | resubmitting the operation, or any later write to the record       |
| `conflict` | the authority answers the operation that wrote the record with a conflict or a manual resolution             | resubmitting the operation, or any later write to the record       |

A write on the `sync` channel is the authority writing its own state: it is
accepted state by definition and is waiting for nobody, which is why it is
`synced` rather than `pending`. A device write is `pending` whether or not an
authority is reachable, or configured at all — the write is queued and
unanswered either way, and reporting it as settled would misdescribe work the
device is still holding.

Recording a verdict against a record is **reporting, not resolving**. No value
changes, no revision is minted, nothing is audited and nothing is queued. It is
written on the record rather than derived from the queue entry because the entry
is discarded the moment the user dismisses the verdict, and a refused write whose
only trace was that entry is indistinguishable from a write nobody has sent yet.
For the same reason the state lives in storage and survives a reload.

The state is **device-local and crosses the wire in neither direction**. No
intent carries it, no client may assert it, and a record arriving from the
authority is `synced` on the receiving device whatever the authority's own copy
of the field said. It describes one device's relationship to the authority, so a
value from anywhere else would be a claim about a device that did not make it.

### What a verdict covers

A verdict is recorded against **every record the operation wrote**, not only the
one its queue entry names. For an ordinary create, update, delete or transition
that is the same record. For a command it is every record all of its steps wrote:
the authority answered the command as one transaction, so its answer is equally
true of every row that transaction produced, and a command's queue entry names a
representative record rather than the subject of the change. For a
[batch](#staged-child-changes) it is every record the transaction wrote, derived
writes included — a sibling an ordered-collection shift moved is covered by the
same verdict, and reading coverage from the wire payload alone would leave it
waiting for an answer nothing could give.

An accepted operation leaves every record it covered `synced`, including records
the outcome did not return — an accepted delete returns a tombstone the caller
may not read back, and leaving such a record `pending` would show settled work as
still in flight.

`resubmitMine` returns every record the operation covered to `pending` before
resending it: the verdict is spent, the operation is queued and unanswered again,
and the records must say so. An accepted resubmission therefore leaves them
`synced` with no residue of the earlier verdict.

### Discarding a refused record

A refused write leaves its local records in place. Neither recovery primitive
removes them: `keepServer` abandons the operation and `resubmitMine` sends it
again, and a compensating local rollback would be a third primitive that invents
a winner.

A record may be discarded locally only when the refused write was **the record's
own create**. That is the single case in which the refusal proves the authority
has no copy, so removing the row loses nothing: a record whose _update_ was
refused still exists on the authority, and deleting it locally would destroy a
row the next bootstrap would restore anyway. The runtime therefore records, per
record, whether the refused write created it, and refuses to discard any other
refused record.

That record is a claim about the authority — that it holds no copy — so only the
authority can settle it. It survives later local writes to the row: editing a
refused create does not give the authority a copy, and the edit is refused in its
turn as an update to a record the authority does not have. It is spent when the
authority produces a copy under that id: an accepted operation, or a
reconciliation, including the collision case where the create was refused
_because_ the id already named a record the authority holds. A runtime that
cleared it on any local write strands the record one edit after the refusal, with
nothing left saying it can be thrown away.

A discard is a local delete the user asks for. It is not a recovery primitive, it
settles nothing with the authority, and it is not queued — the authority never
had the record, so asking it to delete one would be a request about a row that
does not exist there. It writes a tombstone rather than erasing the row, so a
later create cannot silently reuse the id.

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

### What each sync scope selects

An object's declared sync scope decides **which context** its records are kept
for. A declared window and a declared predicate decide **how much** of them a
device keeps. The two are independent: either bound may accompany any scope, both
may accompany the same one, and when both are declared a record must satisfy
both. The scopes are exhaustive: every one of them selects by a rule the runtime
evaluates, and none of them is accepted in a form the runtime cannot honour.

| Scope | Selects |
| --- | --- |
| `all` | every record in a business context available to the device |
| `currentUser`, `assignedToUser`, `ownedByUser` | records whose lookup to the user object holds the signed-in user, within an available context |
| `currentContext` | records in the selected business context only |
| `allAvailableContexts` | records in every business context available to the device |
| `recent` | records in an available context, with a window defaulted to 30 days over `_updatedAt` |
| `custom` | records in an available context, with a predicate that is required rather than optional |

`recent` and `custom` are the two scopes that imply a bound. `recent` is a
spelling for available contexts plus a window the runtime derives when the model
declares none, so a bare `SCOPE recent` still selects a bounded set. `custom` is
a spelling for available contexts plus a predicate that may not be omitted; that
is a validation refusal, not a runtime one. Neither is a different kind of scope
from the others, and neither is required in order to declare a bound.

`ResolvedSyncWindow.windowSource` (Phase 72) is `"authored"` when the model
wrote a `WINDOW` clause and `"impliedByScope"` when a bare `SCOPE recent`
derived one. Two resolved models built from `SCOPE recent WHERE ...` and from
`SCOPE currentContext WINDOW ... 30 DAYS` used to look identical downstream;
`windowSource` makes the origin inspectable without already knowing `recent`'s
special case.

A window names a date or datetime field, an optional day span measured back from
the runtime context's current moment, and an optional limit that keeps only that
many records, newest first. A record whose window field is absent or is not a
readable date falls outside the window.

A limit ranks an object's *own* selection. A record another route holds — a read
model sourcing the object across contexts — is not ranked against that selection
and is not evicted by it, because a bound may narrow how much of an object a
device keeps and may never narrow which contexts it is kept for. The day span and
the predicate are decided one record at a time and do gate every route.

A predicate is an ordinary expression evaluated against the record's own field
values and the runtime context, so the same records and the same model produce
different datasets for different signed-in users. A predicate that does not
evaluate against a given record — a type mismatch, say — excludes that record
rather than failing the whole dataset, the same way an unreadable window date
does.

### What a read-model source may widen

A record reaches a device by one of two routes: its object's own sync scope, or a
read model that declares it as a source. The two routes are not equal, and the
difference is between saying *which context* an object is held for and saying
*how much* of it a device keeps.

- A read-model source scope **may widen the context**. A dashboard declaring a
  cross-context input is asking for exactly that, and a source with scope `all`
  admits a record whose object is scoped to a single context. This is deliberate:
  narrowing it would make a declared cross-context dashboard silently empty
  offline.
- A read-model source **never widens a declared bound**. A declared window and a
  declared predicate say how much of an object a device keeps at all, and no
  source can say otherwise, because a source has no way to declare a bound of its
  own. A record outside its object's window, or failing its object's predicate, is
  not in the offline dataset by any route, however many read models source it.
  A `LIMIT` is the one part of a bound a source is not measured against, for the
  reason given above: ranking a sourced record against the object's own selection
  would make a bound narrow a context, which nothing may do.

The bound is therefore evaluated once per record and gates every reason, rather
than being one disjunct among them. A record excluded by the bound reports no
reasons at all, including no read-model source reason.

When a record is held and its object declares a bound, every read-model source
reason for it carries `boundedBy`, naming `window`, `predicate`, or
`windowAndPredicate` when the object declares both. That is what distinguishes a
dashboard that is deliberately short offline from one that is wrong.

Dataset membership remains separate from authorization throughout. Widening or
bounding what a device holds never widens or narrows what its user may read.

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

| Persisted state                              | Outcome                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Same version, same fingerprint               | Proceeds.                                                                           |
| Same version, no fingerprint recorded        | Proceeds with `ADL_PERSISTED_MODEL_FINGERPRINT_MISSING` (warning) and backfills it. |
| Same version, different fingerprint          | Refuses with `ADL_PERSISTED_MODEL_FINGERPRINT_STALE`.                               |
| Earlier version, a declared chain reaches it | Migrates, then proceeds, reporting `ADL_MODEL_MIGRATION_APPLIED` (info).            |
| Earlier version, no chain reaches it         | Refuses with `ADL_PERSISTED_MODEL_VERSION_MISMATCH`.                                |
| Later version than the model's               | Refuses with `ADL_MIGRATION_PERSISTED_VERSION_AHEAD`.                               |

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

| Code                                           | Raised when                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `ADL_EXPRESSION_FIELD_UNSUPPORTED_VALUE`       | A field reference resolves to a value that is not a supported expression value. |
| `ADL_EXPRESSION_RUNTIME_REFERENCE_MISSING`     | A runtime property is referenced but absent from the runtime context.           |
| `ADL_EXPRESSION_RUNTIME_REFERENCE_UNSUPPORTED` | A runtime property is referenced that this contract does not define.            |
| `ADL_EXPRESSION_OPERATOR_UNSUPPORTED`          | An operator is reserved and not yet supported (`in`).                           |
| `ADL_EXPRESSION_TYPE_MISMATCH`                 | Operand kinds cannot be combined or compared.                                   |
| `ADL_EXPRESSION_DIVIDE_BY_ZERO`                | Division or modulo by zero.                                                     |
| `ADL_EXPRESSION_DECIMAL_OVERFLOW`              | A value or result exceeds the supported decimal magnitude.                      |
| `ADL_EXPRESSION_INVALID_TEMPORAL_VALUE`        | A `date`, `datetime` or `time` value is not well formed.                        |

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

## Record Revisions

Every stored record carries a `revision`, and it names **one version of one
record**: the values, state and metadata that record held at one point in its
history. Every write to a record mints a new one — create, update, transition and
delete alike — and the runtime performing the write is the one that mints it.

Three things a runtime, a client and a conformance case may assume:

- a revision identifies one version of **one** record, so two records' revisions
  say nothing about each other and are never compared;
- an accepted write **advances** the record's revision, so the revision an
  accepted outcome returns is the one the next intent must carry; and
- a revision is **never reissued** for that record — not after a process restart,
  not across two runtimes writing to the same persisted state, and not between a
  device minting offline and the authority it eventually reaches.

The scope of that last guarantee is the point of stating it. It is about the life
of the **persisted state**, not the life of the process that minted the value. A
runtime numbering revisions from a counter it starts at 1 in its constructor
satisfies it right up until it is restarted; after that a record standing at its
fourth revision is handed its first again, and it wears a name a _different_
version of itself already wore.

That is a silent lost update rather than a cosmetic problem, because the
optimistic-concurrency check the whole sync loop rests on is an **equality
comparison and nothing else**. A client holding the earlier version submits that
revision as its `baseRevision`; the check compares it with the record's current
revision, finds them equal, and applies the write over edits the client never
saw. There is no conflict, no `manualResolution`, and no audit of anything
unusual — and afterwards nothing can detect what happened, because the two
versions are indistinguishable by the only value that distinguishes versions.
Uniqueness for the life of the state is therefore a correctness requirement of
the conflict check, not a property of one convenient minting scheme.

Everything else about a revision is unspecified, because a revision is
**opaque**:

- **No format.** None is defined and none may be assumed. A conforming runtime
  may mint a UUID, a ULID, a counted token or anything else that satisfies the
  guarantees above. A conformance case names a revision by the outcome that
  produced it — `{"$ref": "<alias>.records.0.meta.revision"}` — rather than
  spelling one out, because a spelled-out revision pins one implementation's
  convention as the contract.
- **No order.** Two revisions of the same record cannot be ranked. Nothing in
  this specification says a later revision sorts after an earlier one, and no
  client, report or case may depend on it. The runtime that mints a record's next
  revision is the only thing entitled to read the previous one.
- **No arithmetic and no derivation.** A caller never constructs, parses or
  increments a revision; it round-trips the value it was handed. Deriving the
  next revision from the last would be depending on a guarantee only one
  implementation makes.
- **No comparison other than equality.** Equality against the revision the client
  last saw is the only defined operation on the value.

A revision is never supplied by a caller. It is derived by the writing runtime in
the same sense as actor, timestamps, accepted state and scope, and a create
intent naming its own record asserts nothing about the revision that record will
receive. The `baseRevision` an `update`, `delete` or `transition` intent carries
is a claim about the version the client last read, never an instruction about the
version the write will produce.

A migration is the one operation that rewrites a record without advancing its
revision, and deliberately so — a schema change is not an edit by anyone. See
[model migration](#model-migration) for why, and for what that preserves.

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

Equality is the whole of that test. [Record revisions](#record-revisions) states
the contract this rests on — a revision is opaque, is compared only for equality,
and is never reissued for the life of the persisted state rather than the life of
the process that minted it — and states why an authority that broke it would
accept a stale write in silence rather than raise the conflict this section
describes.

An outcome is one of four:

| Status             | Meaning                                                  |
| ------------------ | -------------------------------------------------------- |
| `accepted`         | Applied; the accepted records are returned.              |
| `rejected`         | Refused with a code.                                     |
| `conflict`         | The record moved; `recovery` names the resolution.       |
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

### Command intents

A model-declared command replays as a single intent of kind `command`, carrying
the command name, the input it was executed with, and a **record-id manifest**.
One command is one `operationId`.

The authority **re-executes** the command rather than applying its recorded
writes. Every enforcement layer therefore runs server-side exactly as it ran on
the device: input validation and defaults, command preconditions, step
preconditions, object scope, policy and field policy, lifecycle, constraints and
sync-mode write checks — and the steps stay inside one transaction, which is the
whole point. Nothing about a command intent is trusted because it already
succeeded locally.

The manifest names the records the re-execution will create:

- **Creates only.** An update step names an existing record through its own `ID`
  expression, and an expression reaching for a created record's id resolves to
  the adopted id.
- **Planned order**, including one entry per item of an iterating step. An entry
  carries the step name, the item index for an iterating step (absent otherwise),
  the object name and the record id.
- **Positional and named.** The entry at position N must have the same step name,
  object name and item index as the Nth planned create. Position alone would let
  a manifest built for a different execution be adopted silently.

Each supplied id is subject to the same contract as a create intent's `recordId`:
untrusted input, shape-checked before any work, refused when already taken, and
never an assertion about revision, actor, timestamps, accepted state or scope. It
follows the same ordering — shape, then scope, then policy, then field policy,
then sync mode, then collision — so a command can never be used to claim an id
that a direct create by the same caller would be refused, and never becomes an
existence oracle. **A supplied id is a name, never an authorisation.**

Two refusals are specific to the manifest, and both are ordinary durable
rejections rather than transport faults:

| Code                                      | Raised when                                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH` | the manifest is absent, is not a list, describes more or fewer creates than the command plans, or names a step, object or item index that does not match the planned create at that position |
| `ADL_RUNTIME_RECORD_ID_TAKEN`             | a supplied id already names a record, including a deleted one                                                                                                                                |

A refused command leaves **nothing** behind: no step of it is applied, so a
partially adopted manifest is not a reachable state.

Idempotency covers the whole command. Replaying the same `operationId` from the
same actor returns the stored outcome and writes nothing a second time, including
every item of an iterating step — which is also why a retry that has already been
settled must carry a new operation id rather than the one the authority answered.

A command intent is the only way some work can reach the authority at all. A
command that founds a business context and its first membership record is
accepted as one intent; the identical membership write submitted as a per-record
create intent is refused with `ADL_RUNTIME_CONTEXT_ERROR`, because the caller may
not select a context they are not yet a member of, and the record that would make
them one is the record being refused. Established-context reach is transaction-
local (see [resolved-model#established-contexts](resolved-model.md)), so the
transaction is the mechanism, and preserving it across the sync boundary is what
the `command` intent exists for.
