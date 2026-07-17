# ADL UI Language Addendum

This document defines proposed ADL presentation-layer constructs for composed
application screens such as the Giggle Band home dashboard. It is intentionally
separate from `language.md`, `resolved-model.md`, and `runtime-semantics.md`
because these constructs describe UI composition and rendering intent, not core
business object semantics.

This addendum is design documentation for ADL source syntax and renderer
behavior. The resolved-model foundation for composed view presentation is
implemented: JSON/TypeScript partial models can resolve and validate
presentation declarations. The initial parser/compiler subset is implemented
for composed view presentation blocks, local state, sections, toggles, lists,
row templates, icon maps, formatting, and empty states. Runtime evaluation is
implemented through a renderer-neutral presentation evaluator. The browser
runtime renders the initial composed-view subset through generic Web Components.

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

The language should include at least:

- `TOGGLE` for Boolean state.
- `SELECT` for finite option selection.
- `ACTION` for commands or navigation.
- `CONTEXT_SELECTOR` for selecting an active business context, such as a band.

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

Some screen elements belong to the app shell rather than a single list or form:

```adl
SHELL
  TOP_BAR
    LEFT_ACTION Menu
    TITLE CurrentBand.Name
    RIGHT_CONTROL BandSelector
  END.TOP_BAR
END.SHELL
```

For the Giggle dashboard screenshot this covers:

- left menu button
- centered band/app title
- right-side band selector

The shell should be app-level or layout-level. It should not be repeated inside
every view unless a view intentionally overrides it.

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
  presentation?: ResolvedViewPresentation;
}
```

The implemented presentation model resolves to structured data for:

- view layout hints
- sections
- local state declarations
- controls
- list bindings
- row template fragments
- icon maps
- format declarations
- empty states
- shell regions

Runtime services should still consume the resolved model, not ADL syntax or raw
parser AST nodes.

Implemented defaults are explicit in the resolved model:

- view and section layout: `stack`
- view, section, list, and row density: `comfortable`
- list source kind: `readModel`
- list render style: `table`
- row layout: `inline`
- text and field fragment style: `plain`
- local state type: `boolean`
- local state persistence: `memory`
- local state default values: `false` for Boolean, `0` for number, empty text
  for text, and `null` for date/time values
- empty-state text: empty string

Implemented validation reports structured diagnostics for invalid references to
read models, objects, fields, local state, icon maps, known fragment styles,
formats, commands, target views, contexts, shell regions, and shell controls.

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
presentation filters and ordering, resolves row templates and icon maps, formats
primitive display values, and returns empty states when no visible rows remain.

The evaluator returns renderer-neutral data only. It does not return DOM nodes,
HTML strings, CSS selectors, framework component names, or SVG payloads.
Presentation filters run after read authorization, context scoping, and
read-model shaping; they are not a policy or storage boundary.

The browser renderer consumes this evaluator output. It renders sections,
headings, local toggle controls, compact feed rows, inline text fragments, bold
fragments, semantic icons, diagnostics, and empty states. Toggle interaction
updates view-local presentation state and re-evaluates the view; it does not
write object-store records.

The deterministic formatter intentionally supports a small cross-runtime subset:
date tokens such as `EEE d MMM`, time tokens such as `h:mma`, UTC datetime
combinations, number patterns such as `fixed:1`, and primitive text conversion.
Unsupported patterns produce `ADL_PRESENTATION_FORMAT_UNSUPPORTED` diagnostics
and fall back to raw values where possible.

## Open Questions

- Should shell declarations be global, view-scoped, or both?
- Should icon names be restricted to a standard set at compile time?
- Should date/time format strings use a single ADL-supported pattern language
  across runtimes?
- Should view-local state be persisted per device, per user, or only in memory?
- How much conditional logic should be allowed in row templates before it
  becomes a computed/read-model concern?
- Should `RENDER_AS` values be standardized, or should they be theme/runtime
  extension points?
