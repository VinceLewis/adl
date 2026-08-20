# ADL UI Language Addendum

This document specifies the implemented ADL presentation-layer subset for
composed application screens such as the Giggle Band home dashboard. It remains
separate from `language.md`, `resolved-model.md`, and `runtime-semantics.md`
because these constructs describe UI composition and rendering intent, not core
business object semantics.

Implemented behavior covers composed view presentation blocks, local state,
sections, toggles, action controls, lists, row actions, row templates, icon
maps, formatting, empty states, renderer-neutral runtime evaluation, browser
rendering through generic Web Components, and data-driven conformance coverage.
Future proposals are called out explicitly below.

## Purpose

The core ADL language should continue to describe durable application meaning:
objects, fields, relationships, contexts, policies, lifecycles, commands, read
models, sync behavior, and validation.

The UI language should describe how already-defined application data is composed
into screens:

- screen structure
- sections
- local UI state
- controls such as toggles and selectors
- list presentation
- row templates
- icons
- formatting
- inline text emphasis
- empty states
- app shell placement

This separation keeps the runtime model business-first while still allowing a
real application to have a UI that is materially better than generic CRUD.

## Design Principles

UI ADL should be model-driven, not component-code-driven. Authors should express
what a screen is made of and what data it presents, while renderers decide the
exact DOM, native widgets, accessibility attributes, and platform-specific
behavior.

UI ADL should be declarative. It should not contain arbitrary JavaScript,
framework component names, SQL, CSS selectors, host callbacks, or procedural
render loops.

UI ADL should compose with read models. Read models shape and authorize data;
presentation constructs decide how that data appears.

Semantic statuses describe business-facing presentation meaning, not CSS class
names. A row or future cell can expose a stable status such as `event`,
`rehearsal`, `available`, `unavailable`, `busyElsewhere`, `conflict`, or
`unset`; themes and renderers choose the color/icon treatment.

UI ADL should be optional. A valid ADL app should still render through default
list and form views when no presentation layer is provided.

UI ADL should be loadable from one or more `.adl` files listed by `app.yaml`.
Domain and presentation may live together while an app is small, but larger apps
should be able to split files, for example:

```yaml
name: Giggle Band
id: giggle-band
startView: Home

sources:
  - domain.adl
  - read-models.adl
  - ui.adl
```

## Relationship To Core Views

A dashboard does not need to be a separate first-class view type. It can be a
normal composed `VIEW` that contains sections, lists, local state, and row
templates.

The language should avoid hard-coding categories such as `Dashboard` until the
runtime needs distinct behavior that cannot be expressed through general
composition. If repeated defaults are useful later, prefer style or layout hints:

```adl
VIEW HomeDashboard DASHBOARD
  LAYOUT Stack
  DENSITY Compact
END.VIEW
```

This keeps "dashboard" as a presentation style, not a different semantic kind
of view.

## Required Constructs

### View Composition

A view may contain multiple independent UI blocks:

```adl
VIEW HomeDashboard DASHBOARD
  SECTION Welcome
    HEADING "Welcome Back!"
  END.SECTION

  SECTION Schedule
    LIST UpcomingEvents FROM HomeUpcomingEvents
    END.LIST
  END.SECTION
END.VIEW
```

Sections provide screen structure. They are not business objects and do not
imply persistence.

### Local View State

Views may declare local UI state for filters and presentation choices:

```adl
VIEW HomeDashboard DASHBOARD
  STATE showGigs Boolean DEFAULT true
  STATE showRehearsals Boolean DEFAULT true
  STATE showUnavailable Boolean DEFAULT true
END.VIEW
```

Local state is view state. It is not an object field unless explicitly bound to
a persistent object.

### Controls

Controls bind to local state, runtime context, command inputs, or view
parameters. The Giggle dashboard needs compact toggle controls:

```adl
TOGGLE showGigs
  LABEL "Gigs"
  ICON music
END.TOGGLE
```

Implemented source syntax includes `TOGGLE` for Boolean local state and
`ACTION` for command or navigation controls. The resolved model also has
generic `select` and `contextSelector` control shapes for JSON/TypeScript
partial models, but ADL source syntax for those controls is not implemented
yet.

Action controls declare renderer-neutral intent, not host callbacks:

```adl
ACTION addEvent COMMAND CreateEvent LABEL "Add Event" ICON calendar PLACEMENT primary
END.ACTION

ACTION openEvent VIEW EventList LABEL "Open" PLACEMENT row
  INPUT title FROM Title
END.ACTION
```

Supported placements are `primary`, `secondary`, and `row`. Section actions
default to `secondary`; actions declared inside a `LIST` default to `row`.
Command actions may map inputs from local presentation state or row fields.
`WHEN` predicates can hide an action from presentation output, and command
preconditions shape the renderer-neutral enabled state. Runtime command
services still enforce command preconditions, policy, validation, sync, audit,
and operation-log behavior when the action is attempted.

### Lists In Composed Views

A composed view may contain multiple lists, each backed by an object or read
model:

```adl
LIST UpcomingEvents FROM HomeUpcomingEvents
  ORDER BY EventDate ASC, StartTime ASC
  EMPTY_TEXT "No upcoming events"
END.LIST

LIST PendingInvitations FROM PendingInvitations
  EMPTY_TEXT "No pending invitations"
END.LIST
```

The list construct describes a repeated presentation region. It does not require
table rendering.

### List Rendering Hints

Lists should support renderer-neutral presentation hints:

```adl
LIST UpcomingEvents FROM HomeUpcomingEvents
  RENDER_AS CompactFeed
  DENSITY Compact
END.LIST
```

These are hints. A runtime can map them to native components appropriate for the
platform.

### Row Templates

Rows may be composed from fields, literals, icons, and formatted values:

```adl
ROW
  ICON EventTypeIcon(EventType)
  TEXT EventDate FORMAT "EEE d MMM"
  TEXT " - "
  TEXT BandName
  TEXT " - "
  TEXT Title STYLE bold
  TEXT " at "
  TEXT StartTime FORMAT "h:mma"
END.ROW
```

Row templates are presentation declarations. They should not mutate data and
should not bypass read-model or policy behavior.

### Inline Text Fragments

The UI language needs inline composition for sentence-like rows. A list row is
not always a grid of fields.

Required fragment types:

- literal text
- field text
- formatted field text
- conditional text
- emphasized text, initially `bold`

Initial styles should be deliberately small:

```adl
TEXT Title STYLE bold
```

Avoid exposing arbitrary CSS as the author-facing contract.

### Formatting

Formatting should be declared at the presentation layer when it affects display
only:

```adl
TEXT EventDate FORMAT "EEE d MMM"
TEXT StartTime FORMAT "h:mma"
```

The underlying field remains a date, datetime, time, number, or text value.
Formatting does not change validation or storage semantics.

### Icon Mapping

The dashboard needs value-to-icon mapping, for example event type to icon:

```adl
ICON_MAP EventTypeIcon FOR EventType
  Gig -> music
  Rehearsal -> microphone
  Unavailable -> x
END.ICON_MAP
```

Icons are semantic names from a platform-supported icon set. ADL should not
embed raw SVG paths in ordinary application source.

Icon maps may be reused by controls and row templates:

```adl
TOGGLE showGigs
  LABEL "Gigs"
  ICON EventTypeIcon(Gig)
END.TOGGLE

ROW
  ICON EventTypeIcon(EventType)
END.ROW
```

### Conditional Visibility And Filtering

Presentation filters may reference local state and row values:

```adl
LIST UpcomingEvents FROM HomeUpcomingEvents
  WHERE (EventType == 'Gig' AND showGigs == true) OR (EventType == 'Rehearsal' AND showRehearsals == true)
END.LIST
```

These filters are UI filters. They do not replace runtime policy enforcement or
read-model scoping.

### Semantic Statuses And Legends

Views may declare semantic statuses, maps from row values to statuses, and
legends:

```adl
STATUS event LABEL "Gig" ARIA_LABEL "Gig event" ICON EventTypeIcon(Gig) THEME colorStatusEvent PRECEDENCE 10
STATUS unavailable LABEL "Unavailable" ARIA_LABEL "Unavailable block" ICON EventTypeIcon(Unavailable) THEME colorStatusUnavailable PRECEDENCE 20

STATUS_MAP EventTypeStatus FOR EventType DEFAULT event
  Gig -> event
  Rehearsal -> rehearsal
  Unavailable -> unavailable
END.STATUS_MAP

LEGEND ScheduleStatus TITLE "Schedule status" STATUSES event rehearsal unavailable
```

Lists may declare one or more status candidates:

```adl
LIST UpcomingEvents FROM HomeUpcomingEvents
  STATUS EventTypeStatus(EventType)
END.LIST
```

If multiple candidates produce statuses for one row or future cell, the runtime
chooses the status with the highest declared `PRECEDENCE`. Equal precedence is
resolved by the order of status declarations in the view. Legends default to
showing only statuses present in evaluated rows; `INCLUDE all` shows all
statuses named by the legend.

The evaluator returns status name, label, accessibility label, theme token,
precedence, optional semantic icon, and source metadata. Browser renderers must
include accessible text or labels wherever status is conveyed by icon or color.
Unsupported or missing status maps, fields, values, or status names produce
structured `ADL_PRESENTATION_*` diagnostics where runtime evaluation can detect
them.

### Resource/Date Matrices

Composed sections may include matrix declarations for availability-style
planning. A matrix has a row source, a regular date column axis, a cell source,
cell status binding, and optional edit behavior:

```text
MATRIX AvailabilityMatrix
  ROWS FROM Members KEY User LABEL Name
  COLUMNS DATE_RANGE 2026-08-01 TO 2026-08-14 STEP_DAYS 1
  CELLS FROM AvailabilityCells ROW User COLUMN Date
  STATUS AvailabilityStatus(Status), BusyStatus(BusyElsewhere)
  UNSET_STATUS unset
  EDIT Availability VALUE Status CYCLE Available Unavailable UNSET_AS_ABSENCE
END.MATRIX
```

The implemented resolved-model shape is available to JSON/TypeScript partial
models. ADL source syntax for `MATRIX` is documented here as intended language
direction, but parser support remains future work.

Rows and cells bind through object search or read-model execution, so policy,
context scope, field shaping, and read-model projection apply before the
renderer sees data. A blank cell may resolve to an `unset` status without
persisting a fake enum value. Derived cell facts such as `busyElsewhere` should
come from read-model or runtime-shaped fields, then map to semantic statuses.

Matrix edit behavior supports per-cell cycling and range application. Edits use
validated runtime object operations and declare `bulkBehavior:
sequentialValidatedWrites`, making sync/offline behavior explicit per affected
object write.

### Empty States

Lists should declare empty states:

```adl
LIST PendingInvitations FROM PendingInvitations
  EMPTY_TEXT "No pending invitations"
END.LIST
```

An empty state is presentation only. It does not imply a validation result or
business state.

### App Shell

Some screen elements belong to the app shell rather than a single list or form.
Implemented global shell syntax declares navigation and top-bar controls:

```adl
SHELL
  NAV HomeDashboard LABEL "Home" ICON home GROUP Main ORDER 10
  NAV BandEventList LABEL "Gigs" ICON calendar GROUP Main ORDER 20
  NAV MyAvailabilityList LABEL "Availability" ICON calendar GROUP Main ORDER 30 VISIBLE WHEN CONTEXT Band SELECTED
  CONTROL contextSelector KIND contextSelector PLACEMENT topBar
  CONTROL syncStatus KIND syncStatus PLACEMENT topBar
  TOP_BAR CONTEXT_SELECTOR topBar MOBILE_CONTEXT_SELECTOR sheet CONTROLS contextSelector syncStatus
END.SHELL
```

For the Giggle dashboard screenshot this covers:

- left menu button
- centered band/app title
- right-side band selector
- drawer labels for Home, Gigs, Availability, Songs, Set Lists, and Bands
- compact mobile business-context selection through a sheet

The resolved model stores shell metadata at `ResolvedApplicationModel.shell`.
Nav items target resolved views and carry label, icon, group, order,
active-state, and visibility metadata. Shell visibility can depend on runtime
online state or business-context availability/selection. Visibility is not
authorization; runtime policy and context services still enforce access when an
operation runs.

Shell controls support `contextSelector`, `syncStatus`, `connectivity`,
`themeSwitch`, `logout`, and `pwaInstall`. Controls whose host capability is
unavailable render as unavailable controls rather than breaking the shell.

`syncStatus` and `connectivity` answer two different questions and are declared
separately:

- `SYNC_STATUS` reports **record state**: how many of the device's records are
  waiting to be sent, and whether any were refused or are in conflict. It reads
  the records, not the network.
- `CONNECTIVITY` reports **reachability**: whether the device can currently reach
  the authority.

They are not interchangeable. A device that is online can still be holding
refused records, and a device that is offline is not thereby in conflict with
anything. A shell that shows only one of them leaves the other question
unanswered.

```adl
  CONTROL syncStatus KIND syncStatus PLACEMENT topBar
  CONTROL connectivity KIND connectivity PLACEMENT topBar
```

A model that declares no shell gets both by default, in the order
`contextSelector`, `connectivity`, `syncStatus`.

Per-view `presentation.shell.regions` remains available in JSON/TypeScript
partial models for view-local presentation-control placement, but source syntax
for view-declared shell regions is not implemented.

## Giggle Dashboard Example

The real Giggle dashboard can be described as one composed view over upcoming
events and pending invitations:

```adl
VIEW HomeDashboard DASHBOARD
  LAYOUT Stack
  DENSITY Compact

  STATE showGigs Boolean DEFAULT true
  STATE showRehearsals Boolean DEFAULT true
  STATE showUnavailable Boolean DEFAULT true

  ICON_MAP EventTypeIcon FOR EventType
    Gig -> music
    Rehearsal -> microphone
    Unavailable -> x
  END.ICON_MAP

  STATUS event LABEL "Gig" ARIA_LABEL "Gig event" ICON EventTypeIcon(Gig) THEME colorStatusEvent PRECEDENCE 10
  STATUS rehearsal LABEL "Rehearsal" ARIA_LABEL "Rehearsal event" ICON EventTypeIcon(Rehearsal) THEME colorStatusAlternate PRECEDENCE 10
  STATUS unavailable LABEL "Unavailable" ARIA_LABEL "Unavailable block" ICON EventTypeIcon(Unavailable) THEME colorStatusUnavailable PRECEDENCE 20

  STATUS_MAP EventTypeStatus FOR EventType DEFAULT event
    Gig -> event
    Rehearsal -> rehearsal
    Unavailable -> unavailable
  END.STATUS_MAP

  LEGEND ScheduleStatus TITLE "Schedule status" STATUSES event rehearsal unavailable

  SECTION Welcome
    HEADING "Welcome Back!"
  END.SECTION

  SECTION Filters
    TOGGLE showGigs
      LABEL "Gigs"
      ICON EventTypeIcon(Gig)
    END.TOGGLE

    TOGGLE showRehearsals
      LABEL "Rehearsals"
      ICON EventTypeIcon(Rehearsal)
    END.TOGGLE

    TOGGLE showUnavailable
      LABEL "Unavailable"
      ICON EventTypeIcon(Unavailable)
    END.TOGGLE
  END.SECTION

  SECTION Schedule
    HEADING "Schedule"

    LIST UpcomingEvents FROM HomeUpcomingEvents
      RENDER_AS compactFeed
      ORDER BY EventDate ASC, StartTime ASC
      EMPTY_TEXT "No upcoming events"
      WHERE (EventType == 'Gig' AND showGigs == true) OR (EventType == 'Rehearsal' AND showRehearsals == true) OR (EventType == 'Unavailable' AND showUnavailable == true)
      STATUS EventTypeStatus(EventType)

      ROW
        ICON EventTypeIcon(EventType)
        TEXT EventDate FORMAT date "EEE d MMM"
        TEXT " "
        TEXT StartTime FORMAT time "h:mma"
        TEXT " - "
        TEXT BandName
        TEXT " - "
        TEXT Title STYLE bold
        TEXT " - "
        TEXT VenueName
      END.ROW
    END.LIST
  END.SECTION

  SECTION Invitations
    HEADING "Invitations"

    LIST PendingInvitations FROM PendingInvitations
      RENDER_AS compactFeed
      EMPTY_TEXT "No pending invitations"
    END.LIST
  END.SECTION
END.VIEW
```

This does not require a `Dashboard` view type. It requires the renderer to
understand composed views.

## Read Model Boundary

Read models can and should provide dashboard-ready data:

- upcoming event rows
- joined band name
- event type
- venue
- invitation summary
- sorted dates
- scoped records visible to the user

Read models should not carry presentation-only details unless those details are
business-facing derived facts. The following belong in UI ADL:

- icon choice
- bold fragments
- compact feed rendering
- section grouping
- toggle placement
- display date/time format
- empty-state wording

A read model may expose a stable semantic value such as `EventType`; the UI
layer maps that value to an icon, text fragment, or filter control.

## Resolved Model Implications

Implemented behavior: presentation lives as an optional `presentation`
declaration on a resolved view. This keeps composed screens as ordinary views
and avoids introducing a distinct dashboard view type.

```ts
interface ResolvedView {
  name: string;
  object: string;
  kind: ViewKind;
  editContainer: "modal" | "drawer" | "page" | "splitPane";
  presentation?: ResolvedViewPresentation;
}
```

`editContainer` is the implemented CRUD form-container hint for generic object
views. Normal list views default to `modal`, so the list/table is the primary
surface and create/edit forms open only from explicit user actions. `drawer`
and `page` are also renderer-neutral hints consumed by the browser runtime.
`splitPane` is supported as an explicit dense workflow that keeps list and form
visible together. ADL source syntax for setting this property is
`EDIT_CONTAINER modal|drawer|page|splitPane` inside a `VIEW` block; see
[language#edit-surfaces](language.md).

The renderer takes the hint from the **form view it is about to open**, not from
the view currently on screen. A form opened from a list, from a row, or by
navigating to the form view itself is therefore presented the same way, and a
`FORM` view's own `EDIT_CONTAINER` is not inert. The workspace layout and the
open/close behaviour read that one value, so what is drawn and what is opened
cannot disagree.

The implemented presentation model resolves to structured data for:

- view layout hints
- sections
- local state declarations
- controls
- action placement and command/navigation bindings
- list bindings
- calendar month planning bindings
- row actions
- row template fragments
- icon maps
- semantic statuses, status maps, status precedence, and legends
- format declarations
- empty states
- shell regions in JSON/TypeScript partial models only

Runtime services should still consume the resolved model, not ADL syntax or raw
parser AST nodes.

Implemented defaults are explicit in the resolved model:

- view and section layout: `stack`
- view, section, list, and row density: `comfortable`
- list source kind: `readModel`
- list render style: `table`
- calendar source kind: `readModel`
- calendar week start: `monday`
- section action placement: `secondary`
- list action placement: `row`
- row layout: `inline`
- text and field fragment style: `plain`
- local state type: `boolean`
- local state persistence: `memory`
- local state default values: `false` for Boolean, `0` for number, empty text
  for text, and `null` for date/time values
- status label and accessibility label: title-cased status name
- status theme token: common semantic status color token when known, otherwise
  `colorInfo`
- status precedence: `0`
- legend include behavior: `present`
- empty-state text: empty string
- CRUD edit container: `modal`
- child collection operations: `createChild`, `updateChild`, and `remove` — the
  largest set every child collection can honour, since `unlink` needs an optional
  parent field
- child collection staged changes: enabled

Implemented validation reports structured diagnostics for invalid references to
read models, objects, fields, local state, icon maps, known fragment styles,
formats, commands, command action inputs, action visibility predicates, target
views, create targets, contexts, status maps, status names, status map fields,
legends, shell regions, and shell controls.

Conformance cases under `conformance/presentation/` cover resolution defaults,
validation diagnostics, local state defaults, toggle-controlled filters,
read-model list binding, row fragments, icon maps, deterministic formatting,
ordering, semantic statuses, legends, empty states, and inspect output for
presentation defaults and references.

Edit surfaces are covered by `conformance/model/edit-surfaces.json`, which states
what the ADL syntax resolves to and which declarations are refused — including
both picker modes, the source each one must be routed at, every candidate-field
diagnostic, the default operation set, and the refusal of `unlink` against a
required parent field — and `conformance/runtime/edit-surfaces.json`, which states what an
ADL-declared child collection evaluates to, what each picker mode offers and
excludes, what a staged batch commits, queues and reconciles, and that a staged
`updateChild` changes only the fields its patch names while one carrying no values
is refused and takes the rest of its batch with it.

## Implementation Notes

Parser/compiler support is implemented for the smallest useful subset:

1. `SECTION`
2. local `STATE`
3. `TOGGLE`
4. `LIST ... FROM ...`
5. list `ORDER BY`, `WHERE`, `RENDER_AS`, `DENSITY`, and `EMPTY_TEXT`
6. `ROW`
7. `TEXT` literals and fields with `FORMAT` and `STYLE bold`
8. `ICON`
9. `ICON_MAP`
10. `STATUS`, `STATUS_MAP`, `LEGEND`, and list/calendar `STATUS` candidates
11. `CALENDAR ... FROM ...` with `DATE_FIELD`, `TITLE_FIELD`,
    `SUMMARY_FIELDS`, `MONTH`, `MONTH_STATE`, `WEEK_START`, `RANGE`,
    `EMPTY_TEXT`, and cell `ACTION`
12. edit surfaces: `EDIT_CONTAINER`, `EDIT_SECTION`, `CHILD_COLLECTION` with
    `CHILD ... PARENT_FIELD`, `CHILD_VIEW`, `OPERATIONS`, `STAGED`,
    `ORDER_FIELD` and `EMPTY_TEXT`, and a nested `PICKER` with `SOURCE`,
    `CANDIDATE_FIELD`, `SELECTION`, `DISPLAY`, `SEARCH`, `SORT`,
    `EXCLUDE_LINKED` and `EMPTY_TEXT`

Unsupported source constructs include `SELECT`, `CONTEXT_SELECTOR`, arbitrary
CSS, raw SVG, framework component names, host callbacks, procedural render
loops, and DOM-specific declarations.

The first implementation target is the Giggle Band home dashboard source in
`src/reference/giggle-band/ui.adl`. It proves that non-CRUD presentation can be
authored without app-specific UI components. That file is now a frozen
model-version-1.0.0 snapshot rather than the app's compiled source — Giggle
Band's `app.yaml` lists `domain.adlj`/`ui.adlj` — so read it as the original
implementation target it was, not as the current dashboard. See
`docs/spec/language.md`'s "Reference-app citations point at a frozen snapshot"
and `docs/phases/phase-94-adl-adlj-divergence.md`.

The compiler should accept presentation declarations from any source listed in
`app.yaml`, so an app can keep domain and UI source separate:

```text
src/reference/giggle-band/
  app.yaml
  domain.adlj
  ui.adlj
```

Current parser detail: view declarations are object-scoped. A later `OBJECT`
declaration that contains only `VIEW` blocks extends the earlier object
declaration of the same name, which allows a domain source to define fields and
a UI source to add authored presentation views. The same split works for either
surface: `.adl` text merges at the AST level through `compileAdlProject`, and
`.adlj` merges at the `PartialApplicationModel` level through
`compileAdlProjectV2` (see [adlj.md](adlj.md)).

Runtime evaluation is implemented by `ApplicationRuntime.evaluatePresentationView`.
It initializes resolved local state defaults, applies local state updates, binds
lists and calendars through policy-enforcing runtime reads or read models,
applies presentation filters and ordering, resolves semantic statuses by
deterministic precedence, resolves row templates and icon maps, formats
primitive display values, evaluates matrices and month calendars, evaluates
legends, and returns empty states when no visible rows remain.

The evaluator returns renderer-neutral data only. It does not return DOM nodes,
HTML strings, CSS selectors, framework component names, JavaScript callbacks,
or SVG payloads. Action controls include intent, label, icon, placement,
target command/view/create flow, resolved input, and visible/enabled state. Presentation
filters run after read authorization, context scoping, and read-model shaping;
they are not a policy or storage boundary.

The browser renderer consumes this evaluator output. It renders sections,
headings, legends, semantic status indicators, local toggle controls,
command/navigation actions, compact feed rows, row actions, resource/date
matrices, month calendars with mobile agenda fallback, inline text fragments,
bold fragments, semantic icons, diagnostics, and empty states.
Toggle interaction updates view-local
presentation state and re-evaluates the view; it does not write object-store
records. Calendar month navigation also updates view-local state. Action clicks
dispatch to model navigation, shared create forms, or `ApplicationRuntime`
command execution.

For non-composed CRUD object views, the browser renderer is list-first by
default. It renders only the list/table at rest, opens create/edit forms from
the list's explicit actions or row clicks, and closes non-split form containers
back to the same list context after save, cancel, close, delete, or lifecycle
transition. This path still uses runtime policy presentation for field
visibility/editability and runtime services for all write enforcement.

CRUD form views declare resolved-model `editSections`. Field sections group
parent fields. Child collection sections embed records whose child object has a
lookup field back to the parent object. The browser renderer consumes
`ApplicationRuntime.evaluateEditSurface` output and renders the child rows in
the same modal, drawer, page, or split-pane form container. New-parent workflows
stage child operations explicitly until the parent record exists; canceling the
container discards those staged operations, while save applies them through
runtime services after the parent save succeeds — as one transaction, so a batch
that fails at any one change leaves none of them written and none queued. ADL
source syntax is `EDIT_CONTAINER`, `EDIT_SECTION` and `CHILD_COLLECTION`; see
[language#edit-surfaces](language.md).

A child collection has two editable surfaces: the **draft row**, which a section
supporting `createChild` renders below its rows, and the **row editor**, which
opens in place over one existing row. Both render the section's fields through the
same platform field renderer the parent form uses, resolved against the **child**
object rather than the parent — so a child field behaves exactly as it would on
its own form. A `LOOKUP` field is a chooser rather than a box to type a record id
into; a date, number or boolean field gets its own control; a field constrained to
a declared set of values is a select; required fields are marked; and readonly
fields and field-level read and write policy resolve through the same
`resolveFieldPresentation` the parent form uses. The chooser's candidate records
are loaded through `ApplicationRuntime.search` on the lookup's target object, so
read policy and context scoping apply to them; the browser must not obtain
candidate records by any other route.

The section's `orderField` is excluded from both surfaces. A new child is
appended, and reordering has its own controls, so a typed position would be a
second source of truth for the same thing.

A persisted row's `updateChild` action is labelled `Edit` and **opens the row
editor**; it writes nothing and stages nothing by itself. The open row's own
`Edit` control is replaced by `Save` and `Cancel` while `Remove` stays available,
and its reorder controls are unaffected.

- `Save` stages one `updateChild` naming that child and carrying **only the fields
  whose values differ** from the row's current ones, and stages **nothing at all**
  when nothing differs.
- `Cancel` discards the editor and stages nothing.

Either way the editor closes. Nothing about a row's record changes until the
staged change is applied, so a cancelled edit leaves no trace. A staged
`updateChild` is then committed and queued inside the same batch as the section's
other child changes — an inline edit is not a second write path — and the runtime
independently refuses a staged `updateChild` carrying no values, so the empty
write is unreachable however a caller reaches the runtime. See
[runtime-semantics#staged-child-changes](runtime-semantics.md).

Only persisted rows offer `Edit`. A staged row has no record yet and carries the
staged-removal control alone.

Child collection sections can declare relationship pickers. The generic browser
renderer opens a modal picker, supports single-select or multi-select candidate
choices, and renders empty candidate states as neutral empty states. Candidate
loading goes through `ApplicationRuntime.evaluateRelationshipPicker`, so policy
and context scoping apply before search text, already-linked exclusion, and picker
ordering. ADL source syntax is the `PICKER` block inside `CHILD_COLLECTION`; see
[language#edit-surfaces](language.md).

A section with a picker renders **one** header control that opens it, and the
picker's mode decides everything about that control:

- when the picker names a `candidateField` it mints, the control is labelled
  `Add`, and it is shown and enabled by the section's `createChild` action;
- otherwise it links, the control is labelled `Link`, and it is shown and enabled
  by the section's `linkExisting` action.

Confirming the picker stages one child operation per chosen candidate: a
`createChild` carrying the candidate's id in the declared candidate field for a
minting picker, and a `linkExisting` naming the chosen child for a linking one.
The staged operation always names the section's own child object, never the
candidate's, because for a minting picker those are different objects. A chosen
candidate is staged as a _value_ of the new child rather than as a child id: the
child does not exist yet, and the candidate's record is not one.

The child draft row — the inline inputs a section otherwise renders for
`createChild` — is suppressed when a minting picker exists, and so is the separate
`Add` button that submits it. Choosing a candidate is how a child is added there,
so a draft row beside it would be a second control doing the same job, and the two
could disagree about which candidates are still available. A section with a linking
picker that also supports `createChild` still renders both: its `Link` control and
its draft row do different things.

Presentation is not enforcement here. The runtime refuses a staged operation the
collection does not declare whatever the renderer showed, and the child object's
own policy, scope, constraints and sync mode still decide every write.

The generic browser shell renders application navigation through a hamburger
drawer from resolved shell nav metadata rather than exposing a raw view selector
in the top bar. The top bar is reserved for app identity, model-declared shell
controls, and business context controls such as band selection. The drawer
closes through the hamburger button, overlay click, or Escape key.

The deterministic formatter intentionally supports a small cross-runtime subset:
date tokens such as `EEE d MMM`, time tokens such as `h:mma`, UTC datetime
combinations, number patterns such as `fixed:1`, and primitive text conversion.
Unsupported patterns produce `ADL_PRESENTATION_FORMAT_UNSUPPORTED` diagnostics
and fall back to raw values where possible.

## Open Questions

- Should view-scoped shell regions get source syntax, or should shell stay
  global with view-local controls referenced through presentation?
- Should icon names be restricted to a standard set at compile time?
- Should date/time format strings use a single ADL-supported pattern language
  across runtimes?
- Should view-local state be persisted per device, per user, or only in memory?
- How much conditional logic should be allowed in row templates before it
  becomes a computed/read-model concern?
- Should `RENDER_AS` values be standardized, or should they be theme/runtime
  extension points?
