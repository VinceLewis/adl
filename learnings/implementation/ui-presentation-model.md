# UI Presentation Model And Runtime

Phase 24 added the resolved-model foundation for composed UI presentation.
Phase 26 added renderer-neutral runtime evaluation for composed views.

## Decisions

- Presentation is optional and lives on `ResolvedView.presentation`, not in a
  separate top-level model collection. Composed screens remain ordinary views.
- CRUD form container selection lives on `ResolvedView.editContainer`, separate
  from composed `ResolvedView.presentation`. It is renderer-neutral and
  defaults to `modal`; supported values are `modal`, `drawer`, `page`, and
  `splitPane`.
- The presentation contract is renderer-neutral. It uses layout, density,
  sections, controls, list bindings, row fragments, icon maps, formatting, empty
  states, and shell regions, but no DOM tags, CSS selectors, framework
  component names, SVG paths, or browser event handlers.
- Resolver defaults are explicit: `stack` layout, `comfortable` density,
  `readModel` list source kind, `table` list rendering, `inline` row layout,
  `plain` text/field fragments, memory-backed local state, and empty
  empty-state text.
- Local presentation state is view-local data. It can be referenced by
  presentation filters and controls, but it is not an object field or durable
  business state.
- Presentation filters and conditional row fragments reuse `ResolvedExpression`.
  Validation checks expressions against list row fields plus local state.
- Presentation validation belongs in the resolved-model validator. Invalid list
  sources, row fields, icon maps, state references, command/view/context
  references, shell controls, formats, and supported-value enums produce
  structured `ADL_PRESENTATION_*` diagnostics.
- Presentation runtime evaluation is exposed through
  `ApplicationRuntime.evaluatePresentationView(...)`. Browser renderers should
  use this public API rather than binding lists or read models themselves.
- The generic browser renderer consumes `RuntimePresentationView` output
  directly. It maps renderer-neutral sections, controls, lists, row fragments,
  icons, and empty states to DOM without adding app-specific branches.
- Evaluation order is state defaults, caller state, local state updates, list
  binding, presentation filters, presentation ordering, row fragments, icon
  maps, formatting, and empty states.
- List binding preserves runtime boundaries: object-backed lists call
  policy-enforcing `search`, and read-model-backed lists call
  `executeReadModel`. Presentation filters run only after those reads have
  applied authorization, context scoping, and read-model shaping.
- Row-template evaluation is read-only and returns typed renderer-neutral text
  and icon fragments, not DOM or HTML.
- The deterministic formatter intentionally starts small: date tokens like
  `EEE d MMM`, time tokens like `h:mma`, UTC datetime combinations, `plain`,
  `integer`, `fixed:N`, and `0.00`-style number patterns. Unsupported formats
  produce structured runtime diagnostics and fall back to raw values where
  possible.
- Phase 28 proved the Giggle home dashboard can remain authored through
  `ui.adl`: local toggle state, event-type icon maps, read-model-backed compact
  feed rows, formatted date/time fragments, bold titles, venue text, and empty
  states all flow through the generic evaluator and browser renderer.
- The browser has a generic hamburger-drawer shell with top-bar business
  context controls, but parser and runtime support for ADL `SHELL`/`TOP_BAR` or
  `NAV_DRAWER` declarations remains a future platform gap. Do not model shell
  behavior with app-specific browser branches.
- Phase 29 added DOM-free presentation conformance coverage. New presentation
  semantics should be pinned through `conformance/presentation/` using public
  model resolution, validation, inspect, and `evaluatePresentationView` paths
  before or alongside browser component assertions.
- `explainResolvedModel` now walks composed view presentation declarations. It
  reports defaults and reference-bearing paths for layout, density, local state,
  icon maps, controls, list sources, row templates, and fragment styles.
- Phase 32 added action placement to the presentation contract. Section actions
  default to `secondary`, list actions default to `row`, and authored actions
  carry renderer-neutral command/view targets, semantic icons, optional input
  expressions, optional visibility predicates, and runtime-shaped visible/
  enabled state.
- Browser action dispatch is generic: navigation actions call model view
  navigation, and command actions call `ApplicationRuntime.executeCommand`.
  Runtime command services remain the enforcement boundary for command
  preconditions, policy, validation, sync, audit, and operation logging.
- Phase 33 added CRUD `ResolvedView.editSections` for parent edit surfaces.
  Every view resolves an inspectable default `fields` edit section from
  `view.fields`; authored models can add `childCollection` sections that point
  to a child object and lookup field back to the parent. **Phase 59 added ADL
  source syntax for all of it** — `EDIT_CONTAINER`, `EDIT_SECTION`,
  `CHILD_COLLECTION` and `PICKER`, resolving to these same shapes — and made a
  staged batch of child changes commit as one transaction and replay as one
  operation. See [[edit-surface-language]].
- Parent-child edit evaluation is exposed through
  `ApplicationRuntime.evaluateEditSurface(...)`. Existing parent child rows are
  loaded through child-object runtime search, then filtered by the declared
  parent lookup field. Child action visibility/enabled state is shaped through
  child-object policy and sync decisions.
- New-parent child changes are explicit staged operations held by the caller/UI.
  `ApplicationRuntime.applyStagedChildChanges(...)` applies them after the
  parent exists, in caller-supplied order, through normal runtime create/update/
  delete APIs. Cancelling a browser form clears the staged list without writing
  child records.
- Phase 34 added relationship pickers to child collection edit sections.
  `ResolvedEditChildCollectionSection.picker` is optional and supports object
  or read-model candidate sources, single or multiple selection, display/search
  fields, sort, already-linked exclusion, and picker empty text. Runtime
  candidate evaluation is exposed through
  `ApplicationRuntime.evaluateRelationshipPicker(...)` and must run before
  browser rendering or staging.
- Picker candidates are policy and context scoped first because object sources
  call runtime `search` and read-model sources call `executeReadModel`.
  Picker-specific search text, exclusion of already-linked rows, and stable
  sorting run only after those authorized reads. Applying staged links still
  goes through `applyStagedChildChanges(...)`, which now rejects duplicate
  `linkExisting` operations and stale links to the same parent before normal
  update constraints run.

## Practical Guidance

- Parser work should compile UI syntax into the existing partial presentation
  types rather than adding parser-specific runtime structures.
- Browser renderer work should consume `ApplicationRuntime.evaluatePresentationView`
  output. It should not query storage or execute read models directly to render
  composed presentation lists.
- Browser CRUD renderer work should use `ResolvedView.editContainer` for
  create/edit placement. Do not encode modal, drawer, page, or split-pane
  choices through app-specific branches or DOM/CSS selector names in the model.
- Browser parent-child rendering should consume evaluated edit surfaces and
  dispatch staged child operations back to the app container. It should not
  write child objects directly from child-section DOM handlers.
- Browser relationship picker rendering should consume
  `ApplicationRuntime.evaluateRelationshipPicker(...)` output and dispatch
  selected candidates as staged `linkExisting` child operations. It should not
  query candidate objects directly or infer already-linked rows from DOM state.
- Browser toggle controls should update view-local presentation state and
  request re-evaluation. They are not durable fields and should not call object
  create/update APIs unless a future model declaration explicitly binds them to
  a persistent command.
- Browser action controls should consume evaluated `RuntimePresentationAction`
  data. Do not attach host callbacks or mutate storage directly from the
  renderer; command actions must flow through `ApplicationRuntime`.
- Keep read models responsible for data shape and authorization; keep
  presentation responsible for display composition such as row text, icons,
  formatting, empty states, and section layout.
- Keep ADL shell syntax documented as unsupported until parser, evaluator, and
  browser handoff support the same resolved contract end to end. The browser's
  current drawer navigation is a generic convention, not an authored shell
  declaration.

## A row-scoped presentation ACTION can target its own record's identity (Phase 69)

Phase 69 closed the gap recorded below. `INPUT NoteId FROM id` inside a `LIST`
row `ACTION` now resolves `id` to that row's own real storage id, for both an
`OBJECT`-backed and a `READ_MODEL`-backed list. The rest of this section is
kept as the evidence trail; the fix is described first.

- **Mechanism: reuse `RECORD_ID_JOIN_FIELD` (`"id"`), the token this codebase
  already reserves for "this record's own id" inside a `JOIN ON` clause, as a
  row-action-only expression field.** One name, one meaning, everywhere a
  resolved model can name a record's own identity — rather than inventing a
  second spelling for the same concept.
- **Runtime:** `presentation-runtime.ts`'s `rowActionValues(row)` returns
  `{ ...row.values, [RECORD_ID_JOIN_FIELD]: row.sources[0]?.recordId }`, and
  `evaluateRow`'s row-action loop passes this instead of raw `row.values` to
  `evaluateActionControl` — so both a row action's `INPUT ... FROM <expr>`
  and its `WHEN <expr>` can see `id`.
- **`row.sources[0].recordId`, never `row.id`.** `BoundPresentationRow.id` is
  a synthetic display/sort key (`"Object:guid"` for an object row,
  `"readModel:source:guid|..."` for a read-model row) that no command step's
  `ID INPUT` could ever resolve to a real record — `CommandService`'s
  `evaluateRecordIdExpression`/`ObjectStore.getRecordForRuntime` need the raw
  `meta.guid`. `sources[0]` is always the row's primary source (an object row
  has exactly one; a read-model row's first declared source is already the
  documented primary — see the Phase 15 section above), and its `recordId` is
  that raw guid.
- **Validation matches runtime exactly, and only for row actions.**
  `validate-model.ts`'s `validatePresentationList` builds a *separate*
  field-reference map — the existing `expressionFieldsByName` plus `id` — and
  passes it only to `validatePresentationActionControl` for `list.actions`.
  `list.filter` and `validatePresentationRowTemplate` (row fragments) keep the
  original map without `id`, because the runtime genuinely does not populate
  `id` for those evaluation contexts — only for row actions. Giving `id` to
  every row-scoped expression consumer instead of only actions was
  considered and rejected: it would have been compile-time acceptance for
  something the runtime does not actually do outside actions, exactly the
  "validated but inert" trap `read-model-runtime.md`'s Phase 68 section
  describes for `LOOKUP ... TARGET_FIELD`.
- **No parser change.** Any identifier already parsed as `{ kind: "field",
  field: <name> }` with no reserved-word list — `id` needed no grammar work at
  all, only resolved-model/runtime/validator wiring. Confirmed by a parser
  test that pins the AST shape independent of the runtime/validator fix.
- **Deliberately not touched:** `list.filter`, `ROW` fragments, matrix cell
  expressions, and calendar cell/action expressions still cannot see a row's
  identity. Matrix cells already have direct record access through a
  different mechanism (`matrixCellRecord`, keyed off `cell.sources`) and
  calendar cell actions are aggregate/create-shaped by design (see the Phase
  15/22 sections above); neither needed this change. If a future need arises
  for `list.filter`/`ROW` to reference `id` too, extend `rowActionValues`'s
  merge to those call sites rather than inventing a second mechanism.
- **Left open, evaluated and explicitly scoped out:** a related but separate
  gap — `COMMAND`/`STEP` has no way to read an *existing* record's fields to
  seed a new record, only `create`/`update` step kinds and a create step's
  `STEP x FIELD y` (which only reaches an earlier step *this same command*
  wrote). This is a genuinely different capability (new
  `ResolvedCommandValueExpression` kind, parser syntax, validation, and
  runtime evaluation inside `CommandService`, not an extension of
  `rowActionValues`) and was not built in Phase 69. See
  `docs/phases/phase-69-row-action-record-identity.md`.

### Original gap (Phase 65-era), preserved as evidence

Found while adding a "revoke invitation" admin surface to the Giggle Band
reference app: a `LIST` row's `ACTION ... COMMAND <name> ... INPUT <name>
FROM <expr>` cannot invoke a command whose step identifies an *existing*
record (`STEP x UPDATE <Object> ID INPUT <input>`), because nothing carries
that record's storage id (`meta.guid`) into the expression scope the action's
`INPUT` clauses evaluate against.

- `evaluateActionInput` (`src/runtime/presentation-runtime.ts`) evaluates
  every `INPUT ... FROM <expr>` against `{ values: row.values, ...state }`
  only. `row.id` and `row.sources[].recordId` — which do carry the real
  guid — live on the outer `RuntimePresentationRow`/`BoundPresentationRow`
  and are never merged into that scope, for rows bound to either an
  `OBJECT` or a `READ_MODEL` (`objectRecordToPresentationRow` and
  `readModelRowToPresentationRow` both put the guid only in `id`/`sources`).
- No field can carry a record's own id into `row.values` either. A
  `READ_MODEL FIELD ... FROM <source>.<field>` resolves `field` only against
  the source object's declared `fields`/`computedFields`
  (`resolveReadModelField` in `src/compiler/resolve-model.ts`); an object
  computed field's expression likewise evaluates over `record.values` only
  (`src/runtime/computed-fields.ts`). The one place a record's own id *is*
  addressable by name is `RECORD_ID_JOIN_FIELD` (`"id"`), and it is
  special-cased solely inside `READ_MODEL SOURCE ... JOIN ON` key matching
  (`joinKeyForRecord` in `src/runtime/read-model-service.ts`) — it never
  reaches a projected field or an action input.
- Consequence: every existing presentation `ACTION` in this app's reference
  content is either `CREATE`-shaped (`ACTION addEvent CREATE Event ...`,
  which mints a new record and so needs no existing id) or read/navigation
  only. Accepting a `BandInvitation` (`AcceptBandInvitation`) has never been
  wired to a UI action for exactly this reason — it is exercised only by
  calling `ApplicationRuntime.executeCommand` directly, in tests.
- If a future phase needs a one-click UI action against a specific existing
  record — revoke, cancel, archive, and similar — from a `LIST` row, the
  platform work is to expose the record's own id into the row values an
  `ACTION INPUT` can reference (e.g. a reserved field name mirroring
  `RECORD_ID_JOIN_FIELD`, projected into `RuntimePresentationRow.values` for
  both object- and read-model-backed rows). Do not simulate this by wiring
  `INPUT` to some other unique-looking business field (an email, a natural
  key): it will send the wrong value to the command's `ID INPUT` and fail on
  every click.
