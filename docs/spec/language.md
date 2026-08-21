# ADL Language Specification

ADL source is the author-facing syntax for producing a partial application
model. Runtime services do not consume this syntax directly; `compileAdl`
parses source, resolves defaults, validates the resolved model, and returns the
same resolved-model contract that JSON fixtures use.

This document covers `.adl` text. A JSON-encoded alternative,
`.adlj`, shares the same resolve/validate pipeline and is documented
separately in [adlj.md](adlj.md).

## `.adlj` Is the Primary Authoring Surface

**New ADL application content — a reference app, an example fixture, a spec
example, anything generated rather than hand-typed by a person sitting at a
keyboard — should be authored as `.adlj`, not as `.adl` text.** The author is
overwhelmingly an LLM writing to a JSON Schema; `.adlj`'s JSON Schema
(`src/model/adlj-schema.json`) validates structure before the ADL compiler
ever runs, the way this grammar's keyword syntax cannot. `.adl` text's role
is the _derived_, human-reviewable, diffable read surface — rendered from an
authored `.adlj` document by `printPartialApplicationModelAsAdl`
(`src/compiler/print-adl.ts`) — not a source of truth to hand-write for new
work. The two are not equally-weighted alternatives: an `.adl` file with no
`.adlj` behind it is fine for something a human is genuinely hand-editing
(this specification's own inline examples, a narrow fixture where JSON would
be pure overhead), but new application content defaults to `.adlj` unless
there is a specific reason not to.

This document (the grammar/semantics reference) still describes what every
construct _means_ — an `.adlj` document resolves to exactly the same grammar
and runtime semantics this file documents, just JSON-shaped instead of
keyword-shaped. For the JSON format itself — the top-level document shape,
how each construct below maps into JSON, how expressions are represented, and
a worked example — see [adlj.md](adlj.md), specifically its "Authoring a
`.adlj` document from scratch" section.

### Reference-app examples are quoted, not cited by line

Where this document illustrates a construct with real content, the example is
quoted here in full and attributed by **construct name** to the file that
declares it — `src/reference/giggle-band/domain.adlj` or `ui.adlj`, the
application's real compiled source (`app.yaml` lists exactly those two). No
example cites a line number.

That is a deliberate change, made in Phase 98. Until then these examples cited
exact lines in `src/reference/giggle-band/domain.adl` and `ui.adl`, a text
snapshot of the same application kept beside the `.adlj` source. Every one of
those line numbers resolved, and the citations were still wrong: the snapshot
had frozen at model version 1.0.0 while the application reached 1.9.0, so the
prose around each citation described a release nobody was running. A line
number is only ever a citation into a file's _current_ bytes, and no checker
can tell you that the bytes it lands on stopped being true. The snapshot was
deleted; the examples stayed, quoted where you can read them.

Two limits on reading any example here as the whole truth about the app.
`.adl` text is the printed, human-readable view of `.adlj`, and that view is
not yet complete: some constructs the reference app declares have no ADL text
syntax at all — a calendar's `conflictOverlay`, and a child collection's
`projectedFields` and `summary` — so `print-adl.ts` refuses to render Giggle
Band, and no `.adl` text, here or anywhere, says everything its `.adlj` says
(see [adlj.md](adlj.md)). And an example trimmed for focus says so where it is
trimmed. For what the running application declares today, read the `.adlj`.

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
- `CONTEXT_GRANT Name ON Context` declares a route into a context that is not
  membership.
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
Giggle Band's `ui.adlj` to live beside domain source without redefining fields
or policies.

## Deprecated Spellings

Phase 72 found several places where the grammar accepted more than one legal
spelling for the same construct, with no rule for which one an author should
reach for — a fact to memorize rather than infer, for no benefit. Each pair now
has exactly one canonical spelling, picked by whichever the reference app and
conformance corpus already predominantly used. The deprecated spelling still
parses — no existing `.adl` file needs to change to keep compiling — but
`compileAdl` reports a warning-severity `ADL_STYLE_DEPRECATED_SPELLING`
diagnostic naming the deprecated spelling and its canonical replacement. This
is a parser-level fact with no representation on the resolved model, so it
never appears for a model built from JSON (a hand-built `PartialApplicationModel`,
or the `.adlj` format) — there is no spelling to have gotten wrong.

| Construct                                                                                                                                                                                                                                                                                                                        | Canonical              | Deprecated                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------- |
| Field validator                                                                                                                                                                                                                                                                                                                  | `VALIDATE`             | `PREDICATE`                     |
| Policy rule channel list                                                                                                                                                                                                                                                                                                         | `CHANNELS`             | `CHANNEL`                       |
| Policy rule field list                                                                                                                                                                                                                                                                                                           | `FIELDS`               | `FIELD`                         |
| Policy principal role list                                                                                                                                                                                                                                                                                                       | `ROLE`                 | `ROLES`                         |
| Policy principal group-role list                                                                                                                                                                                                                                                                                                 | `GROUP_ROLE`           | `GROUP_ROLES`                   |
| Policy principal user list                                                                                                                                                                                                                                                                                                       | `USER`                 | `USERS`                         |
| `ACTION ALLOW` role list                                                                                                                                                                                                                                                                                                         | `ROLE`                 | `ROLES`                         |
| `ACTION` policy reference list                                                                                                                                                                                                                                                                                                   | `POLICY`               | `POLICIES`                      |
| `CONSTRAINT UNIQUE` field list                                                                                                                                                                                                                                                                                                   | `FIELDS`               | `FIELD`                         |
| `CONTEXT MEMBERSHIP` context field                                                                                                                                                                                                                                                                                               | `CONTEXT_FIELD`        | `CONTEXT`                       |
| `CONTEXT MEMBERSHIP` role field                                                                                                                                                                                                                                                                                                  | `ROLE_FIELD`           | `ROLE`                          |
| `CONTEXT_GRANT` context field                                                                                                                                                                                                                                                                                                    | `CONTEXT_FIELD`        | `CONTEXT`                       |
| `DECISION_TABLE INPUT` binder                                                                                                                                                                                                                                                                                                    | `=`                    | `FROM`                          |
| `COMPUTED FIELD` binder                                                                                                                                                                                                                                                                                                          | `=`                    | `AS`                            |
| `READ_MODEL FIELD` expression binder                                                                                                                                                                                                                                                                                             | `=`                    | `AS`                            |
| `COMMAND STEP` record identity header                                                                                                                                                                                                                                                                                            | `ID`                   | `RECORD`                        |
| `COMMAND STEP` value directive                                                                                                                                                                                                                                                                                                   | `VALUE`                | `SET`, `PATCH`                  |
| `COMMAND STEP` iteration clause                                                                                                                                                                                                                                                                                                  | `FOR EACH` (two words) | `FOR_EACH` (one word)           |
| Every `X_Y` keyword's dotted spelling — `AUTO_ID`, `MODEL_VERSION`, `SCHEMA_VERSION`, `ACTIVE_WHEN`, `READ_MODEL`, `ARIA_LABEL`, `RENDER_AS`, `DATE_FIELD`, `TITLE_FIELD`, `SUMMARY_FIELDS`, `MONTH_STATE`, `WEEK_START`, `CONTEXT_MEMBER`, `TOP_BAR`, `NAV_DRAWER`, `CONTEXT_GRANT`, `ICON_MAP`, `STATUS_MAP`, `DECISION_TABLE` | the underscore form    | the dotted form, e.g. `AUTO.ID` |

A modifier value's parentheses (`MIN(0)`, `DEFAULT('Draft')`, an `ACTION FROM`
state list) are a different kind of fix and are **not** in this table: a bare
value is a parse error now, not a warning. See "Field Validators" below for
why the two are treated differently. `DECISION_TABLE ROW`'s `WHEN` is the same
kind of hard requirement — see "Decision Tables" below — because every real
`ROW` already wrote it, so making it required broke nothing.

## Application Declaration

```text
APP 'Giggle Band ADL Example'
  MODEL_VERSION '1.0.0'
  THEME CorporateLight
  START_VIEW HomeDashboard
  OFFLINE_GRACE 30 DAYS
  REGISTRATION SELF_SERVICE
END.APP
```

- `MODEL_VERSION` declares the model's version as a quoted dotted number of up
  to four components (`1`, `1.2`, `1.2.3`). It defaults to `0.1.0`. It is
  quoted and read as text rather than as a number, because `1.1.0` is not a
  number a lexer can carry intact. See
  [Model Versions And Migrations](#model-versions-and-migrations).
- `THEME` names the application theme. It defaults to `CorporateLight`. Three
  built-in themes ship and are always selectable by name, whether or not a
  model declares one of its own: `CorporateLight` (light, blue primary and
  green accent — the default), `CorporateDark` (the same palette intent
  inverted for a dark background), and `MinimalLight` (light, a neutral
  near-black primary and teal accent, smaller corner radius, compact density,
  and top navigation instead of side). `THEME Name BASE <BuiltIn> ...
END.THEME` overrides individual tokens on top of one of these three.
- `START_VIEW` names the initial view. It defaults to the first resolved object
  view.
- `OFFLINE_GRACE <days> DAYS` declares how long a device may keep syncing since
  its last successful authentication to the authority before a fresh logon is
  required. It defaults to `30 DAYS`. The unit word is required, so a bare
  number can never be read as the wrong unit if another unit is added later.
- `REGISTRATION SELF_SERVICE | INVITE_ONLY` declares whether the application
  admits people nobody invited. See
  [Self-Service Registration](#self-service-registration).

`OFFLINE_GRACE` is a **sync-policy** declaration, not an identity one. ADL models
sync mode, conflict policy and offline dataset scope in the same family — see
[Offline Dataset Scope](#offline-dataset-scope) — and this belongs with them; it
never declares how a credential is verified, which remains deployment
configuration. Three properties follow from that and are part of the language
contract:

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

### Self-Service Registration

```text
APP 'Giggle Band ADL Example'
  REGISTRATION SELF_SERVICE
END.APP
```

`REGISTRATION` takes exactly one of two bare words, both underscore-only:

- `SELF_SERVICE` — a person who was never invited may obtain an identity
  through the product's own registration ceremony.
- `INVITE_ONLY` — registration requires either an existing session (adding
  another authenticator to an identity that already exists) or a valid
  invitation.

**Absence means `INVITE_ONLY`.** The resolver deliberately omits the key rather
than materialising a default, so a model that says nothing resolves to exactly
the model it resolved to before this construct existed — same JSON, same
`modelFingerprint`. Consumers must read absence as the restrictive value.

Like `OFFLINE_GRACE`, this is a declaration about what the application _is_,
and the **authority is the enforcement point**. Three properties are part of
the language contract:

- **The model is the ceiling.** A deployment control
  (`ADL_SELF_SERVICE_REGISTRATION`, accepting `model` or `off`) may only ever
  _restrict_ what the model declared. There is deliberately no value of any
  environment variable that turns self-service on for a model that did not
  declare it: an operator opening an application whose model says invite-only
  would grant a capability the application never declared, and would do so
  where nothing in the model records it.
- **It is meaningful only where there is a registration ceremony.** The
  authority's `passkey` identity mode is the only one that has one; in
  `bypass` and `upstream` an identity is minted from an account proof and the
  declaration resolves to `false`.
- **A self-registered identity holds nothing.** It carries no membership and
  therefore no context role. Whether it can then create anything of its own is
  a question the model's own policies answer — which is why
  `ADL_APP_SELF_SERVICE_REGISTRATION_UNREACHABLE` (warning) fires when a model
  declares `SELF_SERVICE` and no policy grants `create` to an `authenticated`
  or `everyone` principal on any object a business context is bound to. Such
  an application admits strangers into an empty room.

An application whose `User`-shaped object exposes anything more sensitive than
a display name to the `AUTHENTICATED` principal should not declare
`SELF_SERVICE`: after this declaration, "authenticated" no longer implies
"somebody already inside vouched for them". The platform does not check what a
model's policies expose.

Changing the declaration changes the resolved model, so it is a model version
change and passes through the startup compatibility guard like any other.

## Objects And Fields

Objects contain business fields. Field syntax supports text, number, date,
datetime, time, boolean, and attachment types. A field may be `REQUIRED`, have a
literal `DEFAULT`, validators, lookup metadata, and author-facing display or key
roles through the resolved model.

An object-level `KEY <field>` and `DISPLAY <field>` name that object's business
key and display field respectively:

```adl
OBJECT SetList
  DISPLAY Name
  FIELD Name TEXT REQUIRED
  ...
END.OBJECT
```

**Both must name a stored `FIELD`, never a `COMPUTED FIELD`.** Model validation
resolves `KEY` and `DISPLAY` against the object's own `fields` list only, not
its `computedFields` (`ADL_OBJECT_DISPLAY_FIELD_UNKNOWN` for `DISPLAY`, the
equivalent check for `KEY`), so naming a computed field is refused at compile
time the same way naming a field that does not exist at all is. A `DISPLAY
Email ?? Name`-shaped fallback has to be modelled as a plain stored field —
`DISPLAY` cannot point at a `COMPUTED FIELD` (see below) that derives one.

### Field Validators

A field may declare one or more validators after its type and `REQUIRED`/
`DEFAULT`:

```adl
FIELD Email TEXT EMAIL
FIELD Age NUMBER MIN(0) MAX(150)
FIELD Name TEXT MIN_LENGTH(2) MAX_LENGTH(120)
FIELD Status TEXT IN ('Draft', 'Active', 'Closed')
FIELD Code TEXT REGEXP('^[A-Z]{3}$')
FIELD Currency TEXT CURRENCY_CODE
FIELD Attachment ATTACHMENT MAX_SIZE(5000000)
FIELD EndDate DATE VALIDATE EndDate >= StartDate MESSAGE 'End date must be on or after the start date.'
```

This block is illustrative, gathering every validator kind in one place. Giggle
Band exercises several of them directly and unmixed with the others: `EMAIL` on
`User.Email` and `BandInvitation.InviteeEmail`, `MIN` on `Event.Amount`, `IN`
on `Event.EventType`, and `REGEXP` on `Band.Facebook` — all in
`src/reference/giggle-band/domain.adlj`. `MIN_LENGTH`, `MAX_LENGTH`,
`CURRENCY_CODE`, `MAX_SIZE`, and the field-level `VALIDATE` form are not
exercised anywhere in the reference app and are shown here only to document
that the syntax exists.

- `EMAIL` (text) checks the value is shaped like `local@domain.tld`; it is not
  full RFC 5322 validation.
- `MIN(<n>)` / `MAX(<n>)` apply to `NUMBER` fields only (not date or datetime)
  and bound the value inclusively.
- `MIN_LENGTH(<n>)` / `MAX_LENGTH(<n>)` (text) bound a string's character
  length inclusively.
- `IN (<values>, ...)` (text, number, or boolean) restricts the value to the
  given literal set. Like every other validator's value, its own value is
  always a parenthesised, comma-separated list — the parentheses are not
  optional here, and never have been.
- `REGEXP(<pattern>)` (text) tests the value against `pattern` using
  JavaScript `RegExp` semantics with no flags. The pattern's own syntactic
  validity is not checked until a value is evaluated against it at runtime.
- `CURRENCY_CODE` (text, no value) checks the value is three uppercase
  letters; it does not check membership in an actual ISO 4217 list.
- `MAX_SIZE(<n>)` (attachment) bounds an approximate size of the field's
  stored value.
- `MIME_TYPE (<values>, ...)` (attachment) restricts an attachment to the
  given set of allowed MIME types. Like `IN`, its value is always a
  parenthesised, comma-separated list — even a single allowed type needs the
  parentheses: `MIME_TYPE ('application/pdf')`.
- `VALIDATE <expression> [MESSAGE '<text>']` runs an [expression](#expressions)
  over the object's own fields and `RUNTIME.userId` / `RUNTIME.now`. Unlike an
  object `VALIDATE`/`VALIDATION` declaration, the field-level form takes no
  name — the keyword is followed directly by the expression. The expression
  must resolve to boolean (`ADL_FIELD_VALIDATOR_EXPRESSION_TYPE` otherwise).
  `MESSAGE` supplies the runtime failure text and defaults to a generic
  message naming the field when omitted. `PREDICATE <expression>` is the exact
  same clause, kept as a deprecated spelling — see "Deprecated spellings"
  below.

Model validation checks every named validator's kind against the field's type
and checks that a value it needs is present and the right JSON shape
(`ADL_FIELD_VALIDATOR_KIND_INVALID`, `ADL_FIELD_VALIDATOR_VALUE_INVALID`) —
this is why a validator that could never fire, such as `MIN` on a text field,
is refused rather than silently accepted.

**Parentheses are mandatory, not optional grouping.** `MIN`, `MAX`,
`MIN_LENGTH`, `MAX_LENGTH`, `MAX_SIZE`, `REGEXP`, `DEFAULT`, `AUTO_ID PREFIX`,
`AUTO_ID PAD`, a `MIGRATION ADD FIELD`'s `DEFAULT`, a presentation `STATE`'s
`DEFAULT`, and a `COMMAND INPUT`'s `DEFAULT` all take their value
parenthesised — `MIN(0)`, not `MIN 0` — joining `IN(...)`/`MIME_TYPE(...)`,
whose value was always a parenthesised list. A bare value is a parse error
(`ADL_PARSE_EXPECTED_TOKEN`), not a deprecated spelling: unlike the alias pairs
below, the two shapes were never accepted side by side once this rule shipped
(Phase 72), so there is no warning-and-still-compiles path for it. The same
rule applies to an `ACTION FROM` state list — `FROM (Draft)`, not
`FROM Draft` — for the same reason `IN`/`MIME_TYPE` always required
parentheses: a bare, unparenthesised list has no unambiguous end.

### Field Modifiers

```adl
FIELD PONumber TEXT REQUIRED AUTO_ID PREFIX('PO-') PAD(6)
FIELD InternalNotes TEXT READONLY
FIELD LegacyId TEXT HIDDEN
```

- `READONLY` refuses any direct write that supplies a value for the field, on
  create as well as on update (`ADL_RUNTIME_FIELD_READONLY`). Its value can
  only come from a `DEFAULT`, a computed field, or other system-managed logic
  — never from caller-supplied input.
- `HIDDEN` omits the field from anything a read returns to the caller. This is
  unconditional, unlike a policy rule's `HIDDEN` effect, which hides a field
  only for the principals and conditions that rule names.
- `AUTO_ID`, together with any of `PREFIX '<text>'`, `PAD <n>`, and `SCOPE
<field>` (each optional, in any order), marks a text field as one whose
  value is minted rather than authored: `PREFIX` declares a literal prefix and
  `PAD` a zero-padded numeric width for the minted value, and `SCOPE <field>`
  names another field on the same object the minted sequence is meant to be
  scoped within, such as a per-branch invoice sequence instead of one global
  one. `AUTO_ID` is refused on a non-text field (`ADL_AUTO_ID_NON_TEXT`), and
  `SCOPE` is refused naming a field that does not exist on the object
  (`ADL_AUTO_ID_SCOPE_FIELD_UNKNOWN`).

  **How minting works (Phase 74).** `ObjectStore.planCreateForTransaction`
  mints the value on every create — direct `create` calls and every other
  write path that plans a create (command `CREATE` steps included) — right
  after ordinary `DEFAULT`s are applied and before the record is built. If the
  caller supplies an explicit value for the field, that value is used as-is
  and nothing is minted, the same way an explicit `_guid` overrides a minted
  one; this lets an import or migration author the field directly. Otherwise
  the runtime finds the object's existing records (including deleted ones, so
  a deleted record's number is never handed to a new record), narrows them to
  the same `SCOPE` value when one is declared, reads each candidate's own
  value for the field, strips a leading `PREFIX` match and parses the
  remaining digits, and mints one past the highest number it finds (starting
  at 1 if there is none). A value that does not start with `PREFIX` or whose
  remainder is not entirely digits is treated as foreign or hand-entered and
  ignored rather than letting it corrupt the sequence. Because a `DEFAULT`
  applies before minting runs and minting always overwrites it when the
  caller supplied nothing else, an `AUTO_ID` field no longer needs a
  `DEFAULT` — declaring one alongside `AUTO_ID` is harmless but has no
  effect on a normal create.

  **What minting does not do.** It is local best-effort, not a cross-device
  coordination protocol: two offline devices can each mint the same value for
  the same object (and the same `SCOPE`) before either syncs, because each
  device only ever sees its own storage. This is accepted, not a defect — it
  is the same optimistic-write philosophy every other offline write in this
  system already relies on, and the existing authority-side conflict/rejection
  machinery is the backstop, not a bespoke `AUTO_ID` mechanism. An author who
  needs a real collision caught rather than silently duplicated should pair
  `AUTO_ID` with `CONSTRAINT ... UNIQUE FIELDS <thatField>` (optionally
  `SCOPE`-qualified to match) on the same field, so the authority refuses the
  losing write on sync the same way it already refuses any other uniqueness
  violation.

Objects can declare business context scope and backend-neutral constraints:

```adl
SCOPE Band FIELD Band
CONSTRAINT uniqueSongTitleInBand UNIQUE SCOPE Band FIELDS Title
CONSTRAINT orderedSetListItems ORDERED SCOPE Band PARENT SetList POSITION Position REORDER shift COMPACT onDelete
CONSTRAINT lastBandAdminStanding PROTECTED_ROLE SCOPE Band FIELD Role VALUES ('BandAdmin') MIN(1)
```

The compiler maps these declarations to the resolved model; runtime services
enforce scope and constraints.

An `ORDERED` constraint accepts `MIN <n>`, `REORDER strict|shift`, and
`COMPACT none|onDelete`. Both modes default to the behaviour that shipped before
they existed — refuse a duplicate position, keep the gap a removal leaves — so
adding them changes nothing an existing model does.

`REORDER shift` makes a collection reorderable: a write landing on an occupied
position moves the intervening siblings in the same transaction instead of being
refused, in whichever direction the move requires, stopping at the first free
slot so an existing gap absorbs the shift rather than being pushed ahead of it.
`COMPACT onDelete` renumbers later siblings down when an item is removed.

Neither introduces a new operation: a reorder is ordinary updates and a
compacting delete is a delete plus updates, so both replay through the authority
unchanged. Every generated sibling write faces the same policy, validation, scope
and sync checks as an authored one — a sibling the caller may not write fails the
whole transaction rather than moving silently. Because more than one write is
involved, a model that opts into either mode requires a storage backend that
supports transactions; a backend that does not refuses before anything persists.

A `PROTECTED_ROLE` constraint is the "last admin standing" guard: it refuses a
delete or an update that would leave fewer than `MIN` active records whose
`FIELD` holds one of the `VALUES` within the same `SCOPE` key. `SCOPE` may name
more than one field, or none at all to guard the whole object as a single scope.
`VALUES` takes one or more literals, so more than one role may share the guard —
demoting between two guarded values (`Admin` to `Owner`, say, when both are
declared) satisfies it, because the scope's guarded count does not change.
`MIN` defaults to `1` when omitted.

Declared once on a membership-shaped object — `BandMember`'s `Role` field going
from `BandAdmin` to `BandMember` is the motivating case — it is enforced by
every write path that reaches the object's constraints: direct CRUD and command
steps alike, never only a client-side affordance disabling a button. A create
can never trigger it, since a create only adds a record; an update or delete
that never held a guarded value has nothing to protect, and a scope that
already holds fewer than `MIN` before the write is not retroactively repaired.

## Offline Dataset Scope

An object's `SYNC` declaration says how its records reach the authority and which
of them a device keeps offline:

```adl
SYNC LOCAL_FIRST SCOPE currentContext
SYNC LOCAL_FIRST SCOPE recent WINDOW Date 90 DAYS LIMIT 200
SYNC LOCAL_FIRST SCOPE custom WHERE Status == 'open' AND Owner == RUNTIME.userId
SYNC ONLINE_REQUIRED SCOPE currentContext CONFLICT serverWins
```

The first line matches, verbatim, the `SYNC` declaration on each of `Song`,
`SetList`, `SetListItem`, and `StreamingLink` in
`src/reference/giggle-band/domain.adlj`. The fourth line's `SCOPE
currentContext` portion matches `BandInvitation`'s, which is
`ONLINE_REQUIRED` and does not itself declare `CONFLICT`. Giggle Band uses only `currentContext`,
`currentUser`, and `allAvailableContexts` for `SCOPE`, so `recent` and
`custom` above are shown synthetically — they are legal syntax the reference
app has no occasion to use.

`MODE` may be written before the mode word for readability. The mode is one of
`LOCAL_FIRST`, `CACHE_READONLY`, `ONLINE_REQUIRED` and `LOCAL_PRIVATE`; it
decides writes and delivery, not dataset membership, and is specified under
[Sync Modes](runtime-semantics.md#sync-modes). `CONFLICT` names the conflict
strategy. Everything else on the line decides what a device holds.

`SCOPE` is one of `all`, `currentUser`, `assignedToUser`, `ownedByUser`,
`currentContext`, `allAvailableContexts`, `recent` and `custom`. It defaults to
`all`. What each one selects is specified under
[Offline Datasets](runtime-semantics.md#offline-datasets).

`SCOPE` says which records a device keeps; `WINDOW` and `WHERE` say how much of
them. They are independent, so either may accompany any scope and both may
accompany the same one:

```text
SYNC LOCAL_FIRST SCOPE currentUser WINDOW Date 90 DAYS LIMIT 400
SYNC LOCAL_FIRST SCOPE currentContext WHERE Status == 'open'
SYNC LOCAL_FIRST SCOPE currentUser WINDOW SpentOn 30 DAYS WHERE Status == 'open'
```

The first line is `Availability`'s own declaration verbatim, in
`src/reference/giggle-band/domain.adlj`. The other two are illustrative:
Giggle Band's `SYNC` declarations never combine `WINDOW` with `WHERE`, and
none use `WHERE` at all, since the reference app has no `SCOPE custom`
declarations either.

When both are declared, both must pass.

`WINDOW` bounds how much of a scope a device keeps:

```text
WINDOW [<field>] [<days> DAYS] [LIMIT <count>]
```

Each part is optional and the order is fixed, but a `WINDOW` with no parts at all
is a parse error rather than a no-op. The field names a date or datetime field
and defaults to `_updatedAt`. The unit word after the day count is required, as
it is for `OFFLINE_GRACE`, so a bare number can never be read as the wrong unit
if another unit is ever added. `LIMIT` keeps that many records, newest first,
from among those already inside the day span.

`LIMIT` ranks an object's own selection: a record another route holds — a read
model sourcing the object across contexts — is not ranked against it and is not
evicted by it. The day span and the predicate bound every route.

`SCOPE recent` with no window resolves to 30 days over `_updatedAt`, which is
what a model that declares no window has always meant. It is the one scope that
_implies_ a window; every other scope bounds nothing unless the model says so.
The resolved window carries `windowSource: "impliedByScope"` for this implied
case and `"authored"` for a window the model actually wrote (Phase 72), so a
resolved model — or a human reading a dumped one — can tell which happened
without already knowing `recent`'s special case. See
[resolved-model.md](resolved-model.md).

`WHERE` gives a scope a predicate to select by, and gives `SCOPE custom` the one
it cannot do without:

```adl
SYNC LOCAL_FIRST SCOPE custom WHERE Status == 'open' AND Owner == RUNTIME.userId
```

It is an ordinary [expression](#expressions) over the object's own fields and
`RUNTIME.userId` / `RUNTIME.now`, not a second dialect, and it must resolve to
boolean. `SCOPE custom` without a predicate is a validation error: a declared
scope must be one the runtime can honour, and `custom` selects by a predicate and
by nothing else.

## Context Grants

A business context is normally reached through its `MEMBERSHIP` declaration.
`CONTEXT_GRANT` declares a second route, for the case where somebody must reach a
context _in order to_ join it:

```adl
CONTEXT_GRANT pendingBandInvitation ON Band OBJECT BandInvitation USER Invitee CONTEXT_FIELD Band WHEN Status == 'Pending'
```

`ON` names the business context, `OBJECT` the records that carry the grant,
`USER` the field naming the granted user, and `CONTEXT_FIELD` the field naming
the context instance (bare `CONTEXT` is the deprecated spelling — see
"Deprecated spellings" below). The optional `WHEN` clause is an expression
over the grant record and consumes the rest of the line.

A grant **confers no roles**. It only makes records of the granted `OBJECT` —
`BandInvitation` above, never `Band` itself — eligible for a policy decision;
the object's own policy still decides. Without it, an invitation scoped to
the very context it invites somebody into is refused upstream of policy
entirely, so a rule granting an invitee access to their own invitation can be
written and can never fire.

**The reach stops at the granted object; it never extends to the context's
own root/bound object.** `pendingBandInvitation` above puts `BandInvitation`
records in reach of a pending invitee's search/read checks; it confers
nothing that would let the same caller read the `Band` record the invitation
points at, because a grant is not a policy principal for "this context" the
way `CONTEXT_MEMBER` is a principal for "this object, via a context roster".
This matters most for a read model: a join from the granted object toward the
context's own object, evaluated for a grant-only caller, does not error — it
silently drops the row. `applyLookupJoinedSource`
(`src/runtime/read-model-service.ts`) reads the joined record through the
same policy path an unrelated `READ` would use, and a caller who may not read
it simply loses that row from the result, the same way a `READ`-denied lookup
target always has. A view built for exactly the grant-only caller (an
"invites addressed to me" list, for example) can lose every row this way with
no diagnostic anywhere — worth an explicit grant-only test case rather than
trusting the join to fail loudly if it is wrong.

Because a grant is not membership, a grant-holder is not a co-member of anyone —
they do not match the `CONTEXT_MEMBER` principal below and do not appear in
anyone else's roster.

Computed fields are declared inside objects:

```adl
COMPUTED FIELD Gross NUMBER = UnitPrice * Quantity
```

Computed fields are runtime read-time fields. They are not persisted business
fields and are not writable. A `KEY` or `DISPLAY` declaration (see "Objects
And Fields" above) can never name one — both resolve only against an object's
stored `FIELD`s.

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
authenticated users, anonymous users, owners, **the record that is the caller**
(`SELF`), specific users, roles, group roles, owner-as-specific, or **context
members**:

```adl
RULE allowBandMemberReadSharedAvailability ALLOW READ CONTEXT_MEMBER Band FIELD User
```

`CONTEXT_MEMBER <Context> FIELD <field>` matches when the named field on the
target record holds a user the caller shares an instance of that context with, by
membership. It says the thing neither `OWNER` nor a role can: `OWNER` covers the
caller's own records and a role covers everything of an object inside a context,
but a shared roster needs "this record belongs to somebody I am in a context
with". Writing that as a role would grant it over every record of the object,
including those belonging to people the caller shares nothing with.

Two properties are part of the contract:

- It **fails closed.** Membership resolution reads storage and policy evaluation
  does not, so the roster is resolved onto the runtime context beforehand. A
  missing roster never matches.
- It **cannot gate `search`.** The object-level search check is evaluated with no
  record, so there is nothing for the field to be read from. A policy rule
  granting `SEARCH` to a `CONTEXT_MEMBER` principal is refused at compile time
  (`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE`, Phase 72) — a rule that can
  never match would otherwise look like a working grant. Grant `SEARCH` to a
  wider principal and let the per-record read filter do the work; that is where
  the roster is consulted.

### `SELF`: the record that is the caller

`SELF` matches when the target record's **own id** is the caller's user id, and
nothing else:

```adl
POLICY UserSelfPolicy ON User
  RULE allowUserReadSelf ALLOW READ SELF
  RULE allowUserUpdateSelf ALLOW UPDATE SELF
END.POLICY
```

It is deliberately narrower than `OWNER`, which matches a record the caller
*created* (`meta.createdBy`) or that names them in a `CreatedBy`, `OwnerId` or
`ownerId` field. Those are different claims, and an application must be able to
grant one without the other. A `User` record carries none of `OWNER`'s four
signals about the person it describes — its creator is whoever seeded or invited
it — so before `SELF` existed there was no construct in the language that let a
person read their own `User` record. `AUTHENTICATED` says "I am somebody";
`SELF` says "this row is me".

The same invariant is already how a `SYNC ... SCOPE CURRENT_USER` selection and
a `currentUser`-scoped read-model source decide what belongs to a caller, so
`SELF` makes policy agree with the rest of the runtime rather than adding a
third opinion.

Three properties are part of the contract:

- It **fails closed.** A request that carries no record never matches, and
  neither does an empty caller id.
- It **grants a whole row**, which is what a profile surface needs, and which a
  field-scoped `ALLOW ... FIELDS` rule deliberately cannot do — a rule naming
  `FIELDS` never matches a whole-record request.
- It **cannot widen enumeration.** The object-level search check is evaluated
  with no record at all, so no `SELF` rule can ever admit a search, and a rule
  granting `SEARCH` to a `SELF` principal is refused at compile time
  (`ADL_POLICY_SELF_SEARCH_UNREACHABLE`) for the same reason its
  `CONTEXT_MEMBER` sibling is. This is a property of the request shape rather
  than of careful policy authoring: a `SELF` grant added to an object whose
  directory is closed leaves it closed.

That `CONTEXT_MEMBER`+`SEARCH` refusal is one instance of a broader rule: **a
`WHEN` condition cannot gate any action whose policy check has no candidate
record to evaluate it against.** A condition evaluates against the target
record's field values overlaid with any patch; when a request carries neither
(no record because none has been selected yet, no patch because nothing is
being written), every field reference the condition names resolves to
nothing, so the condition can never be true and the rule can never match — a
principal that would otherwise be perfectly reachable is silently starved by
its own `WHEN` clause. `SEARCH` is the confirmed case: the object-level "may
this principal search this object at all" gate runs before any row is
fetched, so it never carries a record or a patch, for any principal — and a
`WHEN` clause on a `SEARCH` rule is refused at compile time regardless of
principal (`ADL_POLICY_SEARCH_CONDITION_UNREACHABLE`), not only when the
principal is `CONTEXT_MEMBER`. Grant `SEARCH` unconditionally to the wider
principal that should be able to search at all, and pair it with a
conditioned `READ` rule that does the actual per-row shaping — see
`AvailabilityPolicy.allowAuthenticatedSearchAvailability` in
`src/reference/giggle-band/domain.adlj` for the pattern.

`EXPORT` does not share this defect, and carries no equivalent compile-time
check. Its one runtime call site
(`AuthorityReportingService.requireExportAllowed` in
`src/server/authoritative-reporting.ts`) re-checks policy once per exported
row, against the actual stored record, after the read model has already run —
so a `WHEN` condition on an `EXPORT` rule is reachable and does real per-row
work. `AvailabilityPolicy.allowAvailabilityOwnerExport` in the same reference
app (`ALLOW EXPORT AUTHENTICATED WHEN User == runtime.userId`) relies on
exactly this.

### Role reach

`ROLE <name>` matches a role earned through a business context, but a `ROLE`
check only ever looks at a fixed, narrow set of contexts for the object being
checked — never any context that merely relates to it. Concretely, a `ROLE`
check is evaluated against either the contexts the target object's own
`SCOPE` names, or — when the object declares no `SCOPE` at all — the one
business context (if any) that names this object as its own bound `OBJECT`
(a caller's own identity selection context, for example). A role earned
through a _different_ context is never among those targets, no matter which
instance of that other context the caller has selected.

For example, a `CircleMember` role earned through `CONTEXT Circle MEMBERSHIP
CircleMember ...` can gate a `ROLE CircleMember` check on `Circle` itself
(the context's own bound object) or on any object `SCOPE`d to `Circle`, but
it can never satisfy a `ROLE CircleMember` check on `User` — `User` is
neither `SCOPE`d to `Circle` nor `Circle`'s own bound object, so nothing
about the caller's `Circle` membership is ever consulted for that check,
however many circles they belong to. This is a structural property of what a
`ROLE` check can see, not a bug to route around with a differently-shaped
condition.

When a `ROLE` condition cannot apply for this reason — typically an object
like `User` that legitimately needs to be reached by callers who share no
context or scope with the record at all — reach for `AUTHENTICATED`,
`OWNER`, or a structured field condition (`WHEN <field> == runtime.userId`)
instead of a `ROLE` condition that can never fire.

Where the model can prove such a rule is dead, the compiler refuses it
(`ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE`, Phase 93) rather than accepting a
grant that matches nothing. It fires only when _all_ of the following hold, so
that firing is a proof rather than a guess:

- the rule's principal is `ROLE`-only — a principal that also names specific
  users, group roles, or `OWNER` can still match, so it is left alone;
- **every** role the principal names is unreachable — one reachable role keeps
  the rule live, since a principal is a disjunction;
- each named role is conferred by some context's `MEMBERSHIP ... ROLES` list
  and is not reachable from any role that no membership confers. A
  globally-assigned role such as `SystemAdmin` — and anything such a role
  `INHERITS` — is never refused, because `RuntimeContext.roles` is supplied by
  the host and can satisfy a `ROLE` check on any object;
- no context the object's `ROLE` check is evaluated against declares a
  `MEMBERSHIP` without a `ROLES` list. Such a membership confers whatever role
  its records carry, so nothing about role reach is decidable there.

Two shapes it deliberately does **not** catch: a rule naming one dead role
alongside a live one (the rule still works, and the dead half is invisible to
this check), and a role dead only because the _host_ never assigns it — the
model has no declaration of global role assignment for the compiler to read.

Lifecycle transition policy can name an action and state. Field rules restrict
specific fields. Conditions compile to resolved expressions.

A rule may also restrict itself to specific runtime channels:

```adl
RULE apiOnlyExport ALLOW EXPORT EVERYONE CHANNELS api
RULE syncAndUiWrite ALLOW UPDATE ROLE Admin CHANNELS ui sync
```

`CHANNELS` takes one or more of `ui`, `api`, `sync`, `import`, and `test` —
the runtime channels a `RuntimeContext` carries, naming the browser UI, the
HTTP API, sync replay, a bulk import, and the conformance/test harness
respectively. `CHANNEL` (singular) is the same clause, kept as a deprecated
spelling — see "Deprecated spellings" below. A rule with no `CHANNELS` clause
matches all five, which is why every rule written before channels existed
keeps working unchanged. The check happens right after the rule's
action match and before role, owner, state, field, or condition matching, so a
request on a channel the rule does not name skips it entirely, as if the rule
were not declared — this is how a model can grant a wider principal through
the UI than through direct API access, or keep a rule out of sync replay
without touching who it names.

## Lifecycles

Objects may declare a lifecycle with states and actions. A lifecycle action
declares source states, a target state, optional guards, optional policy
references, and optional hook names:

```adl
LIFECYCLE TicketLifecycle FIELD Status INITIAL Open
  STATE Open
  STATE Closed TERMINAL

  ACTION close FROM (Open) TO Closed LABEL 'Close'
    ALLOW ROLE Admin
    WHEN Resolution != ''
    BEFORE hooks.ticket.beforeClose
    AFTER hooks.ticket.afterClose, hooks.ticket.notify
    ON_ERROR hooks.ticket.onCloseError
  END.ACTION
END.LIFECYCLE
```

`BEFORE`, `AFTER`, and `ON_ERROR` each take one or more hook names, comma-
optional, either a bare name or a dotted path (`hooks.ticket.beforeClose`). A
name is checked only for syntactic shape (`ADL_HOOK_REFERENCE_INVALID`); the
model never requires it to resolve to anything, and whether it fires at all
depends on whether the runtime host has registered a handler under that exact
name — an unregistered name is a silent no-op, not an error.

Hook names are references only; registered runtime hooks decide behavior.
Guards, transition policy, and sync-policy checks all run before any hook, so
a refused transition never fires one. Once a transition is permitted: `BEFORE`
hooks run, in declared order, against the pre-transition record; the write
then commits; and `AFTER` hooks run, in declared order, against the updated
record. If preparing the write, a `BEFORE` hook, the commit, or an `AFTER`
hook throws, `ON_ERROR` hooks run — against the original, pre-transition
record — and the original error still propagates to the caller afterward;
hooks never turn a failed transition into a successful one. See
[runtime-semantics#lifecycles](runtime-semantics.md) for the complete ordered
list, including where audit and the operation log sit.

## Read Models

Read models declare named object sources and output fields. A field can project
from a source field or evaluate an expression over already-projected row values.
Read models are backend-neutral; they do not embed SQL or materialization
strategy.

Views and read models can declare context requirements:

```adl
VIEW BandEventList LIST
  CONTEXT REQUIRED Band
  FIELDS Date StartTime EventType Title VenueName
  SEARCH Title VenueName EventType
  SORT Date ASC StartTime ASC
  ACTIONS create read update delete
END.VIEW

READ_MODEL HomeUpcomingEvents
  CONTEXT ALL Band
  SOURCE event OBJECT Event SCOPE allAvailableContexts
END.READ_MODEL
```

`BandEventList` above is Giggle Band's own view, verbatim, from
`src/reference/giggle-band/domain.adlj`. The `READ_MODEL` fragment is trimmed
to its `CONTEXT`/first-`SOURCE` lines for focus; Giggle Band's actual
`HomeUpcomingEvents`, in the same file, is a two-source `UNION` with a full
field list.

A source after the first may declare an explicit join:

```adl
READ_MODEL BandMemberAvailability
  CONTEXT REQUIRED Band
  SOURCE member OBJECT BandMember SCOPE currentContext
  SOURCE availability OBJECT Availability SCOPE all JOIN member ON User == member.User CARDINALITY many
  FIELD Member FROM member.User
  FIELD Date FROM availability.Date
END.READ_MODEL
```

`JOIN <source> ON <localField> == <source>.<field>` names an earlier source and
the field on each side; `id` on either side means the record's own id.
`CARDINALITY one|many` may only follow a `JOIN` and defaults to `one`.

Without a declared join a source is resolved the original way: follow whatever
lookup field an already-loaded record declares toward this source's object and
read one record by id. That walks a foreign key forwards only and cannot produce
more than one record, so a projection through a junction object — two objects
that share a third object's id rather than referencing each other, which is what
the example above does through `BandMember` — cannot be expressed without one.

`many` fans out: an upstream row with several matches becomes several rows. A
declared join matches by field value rather than by known id, so it requires the
`search` action on the joined object for both cardinalities, and every joined
record still passes per-record read policy and object scope. A join may not
appear on the primary source, may not name a later source, and may not appear in
a `UNION` read model.

### Projecting a `LOOKUP` field

`FIELD Member FROM member.User` above projects a field whose object declares
`LOOKUP User DISPLAY Name`. The projected field inherits that lookup, the same
way it already inherits the source field's type — nothing is written to ask for
it, and there is no syntax to ask for it. A runtime uses it to render the
target's `DISPLAY` value wherever the row is shown to a person, so a
read-model-backed surface reads the same as the object-backed one instead of
showing a stored record id.

Two properties are part of the contract:

- **The projected value does not change.** The row still carries the stored id
  (or, for `LOOKUP ... TARGET_FIELD`, the stored natural key), so filters,
  `ORDER BY`, expression fields and row actions keep seeing what they always
  saw. The display value travels beside it, not instead of it.
- **The label is a record read, and it is policy-gated like one.** The target is
  a record on another object with its own read policy; a caller who may not read
  it — or may not `search` the target object, for a `TARGET_FIELD` lookup, since
  matching by field value is a search — gets no label, and the surface falls
  back to the stored value it already legitimately holds. A denied, deleted or
  missing target never produces a name.

Generic CRUD views also resolve an `editContainer` hint with values `modal`,
`drawer`, `page`, or `splitPane`, declared in source with `EDIT_CONTAINER` inside
a `VIEW` block. The hint in force is the one on the **form view that opens**, not
the one on whichever view is active, so a view that declares none uses the
platform default `modal`. See [Edit Surfaces](#edit-surfaces).

## Decision Tables

`DECISION_TABLE` expresses multi-condition branching logic as data — named
inputs, ordered rows with a boolean condition and literal outputs, and a
required default — instead of as nested boolean expressions written inline
elsewhere. A decision table is not wired into any other declaration
automatically; nothing in a command, policy, or lifecycle references one. A
host evaluates it explicitly through
`ApplicationRuntime.evaluateDecisionTable(tableName, values, context)`. See
[Decision Tables](runtime-semantics.md#decision-tables) for the runtime's
evaluation order.

```adl
OBJECT Order
  FIELD Customer TEXT REQUIRED
  FIELD Total NUMBER REQUIRED
END.OBJECT

DECISION_TABLE OrderDiscount ON Order MATCH FIRST
  INPUT amount = Total
  ROW bulk WHEN amount >= 1000 OUTPUT discountPercent 15, label 'Bulk'
  ROW standard WHEN amount >= 100 AND amount < 1000 OUTPUT discountPercent 5, label 'Standard'
  DEFAULT OUTPUT discountPercent 0, label 'None'
END.DECISION_TABLE
```

- `DECISION_TABLE Name ON Object` names the table and the object whose fields
  `INPUT` expressions may reference. `Object` must be a declared object name
  (`ADL_DECISION_TABLE_OBJECT_UNKNOWN` otherwise).
- `MATCH FIRST` (default) or `MATCH SINGLE` sets the match policy. `FIRST`
  returns the first row whose condition is true, in declaration order.
  `SINGLE` requires at most one matching row and raises a `DecisionTableError`
  at evaluation time when more than one row matches.
- `INPUT <name> = <expression>` declares one named input. Its expression
  evaluates once, against the caller-supplied source values keyed by
  `Object`'s field names, before any row is considered. `FROM` is accepted in
  place of `=` as a deprecated spelling — see "Deprecated spellings" below.
- `ROW <name> WHEN <condition> OUTPUT <key> <value>[, <key> <value>...]`
  declares one row. `WHEN` is required (Phase 72): a bare condition
  immediately after the row name no longer parses
  (`ADL_PARSE_EXPECTED_TOKEN`). The condition evaluates over the table's
  `INPUT` names — not the object's raw fields — and must resolve to `boolean`
  (`ADL_DECISION_TABLE_ROW_CONDITION_TYPE` otherwise). `OUTPUT` takes one or
  more `name value` literal pairs, comma- or newline-separated.
- `DEFAULT [OUTPUT] <key> <value>...` declares the output returned when no row
  matches. It is not optional: a table with no `DEFAULT` fails validation
  (`ADL_DECISION_TABLE_DEFAULT_MISSING`).

Input names and row names must each be unique within a table
(`ADL_DECISION_TABLE_INPUT_DUPLICATE`, `ADL_DECISION_TABLE_ROW_DUPLICATE`).
Where a row condition compares an input to a literal with a supported
operator, the validator statically analyzes the constraint it implies on that
input and reports two shapes of static defect: a row whose constraint no
input value could ever satisfy, given what earlier rows already exclude
(`ADL_DECISION_TABLE_ROW_UNREACHABLE`, a warning), and a row whose constraint
overlaps an earlier row's (`ADL_DECISION_TABLE_ROW_OVERLAP`) — a warning
under `MATCH FIRST`, where declaration order still resolves the overlap
deterministically, and an error under `MATCH SINGLE`, where an overlap is a
real defect because both rows can match the same input at once.

## Composed View Presentation

Views may include renderer-neutral presentation declarations. Presentation is
resolved onto `ResolvedView.presentation`; runtime services still consume the
resolved model, not parser AST nodes.

Implemented view-level declarations:

- `LAYOUT stack|grid|split|sidebar`
- `DENSITY compact|comfortable|spacious`
- local `STATE Name Type DEFAULT(Literal)`
- `ICON_MAP Name FOR Field ... END.ICON_MAP`
- `STATUS name LABEL 'Label' ARIA_LABEL 'Accessible label' ICON iconRef
THEME colorStatusEvent PRECEDENCE 10` (`iconRef` is either a name from the
  [icon vocabulary](#icon-vocabulary) or an `ICON_MAP` reference)
- `STATUS_MAP Name FOR Field ... END.STATUS_MAP`
- `LEGEND Name TITLE 'Title' STATUSES statusName ...`
- `SECTION Name ... END.SECTION`

Sections may declare `HEADING`, local layout/density hints, controls
(`TOGGLE`, `SELECT`, `CONTEXT_SELECTOR`, `ACTION`), `LIST` blocks,
`CALENDAR` blocks and `MATRIX` blocks. Lists bind to an object or read model and support `FIELDS`,
`ORDER BY`, `WHERE`, `RENDER_AS`, `DENSITY`, `EMPTY_TEXT`, `EMPTY_ICON`,
repeatable `STATUS` candidates, and a `ROW` template. Every icon named here
comes from the closed [icon vocabulary](#icon-vocabulary).

A `ROW`'s `TEXT <field>` fragment accepts `FORMAT`, `FALLBACK 'text'` — what to
render when the field is null — and `STYLE`. `FALLBACK` is refused on a literal
`TEXT 'text'` fragment, which has no field that could be null.

```adl
VIEW HomeDashboard DASHBOARD
  READ_MODEL HomeUpcomingEvents
  LAYOUT stack
  DENSITY compact
  STATE showGigs BOOLEAN DEFAULT(true)
  STATE showRehearsals BOOLEAN DEFAULT(true)
  STATE showUnavailable BOOLEAN DEFAULT(true)

  ICON_MAP EventTypeIcon FOR EventType DEFAULT calendar
    Gig -> music
    Rehearsal -> microphone
    Unavailable -> x
  END.ICON_MAP

  STATUS event LABEL 'Gig' ARIA_LABEL 'Gig event' ICON EventTypeIcon(Gig) THEME colorStatusEvent PRECEDENCE 10
  STATUS rehearsal LABEL 'Rehearsal' ARIA_LABEL 'Rehearsal event' ICON EventTypeIcon(Rehearsal) THEME colorStatusAlternate PRECEDENCE 10
  STATUS unavailable LABEL 'Unavailable' ARIA_LABEL 'Unavailable block' ICON EventTypeIcon(Unavailable) THEME colorStatusUnavailable PRECEDENCE 20

  STATUS_MAP EventTypeStatus FOR EventType DEFAULT event
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
      DENSITY compact
      EMPTY_TEXT 'No upcoming events'
      STATUS EventTypeStatus(EventType)

      ROW
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

This is Giggle Band's own `HomeDashboard`, verbatim, trimmed of its `CONTEXT`/
`FIELDS`/`SORT`/`ACTIONS` lines and its `Welcome` and `Filters` sections. The
complete view — including the toggle controls that drive
`showGigs`/`showRehearsals`/`showUnavailable` — is the `HomeDashboard` view on
`Event` in `src/reference/giggle-band/ui.adlj`.

A `LIST`'s row-scoped `ACTION` may reference the row's own record identity as
`id` inside `INPUT ... FROM` and `WHEN`, targeting the exact record the row
renders from rather than only its projected fields:

```adl
LIST SentInvitationsList FROM READ_MODEL SentBandInvitations
  ORDER BY SentAt DESC
  RENDER_AS table
  DENSITY compact
  EMPTY_TEXT 'No invitations sent yet'

  ROW
    TEXT InviteeEmail STYLE bold
    TEXT ' - '
    TEXT Role
    TEXT ' - '
    TEXT Status
    TEXT ' - '
    TEXT SentAt FORMAT date 'EEE d MMM'
  END.ROW

  ACTION revoke COMMAND RevokeBandInvitation LABEL 'Revoke' ICON x PLACEMENT row
    WHEN Status == 'Pending'
    INPUT Invitation FROM id
  END.ACTION
END.LIST
```

This is `SentInvitationsList`, verbatim: the list inside Giggle Band's
`MyInvitationList` view (`src/reference/giggle-band/ui.adlj`). It is
read-model-backed, so `id` here resolves through `SentBandInvitations`' first
declared source (`invitation`) rather than through an object binding.

`id` resolves to the row's real storage id (its primary source's record id —
the object it is bound to for an object-backed list, or a read model's first
declared source for a read-model-backed list), not the renderer-facing row
key. It is reserved the same way `id` already is inside a read model's `JOIN
ON` matching, and it is the mechanism a command step's `ID INPUT` needs to
update, delete, or otherwise act on the specific record a row was rendered
from. It resolves only inside a row `ACTION`'s own `INPUT`/`WHEN`
expressions; `LIST WHERE` and `ROW` fragments still see only the list's
projected field values and cannot reference it.

### Controls beyond `TOGGLE`

`TOGGLE Name ... END.TOGGLE` binds a control to one Boolean piece of local
`STATE`; `STATE` defaults to the control's own name. Two siblings share its
shape:

- `SELECT Name ... END.SELECT` offers a closed list of values for one piece of
  local state instead of two. It takes the same `STATE`, `LABEL` and `ICON`
  clauses, plus repeatable `OPTION <value> LABEL 'text' [ICON iconRef]`. An
  option must carry a `LABEL`: an option with none renders a blank row, so it
  is refused rather than defaulted to the value's own text.
- `CONTEXT_SELECTOR Name ... END.CONTEXT_SELECTOR` places a context picker
  inside a composed section, taking `LABEL`, `ICON` and an optional
  `CONTEXT <context>`. Omitting `CONTEXT` offers whatever context the view is
  bound to. This is the _view-local_ selector; the application-wide one is
  `SHELL`'s `CONTROL ... KIND contextSelector` (see
  [shell-navigation](#shell-navigation)).

```adl
SELECT eventType STATE eventTypeFilter LABEL 'Event type' ICON calendar
  OPTION 'Gig' LABEL 'Gigs' ICON music
  OPTION 'Rehearsal' LABEL 'Rehearsals'
END.SELECT
```

### Calendars

`CALENDAR Name FROM OBJECT <object>|READ_MODEL <read model> ... END.CALENDAR`
binds a month calendar. Its directives are `DATE_FIELD`, `TITLE_FIELD`,
`SUMMARY_FIELDS`, `FIELDS`, `ORDER BY`, `DENSITY`, `MONTH 'yyyy-MM'`,
`MONTH_STATE <state>`, `WEEK_START`, `MONTH_LABEL_FORMAT`, `RANGE 'from' TO
'to'`, `EMPTY_TEXT`, `EMPTY_ICON`, repeatable `STATUS` candidates, cell
`ACTION`s, and `CONFLICT_OVERLAY`.

`MONTH_LABEL_FORMAT date 'MMMM yyyy'` takes the same format kind and pattern a
row fragment's `FORMAT` does, and governs how the month heading is rendered.

`CONFLICT_OVERLAY FROM READ_MODEL <read model> ... END.CONFLICT_OVERLAY` layers
a correlated status onto specific dates of the calendar's own rows, without
altering what those rows already show:

```adl
CALENDAR MonthPlanner FROM READ_MODEL BandMonthEvents
  DATE_FIELD Date
  TITLE_FIELD Title
  MONTH_STATE visibleMonth
  WEEK_START monday
  EMPTY_TEXT 'No events in this month'
  STATUS CalendarEventTypeStatus(CalendarStatus)

  CONFLICT_OVERLAY FROM READ_MODEL EventAvailabilityConflicts
    DATE_FIELD Date
    FLAG_FIELD IsConflict
    STATUS conflict
  END.CONFLICT_OVERLAY
END.CALENDAR
```

All four parts are required. `FROM READ_MODEL` names a **second**,
independently executed read model — never the calendar's own `source`.
`DATE_FIELD` and `FLAG_FIELD` are that read model's own output fields: a row
marks its date only when `FLAG_FIELD` is `true`, so a read model that also
projects correlated but non-conflicting rows does not falsely flag them.
`STATUS` names a status already declared on the consuming view.

The overlay exists because neither read-model strategy can express this alone:
a `UNION` read model may not declare a `JOIN`
(`ADL_READ_MODEL_JOIN_STRATEGY_INVALID`), and a `JOIN`-strategy read model's
inner-join semantics would drop every non-matching row of whichever source is
not primary — which is exactly the ordinary, non-conflicting rows the calendar
still has to show. The block above is Giggle Band's own `MonthPlanner`,
trimmed of its `DENSITY` and its cell `ACTION`; the full calendar is the
`BandEventCalendar` view in `src/reference/giggle-band/ui.adlj`.

Presentation syntax remains declarative. It does not allow raw CSS, raw SVG,
framework component names, procedural render loops, or host functions.

### Matrices

`MATRIX Name ... END.MATRIX` binds a resource/date grid: rows from one source,
a regular date column axis, and cells correlated to a row and a column. It sits
beside `LIST` and `CALENDAR` inside a `SECTION`.

```adl
MATRIX AvailabilityMatrix
  DENSITY compact
  ROWS FROM OBJECT Member
    KEY MemberKey
    LABEL MemberName
    FIELDS MemberKey MemberName
    ORDER BY MemberName ASC
  END.ROWS
  COLUMNS DATE_RANGE '2026-03-02' TO '2026-03-06' STEP_DAYS 1 LABEL_FORMAT date 'EEE d'
  CELLS FROM OBJECT Availability ROW MemberKey COLUMN Day
    FIELDS MemberKey Day State
    RECORD_SOURCE Availability
    STATUS StateStatus(FIELD State)
  END.CELLS
  CELL
    UNSET_STATUS unset
    ACCESSIBLE_LABEL 'Availability cell'
  END.CELL
  EDIT Availability ROW MemberKey COLUMN Day VALUE State
    CYCLE 'available' 'unavailable'
    UNSET_VALUE null
    UNSET_AS_ABSENCE
    BULK_BEHAVIOR SEQUENTIAL_VALIDATED_WRITES
  END.EDIT
END.MATRIX
```

The block carries one optional directive of its own, `DENSITY`, and five
sub-structures. Three of them are required — `ROWS`, `COLUMNS` and `CELLS` —
because `ResolvedPresentationMatrix` declares them non-optional; a matrix
missing any of the three is a parse error rather than a partial model.

- **`ROWS FROM OBJECT <object>|READ_MODEL <read model> ... END.ROWS`** — the row
  axis. `LABEL <field>` is required and names the field rendered as the row
  header. `KEY <field>` names the field cells correlate against (defaulting to
  the record identity when absent), `FIELDS` projects the fields the row axis
  needs, and `ORDER BY` sorts the rows.
- **`COLUMNS DATE_RANGE '<from>' TO '<to>' [STEP_DAYS <n>] [LABEL_FORMAT <kind> ['pattern']]`**
  — the column axis, on one line. `DATE_RANGE` is currently the only axis kind
  and is still written out, so a second kind can later be a new word rather
  than a reinterpretation of an unmarked line. `STEP_DAYS` defaults to `1`, and
  `LABEL_FORMAT` takes the same kind and pattern a row fragment's `FORMAT`
  does.
- **`CELLS FROM OBJECT <object>|READ_MODEL <read model> ROW <field> COLUMN <field> ... END.CELLS`**
  — the cell source. `ROW` and `COLUMN` are the cell fields correlated against
  the row key and the column date, both required. `FIELDS` projects what the
  cells need, `RECORD_SOURCE` names the object cell records belong to, and
  repeatable `STATUS` candidates bind a status to the cell's data.
- **`CELL ... END.CELL`** — the cell's *own* presentation. Its `STATUS`
  candidates override the cell source's; `UNSET_STATUS` names the status for a
  cell with no matching record, without persisting a fake enum value; and
  `ACCESSIBLE_LABEL` names the cell for assistive technology. The block is
  omitted entirely when it would carry nothing.
- **`EDIT <object> ROW <field> COLUMN <field> VALUE <field> ... END.EDIT`** —
  optional cell editing. The object name is bare rather than `OBJECT <name>`:
  an edit always writes an object, so there is no source kind to disambiguate.
  `CYCLE` lists the values a cell steps through, as literals; `UNSET_VALUE`
  names the value written when a cell is cleared — `UNSET_VALUE null` writes a
  null, and omitting the directive entirely is a *different* model, not the
  same one; `UNSET_AS_ABSENCE` deletes the record instead of writing a value
  (bare means `true`, and `UNSET_AS_ABSENCE FALSE` turns it off); and
  `BULK_BEHAVIOR SEQUENTIAL_VALIDATED_WRITES` — currently the only behaviour —
  states that a range edit is a sequence of individually validated object
  writes, not an atomic batch.

A `STATUS` candidate is one directive per line, in either block, spelled the
same way as everywhere else in the language: `STATUS <status>` for a status by
name, `STATUS <map>(FIELD <field>)` for a status map read against a named
field, `STATUS <map>(VALUE <literal>)` for a status map read against a fixed
value, and `STATUS <map>()` for a status map read against its own declared
field. The parentheses are what distinguish the last of those from the first:
`STATUS StateStatus` names a *status* called `StateStatus`, while
`STATUS StateStatus()` names the *map*.

Rows and cells bind through the same runtime boundaries lists do — object
sources call the policy-enforcing `search`, read-model sources call
`executeReadModel` — so policy, context scope, field shaping and read-model
projection all apply before a renderer sees any data.

### Icon vocabulary

Every icon name -- a control's or status's `ICON`, an `EMPTY_ICON`, an
`ICON_MAP` target, an `ICON_MAP`'s `DEFAULT`, a `ROW`'s `ICON` fragment, an
`OPTION`'s `ICON`, and `SHELL`'s `NAV`/`CONTROL` icons -- is drawn from one
closed, renderer-neutral vocabulary. The legal names are:

`calendar`, `check`, `close`, `dot`, `home`, `list`, `log-out`, `logout`,
`menu`, `mic`, `microphone`, `music`, `sync`, `users`, `x`

`mic`/`microphone`, `log-out`/`logout` and `x`/`close` are aliases: both
spellings of a pair name the same icon.

An icon name outside this list is a compile error, `ADL_ICON_NAME_UNKNOWN`,
reported at the exact model path that names it. The set is closed on purpose:
an unrecognised name used to render as a blank space, discoverable only by
looking at a screen.

The vocabulary is declared once, in the model layer
(`src/model/resolved-model/icon-vocabulary.ts`), and the compiler and every
renderer consume that one declaration. A renderer chooses its own _form_ -- the
shell's text chrome draws a single glyph, a composed view draws an inline SVG --
but never its own _set_; every name must render something real in every
renderer. Adding a name is therefore a language change, not a rendering change.

## Edit Surfaces

A view may declare how its CRUD form is composed: which container it opens in,
which field groups it presents, and which child collections are edited inside
it. These declarations resolve onto `ResolvedView.editContainer` and
`ResolvedView.editSections`; see
[resolved-model#view-presentation](resolved-model.md) for the resolved contract
and [runtime-semantics#staged-child-changes](runtime-semantics.md) for what a
runtime does with them.

`EDIT_CONTAINER modal|drawer|page|splitPane` chooses where a create or edit form
opens. The default is `modal`. The declaration that governs is the one on the
**form view that opens**, not the one on whichever view happens to be active: a
form is presented the same way wherever it was opened from, so declaring the
container on a `FORM` view is what controls that form, and declaring it on a
`LIST` view does not control the form that list opens.

`EDIT_SECTION Name ... END.EDIT_SECTION` declares a field group. It accepts
`HEADING 'text'` — on the header line or on its own line — and `FIELDS`. A
section that declares no `FIELDS` inherits the view's own fields. A view that
declares no edit sections at all resolves one `fields` section over `view.fields`,
so adding this syntax changes nothing an existing model does.

`CHILD_COLLECTION Name ... END.CHILD_COLLECTION` declares a collection of child
records edited inside the parent's form:

- `CHILD <object> PARENT_FIELD <field>` — both required. The child object alone
  does not say which of its lookups points back at this parent, and inferring one
  would silently pick a field when a child has two.
- `CHILD_VIEW <view>` — an optional view on the child object, for the fields the
  collection works in: the columns its rows display and, minus the `ORDER_FIELD`,
  the inputs its draft row and its row editor offer.
- `OPERATIONS createChild linkExisting updateChild unlink remove reorder` — any
  subset, in any order. The default is `createChild updateChild remove`, because
  the default has to be a set every child collection can honour and `unlink` is
  not one: it detaches a child by patching `PARENT_FIELD` to null, which a
  required parent field — the common case — can never accept. `remove` deletes
  the child instead, and is still gated by the child object's `delete` policy
  action. Declaring `unlink` where the `PARENT_FIELD` is `REQUIRED` is refused
  with `ADL_VIEW_EDIT_SECTION_UNLINK_PARENT_FIELD_REQUIRED` against
  `<view>.editSections[i].operations`, naming the field: the language could
  declare the operation and the model could never satisfy it, so without the
  diagnostic the failure would first appear as a control that looks available and
  fails at the write. Use `remove`, or make the parent field optional.
- `STAGED` (or `STAGED false`) — whether child changes are held until the parent
  is saved. The bare word means `true`, which is the default.
- `ORDER_FIELD <field>` — the child field carrying position. Required when
  `reorder` is among the operations. A new child is appended and reordering has
  its own controls, so this field is left out of the collection's editable
  surfaces rather than offered as an input; see
  [ui-language-addendum#implementation-notes](ui-language-addendum.md).
- `EMPTY_TEXT 'text'` — what to show when the collection is empty.
- `PROJECTED_FIELD <name> THROUGH <lookup field> FIELD <target field>` —
  repeatable. Adds a row field sourced from a _related_ object reached through
  one of the child object's own lookup fields, rather than from the child's own
  stored fields. `THROUGH` must name a field on the child object carrying a
  `LOOKUP`; `FIELD` must exist on that lookup's target object and not be
  hidden; `<name>` must not collide with any field name, own or projected,
  already on the section. It reaches exactly one hop — the two clauses are
  separate rather than a dotted `Song.DurationSeconds` path precisely because a
  dotted path would read as though it could reach further.
- `SUMMARY ... END.SUMMARY` — see below.
- `PICKER ... END.PICKER` — see below.

`SUMMARY <aggregate> [<field>] ... END.SUMMARY` declares a single aggregated
value over the collection's current rows — persisted and staged together, so it
updates live as a person edits — shown once above or below the rows:

```adl
SUMMARY SUM DurationSeconds
  LABEL 'Total'
  FORMAT duration 'm:ss'
  PLACEMENT footer
END.SUMMARY
```

- The aggregate is one of `sum`, `avg`, `min`, `max`, `count`. The vocabulary is
  deliberately closed rather than an open expression grammar: every declarative
  totals feature checked while designing this converges on the same five.
- The field goes on the header line, the way an aggregate reads everywhere
  else. It may name a field on the child object or one of the section's own
  `PROJECTED_FIELD` names, and must be numeric for every aggregate except
  `count`. It is optional only for `count`: `SUMMARY COUNT` counts every row,
  while `SUMMARY COUNT Something` counts rows with a non-null value for that
  field.
- `LABEL 'text'`, `FORMAT <kind> ['pattern']` and `PLACEMENT header|footer` may
  each appear on the header line or as their own directive. `PLACEMENT`
  defaults to `footer` and `FORMAT` to `number`.

`PICKER Name ... END.PICKER` declares how a caller chooses what to add to the
collection. It has two modes, and `CANDIDATE_FIELD` is what chooses between them:

- Without it the picker **links**. Its candidates are existing child records, and
  choosing one re-parents it, so the collection's operations must include
  `linkExisting` and are refused otherwise.
- With it the picker **mints**. Its candidates are records of whatever that field
  looks up, and choosing one creates a new child naming it, so the collection's
  operations must include `createChild` and are refused otherwise.

Its directives are:

- `SOURCE OBJECT <object>` or `SOURCE READ_MODEL <read model>`. The source must
  agree with what is being chosen: for a linking picker that is the child object,
  and for a minting picker it is the candidate field's lookup target. An object
  source must name that object; a read-model source must include it, so every
  candidate resolves to a deterministic record id of it. Omitting `SOURCE`
  resolves to the child object, so a minting picker whose candidates are records
  of anything else has to declare one.
- `CANDIDATE_FIELD <field>` — a lookup field on the **child** object that receives
  the chosen record's id. Optional, and never inferred: which of a child's lookups
  the picker fills is a modelling decision, and guessing would silently pick one
  when a child has two. A field the child object does not carry, or one that is
  not a lookup, is refused.
- `SELECTION single|multiple` — the default is `multiple`.
- `DISPLAY <fields>`, `SEARCH <fields>`, `SORT <field> ASC|DESC` — over candidate
  fields, meaning fields of the source above rather than of the child.
- `EXCLUDE_LINKED` (or `EXCLUDE_LINKED false`) — whether candidates this parent
  already has are hidden: for a linking picker the children themselves, for a
  minting picker the candidates its children already name. The bare word means
  `true`, which is the default.
- `EMPTY_TEXT 'text'` — what to show when no candidate remains.

```adl
OBJECT Order
  DISPLAY Code
  FIELD Code TEXT REQUIRED
  FIELD Notes TEXT

  VIEW OrderForm FORM
    FIELDS Code Notes
    EDIT_CONTAINER page

    EDIT_SECTION Details HEADING 'Order'
      FIELDS Code Notes
    END.EDIT_SECTION

    CHILD_COLLECTION Lines HEADING 'Lines'
      CHILD OrderLine PARENT_FIELD Order
      CHILD_VIEW OrderLineList
      # `unlink` would need `OrderLine.Order` to be optional, because it detaches
      # a line by clearing that field. `remove` deletes the line instead.
      OPERATIONS createChild linkExisting updateChild remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No lines yet.'

      PICKER LinePicker
        SOURCE OBJECT OrderLine
        SELECTION single
        DISPLAY Description
        SEARCH Description
        SORT Position ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Nothing to link.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT
```

The picker above links: its candidates are `OrderLine` records, and choosing one
moves that line onto this order. A picker that mints instead offers the thing a
person thinks they are choosing, and the platform creates the child record for
them:

```adl
OBJECT SetList
  DISPLAY Name
  FIELD Name TEXT REQUIRED

  VIEW SetListForm FORM
    FIELDS Name
    EDIT_CONTAINER page

    CHILD_COLLECTION Songs HEADING 'Songs'
      CHILD SetListItem PARENT_FIELD SetList
      CHILD_VIEW SetListItemList
      OPERATIONS createChild updateChild remove reorder
      STAGED
      ORDER_FIELD Position
      EMPTY_TEXT 'No songs in this set list yet.'

      PICKER SongPicker
        SOURCE OBJECT Song            # the candidate object, not the child
        CANDIDATE_FIELD Song          # the child field the choice is written to
        SELECTION multiple
        DISPLAY Title Composer
        SEARCH Title Composer
        SORT Title ASC
        EXCLUDE_LINKED
        EMPTY_TEXT 'Every song in the library is already in this set list.'
      END.PICKER
    END.CHILD_COLLECTION
  END.VIEW
END.OBJECT

OBJECT SetListItem
  FIELD SetList TEXT REQUIRED LOOKUP SetList DISPLAY Name
  FIELD Song TEXT REQUIRED LOOKUP Song DISPLAY Title
  FIELD Position NUMBER REQUIRED MIN(1)

  VIEW SetListItemList LIST
    FIELDS Song Position
    ACTIONS read
  END.VIEW
END.OBJECT
```

The `CHILD_COLLECTION`/`PICKER` block above is Giggle Band's own
`SongPicker`, verbatim — the `SOURCE`/`CANDIDATE_FIELD` comments are added
here for exposition and are not in the source. The surrounding `SetList` and
`SetListItem` objects are simplified for this example: the real objects carry
business-context `SCOPE`, `UNIQUE`/`ORDERED` constraints, `SYNC`, and several
more fields. The full `SetListForm` view is in
`src/reference/giggle-band/ui.adlj` and the full `SetList`/`SetListItem`
objects are in `domain.adlj`. The real `Songs` collection also declares a
projected field and a summary, which print as:

```adl
PROJECTED_FIELD DurationSeconds THROUGH Song FIELD DurationSeconds
SUMMARY SUM DurationSeconds
  LABEL 'Total'
  FORMAT duration 'm:ss'
  PLACEMENT footer
END.SUMMARY
```

Choosing three songs there stages three `createChild` operations, each carrying
the chosen song's id in `Song`, each appended to the end of the set list. Songs
already in this set list are not offered again. See
[runtime-semantics#relationship-pickers](runtime-semantics.md) for the full
evaluation rules.

`LOOKUP <Object> [TARGET_FIELD <field>] DISPLAY <field>` also accepts
`TARGET_FIELD`, naming the field on the target object that the stored value
identifies:

```adl
FIELD Song TEXT REQUIRED LOOKUP Song TARGET_FIELD Isrc DISPLAY Title
```

`TARGET_FIELD` must name a field that exists on the target object
(`ADL_LOOKUP_TARGET_FIELD_UNKNOWN`). A `LOOKUP` with no `TARGET_FIELD` stores
the target record's own id, resolved by an identity read. A `LOOKUP` that
declares `TARGET_FIELD` stores a natural key instead: the _implicit_ join a
read model source performs when it names no `JOIN` of its own (see
[Read Models](resolved-model.md#read-models)) matches the target object's
records by that field's value, not by id. `TARGET_FIELD` is meant for a
target field the target object declares `UNIQUE`; model validation does not
require this, so if more than one record shares the value, the match is
whichever one a search of the target object happens to return first — the
same ambiguity rule an explicitly declared `JOIN ... CARDINALITY one` already
applies. Matching by field value is a search however it is spelled, so it is
refused for a caller who may not `search` the target object, exactly like a
declared join's candidate set.

A `LOOKUP` field's value is also read by two other runtime paths that predate
`TARGET_FIELD`: a "current user" read-model source scope matching a lookup
field against the signed-in user, and the browser UI's lookup-label display.
Both now honour `TARGET_FIELD` (Phase 75). The "current user" match compares
the stored value against the _signed-in user's own record's_ `TARGET_FIELD`
value rather than against the user's id directly, reading that record by
identity and requiring it to pass read policy — if the record cannot be
found or read, the match fails closed rather than throwing. The browser UI's
lookup-label display does an exact-match search on the declared
`TARGET_FIELD` when one is declared, filtering the (possibly fuzzy) search
results for an exact match before using one, and otherwise keeps its
original identity-read behaviour. See
`learnings/implementation/read-model-runtime.md` and
`learnings/implementation/browser-ui-runtime.md` for the implementation
details.

`EDIT_SECTION` is spelled differently from the composed-presentation `SECTION`
because a view may declare both, and two different things cannot share one
keyword without one of them changing meaning by position.

Declaring a child collection grants nothing. The child object's own policy,
scope, constraints and sync mode still decide every write, and an operation the
collection does not list is refused by the runtime rather than merely hidden.

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
  CONTROL signOut KIND logout LABEL 'Sign out' PLACEMENT navDrawer
  TOP_BAR CONTEXT_SELECTOR topBar MOBILE_CONTEXT_SELECTOR sheet CONTROLS contextSelector syncStatus
  NAV_DRAWER TITLE 'Giggle Band' CONTROLS signOut
END.SHELL
```

This is a trimmed shape of Giggle Band's own `SHELL` (three of its ten `NAV`
entries and three of its six `CONTROL` entries), with a `VISIBLE ONLINE`
clause added to `syncStatus` to document that condition, which the reference
app's own `syncStatus` control does not declare. The complete, working block
is the `shell` declaration in `src/reference/giggle-band/ui.adlj`.

`NAV` entries target resolved views. Supported nav metadata includes `LABEL`,
a semantic `ICON` from the [icon vocabulary](#icon-vocabulary), `GROUP`, numeric `ORDER`, optional `ACTIVE_WHEN` view names,
and `VISIBLE` conditions. Implemented visibility conditions are `ALWAYS`,
`ONLINE`, `OFFLINE`, `WHEN CONTEXT Name AVAILABLE`, `WHEN CONTEXT Name
UNAVAILABLE`, and `WHEN CONTEXT Name SELECTED`. `UNAVAILABLE` is the mirror of
`AVAILABLE`: it matches when the caller can reach no instance of the named
context, which is what a person holding an identity and no membership sees.

Navigation is **explicit-only by default**. If `NAV_MODE` is omitted, the
resolved drawer contains exactly the declared `NAV` entries; declaring a view
does not itself make that view a top-level destination. This keeps supporting
forms, child lists, and other implementation views out of user-facing
navigation:

```adl
SHELL
  NAV HomeDashboard LABEL 'Home' ICON home ORDER 10
  NAV BandEventList LABEL 'Gigs' ICON calendar ORDER 20
END.SHELL
```

The legacy generated behavior is available only through an explicit opt-in:

```adl
SHELL
  NAV_MODE INCLUDE_UNLISTED_VIEWS
  NAV HomeDashboard LABEL 'Home' ICON home ORDER 10
END.SHELL
```

`INCLUDE_UNLISTED_VIEWS` retains each declared item's metadata and generates a
label, object-name group, order, active state, and `ALWAYS` visibility for every
resolved view that has no `NAV` entry. With no `NAV` lines it generates entries
for every view. `NAV_MODE EXPLICIT_ONLY` is also accepted for round-trip
completeness, but is redundant because it is the default.

`CONTROL` entries support optional `LABEL`, a semantic `ICON` from the
[icon vocabulary](#icon-vocabulary), `PLACEMENT`, and `VISIBLE` metadata. Implemented control kinds are `contextSelector`,
`syncStatus`, `connectivity`, `themeSwitch`, `logout`, `pwaInstall`, and
`commandAction` (see [Command Action Controls](#command-action-controls));
unsupported runtime capabilities degrade as unavailable controls. `SYNC_STATUS`
and `CONNECTIVITY` answer different questions and are separate controls:
`SYNC_STATUS` reports the sync state of the device's own records, and
`CONNECTIVITY` reports whether the authority is reachable. `TOP_BAR` declares context
selector placement, mobile context selector behavior (`dropdown` or `sheet`),
and the ordered top-bar control list. `NAV_DRAWER` declares the drawer's `TITLE`
and its ordered `CONTROLS` list.

`PLACEMENT` is `TOP_BAR`, `NAV_DRAWER` or `EMPTY_STATE`. The first two are
regions with an ordered control list of their own, so a control placed there
must also be named by that region's `CONTROLS`. `EMPTY_STATE` has no list:
order is declaration order, because it is not shared chrome whose ordering is a
layout decision but a single message with, in practice, one way out of it.

### Command Action Controls

```text
SHELL
  CONTROL createFirstBand KIND COMMAND_ACTION LABEL 'Create a band' PLACEMENT EMPTY_STATE VISIBLE WHEN CONTEXT Band UNAVAILABLE COMMAND CreateBand
END.SHELL
```

A `COMMAND_ACTION` control runs a declared `COMMAND`, **prompting for that
command's own declared `INPUTS`**. It is the only shell control that is about
the application rather than about the device or the session, and the only one
that opens a form.

It exists because a presentation `ACTION`'s `INPUT` is a set of expressions
evaluated against a row, so it can only restate values that already exist
somewhere. Nothing in the language could ask a person for a value, which meant
a command with a required free-text input could not be run from a browser at
all — and a person holding an identity and no membership of any context saw
only `No <Context> contexts are available for this view.`, with no affordance,
because every context-scoped view renders its empty state for them.

- `COMMAND` names a declared command and is **required** for this kind
  (`ADL_SHELL_CONTROL_COMMAND_REQUIRED`) and refused on every other kind
  (`ADL_SHELL_CONTROL_COMMAND_UNEXPECTED`), so a `COMMAND` no renderer would
  read is never silently accepted. An unknown command is
  `ADL_SHELL_CONTROL_COMMAND_UNKNOWN`.
- The form is generated from the command's `INPUTS`: one control per input,
  typed from the input's declared field type, required where the input is. A
  command declaring a `REPEATED` or `ATTACHMENT` input has no control to
  generate for it and is refused
  (`ADL_SHELL_CONTROL_COMMAND_INPUT_UNSUPPORTED`) rather than rendering a form
  that silently drops a value.
- The control **decides nothing**. It collects values and hands them to the
  runtime, which runs the command's preconditions and every step's policy
  check exactly as any other caller would. A refusal is shown on the form,
  beside the values that produced it.
- When the command's step declares `ESTABLISHES CONTEXT`, the shell selects the
  instance that step created once the command commits, so the person lands
  inside what they just made rather than back where they started.

Placed in `EMPTY_STATE` with `VISIBLE WHEN CONTEXT Name UNAVAILABLE`, this is a
first-run onboarding surface: it turns the empty state into the entry point,
and takes itself away the moment the person belongs to something. Both
reference apps declare exactly one — `createFirstBand` running `CreateBand`,
and `createFirstCircle` running `CreateCircle`.

Each region's control list defaults to the declared controls whose `PLACEMENT`
names that region, so a placement is meaningful without a second declaration
repeating it; an explicit `CONTROLS` clause overrides that, and an empty list
means "render none" rather than "fall back". A control may only be listed in the
region its placement names — otherwise it would be listed somewhere it can never
render, which is a model error rather than a silent no-op. An undeclared drawer
title stays absent in the resolved model; the renderer falls back to the
application name.

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

### Batch commands

An input may carry a list, and a step may iterate one:

```adl
COMMAND ImportSongs LABEL 'Import songs'
  INPUT Band TEXT REQUIRED
  INPUT Songs LIST REQUIRED
    FIELD Title TEXT REQUIRED
    FIELD Composer TEXT
    FIELD DurationSeconds NUMBER
  END.INPUT
  STEP importSongs CREATE Song FOR EACH Songs
    VALUE Band INPUT Band
    VALUE Title ITEM Title
    VALUE Composer ITEM Composer
    VALUE DurationSeconds ITEM DurationSeconds
  END.STEP
END.COMMAND
```

This is Giggle Band's own `ImportSongs` command, verbatim, from
`src/reference/giggle-band/domain.adlj`.

`INPUT <name> LIST [<type>]` declares a list of scalars; adding `FIELD` lines and
an `END.INPUT` terminator declares a list of records instead. Item `FIELD` lines
default to optional, matching the object `FIELD` line they are shaped like.

`FOR EACH <input>` makes a step plan one write per item into the same
transaction, so a batch either lands whole or not at all. `FOR_EACH` (one
word) is the deprecated spelling of the same clause — see "Deprecated
spellings" below. Inside such a step
`ITEM` is the whole item, `ITEM <field>` one of its fields, and `ITEM_INDEX` its
zero-based position. `ITEM` and `ITEM_INDEX` are refused outside an iterating
step.

An iterating step produces many records, so no step may refer to one with
`STEP x FIELD y` or `STEP x META y`: there is no single record for such a
reference to mean. That is refused at validation.

This exists because a command's steps are otherwise fixed at authoring time, and
so is the number of records it can write — importing fifty songs as fifty
independent transactions has no shared success or failure.

### Commands that create a context

A create step may declare that its new record becomes an instance of a business
context:

```adl
STEP createBand CREATE Band ESTABLISHES CONTEXT Band
  VALUE Name INPUT Name
  VALUE Description INPUT Description
  VALUE CreatedBy RUNTIME userId
END.STEP

STEP createFounderMembership CREATE BandMember AUTHORITY command
  VALUE User RUNTIME userId
  VALUE Band STEP createBand META guid
  VALUE Role LITERAL BandAdmin
  VALUE JoinedAt RUNTIME today
END.STEP
```

This is Giggle Band's own `CreateBand` command's step pair, verbatim, from
`src/reference/giggle-band/domain.adlj`.

For the rest of that transaction the new instance is in reach of the object-scope
gate, so the membership step can write a record scoped to a context that did not
exist when the transaction opened — which is otherwise refused, leaving a
context with no members and therefore no way in.

It reaches only the instance the step just created and does not survive the
command, so it cannot give a caller access to a context that already existed. It
confers no roles either; the membership record the next step creates is what
grants real access afterwards.

**A caveat worth knowing before relying on it.** A locally executed command is
replayed to the authority as one ordinary intent per step, not as a command, so
these two steps arrive as two unrelated writes with no shared transaction — and
the authority then refuses the membership, because the thing that would have made
the caller a member is exactly what was split apart. The authority's `command`
intent handles the whole command in one transaction and works correctly; what
does not yet exist is a client that emits one. See
`tests/command-authority-replay.test.ts`, which pins both halves.

### Reading an existing record

A step may `READ` an existing record instead of writing one, and bind it under
the step's own name for later steps to draw from:

```adl
COMMAND DuplicateEvent LABEL 'Duplicate event'
  INPUT SourceEventId TEXT REQUIRED
  INPUT NewDate DATE REQUIRED
  STEP source READ Event ID INPUT SourceEventId
  END.STEP
  STEP duplicate CREATE Event AUTHORITY command
    VALUE VenueName STEP source FIELD VenueName
    VALUE ContactName STEP source FIELD ContactName
    VALUE EventDate INPUT NewDate
  END.STEP
END.COMMAND
```

A later step reads a `READ` step's bound fields the identical way it already
reads a `create`/`update` step's own written record: `STEP <name> FIELD
<field>` or `STEP <name> META <property>`. There is no separate expression kind
for "a field of a record a READ step bound" — a `READ` step's binding and a
`create`/`update` step's own written record are the same kind of thing to a
later step's value expressions, so they share the one reference syntax.

A `READ` step's header takes only `ID <expr>` (`RECORD` is the deprecated
spelling of the same header — see "Deprecated spellings" below): no
`AUTHORITY`, no `FOR EACH`, and its body accepts only `REQUIRE` (evaluated
against the record it read, the same as any other step precondition) and
`END.STEP` — never `VALUE` (or its deprecated spellings `SET`/`PATCH`),
because a read step writes nothing.

`AUTHORITY` does not apply to a `READ` step because there is no write for it to
authorize. A `READ` step always goes through the caller's own read policy —
object scope, row policy, and field-level masking — the identical path a direct
API/UI read of the same record would take. It cannot see more of the source
record than the caller could see by reading it directly, and there is no
`AUTHORITY command` equivalent that would let it.

A step's value expressions may only reference a `READ` step (or any other step)
that executes _earlier_ in the same command; referencing one that has not run
yet, or does not exist, is refused at validation
(`ADL_COMMAND_STEP_REFERENCE_UNKNOWN`) rather than left to fail at runtime.

**Failure is whole-command failure**, matching every other step: a `READ`
step's target record not existing, or being denied by policy, fails the command
before any write is planned or committed — there is no partial result and
nothing already written by an earlier step in the same command survives.

## Model Versions And Migrations

A model declares its version with `MODEL_VERSION` in the `APP` block, and
declares how persisted data reaches that version with top-level `MIGRATION`
blocks:

```text
MIGRATION FROM '1.0.0' TO '1.1.0'
  OBJECT Gig
    SCHEMA_VERSION 2
    RENAME FIELD Venue TO VenueName
    ADD FIELD PayoutCents DEFAULT(0)
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
