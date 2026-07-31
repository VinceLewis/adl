# Phase 59 - Edit Surfaces in the Language, and the Transaction They Are Missing

> **Phase 58 handoff (accepted).** Phase 58 gave every record an honest, produced
> sync state: `pending`, `conflict` and `rejected` now have writers, a verdict is
> recorded on every record the operation wrote and outlives the queue entry that
> carried it, the `syncStatus` shell control reports record state while a new
> `connectivity` control reports reachability, and a record whose own create the
> authority refused can be discarded locally. It also added `syncReconcile` to
> the conformance runner, which for the first time joins the device's queue to
> the wire.
>
> **This phase is the highest-value remaining gap repository-wide.** The
> candidates Phase 58 listed as its successors were each checked against the code
> while writing this document, and one of them turned out to be much larger than
> it looked from the outside — while a gap nobody had recorded turned out to be
> larger still.
>
> The platform has a complete parent-with-children editing capability — a
> 1,004-line `EditSurfaceRuntime`, child collections, relationship pickers,
> staged changes, six child operation kinds, sixteen validation codes, browser
> rendering, 625 lines of tests and a specification section — and **no ADL model
> can declare any of it**. The parser has no syntax for `editSections`, so every
> ADL-authored view gets the platform's default single `fields` section and
> nothing else. The canonical business-application editing pattern — an order
> with its lines, an invoice with its rows, a set list with its songs — is
> unreachable in the language this repository exists to implement.
>
> Underneath that, the capability itself is not transactional. `applyStagedChanges`
> loops over the staged operations and calls `create`/`update`/`delete` one at a
> time, so a batch of staged child changes is neither one local transaction nor
> one queued operation. It is the exact failure Phase 57 closed for commands,
> still open here — and invisible today only because nothing can reach it.
>
> The other recorded candidates are real and each strictly smaller, and are
> recorded below with their evidence so a later phase does not re-derive them.

## Objective

Make the platform's edit-surface capability declarable in ADL, and make a staged
batch of child changes commit as one transaction and replay as one operation.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **No ADL syntax reaches `editSections`.** `grep -a` for `editSections`,
  `EditSection`, `childCollection`, `CHILD_COLLECTION` and `EDIT_SECTION` across
  `src/parser/parser.ts`, `src/parser/ast.ts` and `src/compiler/compile-adl.ts`
  returns nothing. `resolveViewModel` (`src/compiler/resolve-model.ts:766`) reads
  `input.editSections`, and the only producers of that input are hand-built
  partial models in TypeScript.
- **The capability behind it is fully built.**
  `src/runtime/edit-surface-runtime.ts` is 1,004 lines;
  `ResolvedEditChildCollectionSection` and `ResolvedRelationshipPicker` are
  resolved-model types; `validate-model.ts` carries at least sixteen codes for
  them (`EDIT_SECTION_CHILD_OBJECT_UNKNOWN`, `EDIT_SECTION_PARENT_FIELD_INVALID`,
  `EDIT_SECTION_ORDER_FIELD_UNKNOWN`, `PICKER_LINK_OPERATION_REQUIRED` among
  them); `adl-form-view.ts` renders child sections; `ApplicationRuntime` exposes
  `evaluateEditSurface`, `applyStagedChildChanges` and
  `evaluateRelationshipPicker`; `tests/edit-surface-runtime.test.ts` is 625
  lines; and `docs/spec/resolved-model.md#view-presentation` specifies all of it.
- **The reference app shows the shape of the loss.** `SetList` and `SetListItem`
  exist in `src/reference/giggle-band/domain.adl`, `SetListItem` carries an
  `ORDERED` constraint scoped to its parent set list, and the app edits set-list
  items through a *separate list view* because it cannot declare them inside the
  set list. The ordered-collection runtime that reorders them was built for the
  surface the language cannot express.
- **`editContainer` has the same shape of gap, and the specification says so.**
  `docs/spec/resolved-model.md` states plainly that `editContainer` "is
  model-level only in the current implementation; ADL source syntax for choosing
  it is not implemented yet". It is one keyword's worth of work in the same
  place, and leaving it out would ship a second phase of this one.
- **A staged batch is not a transaction.**
  `EditSurfaceRuntime.applyStagedChanges` iterates `input.stagedChanges` and
  calls `applyStagedOperation` per item, which calls
  `dataSource.create`/`update`/`delete` — each of which is a separate
  `ObjectStore.commitPlannedTransaction([write])`, a separate operation-log entry
  and a separate queue entry. So a staged batch can fail halfway and leave the
  parent's children half-changed locally, and can land partially at the
  authority. `learnings/implementation/command-intent-replay.md` records this
  class as still open: "an ad-hoc multi-record write ... still replays as
  independent per-record intents and can still land partially."
- **The pieces to fix it already exist and were built for exactly this.**
  `ObjectStore.commitPlannedTransaction` takes a list of planned writes and
  commits them in one storage transaction, and Phase 57's `command` local
  operation kind carries a whole transaction as one queue entry. Neither is
  reachable from the staged-change path today.

### Candidates weighed and not chosen

Recorded with their evidence, per `learnings/process/phase-execution.md`.

- **`import` is a policy action and a runtime channel with no producer.**
  `PolicyAction` includes `"import"` and `RuntimeChannel` includes `"import"`;
  `grep -a` finds no `requireAllowed({... action: "import" ...})` and no
  `channel: "import"` anywhere in `src/`. `export` has a call site
  (`authoritative-reporting.ts:260`); `import` has none. The reference app's
  `ImportSongs` is an ordinary command governed by `create` on `Song`, so an
  author who writes `DENY import` gets nothing. Real, and the same class Phase 56
  and Phase 58 closed — but it governs a capability that does not exist yet, so
  closing it honestly means designing bulk ingestion, not wiring a check. Smaller
  in user-visible terms than a shipped subsystem the language cannot reach.
- **No policy action for administering a context.** Narrower still, and the
  administration surfaces are already gated server-side by
  `requireAdministration`.
- **`custom` sync scope has no runtime evaluator**
  (`learnings/implementation/offline-dataset-runtime.md`). A declared scope that
  contributes no records — again the no-producer class, and again narrower.
- **Relationship-aware sync scope** remains an addition rather than a defect.
- **Offline dataset over-inclusion via `SCOPE all` read-model sources** was
  investigated and does not reproduce as a disclosure gap:
  `recordMatchesReadModelSourceContext` falls through to
  `recordMatchesAvailableObjectContext`, which still bounds records to the
  caller's available contexts.

This phase depends on the resolved-model edit-surface types (present since the
UI-presentation phases), on `ObjectStore.commitPlannedTransaction` (Phase 56
ordered collections and Phase 57 command transactions), and on Phase 57's
`command` queue entry as the precedent for carrying a transaction across the sync
boundary.

## Scope

- ADL source syntax for a view's edit sections: field sections with headings, and
  child-collection sections naming the child object, the parent field, an
  optional child view, the permitted child operations, staged-change behaviour,
  an optional order field and empty-state text.
- ADL source syntax for a child collection's relationship picker: source kind and
  source, selection mode, display and search fields, sort, exclude-already-linked
  and empty state.
- ADL source syntax for `editContainer`, which the specification already records
  as missing.
- Parser, AST, `compileAdl` and validation coverage for all of the above,
  reusing the existing resolved-model shapes and validation codes rather than
  inventing parallel ones.
- Make a staged batch commit as **one** local transaction through
  `commitPlannedTransaction`, and reach the authority as **one** operation, so it
  cannot land partially on either side.
- Use the capability in the reference application, so the syntax is proven by a
  real model rather than by a fixture: `SetList` should edit its `SetListItem`
  children in place, including reordering through the existing `ORDERED`
  constraint.

## Constraints

- The resolved model is the contract. Syntax must resolve to the *existing*
  `ResolvedEditSection`, `ResolvedEditChildCollectionSection` and
  `ResolvedRelationshipPicker` shapes; if a shape is wrong, change it
  deliberately in the serial spine and update the specification, never fork it.
- Policy enforcement stays in runtime services. A child operation the model
  permits is still subject to the child object's own policy, scope and sync
  rules, and the edit surface must not become a second enforcement point.
- The staged transaction must respect the ordered-collection expansion
  `commitPlannedTransaction` already performs, so a reorder plus an insert
  commits one coherent set of positions rather than a sequence of intermediate
  ones.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 54 membership scoping, Phase 57 command replay and Phase 58 record sync
  state. A staged batch is a new transactional writer, so every record it writes
  must report the sync state Phase 58 defines, and a refused batch must mark all
  of them.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  anything touching the authority must be proven against real PostgreSQL under
  `tests/integration/`.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- ADL syntax, AST, `compileAdl` support and validation for edit sections, child
  collections, relationship pickers and `editContainer`.
- A staged batch that commits as one local transaction and replays as one
  authority operation, with per-record sync state applied across the whole batch.
- The Giggle Band reference app editing set-list items inside the set list,
  including reorder.
- Conformance cases for the new syntax and for the staged transaction's
  all-or-nothing behaviour; specification updates in `docs/spec/language.md`,
  `docs/spec/resolved-model.md` and `docs/spec/runtime-semantics.md`, including
  removal of the two "not implemented yet" notes this phase closes.
- Real-PostgreSQL integration coverage for a staged batch replayed to the
  authority, including a refused batch.
- Learnings updates: a new `implementation/edit-surface-language.md`, plus
  closure notes in `implementation/command-intent-replay.md` (the ad-hoc
  multi-record write gap) and `implementation/adl-parser.md`.

## Acceptance Criteria

- A view declared entirely in ADL renders a child collection, creates, links,
  updates, unlinks, removes and reorders children, and refuses an operation the
  model did not permit.
- A relationship picker declared in ADL offers candidates from an object or a
  read-model source, excludes already-linked candidates by default, and discloses
  nothing a normal runtime read would not.
- `editContainer` is declarable in ADL and the specification no longer says it is
  not.
- A staged batch of several child changes commits as one storage transaction: if
  any one of them fails, none of them is written and none is queued.
- A staged batch reaches the authority as one operation, and a refused batch
  leaves every record it wrote marked `rejected` per Phase 58.
- The reference app edits set-list items in place, and the visual suite shows it.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots.

## Non-goals

- Bulk ingestion and the `import` policy action. Recorded above as the strongest
  remaining candidate after this one; it is a capability to design, not a check
  to wire, and it does not belong in the middle of this.
- A generic nested-form builder, arbitrary depth, or grandchild sections. One
  level of child collection is what the runtime implements and what this phase
  makes declarable.
- CRDT/Automerge replication, a new sync protocol, or a second runtime.

## Dependencies

- The resolved-model edit-surface and relationship-picker types, and
  `EditSurfaceRuntime`.
- `ObjectStore.commitPlannedTransaction` and its ordered-collection expansion.
- Phase 57 command intent replay, as the precedent for one queue entry carrying a
  transaction.
- Phase 58 record sync state, which every record a staged batch writes must
  report.

## Parallel Execution Plan

Serial spine first:

1. The syntax and its resolved shape in one pass, with no consumers: lexer
   keywords, AST nodes, `compileAdl` conversion, any resolved-model correction,
   and validation. `src/parser/lexer.ts`, `src/parser/parser.ts`,
   `src/parser/ast.ts`, `src/compiler/compile-adl.ts`,
   `src/compiler/resolve-model.ts` and `src/compiler/validate-model.ts` are all
   in this pass. Every downstream stream depends on the parsed shape, so
   predicting it would waste them.
2. The staged-transaction signature in the same pass — how
   `applyStagedChanges` plans writes and hands them to
   `commitPlannedTransaction`, and how the batch is queued — types and
   signatures only.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- The staged transaction's implementation and its local tests
  (`src/runtime/edit-surface-runtime.ts`, `tests/edit-surface-runtime.test.ts`).
- Browser rendering of an ADL-declared child collection (`src/ui/components/`,
  CSS).
- The reference application model and its fixtures.
- Conformance cases, the runner extension and the specification.
- Real-PostgreSQL integration coverage.

Keep serial: `src/parser/parser.ts`, `src/compiler/validate-model.ts`,
`src/model/resolved-model.ts`, `src/index.ts`,
`src/ui/components/register.ts` and shell chrome, ordered migration SQL, the
conformance runner and case schema, reference app fixtures, and specification
updates that must reconcile all streams.

Barriers: one `npm run test:integration` after the runtime and UI streams are
both in, then one `npm run verify:push` with manual screenshot inspection.

Two files in this repository contain a NUL byte, so plain `grep` treats them as
binary and returns nothing silently: `src/compiler/validate-model.ts` and
`src/conformance/runner.ts`. Tell every agent to use `grep -a`. Phase 58 added a
third hazard worth stating: a NUL can be *introduced* by an edit that means to
write a separator, so check `grep -c` against `grep -ac` on any file you have
just written.

## Tasks

1. Design and implement the ADL syntax for edit sections, child collections,
   relationship pickers and `editContainer` in one serial pass, resolving to the
   existing resolved-model shapes.
2. Extend validation to cover the newly reachable declarations, reusing the
   existing edit-surface and picker diagnostic codes.
3. Make a staged batch commit as one local transaction through
   `commitPlannedTransaction`.
4. Make a staged batch reach the authority as one operation, with Phase 58 record
   sync state applied across every record it wrote.
5. Render an ADL-declared child collection in the browser, including reorder.
6. Use it in the Giggle Band reference app: set-list items edited inside the set
   list.
7. Add conformance cases and specification coverage, and remove the two "not
   implemented yet" notes this phase closes.
8. Add real-PostgreSQL integration coverage for a staged batch replayed to the
   authority, including a refused batch.
9. **Required next-phase planning handoff:** before Phase 59 closes, write
   `docs/phases/phase-60-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. If no gap
   justifies a further phase, record that conclusion explicitly instead. Then
   verify, commit, and push Phase 59.
