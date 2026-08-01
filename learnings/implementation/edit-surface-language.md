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
- **`unlink` is undeclarable for a required parent field.** `planStagedOperation`
  patches `{parentField: null}`, so a child whose lookup back to its parent is
  `REQUIRED` can never honour it. The language can declare the operation; that
  model cannot satisfy it. Nothing refuses it at compile time yet.

Two smaller ones worth knowing:

- **`editContainer` is read from the _active_ view, not from the edit form
  view.** `adl-app.activeEditContainer` returns `this.activeView.editContainer`,
  so `EDIT_CONTAINER` on a `FORM` view is inert unless that form view is itself
  navigated to. The reference app declares it on both the list and the form so
  the two entry points agree.
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

Watch the attribute names. Row action buttons carry `data-child-action-row`
while the row element alone keeps `data-child-row`; putting the same attribute on
both made `[data-child-row]` match nine elements instead of three, which a test
caught only because it counted. The same trap had already appeared with
`data-child-section`.

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
