# ADL Language Specification

ADL source is the author-facing syntax for producing a partial application
model. Runtime services do not consume this syntax directly; `compileAdl`
parses source, resolves defaults, validates the resolved model, and returns the
same resolved-model contract that JSON fixtures use.

## Syntax Shape

The current parser is line-oriented and block-based. Top-level declarations use
uppercase keywords and explicit `END.*` block terminators.

- `APP Name` declares the application. `START_VIEW` may name the initial view.
- `SHELL ... END.SHELL` declares application shell navigation and top-bar
  controls.
- `ROLE Name` declares an application role.
- `CONTEXT Name` declares a business context, optional selection behavior, and
  optional membership object mapping.
- `OBJECT Name` declares fields, computed fields, object validations,
  scopes, constraints, lifecycles, and views.
- `POLICY Name ON Object` declares policy rules for one object.
- `THEME Name BASE BuiltInTheme` declares token overrides.
- `READ_MODEL Name` declares backend-neutral read-model sources, output fields,
  expression fields, and sort order.
- `DECISION_TABLE Name ON Object` declares object-scoped decision-table inputs,
  rows, outputs, and optional defaults.
- `COMMAND Name` declares model-driven command inputs, preconditions, and create
  or update steps.

Unsupported procedural or host-code syntax is rejected. ADL source does not
contain SQL, Dart, Flutter, Elixir, LiveView, loops, arbitrary host functions, or
storage-engine declarations.

Apps may list multiple ordered source files in `app.yaml`. The compiler reads
them in manifest order. Later object declarations that contain only `VIEW`
blocks extend the earlier object declaration, which allows UI source such as
`ui.adl` to live beside domain source without redefining fields or policies.

## Objects And Fields

Objects contain business fields. Field syntax supports text, number, date,
datetime, time, boolean, and attachment types. A field may be `REQUIRED`, have a
literal `DEFAULT`, validators, lookup metadata, and author-facing display or key
roles through the resolved model.

Objects can declare business context scope and backend-neutral constraints:

```adl
SCOPE Band FIELD Band
CONSTRAINT uniqueSongTitleInBand UNIQUE SCOPE Band FIELDS Title
CONSTRAINT orderedSetListItems ORDERED SCOPE Band PARENT SetList POSITION Position
```

The compiler maps these declarations to the resolved model; runtime services
enforce scope and constraints.

Computed fields are declared inside objects:

```adl
COMPUTED FIELD Gross NUMBER = UnitPrice * Quantity
```

Computed fields are runtime read-time fields. They are not persisted business
fields and are not writable.

## Expressions

The parser supports expressions in implemented semantic slots: predicate
validators, policy `WHEN` clauses, object validations, lifecycle guards,
decision-table inputs and rows, command preconditions, computed fields, and
read-model expression fields.

Implemented expression forms include literals, field references,
`runtime.userId`, `runtime.now`, unary `NOT` and numeric negation, binary
arithmetic, comparisons, boolean `AND`/`OR`, and null coalescing. The resolved
model stores expressions as structured trees.

## Policies

Policy rules are declared for a single object. Rules can allow, deny, readonly,
mask, or hide an action for principals. Principals can match everyone,
authenticated users, anonymous users, owners, specific users, roles, group
roles, or owner-as-specific.

Lifecycle transition policy can name an action and state. Field rules restrict
specific fields. Conditions compile to resolved expressions.

## Lifecycles

Objects may declare a lifecycle with states and actions. A lifecycle action
declares source states, a target state, optional guards, optional policy
references, and optional hook names. Hook names are references only; registered
runtime hooks decide behavior.

## Read Models

Read models declare named object sources and output fields. A field can project
from a source field or evaluate an expression over already-projected row values.
Read models are backend-neutral; they do not embed SQL or materialization
strategy.

Views and read models can declare context requirements:

```adl
VIEW BandEventList LIST
  CONTEXT REQUIRED Band
  FIELDS Date Title Status
END.VIEW

READ_MODEL HomeUpcomingEvents
  CONTEXT ALL Band
  SOURCE event OBJECT Event SCOPE allAvailableContexts
END.READ_MODEL
```

Generic CRUD views also resolve an `editContainer` hint with values `modal`,
`drawer`, `page`, or `splitPane`. This is currently supported in
JSON/TypeScript partial models and resolved-model fixtures, not ADL source
syntax. In source-authored apps, normal object lists therefore use the platform
default `modal` container until explicit syntax is added.

## Composed View Presentation

Views may include renderer-neutral presentation declarations. Presentation is
resolved onto `ResolvedView.presentation`; runtime services still consume the
resolved model, not parser AST nodes.

Implemented view-level declarations:

- `LAYOUT stack|grid|split|sidebar`
- `DENSITY compact|comfortable|spacious`
- local `STATE Name Type DEFAULT Literal`
- `ICON_MAP Name FOR Field ... END.ICON_MAP`
- `SECTION Name ... END.SECTION`

Sections may declare `HEADING`, local layout/density hints, `TOGGLE` controls,
and `LIST` blocks. Lists bind to an object or read model and support `ORDER BY`,
`WHERE`, `RENDER_AS`, `DENSITY`, `EMPTY_TEXT`, and a `ROW` template.

```adl
VIEW HomeDashboard DASHBOARD
  READ_MODEL HomeUpcomingEvents
  LAYOUT stack
  DENSITY compact
  STATE showGigs BOOLEAN DEFAULT true
  STATE showRehearsals BOOLEAN DEFAULT true
  STATE showUnavailable BOOLEAN DEFAULT true

  ICON_MAP EventTypeIcon FOR EventType
    Gig -> music
    Rehearsal -> microphone
    Unavailable -> x
  END.ICON_MAP

  SECTION Schedule
    HEADING 'Schedule'

    LIST UpcomingEvents FROM HomeUpcomingEvents
      ORDER BY EventDate ASC, StartTime ASC
      WHERE (EventType == 'Gig' AND showGigs == true) OR (EventType == 'Rehearsal' AND showRehearsals == true) OR (EventType == 'Unavailable' AND showUnavailable == true)
      RENDER_AS compactFeed
      EMPTY_TEXT 'No upcoming events'

      ROW
        ICON EventTypeIcon(EventType)
        TEXT EventDate FORMAT date 'EEE d MMM'
        TEXT ' '
        TEXT StartTime FORMAT time 'h:mma'
        TEXT ' - '
        TEXT Title STYLE bold
        TEXT ' - '
        TEXT VenueName
      END.ROW
    END.LIST
  END.SECTION
END.VIEW
```

Presentation syntax remains declarative. It does not allow raw CSS, raw SVG,
framework component names, procedural render loops, or host functions.

## Shell Navigation

The parser supports a global `SHELL` block for renderer-neutral application
navigation and top-bar controls. Shell declarations resolve to top-level
`ResolvedApplicationModel.shell` metadata; browser runtimes do not read ADL
syntax directly.

```adl
SHELL
  NAV HomeDashboard LABEL 'Home' ICON home GROUP Main ORDER 10
  NAV BandEventList LABEL 'Gigs' ICON calendar GROUP Main ORDER 20
  NAV MyAvailabilityList LABEL 'Availability' ICON calendar GROUP Main ORDER 30 VISIBLE WHEN CONTEXT Band SELECTED
  CONTROL contextSelector KIND contextSelector PLACEMENT topBar
  CONTROL syncStatus KIND syncStatus PLACEMENT topBar VISIBLE ONLINE
  TOP_BAR CONTEXT_SELECTOR topBar MOBILE_CONTEXT_SELECTOR sheet CONTROLS contextSelector syncStatus
END.SHELL
```

`NAV` entries target resolved views. Supported nav metadata includes `LABEL`,
semantic `ICON`, `GROUP`, numeric `ORDER`, optional `ACTIVE_WHEN` view names,
and `VISIBLE` conditions. Implemented visibility conditions are `ALWAYS`,
`ONLINE`, `OFFLINE`, `WHEN CONTEXT Name AVAILABLE`, and `WHEN CONTEXT Name
SELECTED`.

`CONTROL` entries support optional `LABEL`, semantic `ICON`, `PLACEMENT`, and
`VISIBLE` metadata. Implemented control kinds are `contextSelector`,
`syncStatus`, `themeSwitch`, `logout`, and `pwaInstall`; unsupported runtime
capabilities degrade as unavailable controls. `TOP_BAR` declares context
selector placement, mobile context selector behavior (`dropdown` or `sheet`),
and the ordered top-bar control list.

ADL source syntax for view-local `SELECT`, `ACTION`, and `CONTEXT_SELECTOR`
presentation controls is not implemented. Those control shapes exist in the
resolved model for JSON/TypeScript partial models and future parser work.

## Commands

Commands declare typed inputs, command-level preconditions, and create/update
steps. Step values can come from literals, command input, runtime values, or
earlier step records. Commands remain model data; runtime services execute them.
