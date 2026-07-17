# ADL Resolved Model Specification

The resolved model is the stable ADL intermediate representation and runtime
contract. Runtime services consume `ResolvedApplicationModel`, not parser AST
nodes or ADL source text.

## Contract

`ResolvedApplicationModel` is deterministic and JSON-compatible. It contains:

- `modelVersion`, `app`, `roles`, `objects`, `policies`, `themes`, `sync`,
  `audit`, `operationLog`, and `defaults`.
- Optional `contexts`, `readModels`, `decisionTables`, and `commands` when the
  source model declares those features.
- Optional `presentation` declarations on resolved views when the source model
  declares composed UI structure.
- No wall-clock `generatedAt` value by default.

All defaults must be visible in the resolved model and explainable by inspection
tooling.

## Defaults

Resolution applies platform defaults consistently:

- Application theme defaults to `CorporateLight`.
- Start view defaults to the first resolved object view.
- Object schema version defaults to `1`.
- Object table names and field storage names use deterministic snake-case
  normalization.
- Objects receive platform metadata fields outside normal business fields.
- Object sync defaults to `localFirst`, `all`, and `manual`.
- Every object has a default-deny policy with `defaultEffect: "deny"` and no
  deny-all rule.
- Objects without explicit views receive list and form views over business and
  computed fields.
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

## View Presentation

Resolved views may include an optional `presentation` contract. This is
renderer-neutral JSON-compatible data consumed by UI runtimes, not parser AST
or browser component code.

Implemented presentation declarations include:

- view layout and density hints
- local view state with type, default value, and persistence
- icon maps from semantic values to icon names
- sections with headings, controls, and lists
- toggle, select, action, and context-selector controls
- read-model-backed or object-backed presentation lists
- list render style, density, fields, sort, filters, and empty states
- row templates with literal text, field text, icon, and conditional fragments
- fragment styles limited to `plain`, `bold`, `muted`, and `caption`
- display-only format declarations for text, number, date, datetime, and time
- optional shell regions such as top bar, bottom bar, and sidebar in resolved
  JSON/TypeScript partial models

Presentation references are validated against the resolved model. Lists must
reference known read models or objects. Row fragments, list fields, sort fields,
filters, icon maps, controls, local state, commands, target views, contexts, and
shell controls produce structured diagnostics when invalid.

The resolved shell shape is not currently authored through ADL `SHELL` or
`TOP_BAR` syntax, and presentation runtime evaluation does not emit shell
regions. Generic browser app-bar styling exists for composed views, but it is
not a resolved shell contract yet.

Presentation does not replace read models, validation, policy enforcement,
lifecycle enforcement, or sync policy. It only describes how already-authorized
data should be composed for a renderer.

## Sync And Compatibility

Sync modes are `localFirst`, `cacheReadonly`, `onlineRequired`, and
`localPrivate`. Scope and conflict strategy are explicit on each object and in
the top-level sync list.

Runtime startup compatibility checks compare persisted application metadata and
stored record schema versions against the resolved model.
