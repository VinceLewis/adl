# Edit Surfaces In The Language

Read this before changing ADL syntax for `EDIT_CONTAINER`, `EDIT_SECTION`,
`CHILD_COLLECTION` or `PICKER`, before changing how an edit surface's staged
child changes are committed or queued, or before adding any other ad-hoc
multi-record write.

## The defect this closes

The platform had a complete parent-with-children editing capability and **no ADL
model could declare any of it**. `src/runtime/edit-surface-runtime.ts` was a
thousand lines, `ResolvedEditChildCollectionSection` and
`ResolvedRelationshipPicker` were resolved-model types, `validate-model.ts`
carried sixteen diagnostic codes for them, `adl-form-view.ts` rendered child
sections and the relationship picker, and `docs/spec/resolved-model.md` specified
the lot. The only producers of `ResolvedView.editSections` were hand-built
partial models in TypeScript, because the parser had no syntax for them. Every
ADL-authored view got the platform's default single `fields` section and nothing
else.

The Giggle Band reference app showed the cost: `SetListItem` carries an `ORDERED`
constraint scoped to its parent set list, and the app edited set-list items
through a _separate list view_ because it could not declare them inside the set
list. The ordered-collection runtime that reorders them was built for a surface
the language could not express.

Underneath that, the capability was not transactional. `applyStagedChanges`
looped over the staged operations calling `create`/`update`/`delete` one at a
time, so a batch of staged child changes was neither one local transaction nor
one queued operation — the exact failure Phase 57 closed for commands, still open
here and invisible only because nothing could reach it.

## The syntax

Declared inside an ordinary object-scoped `VIEW` block. It resolves to the
**existing** `ResolvedView.editContainer`, `ResolvedEditSection`,
`ResolvedEditChildCollectionSection` and `ResolvedRelationshipPicker` shapes; no
resolved-model shape was forked or changed.

```
VIEW SetListForm FORM
  FIELDS Name Description
  EDIT_CONTAINER page                 # modal | drawer | page | splitPane

  EDIT_SECTION Details HEADING 'Set list'
    FIELDS Name Description           # optional; omitted means the view's fields
  END.EDIT_SECTION

  CHILD_COLLECTION Items HEADING 'Songs'
    CHILD SetListItem PARENT_FIELD SetList   # both required
    CHILD_VIEW SetListItemList               # optional
    OPERATIONS createChild linkExisting updateChild unlink remove reorder
    STAGED                                   # bare = true; `STAGED false` also parses
    ORDER_FIELD Position
    EMPTY_TEXT 'No songs in this set list yet.'
    PICKER SongPicker
      SOURCE OBJECT Song                     # or SOURCE READ_MODEL <name>
      SELECTION multiple                     # single | multiple
      DISPLAY Title Composer
      SEARCH Title Composer
      SORT Title ASC
      EXCLUDE_LINKED                         # bare = true
      EMPTY_TEXT 'Every song is already in this set list.'
    END.PICKER
  END.CHILD_COLLECTION
END.VIEW
```

### Decisions

- **`EDIT_SECTION`, not `SECTION`.** A view's `SECTION` already means a composed
  _presentation_ section, and one view may declare both. Two different things
  could not share one keyword without one of them changing meaning by position.
  This is why the wrapping-`EDIT`-block alternative was rejected: it would have
  bought back the shorter keyword at the price of a second nesting level on every
  declaration, including the common single-section case.
- **`CHILD` and `PARENT_FIELD` are both required.** The child object alone does
  not say which of its lookups points back at this parent, and inferring one
  would silently pick a field whenever an object has two.
- **The flag directives default to true when written bare** (`STAGED`,
  `EXCLUDE_LINKED`), because the resolved-model defaults are `true` and the bare
  word has to read as English. The explicit `STAGED false` form exists only
  because turning one _off_ is otherwise unsayable.
- **Underscored keywords only; no dotted aliases.** `READ_MODEL`/`READ.MODEL` and
  `ICON_MAP`/`ICON.MAP` accept both for historical reasons. New keywords accept
  the underscore form alone, which also keeps `END.CHILD_COLLECTION` unambiguous.
- **An authored empty list is never produced.** `compileAdl` omits
  `editSections` entirely when a view declares none, so resolution still supplies
  the default `fields` section over `view.fields`; an empty array would resolve to
  a view with no editable fields at all. The same reasoning omits a picker's
  `displayFields`/`searchFields`/`sort` when unauthored rather than sending `[]`.
- **Validation needed no new codes.** Every `ADL_VIEW_EDIT_SECTION_*` and
  `ADL_RELATIONSHIP_PICKER_*` diagnostic already existed and validates the
  resolved model, so making the shapes reachable from source made the existing
  diagnostics reachable too. This is the payoff of validating the resolved model
  rather than the AST.

## The staged batch is one transaction

`EditSurfaceRuntime.applyStagedChanges` now **plans** every staged operation
(`planStagedOperation`) and commits them through a single
`ObjectStore.commitPlannedTransaction(writes, context, { batch: { label } })`.

- **`LocalOperationKind` gained `"batch"`**, the sibling of `"command"` for a
  transaction no model declares. `commitPlannedTransaction` records every write
  in the operation log for local history and queues exactly one entry for the
  whole batch, reusing the `queue` flag Phase 57 added to `recordOperation`
  rather than adding a second code path.
- **A command crosses the wire as its _input_; a batch crosses as its _writes_.**
  That is the only real difference between the kinds, and it follows from the
  model: the authority can re-execute a command because the command is declared,
  and there is nothing to re-execute for a batch. It is a difference in payload,
  never in trust — `AuthorityService.applyBatch` plans each write through
  `planCreateForTransaction`/`planUpdateForTransaction`/`planDeleteForTransaction`,
  so policy, validation, lifecycle, scope and constraints all run server-side, a
  create's supplied id is shape-checked and refused when taken, and a stale base
  revision is a conflict. The only thing the batch adds is that none of them
  lands unless all do.
- **`"batch"` had to go into `DEFAULT_OPERATION_LOG_OPERATIONS`**, for the reason
  [[command-intent-replay]] records for `"command"`: the operation log gates the
  sync queue, so a kind the model does not log is never queued and has no
  delivery path at all. The failure is silent.
- **`AuditOperation` excludes `"batch"` as well as `"command"`.** Audit is per
  record; the batch's writes are each audited already, and a batch audit event
  would describe the same work twice at two granularities.
- **`coveredQueueRecords` needs no manifest for a batch.** A command carries
  `records` and `recordIds` because its re-execution decides what it writes; a
  batch's writes already say which of them are creates. Phase 58 record sync
  state therefore applies across the whole batch for free — `pending` while
  queued, `rejected` on every record when the authority refuses it.
- **The HTTP edge parses and bounds the batch.** `MAX_BATCH_WRITES` exists for
  the reason `MAX_COMMAND_RECORD_IDS` does: one request must not be able to ask
  the authority to plan an unbounded transaction, and the body-size limit alone
  would still allow a very large one. Each write is shape-checked at the edge
  _and_ in the service, because neither layer may assume the other ran.
- **The batch is labelled after the parent.** A queue entry carries one object's
  sync declaration and is filed under a representative record — for a staged
  batch, a child. Without a label, a refused set-list edit would be presented to
  the user as a rejection against a set-list item row they never touched
  directly, which is the same misnaming Phase 57 had to fix for commands.
- **`commitPlannedTransaction` refuses `command` and `batch` together.** Both
  mean "queue this as one entry", and a transaction cannot be two units of work.

### What planning against pre-transaction state means here

Every write in a batch is planned before any of them is committed, so a plan
cannot see another plan's uncommitted work. This is the same contract commands
have had since Phase 57, and it has two consequences worth stating:

- **Two staged operations naming the same child record are last-write-wins**, not
  a partial commit. The browser collapses repeated edits of one row into a single
  staged operation before submitting, which is where that is prevented.
- **Ordered-collection expansion is what makes a reorder coherent.**
  `expandOrderedCollectionWrites` reserves every requested position before
  arranging siblings and excludes explicitly-written records from shifting, so a
  reorder plus an insert in one batch commits one coherent set of positions
  rather than a sequence of intermediate ones. Callers must not plan their own
  shifts.

## What using it in a real model exposed

The reference app is the phase's proof, and it found three things a fixture never
would have.

- **A context-scoped child could not be created or linked at all.**
  `evaluateCollectionAction` built the policy patch as
  `{[parentField]: parent.guid}` and nothing else. `SetListItem` is
  `SCOPE Band FIELD Band`, so the policy engine had no context id to resolve
  context roles against, `ROLE BandAdmin` could not match, and the collection's
  Add and Link controls silently did not render for a band admin who had been
  granted exactly that role. `planStagedOperation`'s `createChild` had the same
  hole and would have failed the required-field check and the object-scope gate.
  Both now seed the scope value from the caller's own selection — the rule
  `applySelectedScopeToCreateValues` already applies to top-level creates,
  applied where a _child_ create is made: inside a parent form, where nothing
  asks for a context the user selected before opening it. **The prediction and
  the write must be seeded identically**; a policy patch that describes a write
  the runtime does not make is worse than no check.
- ~~**A picker's candidates are existing _child_ records, not the thing a user
  thinks they are picking.**~~ **Closed.** `linkExisting` plans
  `planUpdate(child, {parentField: parent})`, so a linking picker's source must
  be the child object — which made "add a song to this set list" inexpressible
  and left adding a child meaning _typing a record guid into a bare text box_.
  A picker may now name a `CANDIDATE_FIELD`, which turns it from one that links
  into one that **creates**: the candidates become that field's lookup target,
  and each choice mints a child naming it. See "Minting pickers" below.
- ~~**`unlink` is undeclarable for a required parent field.**~~ **Closed.**
  `planStagedOperation` patches `{parentField: null}`, so a child whose lookup
  back to its parent is `REQUIRED` can never honour it. The language could
  declare the operation and that model could not satisfy it. See
  "Refusing an operation no model can satisfy" below.

Two smaller ones worth knowing:

- ~~**`editContainer` is read from the _active_ view, not from the edit form
  view.**~~ **Closed.** `adl-app.activeEditContainer` returned
  `this.activeView.editContainer`, so `EDIT_CONTAINER` on a `FORM` view was inert
  unless that form view was itself navigated to. It now reads
  `this.editFormView.editContainer`. See "The container belongs to the form"
  below.
- **Child rows rendered raw lookup guids.** `adl-list-view` resolves a `LOOKUP`
  column to its display value and the child-row renderer did not, so the same
  column showed a name in one place and `song-26121e9b-…` in another. The
  child-row renderer now mirrors that component's cache — same key, same
  read-through the policy-enforcing `runtime.read`, same fall back to the id when
  the target cannot be read.

## Minting pickers

A `PICKER` naming a `CANDIDATE_FIELD` creates children instead of re-parenting
them. It is the difference between "move a set-list item into this set list" and
"add this song to this set list", and only the second is what a person opening a
set list is trying to do.

```
PICKER SongPicker
  SOURCE OBJECT Song        # the CANDIDATE object, not the child object
  CANDIDATE_FIELD Song      # the child field that receives the chosen record's id
  SELECTION multiple
  DISPLAY Title Composer
  EXCLUDE_LINKED
END.PICKER
```

- **The candidate object is read off the model, not off `SOURCE`.**
  `candidateObjectName` returns the candidate field's lookup target, so an object
  source and a read-model source cannot disagree about what is being chosen.
  Validation then requires `SOURCE` to name that target (object kind) or include
  it (read-model kind), which is the same rule the linking mode has, pointed at a
  different object.
- **The required operation changes with the mode.** A minting picker needs
  `createChild` in the section's operations, a linking one needs `linkExisting`.
  Requiring `linkExisting` of a minting picker would have refused the very
  declaration the feature exists to allow.
- **`EXCLUDE_LINKED` means a different thing in each mode.** Linking excludes
  child records already under this parent. Minting excludes the _candidates_
  those children already name — a song already in the set list is what must not
  be offered, and the set-list item's own id would not identify it. Candidates
  named by staged creates in the same session are excluded too, or ticking the
  same song twice before saving would add it twice.
- **A staged create in an ordered collection appends.**
  `EditSurfaceRuntime.nextAppendPosition` reads the current maximum once per
  section and counts forward in memory, because every write in a batch is planned
  before any is committed and a second read would hand out the same slot twice. A
  caller-supplied position still wins. Without this a required `ORDER_FIELD`
  simply refused the write, so "add" was unusable on exactly the collections that
  most want it.
- **The browser stages the candidate as a _value_, never as `childId`.** Staging
  it as `childId` would have named a child record that does not exist yet and, in
  the same breath, named the song's record as though it were one.
- **A minting picker suppresses the bare child draft row**, and the section
  header renders one control that opens the picker — "Add" when minting, "Link"
  when linking. Two ways to add, one of them requiring a typed record id, is
  worse than one that works.

## Inline child editing

Two defects closed together, because neither could be fixed alone.

- **`Edit` opened nothing and wrote nothing.** It dispatched `updateChild` with
  no values, so the runtime planned an empty patch — a control that looked
  enabled, did nothing a person would recognise as editing, and still burned a
  revision and a queue entry on every click. Clicking it now _opens_ the row;
  `Save` stages `updateChild` carrying only the fields that actually changed, and
  stages nothing when nothing did; `Cancel` discards without dispatching. The
  runtime refuses an empty patch outright, so no caller can reintroduce it.
- **Child fields bypassed the field renderer.** The draft row emitted a bare
  `<input>` per field, consulting neither `field.lookup` nor `field.type` beyond
  number, nor validators or readonly — so the same field was a chooser on the
  parent form and a box you typed a record id into one section below.
  `configureChildFieldEditors` now points both the draft row and the row editor
  at `adl-field-renderer` and `resolveFieldPresentation` against the **child**
  object, which is what makes them behave identically.

Three consequences that are easy to get wrong:

- **`collectValues()` had to be scoped.** It selected every `adl-field-renderer`
  in the component, so the moment children had renderers their values were folded
  into the _parent_ record's patch. It now selects
  `adl-field-renderer[data-field-slot]`, and the child surfaces use their own
  attributes.
- **Typing into a child surface must not re-render the parent form.** Parent
  input becomes parent draft state, and a draft change re-renders the app, which
  recreates this element — wiping what is being typed. The picker was already
  guarded for exactly this reason; the draft row was not, which is why typing
  into it used to be lost. The guard now covers `.adl-relationship-picker`,
  `.adl-child-editor` and `.adl-child-draft`.
- **The `ORDER_FIELD` is excluded from both surfaces.** A new child is appended
  and reordering has its own controls, so an editable position would be a second
  source of truth for the same value in the same row.

Two more that only appeared once a child had fields worth editing:

- **Absent and empty are the same state, and comparing them raw is not.** A
  control for an optional field the record never carried reads back as `null`,
  while the row has no key for that field at all, so `collectChildEditorValues`
  saw a change in every untouched empty field: editing one field staged a patch
  of nulls over fields nobody touched, and closing an editor over no change at
  all staged a write. Compare `current[field.name] ?? null` against the control's
  value. The draft row has the same shape and needs the same treatment — there,
  skipping `null` is also what stops a blank control overwriting a declared
  `DEFAULT`.
- **A control that states its own value has to keep stating it.** The word beside
  a checkbox is rendered from the value `adl-field-renderer` was given, so
  ticking the box left a ticked box beside the word "No" until something
  re-rendered the element. It is now updated on `change` and by
  `syncRenderedInputValue`, so both a person's tick and a programmatic value
  agree with it. This was caught by inspecting the set-list screenshot, not by
  any DOM test, which is the argument for that step existing.

Watch the attribute names. Row action buttons carry `data-child-action-row`
while the row element alone keeps `data-child-row`; putting the same attribute on
both made `[data-child-row]` match nine elements instead of three, which a test
caught only because it counted. The same trap had already appeared with
`data-child-section`.

## Refusing an operation no model can satisfy

`unlink` detaches a child by patching its lookup back to the parent to null, so a
`REQUIRED` parent field can never honour it — and a required parent field is the
overwhelmingly common case, including the reference app's.
`ADL_VIEW_EDIT_SECTION_UNLINK_PARENT_FIELD_REQUIRED` now refuses the declaration
at compile time, naming the field and the remedy.

The interesting part is what writing that check exposed. **The resolver's default
operation set was `createChild updateChild unlink`**, so the first run of the new
diagnostic refused every child collection in the repository that declared no
`OPERATIONS` at all — including the example the language documentation ships. The
default was invalid by construction for the common case, and had been since Phase
59; nothing noticed because nothing checked.

The default is now `createChild updateChild remove`. Two rules come out of this:

- **A default must be a set every model can honour.** A default that only some
  models can satisfy is not a default, it is an undeclared precondition. This is
  the same reasoning that makes `compileAdl` omit an unauthored `editSections`
  rather than send `[]`.
- **`remove` is the right substitute, not "nothing".** It takes a child out of
  the collection in a way any model can satisfy, and it is still gated by the
  child object's `delete` policy action, so making it the default grants nobody
  anything policy did not already allow. Dropping removal from the default
  instead would have made the unauthored collection unable to shrink.

Expect this change to move every model's fingerprint that relies on the default,
for the reason `DEFAULT_OPERATION_LOG_OPERATIONS` does: the resolved model's
content genuinely changed.

## The container belongs to the form

`EDIT_CONTAINER` describes how a form is presented, so it is read from the form
that opens, never from whichever view happens to be active. `activeEditContainer`
returns `this.editFormView.editContainer`, and `renderCrudWorkspace` renders from
the same value.

That second half is the part that bites. Behaviour read `activeEditContainer`
while rendering read the parameter it was passed — `view.editContainer` — so
changing only the getter produced a workspace that painted itself
`data-edit-container="splitPane"` while every branch that decides what to do with
a split pane disagreed. **When a value moves, move every reader of it in the same
pass**; a rendering path that describes a mode nothing implements is worse than
the original defect, because it looks correct.

A consequence worth stating plainly: `EDIT_CONTAINER` on a `LIST` view no longer
governs the form that list opens. Declaring it there is not an error — a list may
itself be opened as an edit surface — but it is not how a list controls its form.

## Projected fields and summary (Phase 87)

A real, concrete need: showing a set list's total duration on
`SetListForm`'s `Songs` child collection — the page where songs are actually
added, removed and reordered — not on a separate browse screen. Two small,
`.adlj`-only additions to `ResolvedEditChildCollectionSection`:
`projectedFields?: ResolvedProjectedField[]` (a row field sourced from a
related object reached through one of the child object's own lookup fields —
`SetListItem.Song` → `Song.DurationSeconds`, not just the child object's own
stored fields) and `summary?: ResolvedEditChildCollectionSummary` (one
aggregated value — `sum`/`avg`/`min`/`max`/`count` — over the collection's
current rows, persisted and staged together, at `header` or `footer`).
Neither had `.adl` text syntax when Phase 87 added them — same treatment as
`MATRIX` and a calendar's `conflictOverlay` — because the concrete need was
JSON-authorable already and inventing text grammar under time pressure for a
construct not yet proven out is how a language accumulates syntax nobody asked
for. Phase 100 added it once both were proven out in a shipped application:
`PROJECTED_FIELD <name> THROUGH <lookup> FIELD <target>` and
`SUMMARY <aggregate> [<field>] ... END.SUMMARY` (see
`docs/spec/language.md`'s Edit Surfaces section). The deferral was the right
call in Phase 87 and closing it was the right call in Phase 100; what changed
in between is that the constructs stopped being speculative.

### Two alternatives considered and rejected

- **Async computed fields.** `computed-fields.ts`'s
  `applyComputedFieldsToRecord` is synchronous — it evaluates a field's
  expression over the record's own already-loaded `values` only, no object
  store access, no `await` anywhere in the call chain. Reaching a *related*
  object's field would mean making that evaluation async, which every call
  site of computed fields would have to absorb — a broad, invasive change
  across the runtime for a need that is really scoped to one rendering path
  (one `CHILD_COLLECTION` section). Rejected in favor of the smaller,
  contained option: resolve the projected field only where it is rendered
  (`toPersistedChildRow`/`evaluateStagedChildRows` in
  `edit-surface-runtime.ts`), not everywhere a computed field is evaluated.
- **A generic `SUMMARY` on the presentation `LIST`.** The phase's own first
  design draft, and *wrong*: a `CHILD_COLLECTION` edit section is evaluated
  entirely by `EditSurfaceRuntime.evaluateChildCollectionSection`, producing
  `RuntimeEditChildCollectionSection`/`RuntimeEditChildRow` — a completely
  separate type and code path from `PresentationRuntime.evaluateList`/
  `RuntimePresentationList`. A construct built against the presentation-`LIST`
  path never reaches `SetListForm`'s `Songs` section, because that section
  is not a `LIST` — it is a child collection, rendered by a different
  runtime class entirely. Tracing which pipeline actually renders the target
  screen *before* designing the construct is what caught this; it would not
  have been caught by testing the construct in isolation, only by trying to
  reach the real screen with it. A `SUMMARY` on the generic presentation
  `LIST` remains a real, separable piece of future work if a non-child-collection
  list ever wants the same idea — deliberately not attempted here, to keep
  this phase's scope to the one pipeline the concrete need actually reaches.

### Why the policy-safe read path is `this.dataSource.read`, not `ObjectStore.getRecordForRuntime`

Phase 71's command `READ` step (`command-service.ts`'s `planStepRead`) reads
a related record via `this.objectStore.read(step.object, recordId,
stepContext)` — object scope, row policy, and field-level read shaping all
apply, deliberately: "a command step gets no more of the record than the
caller could see by reading it directly." `edit-surface-runtime.ts` already
had the same method available on its own `this.dataSource`, so the
projected-field fetch reuses it rather than building a second, weaker read
path. `ObjectStore.getRecordForRuntime` was considered and rejected — it
applies **no** read policy at all, which is correct for its own narrow job
(elsewhere in the runtime) and wrong here: a projected field is a value the
UI shows a person, and it must be shaped by the same policy a direct read of
that record would apply.

A denied or missing projected-field fetch degrades to `null`, never throws:
- **Found and readable**: `values[name] = record.values[field] ?? null`.
- **`PolicyDeniedError`**: caught, `values[name] = null`, and a warning
  diagnostic (`ADL_EDIT_CHILD_PROJECTED_FIELD_DENIED`) is recorded on the
  surface rather than the error propagating and failing the whole section's
  rendering — the general diagnostics-not-crashes posture this project
  already follows elsewhere (`ADL_PRESENTATION_FIELD_MISSING` is the model).
- **Missing/absent lookup value** (the row's own lookup field is `null` or
  not a string — should not happen for a `REQUIRED` lookup like
  `SetListItem.Song`, but is not assumed): `values[name] = null`, no fetch
  attempted at all, no diagnostic (this is not an exceptional case — a
  staged draft row genuinely may not have chosen a related record yet).
- A related record that *did* exist at the id but has since been deleted
  (`this.dataSource.read` returns `null`, not a thrown error) is treated the
  same as "missing" — `null`, no diagnostic. Only a policy *denial* is
  reported, because only a denial is something an author or reviewer would
  want to know about; a dangling reference to a deleted record is not a
  policy question.

Fetches are cached only *within* one `evaluateChildCollectionSection` call
(keyed by `` `${targetObjectName}:${lookupValue}` ``), so ten rows naming the
same related record cost one read, not ten — but the cache is thrown away at
the end of the call. No cross-request cache: caching across calls would mean
a projected field could show a value staler than the record it was read
from, for a feature whose entire point is being live against unsaved edits.

### The summary is computed over the *final* assembled row set

`computeChildCollectionSummary` runs in `evaluateChildCollectionSection`
*after* `rows: [...persistedRows, ...stagedRows]` is fully assembled — which
is the whole reason this lives here rather than in a hypothetical generic
`LIST`-level summary: this collection already recomputes its full row set on
every add/remove/reorder before save, so a summary computed from that same
already-assembled row set updates live as a person edits, with no additional
wiring, no separate "recompute the total" step to remember to call. `null`
per-row values are skipped (matching the convention `formatPresentationValue`
already uses elsewhere), and `field` is validated to resolve against the
child object's own fields **or** the section's own `projectedFields` names —
in that order, since a projected field's resolved type is only known once
`projectedFields` itself has been validated. `count` is the one aggregate
that tolerates an absent `field`: present, it counts rows with a non-null
value for that field; absent, it counts every row.

### The `duration` format kind

Added to `PresentationFormatKind` generally (usable anywhere a presentation
format is declared, not only in a child-collection summary), with a
`formatDuration` function in `presentation-runtime.ts` alongside the existing
date/time formatters. Supports one pattern, `m:ss` (minutes, then seconds
zero-padded to two digits) — the shape a duration actually needs
(`giggle-new`'s own real display, `"47:20"`), following `applyTimePattern`'s
small-closed-token-vocabulary style rather than inventing a different
convention. `formatPresentationValue` itself had to be exported from
`presentation-runtime.ts` — previously module-private — because the child
collection summary is the first consumer of that formatter from outside the
presentation runtime.

## Practical guidance

- Add syntax by extending the AST-to-partial-model conversion, never by
  bypassing the resolver or validator. `viewToPartial` in
  `src/compiler/compile-adl.ts` is the whole of the wiring for this phase.
- When adding a new `LocalOperationKind`, `npx tsc --noEmit` finds the exhaustive
  maps (`OPERATION_KIND_LABELS` in `src/ui/authority-bridge.ts` is deliberately a
  `Record<LocalOperationKind, string>` so the next kind is a compile error) but
  **not** the string-comparison branches. Grep for `=== "command"` as well, and
  check `DEFAULT_OPERATION_LOG_OPERATIONS`, `AuditOperation`,
  `LocalRecordWriteKind`, `coveredQueueRecords`, `toIntent`, `AuthorityService.apply`
  and the HTTP edge's `operationIntent`.
- Adding a value to `DEFAULT_OPERATION_LOG_OPERATIONS` changes every model's
  fingerprint, because `computeModelFingerprint` digests the whole resolved model
  including `operationLog`. That is correct — the content genuinely changed — but
  expect resolution tests that pin the list to fail.
- `src/compiler/validate-model.ts` and `src/conformance/runner.ts` both contain a
  NUL byte, so plain `grep` treats them as binary and returns nothing silently.
  Use `grep -a`, and check `grep -c` against `grep -ac` on any file you have just
  written.
