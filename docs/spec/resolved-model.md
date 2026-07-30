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

Computed fields are separate from stored fields. They include a structured
expression, dependencies, read-time strategy, deterministic evaluation order,
and system-managed readonly flags.

## Expressions

`ResolvedExpression` is the expression contract. Implemented expression nodes
are literal, field, runtime, unary, and binary expressions. Runtime services use
these trees directly for validation, policy conditions, guards, decision tables,
commands, computed fields, and read-model expression fields.

## Contexts

Business contexts name a context object and optional membership declaration.
Object scopes link objects to a context through a field. View and read-model
contexts declare whether a context is none, required, optional, or all.

Context roles are not global roles. Runtime context roles must carry context
name, context instance id, and role.

## Policies

Policies are object-scoped and deny by default. A rule has effect, principal,
action, optional states, optional fields, optional lifecycle action, optional
condition, and channels. Conditions are resolved expressions.

## Lifecycles

A lifecycle names its state field, initial state, states, and actions. Actions
declare source states, target state, guards, policy references, and hook
references. Metadata-backed `_state` is valid when no author state field is
declared.

## Read Models

Read models contain named sources, output fields, and sort order. Source scopes
are backend-neutral: `all`, `currentContext`, `allAvailableContexts`, and
`currentUser`. Expression fields evaluate over already-projected row values.

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

## View Presentation

Resolved views include `editContainer`, a renderer-neutral CRUD presentation
hint with values `modal`, `drawer`, `page`, and `splitPane`. Browser runtimes
use it when a list row or create control opens an object form. The default is
`modal`, making normal CRUD views list-first. `splitPane` preserves the older
dense back-office list/form layout as an explicit option. This property is
model-level only in the current implementation; ADL source syntax for choosing
it is not implemented yet.

Resolved views also include `editSections`. The default is one `fields` section
derived from `view.fields`. A view may instead declare explicit field sections
and `childCollection` sections. Child collections name the child object, the
child lookup field that points at the parent object, an optional child view for
display fields, supported operations, staged-change behavior, optional order
field, and empty-state text. The implemented child operation names are
`createChild`, `linkExisting`, `updateChild`, `unlink`, `remove`, and
`reorder`.

Child collections that support `linkExisting` may declare a renderer-neutral
`picker`:

- `sourceKind`: `object` or `readModel`
- `source`: child object name for object sources, or read-model name for
  read-model sources
- `selection`: `single` or `multiple`
- `displayFields`, `searchFields`, and `sort` over candidate fields
- `excludeAlreadyLinked`, which defaults to true
- picker `emptyState.text`

Object picker sources must be the child object. Read-model picker sources must
include the child object as one source so each candidate can resolve to a
deterministic child record id. These declarations are renderer-neutral; they
describe edit composition and relationship intent, not browser components or
storage tables.

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
`colorStatusEvent`, `colorStatusRehearsal`, `colorStatusAvailable`,
`colorStatusUnavailable`, `colorStatusBusyElsewhere`, `colorStatusConflict`,
and `colorStatusUnset`. Presentation statuses reference these tokens by name;
renderers map them to platform colors or CSS variables.
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
   the author *declared* rather than what the model *is*.

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
- **Named field validators are not type-checked against their field.** A
  validator whose kind does not suit the field's type, or which omits a value it
  needs, is reported so it cannot silently do nothing.

Runtime startup compatibility is a separate concern: model validation checks the
current model, while the startup guard checks *persisted data* against it. See
[runtime-semantics#model-migration](runtime-semantics.md).
