# ADL Language Specification

ADL source is the author-facing syntax for producing a partial application
model. Runtime services do not consume this syntax directly; `compileAdl`
parses source, resolves defaults, validates the resolved model, and returns the
same resolved-model contract that JSON fixtures use.

## Syntax Shape

The current parser is line-oriented and block-based. Top-level declarations use
uppercase keywords and explicit `END.*` block terminators.

- `APP Name` declares the application. `START_VIEW` may name the initial view,
  and `OFFLINE_GRACE` may declare the offline sync grace (see
  [Application Declaration](#application-declaration)).
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

## Application Declaration

```text
APP 'Giggle Band ADL Example'
  MODEL_VERSION '1.0.0'
  THEME CorporateLight
  START_VIEW HomeDashboard
  OFFLINE_GRACE 30 DAYS
END.APP
```

- `MODEL_VERSION` declares the model's version as a quoted dotted number of up
  to four components (`1`, `1.2`, `1.2.3`). It defaults to `0.1.0`. It is
  quoted and read as text rather than as a number, because `1.1.0` is not a
  number a lexer can carry intact. See
  [Model Versions And Migrations](#model-versions-and-migrations).
- `THEME` names the application theme. It defaults to `CorporateLight`.
- `START_VIEW` names the initial view. It defaults to the first resolved object
  view.
- `OFFLINE_GRACE <days> DAYS` declares how long a device may keep syncing since
  its last successful authentication to the authority before a fresh logon is
  required. It defaults to `30 DAYS`. The unit word is required, so a bare
  number can never be read as the wrong unit if another unit is added later.

`OFFLINE_GRACE` is a **sync-policy** declaration, not an identity one. ADL
already models sync mode, conflict policy and offline dataset windows, and this
belongs in that family; it never declares how a credential is verified, which
remains deployment configuration. Three properties follow from that and are part
of the language contract:

- It gates **sync only**. Local reads and local-first writes work offline
  indefinitely, inside the grace and outside it.
- It is a **maximum, never a minimum**. Revoking a session or a membership takes
  effect on the device's next contact regardless of how much grace remains.
- The **authority is the enforcement point**. It loads the same resolved model
  and derives its session lifetime from this value, so a client that skips its
  own grace check gains nothing.

The value must be a whole number of days between 1 and 365; anything else is the
`ADL_APP_OFFLINE_GRACE_INVALID` diagnostic rather than a silent fallback to the
default. Changing it changes the resolved model, so it is a model version change
and passes through the startup compatibility guard like any other.

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
- `STATUS name LABEL 'Label' ARIA_LABEL 'Accessible label' ICON iconRef
  THEME colorStatusEvent PRECEDENCE 10`
- `STATUS_MAP Name FOR Field ... END.STATUS_MAP`
- `LEGEND Name TITLE 'Title' STATUSES statusName ...`
- `SECTION Name ... END.SECTION`

Sections may declare `HEADING`, local layout/density hints, `TOGGLE` controls,
and `LIST` blocks. Lists bind to an object or read model and support `ORDER BY`,
`WHERE`, `RENDER_AS`, `DENSITY`, `EMPTY_TEXT`, repeatable `STATUS` candidates,
and a `ROW` template.

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

  STATUS event LABEL 'Gig' ARIA_LABEL 'Gig event' ICON EventTypeIcon(Gig) THEME colorStatusEvent PRECEDENCE 10
  STATUS rehearsal LABEL 'Rehearsal' ARIA_LABEL 'Rehearsal event' ICON EventTypeIcon(Rehearsal) THEME colorStatusRehearsal PRECEDENCE 10
  STATUS unavailable LABEL 'Unavailable' ARIA_LABEL 'Unavailable block' ICON EventTypeIcon(Unavailable) THEME colorStatusUnavailable PRECEDENCE 20

  STATUS_MAP EventTypeStatus FOR EventType
    Gig -> event
    Rehearsal -> rehearsal
    Unavailable -> unavailable
  END.STATUS_MAP

  LEGEND ScheduleStatus TITLE 'Schedule status' STATUSES event rehearsal unavailable

  SECTION Schedule
    HEADING 'Schedule'

    LIST UpcomingEvents FROM HomeUpcomingEvents
      ORDER BY EventDate ASC, StartTime ASC
      WHERE (EventType == 'Gig' AND showGigs == true) OR (EventType == 'Rehearsal' AND showRehearsals == true) OR (EventType == 'Unavailable' AND showUnavailable == true)
      RENDER_AS compactFeed
      EMPTY_TEXT 'No upcoming events'
      STATUS EventTypeStatus(EventType)

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
earlier step records. Steps are ordered, so later steps may reference earlier
step fields or metadata such as generated record ids.

Commands remain model data; runtime services execute them. They describe a
business action and its affected records, not UI scripts, generated application
code, SQL transactions, or browser-only orchestration.

## Model Versions And Migrations

A model declares its version with `MODEL_VERSION` in the `APP` block, and
declares how persisted data reaches that version with top-level `MIGRATION`
blocks:

```text
MIGRATION FROM '1.0.0' TO '1.1.0'
  OBJECT Gig
    SCHEMA_VERSION 2
    RENAME FIELD Venue TO VenueName
    ADD FIELD PayoutCents DEFAULT 0
    DROP FIELD LegacyNote
  END.OBJECT
END.MIGRATION
```

A migration declares one version hop. Several hops chain: data at `1.0.0` opened
by a `1.2.0` model applies `1.0.0 -> 1.1.0` and then `1.1.0 -> 1.2.0`. When more
than one route forward is declared, the shortest is taken, so a long-way-round
chain kept for old installs does not also apply to a recent one.

The whole step vocabulary is `RENAME FIELD … TO …`, `ADD FIELD … DEFAULT …`,
`DROP FIELD …`, and a per-object `SCHEMA_VERSION`. Every step is total: it
cannot fail on a well-formed record. `DEFAULT` on `ADD FIELD` is required rather
than optional, because a record that silently gained `null` where the model says
the field is required would fail validation on its next write.

A migration is a **persistence** declaration, not a storage one. It never
mentions SQL, tables, indexes or storage engines: the authority's own projection
tables are migrated out of band through ordered SQL files, which are not part of
this language and never will be. What a `MIGRATION` block describes is the shape
of a record, which is the only thing every conforming runtime has in common.

Declaring a version is not the same as proving one. See
[resolved-model#model-versions-and-migrations](resolved-model.md) for the
fingerprint that makes an undeclared content change visible, and
[runtime-semantics#model-migration](runtime-semantics.md) for what a runtime does
with persisted data at an earlier version.
