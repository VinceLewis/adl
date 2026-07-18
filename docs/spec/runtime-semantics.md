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
search paths.

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

## Read Models

Read models execute through `ApplicationRuntime.executeReadModel`. The first
source is the primary source. Additional sources are resolved through lookup
relationships from already-loaded sources. Source records must pass object
scope, search/read policy, and source scope checks before projection.

Expression fields evaluate in declaration order over already-projected row
values, after source read policy shaping.

## Presentation Evaluation

Composed views evaluate through `ApplicationRuntime.evaluatePresentationView`.
The runtime consumes `ResolvedView.presentation` and returns renderer-neutral
view data: sections, controls, command/navigation actions, lists, rows, row
actions, text/icon fragments, semantic row statuses, view legends, empty
states, local state values, and structured diagnostics.

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
8. Evaluate legends from declared status order. Legends default to statuses
   present in evaluated rows; `include: all` includes all declared legend
   statuses.

Presentation filters are display filters only. They run after runtime read
authorization, context scoping, offline dataset constraints, and read-model
projection. They do not grant access to rows or fields and do not replace
policy enforcement on writes, commands, sync replay, imports, or APIs.

Row-template evaluation is read-only. It does not mutate stored records or local
view state.

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

## Sync Modes

`localFirst` allows local writes and queues syncable operations.
`cacheReadonly` allows local reads of cached records but rejects local writes.
`onlineRequired` rejects writes only when `context.online === false`.
`localPrivate` allows local writes but excludes them from the sync queue.

Policy checks run before sync-mode write checks.

## Offline Datasets

Offline dataset membership is separate from authorization. Dataset evaluation
returns record references and reasons. User-facing local reads still route
through policy-enforcing runtime search/read paths.

`onlineRequired` records are excluded from offline datasets.
`cacheReadonly` records can be included for reads. `localPrivate` records can be
included locally but are not queued for sync.

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
