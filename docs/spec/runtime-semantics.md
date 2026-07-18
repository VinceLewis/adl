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
view data: sections, controls, lists, rows, text/icon fragments, empty states,
local state values, and structured diagnostics.

Evaluation order is deterministic:

1. Initialize local view state from resolved state defaults.
2. Apply caller-provided local state and state updates with type checks.
3. Bind each list through policy-enforcing runtime APIs: object lists use
   `search`, and read-model lists use `executeReadModel`.
4. Apply presentation `WHERE` filters to already-shaped row values plus local
   state.
5. Apply presentation list ordering.
6. Evaluate row templates, icon maps, display formats, conditional fragments,
   and empty states.

Presentation filters are display filters only. They run after runtime read
authorization, context scoping, offline dataset constraints, and read-model
projection. They do not grant access to rows or fields and do not replace
policy enforcement on writes, commands, sync replay, imports, or APIs.

Row-template evaluation is read-only. It does not mutate stored records or local
view state.

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
persistence, icon-map fields, control state/command/view/context references,
list source and source kind, render style, density, empty-state text, row layout
and density, row field references, icon-map references, and fragment style
defaults. Invalid presentation references remain validation diagnostics with
`ADL_PRESENTATION_*` codes rather than parser-AST explanations.

## Schema-Version Compatibility

Runtime startup checks persisted application model metadata and stored record
schema versions. Mismatches produce structured startup diagnostics and block
runtime use when severity is error.
