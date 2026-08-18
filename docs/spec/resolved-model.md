# ADL Resolved Model Specification

The resolved model is the stable ADL intermediate representation and runtime
contract. Runtime services consume `ResolvedApplicationModel`, not parser AST
nodes or ADL source text.

## Contract

`ResolvedApplicationModel` is deterministic and JSON-compatible. It contains:

- `modelVersion`, `app`, `shell`, `roles`, `objects`, `policies`, `themes`,
  `sync`, `audit`, `operationLog`, and `defaults`.
- Optional `contexts`, `readModels`, `decisionTables`, and `commands` when the
  source model declares those features.
- Optional `presentation` declarations on resolved views when the source model
  declares composed UI structure.
- An `editContainer` hint on resolved views for generic CRUD create/edit
  surfaces.
- No wall-clock `generatedAt` value by default.

All defaults must be visible in the resolved model and explainable by inspection
tooling.

## Defaults

Resolution applies platform defaults consistently:

- Application theme defaults to `CorporateLight`.
- Start view defaults to the first resolved object view.
- `app.offlineGraceDays` defaults to `30`.
- Object schema version defaults to `1`.
- Object table names and field storage names use deterministic snake-case
  normalization.
- Objects receive platform metadata fields outside normal business fields.
- Object sync defaults to `localFirst`, `all`, and `manual`.
- Every object has a default-deny policy with `defaultEffect: "deny"` and no
  deny-all rule.
- Objects without explicit views receive list and form views over business and
  computed fields.
- Shell navigation defaults to one item per resolved view, with derived labels,
  object-name groups, declaration-order sorting, active state on the target
  view, and `always` visibility.
- Shell top-bar controls default to business context selectors and sync status.
  Mobile business-context selectors default to sheet behavior.
- Shell top-bar and navigation-drawer control lists each default to the declared
  controls whose placement names that region, so a declared placement is
  meaningful without a second declaration repeating it. An undeclared drawer
  title stays **absent** in the resolved model rather than being defaulted to the
  application name; the renderer falls back. Resolution does not invent a value
  that would then be indistinguishable from an author declaring the same string.
- Ordered constraints default to `strict` reordering and `none` compaction.
- Command inputs default to non-repeated; read-model source joins default to
  `one` cardinality. Both defaults leave existing behaviour unchanged.
- Audit operations default to `create`, `update`, `delete` and `transition`.
  Operation-log operations default to those four **and `command`**. The two lists
  differ deliberately: audit is per record, while the operation log is what feeds
  the sync queue, and a command is queued as one operation covering the whole
  transaction. `command` is therefore a local operation kind and not an audit
  operation.
- View edit containers default to `modal`; `splitPane` is available only when
  explicitly selected.
- View presentation defaults, when a view declares presentation, are `stack`
  layout, `comfortable` density, `table` list rendering, `inline` row layout,
  `plain` text fragments, memory-backed local state, and empty list text.
- Recent sync scopes default to a 30-day `_updatedAt` window.

## Objects

An object has business fields, computed fields, metadata fields, optional
scope, constraints, validations, optional lifecycle, policies, views, sync, and
audit policy.

Business fields are author-defined. Metadata fields are platform-managed and
include `_guid`, `_object`, `_schemaVersion`, `_revision`, `_state`,
creation/update/delete metadata, and `_syncStatus`.

`_revision` is a non-empty string naming one version of one record. Every write
to the record replaces it with a value that record has never carried before, for
the life of the persisted state rather than the life of the process that minted
it. It is opaque: no format is defined, it is never ordered, parsed or derived
from, and equality against the revision a caller last read is the only defined
operation on it. See
[runtime-semantics#record-revisions](runtime-semantics.md) for what that
guarantees, why the scope of the uniqueness matters, and what a runtime may not
assume.

`_syncStatus` holds the record's device-local synchronisation state, one of
`local`, `pending`, `synced`, `conflict` and `rejected`. Every value has a
producer; see
[runtime-semantics#record-sync-state](runtime-semantics.md) for what produces
and clears each one. The state is device-local in both directions: a client
never asserts it to the authority and never adopts one the authority sent.

Computed fields are separate from stored fields. They include a structured
expression, dependencies, read-time strategy, deterministic evaluation order,
and system-managed readonly flags.

## Expressions

`ResolvedExpression` is the expression contract. Implemented expression nodes
are literal, field, runtime, unary, and binary expressions. Runtime services use
these trees directly for validation, policy conditions, guards, decision tables,
commands, computed fields, and read-model expression fields.

## Contexts

Business contexts name a context object, an optional membership declaration, and
zero or more grants. Object scopes link objects to a context through a field.
View and read-model contexts declare whether a context is none, required,
optional, or all.

Context roles are not global roles. Runtime context roles must carry context
name, context instance id, and role.

### Grants

A grant names an object whose records associate a user with a context instance,
the fields carrying each, and an optional condition on the record. It is a route
into a context that is not membership.

A grant and a membership are not interchangeable, and a conforming runtime must
not conflate them:

- **A grant confers no roles.** Context roles are derived from membership alone.
  A caller reachable only through a grant holds an empty role set for that
  context, so every role-gated rule denies them.
- **A grant widens the object-scope gate and nothing else.** It makes a record of
  that context instance eligible for a policy decision; the object's own policy
  still decides. Without this distinction a pending invitation could not be read
  by its own invitee, because the invitation is scoped to the very context the
  invitation exists to get them into, and the refusal happens upstream of policy.
- **A grant-holder is not a co-member.** They do not appear in, and are not
  admitted by, the `contextMember` principal below.

A runtime carries grants separately from roles on its runtime context, and the
available-context listing reports them separately, so "invited" and "joined" stay
distinguishable to a caller and a renderer.

## Policies

Policies are object-scoped and deny by default. A rule has effect, principal,
action, optional states, optional fields, optional lifecycle action, optional
condition, and channels. Conditions are resolved expressions.

`channels` restricts a rule to the `RuntimeChannel`s it applies to: `ui`,
`api`, `sync`, `import`, and `test`, matching the channel every
`RuntimeContext` carries. It defaults to all five when the source declares no
channel restriction, so a model that never restricts a rule's channel behaves
exactly as it did before channels existed as a concept. Rule matching checks
the request's channel against this list immediately after the action match and
before principal, state, field, or condition matching — a rule whose channel
does not match the request is skipped entirely, as if it were not declared,
rather than evaluated and simply not applied.

Principals match everyone, authenticated users, anonymous users, owners, specific
users/roles/group-roles, or **context members**.

A `contextMember` principal names a business context and a field on the target
record. It matches when that field holds a user the caller shares an instance of
that context with, by membership. It answers a question neither `owner` nor a
role can: `owner` covers a caller's own records, and a role covers everything of
an object inside a context, but a shared roster needs "this record belongs to
somebody I am in a context with" — expressing that as a role would grant it over
every record of the object, including those of people the caller shares nothing
with.

Membership resolution is asynchronous and policy evaluation is not, so the
membership set is resolved onto the runtime context before evaluation. A missing
set never matches: the principal fails closed rather than treating "not resolved"
as "not restricted".

## Lifecycles

A lifecycle names its state field, initial state, states, and actions. Actions
declare source states, target state, guards, policy references, and hook
references. Metadata-backed `_state` is valid when no author state field is
declared.

## Read Models

Read models contain named sources, output fields, and sort order. Source scopes
are backend-neutral: `all`, `currentContext`, `allAvailableContexts`, and
`currentUser`. Expression fields evaluate over already-projected row values.

A source after the first may declare a **join** naming an earlier source, a field
on each side, and a cardinality. The field name `id` on either side means the
record's own id rather than a declared field.

- `one` contributes at most one matching record and leaves the row count
  unchanged. No match drops the row.
- `many` **fans out**: an upstream row with N matches becomes N rows, and no
  match drops the row.

Without a declared join a source is resolved the original way — follow whatever
lookup field an already-loaded record declares toward this source's object, and
read one record by id. That only walks a foreign key forwards and cannot fan out,
so a projection through a junction object — two objects that share a third
object's id rather than referencing each other — is inexpressible without an
explicit join.

A declared join matches records by field value rather than reading one by a known
id, so it is a search in everything but name and a conforming runtime must
require the `search` action on the joined object — for **both** cardinalities,
not only `many`. The predicate enumerates the joined object either way. An
undeclared lookup source still requires only `read`, because it reads a single
record whose id an already-loaded record handed it.

Per-record read policy, object scope and per-object field shaping still apply to
every source of every produced row. A record the caller may not read must be
indistinguishable from no match: a `one` join drops the row, a `many` join drops
that branch, and neither may reveal that something was withheld.

A join may not appear on the primary source, may not name a later source, and may
not appear in a `union` read model, which interleaves independent feeds and has
no row to join onto.

## Ordered Collections

An `ordered` object constraint declares a parent field, a position field, scope
fields, a minimum position, a reorder mode and a compaction mode.

- `reorder: "strict"` refuses a write onto a position a sibling holds.
- `reorder: "shift"` accepts it and moves the intervening siblings, in the same
  transaction, so the collection stays contiguous and unique and the record lands
  where the author asked.
- `compaction: "none"` leaves the gap a removal creates.
- `compaction: "onDelete"` renumbers later siblings down, in the same transaction
  as the delete.

Both default to the stricter, non-moving behaviour. Neither introduces a new
operation kind: a reorder is ordinary `update` intents and a compacting delete is
a `delete` intent plus `update` intents, so both replay through authority intent
replay unchanged. Every generated sibling write passes the same policy,
validation, scope and sync checks as an authored one — a sibling the caller may
not write fails the whole transaction rather than moving silently.

## Protected Roles

A `protectedRole` object constraint declares scope fields, a role field, one or
more guarded role values, and a minimum count — the "last admin standing"
guard. It refuses a delete or an update that would leave fewer than the
declared minimum active records whose role field holds one of the guarded
values within the same scope key.

The guard fires only on the write that would cause the loss: a delete of a
guarded-role holder, or an update that changes its role field away from every
guarded value (including out of scope entirely, if the scope fields
themselves change). A create can only add a record, never remove one, so it is
never checked. An update that keeps the record within the guarded set —
including a change between two different guarded values, such as `Admin` to
`Owner` when both are declared — leaves the scope's guarded count unchanged and
is not checked either. A scope that already holds fewer than the declared
minimum before this transaction — data older than the constraint's own
declaration, say — is not retroactively repaired or blocked from unrelated
writes; the guard only refuses the write that would make an already-satisfied
scope fall short.

Empty scope fields guard the whole object as one scope rather than a
partitioned one. This is declared once, on the object itself, and is enforced
by every write path that reaches `ResolvedObject.constraints` — direct CRUD and
command steps alike — never only by client-side UI affordance.

## Commands

Commands contain typed inputs, resolved-expression preconditions, and ordered
create/update steps. A step names its target object, authority mode, value or
patch expressions, and optional step preconditions. Step value expressions can
reference command input, runtime values, earlier step fields, or earlier step
metadata such as generated record ids.

Command declarations are backend-neutral runtime semantics. They do not encode
SQL, browser callbacks, or generated application code. Runtime side effects keep
normal row-level audit and operation-log entries, with optional command name,
label, step, and command transaction id metadata to preserve the business
command intent.

### Repeated inputs and iterating steps

An input may be **repeated**, carrying a list of scalars or of records whose
fields the input declares. A step may declare `forEach` naming a repeated input;
it then plans one write per item into the same transaction, and its value
expressions may additionally reference the current item, a named field of it, or
its zero-based index.

This exists because a command's steps are otherwise fixed at authoring time, so
the number of records a command can write is fixed too — and importing fifty
songs as fifty independent transactions has no shared success or failure.

An iterating step produces many records, so no step may reference one by step
field or step metadata: there would be no single answer. A conforming runtime
must refuse such a reference at validation and must not bind an iterating step's
name to any one of its records at execution.

### Established contexts

A create step may declare that its new record **establishes** a business context,
naming the context whose object it creates. For the remainder of that transaction
the new instance is in reach of the object-scope gate, so a later step may write
a record scoped to it — which is what creating a context and its first membership
atomically requires, and what the gate otherwise refuses because the instance did
not exist when the transaction opened.

It reaches only the instance the step just created and does not survive the
transaction, so it cannot hand a caller access to a context that already existed.
It confers no roles; the membership record a later step creates is what confers
real access afterwards.

### Reading an existing record

A step's `action` may be `"read"` instead of `"create"`/`"update"`. A read step
names a target object and a `recordId` expression, and binds the record it
reads under the step's own name — the identical binding a `create`/`update`
step's own written record already gets, so a later step reads it with the same
`{ kind: "stepField" }` / `{ kind: "stepMeta" }` expressions, with no additional
expression kind. A read step has no `authority`, `values`/`patch`, or `forEach`:
it writes nothing, so there is nothing to authorize or iterate.

A read step's `recordId` is validated as any other command value expression is,
and is subject to the same forward-reference rule every step reference is: a
value expression may reference a step (of any action) only if that step
executes earlier in the command's declared step order. Referencing a step that
has not yet run, or does not exist, is `ADL_COMMAND_STEP_REFERENCE_UNKNOWN`.

At runtime a read step is executed through the identical policy-gated path a
direct API/UI read of the same record takes: object scope, row policy, and
field-level read shaping (mask/hidden) all apply. This is a deliberate
constraint, not an implementation detail a conforming runtime is free to
relax — a command must not be able to see more of an existing record than the
caller invoking it could see by reading it directly, and `authority: "command"`
(which lets a *write* step bypass the caller's own write policy) has no
equivalent for a read step. A denied read, or a read of a record that does not
exist, fails the whole command before any write is planned or committed —
consistent with how any other step failure already aborts a command.

A read step contributes no write and so does not appear in a command's written
records, its operation-log entry, or its record-id manifest for authority
replay: the manifest names only the records a command **creates**, and a read
step creates nothing.

### Step sync modes

A command's steps may write objects in different sync modes, but every step
object must agree on whether its writes reach the authority at all. Queueable
modes are `localFirst` and `onlineRequired`; non-queueable modes are
`localPrivate` and `cacheReadonly`. Mixing the two groups within one command is a
validation error, `ADL_COMMAND_STEP_SYNC_MODE_MIXED`, reported once per command
at `commands[<i>].steps`.

Mixing modes _within_ the queueable group is legal, and so is a command whose
steps are all non-queueable. The rule exists because a command replays as a
single intent: a command that mixed the groups has no coherent delivery
behaviour. Queue it and the authority refuses the `localPrivate` step on every
reconnect; do not queue it and the steps that should have synced never do.

The check is skipped when a step's object does not resolve or its declared mode
is not a valid one, so it never stacks a second diagnostic on top of an existing
error.

A read step writes nothing and so has no write-delivery mode to disagree with
the command's other steps about; it is excluded from this check entirely,
whatever sync mode its own target object declares.

### Local operation kinds

Local operations are `create`, `update`, `delete`, `transition`, `command` and
`batch`. The first four describe one record each. `command` describes a whole
model-declared command: it carries the command name and optional label, the input
the command ran on, the record-id manifest for every record the command created
(step name, item index for an iterating step, object name, record id — in planned
order), and the full list of records the command wrote.

`batch` describes an ad-hoc multi-record transaction that no command declares —
the staged child changes of an edit surface are the implemented producer. Having
no declaration to re-execute, it carries the **writes** instead of an input: each
names an operation (`create`, `update` or `delete`), an object and a record id,
plus the values a create was made with, the patch an update asked for, and the
revision an update or delete was planned against — carried verbatim as the opaque
value it is ([runtime-semantics#record-revisions](runtime-semantics.md)). Only the
writes the caller
_requested_ are carried, because the authority re-derives a platform-derived
write — an ordered-collection shift — from the same constraint, and being told
about it twice would apply it twice.

`batch` additionally carries the full list of records the transaction wrote,
derived writes included, so one verdict can be reported over all of them. It is
separate from the writes for the reason a command's record list is separate from
its manifest: the wire payload and the record-coverage list answer different
questions. The batch needs no separate created-record manifest, because only a
requested write is ever a create.

A `command` or `batch` operation is filed under a representative write's object,
so that a queue entry still carries exactly one object's sync declaration; the
object with the most demanding queueable mode is chosen. Neither is an audit
operation. See [runtime-semantics#command-replay](runtime-semantics.md) and
[runtime-semantics#staged-child-changes](runtime-semantics.md) for what a runtime
must do with them.

## View Presentation

Resolved views include `editContainer`, a renderer-neutral CRUD presentation
hint with values `modal`, `drawer`, `page`, and `splitPane`. When a list row or
create control opens an object form, the hint that applies is the one on the
**form view being opened**, not the one on the view the caller was looking at, so
a container declared on a form governs that form from every entry point. The
default is `modal`, making normal CRUD views list-first. `splitPane` preserves the
older dense back-office list/form layout as an explicit option. ADL source syntax
for choosing it is `EDIT_CONTAINER`; see
[language#edit-surfaces](language.md).

Resolved views also include `editSections`. The default is one `fields` section
derived from `view.fields`. A view may instead declare explicit field sections
and `childCollection` sections. Child collections name the child object, the
child lookup field that points at the parent object, an optional child view whose
fields the collection displays and edits, supported operations, staged-change
behavior, optional order field, and empty-state text. The implemented child operation names are
`createChild`, `linkExisting`, `updateChild`, `unlink`, `remove`, and
`reorder`. The defaults are `createChild`, `updateChild` and `remove` for
operations, staged changes enabled, and empty empty-state text.

The default operation set has to be one every child collection can honour.
`unlink` detaches a child by patching its parent lookup to null, so a child whose
lookup back to its parent is required — the common case — can never satisfy it,
and defaulting to it made the unauthored declaration invalid by construction.
`remove` deletes the child instead, and is still gated by the child object's
`delete` policy action. Validation refuses `unlink` wherever it could never
commit: a collection whose declared parent field is required and whose operations
include `unlink` is reported as
`ADL_VIEW_EDIT_SECTION_UNLINK_PARENT_FIELD_REQUIRED` against
`<view>.editSections[i].operations`, naming the field.

A child collection may declare a renderer-neutral `picker`:

- `sourceKind`: `object` or `readModel`
- `source`: object name for object sources, or read-model name for read-model
  sources
- `candidateField`: optional. Present only when choosing a candidate **creates** a
  child naming it rather than re-parenting an existing child. It is a lookup field
  of the child object, and it is never defaulted or inferred — which of a child's
  lookups a picker fills is a modelling decision.
- `selection`: `single` or `multiple`
- `displayFields`, `searchFields`, and `sort` over candidate fields
- `excludeAlreadyLinked`, which defaults to true
- picker `emptyState.text`

`candidateField` decides both which operation the collection must support and
which object the source must name. A picker without it links, requires
`linkExisting` among the collection's operations, and its candidates are child
records. A picker with it mints, requires `createChild`, and its candidates are
records of the field's lookup target. Object picker sources must be that
candidate object; read-model picker sources must include it as one source, so each
candidate resolves to a deterministic record id of it. `source` itself defaults to
the child object, which is the linking answer, so a minting picker over a
different object must declare its source. These declarations are
renderer-neutral; they describe edit composition and relationship intent, not
browser components or storage tables.

Edit sections, child collections and pickers are declarable in ADL source; see
[language#edit-surfaces](language.md) for the syntax and
[runtime-semantics#staged-child-changes](runtime-semantics.md) for what a runtime
does with them.

Resolved views may include an optional `presentation` contract. This is
renderer-neutral JSON-compatible data consumed by UI runtimes, not parser AST
or browser component code.

Implemented presentation declarations include:

- view layout and density hints
- local view state with type, default value, and persistence
- icon maps from semantic values to icon names
- semantic statuses with label, accessibility label, optional icon, theme
  token, and numeric precedence
- status maps from row values to semantic status names
- legends with ordered status names and `present` or `all` include behavior
- sections with headings, controls, and lists
- resource/date matrices with row sources, date column axes, cell sources,
  unset status handling, and optional edit behavior
- month calendars with object/read-model sources, date fields, week-start
  metadata, local-state month navigation, cell summaries, semantic statuses,
  and cell actions
- toggle, select, action, and context-selector controls
- action placement metadata for primary, secondary, and row-level controls
- command, navigation, and create-form action bindings with renderer-neutral
  inputs
- read-model-backed or object-backed presentation lists
- list render style, density, fields, sort, filters, and empty states
- optional list status bindings with one or more direct or mapped status
  candidates
- list row actions
- row templates with literal text, field text, icon, and conditional fragments
- fragment styles limited to `plain`, `bold`, `muted`, and `caption`
- display-only format declarations for text, number, date, datetime, and time
- optional shell regions such as top bar, bottom bar, and sidebar in resolved
  JSON/TypeScript partial models

Presentation references are validated against the resolved model. Lists,
matrices, and calendars must reference known read models or objects. Row
fragments, list fields, matrix row and cell fields, matrix edit targets,
calendar date/title/summary fields, sort fields, filters, icon maps, controls,
local state, commands, command action inputs, action visibility predicates,
target views, create targets, contexts, status maps, status names, status map
fields, legends, and shell controls produce structured diagnostics when
invalid.

## Shell

`ResolvedApplicationModel.shell` is the renderer-neutral application shell
contract. It is separate from per-view presentation and is available even when
source models do not declare a `SHELL` block.

The shell contains:

- `nav.items`: view-backed navigation items with name, target view, label,
  optional semantic icon, optional group, numeric order, active-state view
  names, and visibility metadata.
- `topBar`: business-context selector placement, mobile context-selector mode,
  and ordered shell control names.

Resolved themes include common semantic status color tokens:
`colorStatusEvent`, `colorStatusAlternate`, `colorStatusAvailable`,
`colorStatusUnavailable`, `colorStatusBusyElsewhere`, `colorStatusConflict`,
and `colorStatusUnset`. Presentation statuses reference these tokens by name;
renderers map them to platform colors or CSS variables.

The token set is closed and carries no application vocabulary. A status whose
name is one the platform itself defines — `event`, `available`, `unavailable`,
`busyElsewhere`, `conflict`, `unset` — resolves to the matching token with
nothing declared. Every other status name is the application's own and resolves
to `colorInfo`; an author who wants a distinct colour for it declares one, and
`colorStatusAlternate` exists as a second categorical colour alongside
`colorStatusEvent` for exactly that purpose. No application's own status name
may be added to the reserved set: that would put one domain's vocabulary in
every model's type.

- `controls`: optional shell controls such as context selector, sync status,
  theme switch, logout, and PWA install prompt.

Implemented shell visibility metadata is deliberately small: `always`, `online`,
`offline`, `contextAvailable`, and `contextSelected`. Context visibility names
a business context and is a rendering decision only. It does not grant or deny
runtime access.

Shell validation checks view targets, active-state view references, duplicate
nav names and orders, semantic icon name shape, control names/kinds/placements,
top-bar control references, and context references in shell visibility or
controls. Invalid shell metadata produces `ADL_SHELL_*` diagnostics.

Per-view `presentation.shell.regions` remains a JSON/TypeScript partial-model
shape for placing view-local presentation controls. It is distinct from the
top-level application shell and is not emitted by presentation runtime
evaluation.

Presentation does not replace read models, validation, policy enforcement,
lifecycle enforcement, or sync policy. It only describes how already-authorized
data should be composed for a renderer.

## Sync And Compatibility

Sync modes are `localFirst`, `cacheReadonly`, `onlineRequired`, and
`localPrivate`. Scope and conflict strategy are explicit on each object and in
the top-level sync list.

`app.offlineGraceDays` is the one sync-policy value that is application-wide
rather than per object:

```json
{
  "app": {
    "name": "Giggle Band ADL Example",
    "startView": "HomeDashboard",
    "theme": "CorporateLight",
    "offlineGraceDays": 30
  }
}
```

It is a whole number of days between 1 and 365, declared by
`APP … OFFLINE_GRACE <days> DAYS` and defaulting to `30`. Validation emits
`ADL_APP_OFFLINE_GRACE_INVALID` for a missing-shaped, non-positive, fractional
or out-of-range value rather than silently substituting the default.

It measures how long a device may keep syncing since its last successful
authentication to the authority. It gates sync only: local reads and local-first
writes work offline indefinitely on either side of it, and nothing in the
runtime consults a session. It is also a maximum rather than a minimum —
revoking a session or a membership takes effect on the next contact regardless
of remaining grace.

The authority loads the same resolved model and derives its session lifetime
from this value, so the two cannot drift; `ADL_SESSION_TTL_MINUTES` may only
shorten it. Because the value is part of the resolved model, changing it is a
model version change and passes through the startup compatibility guard.

Runtime startup compatibility checks compare persisted application metadata and
stored record schema versions against the resolved model.

## Model Versions And Migrations

The resolved model carries two version-shaped values, and they answer different
questions:

```json
{
  "modelVersion": "1.1.0",
  "modelFingerprint": "sha256-…",
  "migrations": [
    {
      "from": "1.0.0",
      "to": "1.1.0",
      "objects": [
        {
          "object": "Gig",
          "schemaVersion": 2,
          "steps": [
            { "kind": "renameField", "from": "Venue", "to": "VenueName" },
            { "kind": "addField", "field": "PayoutCents", "defaultValue": 0 },
            { "kind": "dropField", "field": "LegacyNote" }
          ]
        }
      ]
    }
  ]
}
```

`modelVersion` is what the author **declared** (`APP … MODEL_VERSION`),
defaulting to `0.1.0`. It selects migrations.

`modelFingerprint` is what the model **is**: a deterministic digest of the
resolved model's own content, computed during resolution. It is contractual and
must be reproducible by any conforming runtime:

1. **Canonical form.** JSON with object keys sorted by UTF-16 code unit, array
   order preserved, keys whose value is `undefined` omitted, no insignificant
   whitespace, and `-0` written as `0`. Three keys are excluded:
   `modelFingerprint`, because it is its own input; `generatedAt`, because it is
   a build stamp rather than semantics; and `modelVersion`, because it is what
   the author _declared_ rather than what the model _is_.

   Excluding the declared version matters more than it looks. The fingerprint is
   consulted only when two versions already compare equal, so digesting the
   version adds nothing — but it would make `1.1` and `1.1.0`, which are the same
   version, disagree, and the only remedy the guard could then name (declare a
   migration between them) is itself invalid because they do not move forward
   relative to each other. A model that declares `1.0.0` therefore fingerprints
   identically to one that declares nothing, provided their content matches.

2. **Digest.** SHA-256 over the UTF-8 bytes of that text, lowercase hex,
   prefixed `sha256-`.

The two exist separately because a declared version alone was never evidence.
Before this contract existed, `modelVersion` was a platform constant with no ADL
syntax behind it, so editing model content left the version identical and every
compatibility check silent. The fingerprint makes an undeclared content change
detectable without making every content change an author's problem to remember.

Validation covers both: `ADL_MODEL_VERSION_INVALID` for a version that is not a
dotted number, and `ADL_MIGRATION_DUPLICATE`, `ADL_MIGRATION_VERSION_INVALID`,
`ADL_MIGRATION_NOT_FORWARD`, `ADL_MIGRATION_OBJECT_UNKNOWN`,
`ADL_MIGRATION_STEP_INVALID`, `ADL_MIGRATION_SCHEMA_VERSION_INVALID` and
`ADL_MIGRATION_UNREACHABLE` for migrations. Step and schema-version checks apply
only to the hop that ends at the model's own version: an earlier hop describes a
shape the model no longer has, so checking it against today's fields would
reject a correct chain.

## Validation

Model validation runs over the resolved model and returns diagnostics, each
carrying a severity, a stable code and a path. An `error` blocks the model from
being used; a `warning` does not.

Validation covers the model's own consistency: references that must resolve
(views, fields, policies, contexts, read-model sources, commands, decision
tables, themes, migrations), declarations that must be unique, values that must
be in range, and expressions that must type-check against the fields they name.

Two limits are contractual because a conforming runtime should not assume more
than they promise:

- **Decision-table overlap detection is partial.** Only literal, `and`, and
  `field <operator> literal` conditions are analyzable. Anything else is reported
  as `ADL_DECISION_TABLE_ROW_CONDITION_UNANALYZABLE` (a warning) and excluded
  from overlap analysis, so a `single`-match table can still be ambiguous at
  runtime despite validating cleanly.
- **A named validator's element values are not checked against its field's
  type.** Model validation does check that a validator's *kind* suits the
  field's type, and that a value it needs is present and the right JSON shape
  — `MIN` on a text field, or an `IN` with no list, is
  `ADL_FIELD_VALIDATOR_KIND_INVALID` or `ADL_FIELD_VALIDATOR_VALUE_INVALID`
  rather than a validator that can silently never fire. What is not checked is
  the *content* of a compound value: an `IN` list may hold values of a
  different type than the field's own, and a `REGEXP` pattern is not confirmed
  to be syntactically valid until a value is evaluated against it at runtime.
  See [Field Validators](language.md#field-validators) for the full per-keyword
  table of applicable field types and required value shapes.

Runtime startup compatibility is a separate concern: model validation checks the
current model, while the startup guard checks _persisted data_ against it. See
[runtime-semantics#model-migration](runtime-semantics.md).
