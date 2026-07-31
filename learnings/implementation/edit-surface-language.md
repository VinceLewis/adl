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
through a *separate list view* because it could not declare them inside the set
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
  *presentation* section, and one view may declare both. Two different things
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
  because turning one *off* is otherwise unsayable.
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
- **A command crosses the wire as its *input*; a batch crosses as its *writes*.**
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
  *and* in the service, because neither layer may assume the other ran.
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
  applied where a *child* create is made: inside a parent form, where nothing
  asks for a context the user selected before opening it. **The prediction and
  the write must be seeded identically**; a policy patch that describes a write
  the runtime does not make is worse than no check.
- **A picker's candidates are existing *child* records, not the thing a user
  thinks they are picking.** `linkExisting` plans
  `planUpdate(child, {parentField: parent})`, so validation requires an object
  source to *be* the child object and a read-model source to include it. For a
  set list that means the picker offers `SetListItem` rows, not `Song` rows, and
  the reference app uses `READ_MODEL SetListItemsByPosition` so the candidate
  labels are song titles rather than guids. Picking a `Song` and having the
  platform mint the child record is a different operation the model cannot
  express; recorded as a gap, not worked around.
- **`unlink` is undeclarable for a required parent field.** `planStagedOperation`
  patches `{parentField: null}`, so a child whose lookup back to its parent is
  `REQUIRED` can never honour it. The language can declare the operation; that
  model cannot satisfy it. Nothing refuses it at compile time yet.

Two smaller ones worth knowing:

- **`editContainer` is read from the *active* view, not from the edit form
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
