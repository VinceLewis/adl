# Phase 60 - Making A Declared Child Collection Usable

> **Phase 59 handoff (accepted).** Phase 59 made the platform's edit-surface
> capability declarable in ADL — `EDIT_CONTAINER`, `EDIT_SECTION`,
> `CHILD_COLLECTION` and `PICKER` all parse, resolve to the existing
> resolved-model shapes and validate — and made a staged batch of child changes
> commit as one local transaction and replay as one authority operation under a
> new `batch` local-operation kind. The Giggle Band set list now edits its items
> in place, and the visual suite screenshots it on desktop and mobile.
>
> **This phase is the highest-value remaining gap repository-wide.** Every
> candidate below was checked against the code while writing this document. The
> reason this one wins is not that it is adjacent to Phase 59: it is that Phase 59
> shipped a capability a person **cannot operate**. The set-list surface renders,
> the transaction is correct, the conformance corpus pins it — and to add a song
> to a set list in the browser you must type a record guid into a bare text box.
> The canonical business-application editing pattern is now declarable,
> transactional, specified and unusable.
>
> That is a larger, more concrete loss than any capability that does not exist
> yet. The alternatives are recorded below with their evidence so a later phase
> does not re-derive them.

## Objective

Make a declared child collection usable by a person: child fields rendered by the
platform's real field renderer rather than as bare text inputs, an inline edit
path that carries values, and a picker that can offer a related object.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **Child draft fields bypass the field renderer entirely.**
  `AdlFormViewElement.renderChildDraft` (`src/ui/components/adl-form-view.ts:802`)
  maps every child field to
  `<input type="${field.type === "number" ? "number" : "text"}">`. It consults
  `field.lookup`, `field.validators`, `field.readonly`, enum values and every
  non-number `field.type` not at all. The parent form's own fields go through
  `adl-field-renderer`, which loads lookup options with `runtime.search` against
  the target object (`src/ui/components/adl-field-renderer.ts:99,197-233`) and
  applies `resolveFieldPresentation`. The same field is a select in one half of
  the form and a raw text box in the other.
- **The consequence is visible in this repository's own screenshots.** The Phase
  59 desktop capture of `SetListForm` shows the child draft row as `Position`,
  `Song`, `Notes` — three empty text inputs. `SetListItem.Song` is
  `TEXT REQUIRED LOOKUP Song DISPLAY Title`, so adding a song means typing
  `song-26121e9b-…`.
- **The row `Edit` button stages a write of nothing.**
  `handleChildClick` dispatches `updateChild` with `{section, operation,
  childObject, childId}` and no `values`
  (`src/ui/components/adl-form-view.ts`), and `planStagedOperation` calls
  `planUpdate(child, operation.values ?? {}, context)`. There is no inline child
  edit surface at all; the control exists, is enabled, and does nothing a user
  would recognise as editing.
- **A picker can only offer the child object itself.**
  `validateObjectRelationshipPickerSource` requires `source.name ===
  childObject.name` and `validateReadModelRelationshipPickerSource` requires the
  read model to list the child object as a source (`src/compiler/validate-model.ts`,
  `grep -a`). That is correct for `linkExisting`, which plans
  `planUpdate(child, {parentField: parent})` — but it means "pick a Song and add
  it to this set list" is inexpressible. The reference app had to point its picker
  at `READ_MODEL SetListItemsByPosition`, so it offers *existing set-list items
  from other set lists*, which is a real operation but not the one the surface is
  for.
- **`unlink` is declarable where it can never commit.** `planStagedOperation`
  patches `{parentField: null}`, so a child whose lookup back to its parent is
  `REQUIRED` — the overwhelmingly common case, and the reference app's — can never
  honour it. Nothing refuses it at compile time; the reference app simply omits
  the operation and no diagnostic would have told an author why.
- **`editContainer` is read from the wrong view.** `adl-app.activeEditContainer`
  returns `this.activeView.editContainer`, so `EDIT_CONTAINER` declared on a
  `FORM` view is inert unless that form view is itself navigated to. The reference
  app declares it on both the list and the form so the two entry points agree.
  Phase 59 delivered declarability; this is the semantics behind it.

This phase depends on `adl-field-renderer` and `resolveFieldPresentation` (the
existing field rendering path), on `EditSurfaceRuntime` and the `RuntimeEditChildRow`
contract, and on Phase 59's staged-batch transaction, which every inline edit must
continue to commit through.

### Candidates weighed and not chosen

Recorded with their evidence, per `learnings/process/phase-execution.md`.

- **`import` is a policy action and a runtime channel with no producer.**
  Re-verified: `grep -ran 'action: "import"' src/` and
  `grep -ran 'channel: "import"' src/` both return nothing, while `PolicyAction`
  includes `"import"` (`src/model/resolved-model.ts:123`) and `RuntimeChannel`
  includes it (`:133`). Real, and the strongest *capability* candidate — but it
  governs bulk ingestion, which does not exist, so nobody is currently prevented
  from doing anything they can otherwise do. Closing it means designing a feature;
  this phase repairs one people are already given.
- **`custom` sync scope has no runtime evaluator.**
  `offline-dataset-service.ts:287` returns `false` for it, so a declared `custom`
  scope silently contributes zero records to a device's dataset. Same
  no-producer class, narrower, and a strong candidate for the phase after this.
- **A lifecycle transition with side effects is still not transactional.** After
  Phase 57 (`command`) and Phase 59 (`batch`) this is the last multi-record write
  class that replays per record, recorded as still open in
  `learnings/implementation/command-intent-replay.md`. Real, but no surface in
  this repository yet demonstrates a loss from it.
- **No policy action for administering a context.** Narrower still; the
  administration surfaces are already gated server-side by `requireAdministration`.
- **Relationship-aware sync scope** remains an addition rather than a defect.

## Scope

- Render child draft and inline-edit fields through the same path the parent form
  uses, so a lookup is a picker, a date is a date control, a boolean is a
  checkbox, an enum is a select, and validators, readonly and policy-driven field
  presentation all apply.
- An inline child edit that carries values: `updateChild` must stage a real patch,
  and the row must offer a way to produce one.
- Let a picker offer a **related** object and mint the child record from the
  chosen candidate — the "pick a Song, get a SetListItem" operation — without
  weakening the existing `linkExisting` source rules.
- Refuse `unlink` at compile time when the child's parent field is `REQUIRED`,
  with a diagnostic that says why.
- Resolve `editContainer` from the view that actually opens, not from whichever
  view happens to be active.

## Constraints

- The resolved model is the contract. A new picker mode must resolve into
  `ResolvedRelationshipPicker` or extend it deliberately, with the specification
  updated in the same pass; never fork the shape.
- Policy enforcement stays in runtime services. Rendering a lookup as a select
  must go through `runtime.search`, which is already policy- and context-scoped;
  the browser must not read candidate records any other way.
- Every child write still commits through Phase 59's staged batch: one local
  transaction, one queued `batch` operation, Phase 58 record sync state across
  every record it wrote. An inline edit must not become a second write path.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 54 membership scoping, Phase 57 command replay, Phase 58 record sync
  state and Phase 59 batch semantics.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  anything touching the authority must be proven against real PostgreSQL under
  `tests/integration/`.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- Child draft and inline-edit fields rendered through `adl-field-renderer` and
  `resolveFieldPresentation`, with lookups, dates, booleans, enums, validators
  and readonly all honoured.
- An inline child edit that produces a real patch and commits inside the staged
  batch.
- A picker that can offer a related object and mint the child record, declarable
  in ADL, validated, and specified.
- A compile-time diagnostic refusing `unlink` on a required parent field.
- `editContainer` resolved from the opening view.
- Conformance cases for the new picker mode and the diagnostic; specification
  updates in `docs/spec/language.md`, `docs/spec/resolved-model.md`,
  `docs/spec/runtime-semantics.md` and `docs/spec/ui-language-addendum.md`.
- Real-PostgreSQL integration coverage for a batch containing a minted-from-picker
  child.
- Learnings updates in `implementation/edit-surface-language.md` and
  `implementation/browser-ui-runtime.md`.

## Acceptance Criteria

- A song is added to a set list in the browser by choosing it from a list, with
  no record id typed anywhere, and the resulting write commits inside the staged
  batch.
- A child row is edited in place, the edit carries the changed values, and
  cancelling the parent form discards it.
- A picker declared against a related object mints a correctly-scoped child
  record and discloses nothing a normal runtime read would not.
- A model declaring `unlink` on a required parent field fails to compile, with a
  diagnostic naming the field.
- `EDIT_CONTAINER` declared on a form view governs that form wherever it is
  opened from.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots — including
  the set-list edit capture this phase's changes will alter.

## Non-goals

- Bulk ingestion and the `import` policy action. Recorded above as the strongest
  remaining candidate after this one.
- Arbitrary nesting depth or grandchild sections. One level of child collection
  remains what the runtime implements.
- A generic form builder, CRDT/Automerge replication, a new sync protocol, or a
  second runtime.

## Dependencies

- `adl-field-renderer`, `resolveFieldPresentation` and the parent-form field path.
- `EditSurfaceRuntime`, `RuntimeEditChildRow` and the staged-change contract.
- Phase 59's `batch` transaction, which every child write must continue to use.

## Parallel Execution Plan

Serial spine first:

1. Any resolved-model change the new picker mode needs, its defaults, its
   validation, and the `unlink`-on-required diagnostic, in one pass with no
   consumers: `src/model/resolved-model.ts`, `src/compiler/resolve-model.ts`,
   `src/compiler/validate-model.ts`, `src/parser/parser.ts`, `src/parser/ast.ts`,
   `src/compiler/compile-adl.ts`.
2. The runtime signature for minting a child from a picker candidate, and for an
   inline edit that carries values — types and signatures only.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- Child field rendering through `adl-field-renderer`
  (`src/ui/components/adl-form-view.ts`, CSS) and its DOM tests.
- The inline edit path and its staged-batch integration
  (`src/ui/components/adl-app.ts`) and its DOM tests.
- The picker's mint-a-child runtime behaviour
  (`src/runtime/edit-surface-runtime.ts`) and its unit tests.
- Conformance cases, the runner extension and the specification.
- Reference application model and fixtures.
- Real-PostgreSQL integration coverage.

Keep serial: `src/parser/parser.ts`, `src/compiler/validate-model.ts`,
`src/model/resolved-model.ts`, `src/index.ts`,
`src/ui/components/register.ts` and shell chrome, ordered migration SQL, the
conformance runner and case schema, reference app fixtures, and specification
updates that must reconcile all streams.

Barriers: one `npm run test:integration` after the runtime and UI streams are
both in, then one `npm run verify:push` with manual screenshot inspection.

Two hazards Phase 59 confirmed are still live. `src/compiler/validate-model.ts`
and `src/conformance/runner.ts` each contain a NUL byte, so plain `grep` treats
them as binary and returns nothing silently — tell every agent to use `grep -a`,
and to check `grep -c` against `grep -ac` on any file it has just written. And
**two agents editing adjacent facts will disagree**: Phase 59 had one stream
update a derived nav-order assertion while another declared the same view
explicitly, which passed in both streams and failed only at the barrier. Give any
derived, whole-list assertion to exactly one owner.

## Tasks

1. Render child draft fields through `adl-field-renderer` and
   `resolveFieldPresentation`, honouring lookups, types, enums, validators and
   readonly.
2. Add an inline child edit that produces a real patch, staged and committed
   inside the Phase 59 batch.
3. Add a picker mode that offers a related object and mints the child record,
   with parser, validation and resolution support.
4. Refuse `unlink` at compile time on a required parent field.
5. Resolve `editContainer` from the opening view.
6. Use all of it in the Giggle Band reference app: add a song to a set list by
   choosing it.
7. Add conformance cases and specification coverage.
8. Add real-PostgreSQL integration coverage for a batch containing a
   minted-from-picker child.
9. **Required next-phase planning handoff:** before Phase 60 closes, write
   `docs/phases/phase-61-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. If no gap
   justifies a further phase, record that conclusion explicitly instead. Then
   verify, commit, and push Phase 60.
