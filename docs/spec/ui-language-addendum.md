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

Shell controls support `contextSelector`, `syncStatus`, `themeSwitch`,
`logout`, and `pwaInstall`. The current browser implements context selection
and sync/online status. Controls whose host capability is unavailable render as
unavailable controls rather than breaking the shell.

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
  STATUS rehearsal LABEL "Rehearsal" ARIA_LABEL "Rehearsal event" ICON EventTypeIcon(Rehearsal) THEME colorStatusRehearsal PRECEDENCE 10
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
visible together. ADL source syntax for setting this property is not
implemented yet; use JSON/TypeScript partial models or fixtures when a phase
needs to exercise a non-default mode.

The implemented presentation model resolves to structured data for:

- view layout hints
- sections
- local state declarations
- controls
- action placement and command/navigation bindings
- list bindings
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

Implemented validation reports structured diagnostics for invalid references to
read models, objects, fields, local state, icon maps, known fragment styles,
formats, commands, command action inputs, action visibility predicates, target
views, contexts, status maps, status names, status map fields, legends, shell
regions, and shell controls.

Conformance cases under `conformance/presentation/` cover resolution defaults,
validation diagnostics, local state defaults, toggle-controlled filters,
read-model list binding, row fragments, icon maps, deterministic formatting,
ordering, semantic statuses, legends, empty states, and inspect output for
presentation defaults and references.

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
10. `STATUS`, `STATUS_MAP`, `LEGEND`, and list `STATUS` candidates

Unsupported source constructs include `SELECT`, `CONTEXT_SELECTOR`, arbitrary
CSS, raw SVG, framework component names, host callbacks, procedural render
loops, and DOM-specific declarations.

The first implementation target is the Giggle Band home dashboard source in
`src/reference/giggle-band/ui.adl`. It proves that non-CRUD presentation can be
authored without app-specific UI components.

The compiler should accept presentation declarations from any source listed in
`app.yaml`, so an app can keep domain and UI source separate:

```text
src/reference/giggle-band/
  app.yaml
  domain.adl
  ui.adl
```

Current parser detail: view declarations are object-scoped. A later `OBJECT`
declaration that contains only `VIEW` blocks extends the earlier object
declaration of the same name, which allows `domain.adl` to define fields and
`ui.adl` to add authored presentation views.

Runtime evaluation is implemented by `ApplicationRuntime.evaluatePresentationView`.
It initializes resolved local state defaults, applies local state updates, binds
lists through policy-enforcing runtime reads or read models, applies
presentation filters and ordering, resolves semantic statuses by deterministic
precedence, resolves row templates and icon maps, formats primitive display
values, evaluates legends, and returns empty states when no visible rows remain.

The evaluator returns renderer-neutral data only. It does not return DOM nodes,
HTML strings, CSS selectors, framework component names, JavaScript callbacks,
or SVG payloads. Action controls include intent, label, icon, placement,
target command/view, resolved input, and visible/enabled state. Presentation
filters run after read authorization, context scoping, and read-model shaping;
they are not a policy or storage boundary.

The browser renderer consumes this evaluator output. It renders sections,
headings, legends, semantic status indicators, local toggle controls,
command/navigation actions, compact feed rows, row actions, inline text
fragments, bold fragments, semantic icons, diagnostics, and empty states.
Toggle interaction updates view-local
presentation state and re-evaluates the view; it does not write object-store
records. Action clicks dispatch to model navigation or `ApplicationRuntime`
command execution.

For non-composed CRUD object views, the browser renderer is list-first by
default. It renders only the list/table at rest, opens create/edit forms from
the list's explicit actions or row clicks, and closes non-split form containers
back to the same list context after save, cancel, close, delete, or lifecycle
transition. This path still uses runtime policy presentation for field
visibility/editability and runtime services for all write enforcement.

CRUD form views can now declare resolved-model `editSections`. Field sections
group parent fields. Child collection sections embed records whose child object
has a lookup field back to the parent object. The browser renderer consumes
`ApplicationRuntime.evaluateEditSurface` output and renders the child rows in
the same modal, drawer, page, or split-pane form container. New-parent workflows
stage child operations explicitly until the parent record exists; canceling the
container discards those staged operations, while save applies them through
runtime services after the parent save succeeds. ADL source syntax for authored
child edit sections is not implemented yet; JSON/TypeScript partial models can
use the resolved contract.

Child collection sections can now declare relationship pickers for
`linkExisting` operations. The generic browser renderer opens a modal picker,
supports single-select or multi-select candidate choices, renders empty
candidate states as neutral empty states, and stages selected child ids back
through the existing `linkExisting` child-operation flow. Picker candidate
sources may be the child object or a read model containing the child object.
Candidate loading goes through `ApplicationRuntime.evaluateRelationshipPicker`,
so policy and context scoping apply before search text, already-linked
exclusion, and picker ordering. ADL source syntax for authored picker blocks is
not implemented yet; JSON/TypeScript partial models can use the resolved
contract.

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
