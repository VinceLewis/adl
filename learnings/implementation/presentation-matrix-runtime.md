# Presentation Matrix Runtime

Read this before changing resource/date matrices, availability views, matrix
cell editing, range editing, or future calendar work that reuses matrix status
semantics.

**Where the code is (Phase 90).** Matrix evaluation is no longer in a single
`presentation-runtime.ts`. The pure part — the date column axis, cell keys,
cycle stepping, and what a cell edit writes — is
`src/runtime/presentation-runtime/matrix-edit.ts`; the runtime methods
(`evaluateMatrix`, `evaluateMatrixCell`, `planMatrixCellWrite`,
`applyMatrixCellWrite`, …) are
`src/runtime/presentation-runtime/matrix-runtime.ts`. Every name below still
exists with the same name and body — see [[presentation-runtime-file-map]] for
the full map and the chain-ordering rule you must respect when adding one.

## Decisions

- Matrices live under `ResolvedView.presentation.sections[].matrices`, beside
  lists. They are renderer-neutral presentation constructs, not browser
  components or storage queries.
- Matrix row and cell data bind through the same runtime boundaries as lists:
  object sources call policy-enforcing `search`, and read-model sources call
  `executeReadModel`.
- Status maps remain view-level declarations, but validation now allows status
  map fields referenced by matrix cell sources as well as view/list fields.
- Blank availability is modeled with `cell.unsetStatus` and no matching cell
  record. It is not persisted as a fake enum value.
- Synthetic display statuses such as `busyElsewhere` should come from derived
  read-model/runtime-shaped fields and map to semantic statuses. They should
  not be written into the editable availability value field.
- Matrix cell cycling and range edits execute through runtime object
  operations. The runtime plans create/update/delete from the edit declaration,
  checks policy and sync mode, then calls validated `create`, `update`, or
  `delete`.
- Range edits currently declare `bulkBehavior: sequentialValidatedWrites`. This
  makes offline/sync behavior explicit per object write and avoids pretending
  there is an atomic batch contract where the runtime does not provide one.
- Browser rendering consumes evaluated matrix output and dispatches a matrix
  cycle event back to `ApplicationRuntime`; it does not infer records or write
  storage directly from DOM state.

## ADL text syntax (Phase 104)

`MATRIX` had a full resolved model, a shipped runtime, eleven conformance cases
and a browser renderer from Phase 37, and **no way to write it in `.adl` text at
all** until Phase 104. `printPartialApplicationModelAsAdl` refused a section
declaring one, by name. The syntax now is:

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

`docs/spec/language.md#matrices` is authoritative; the grammar is
`parsePresentationMatrix` and its five sub-parsers in
`src/parser/grammar/presentation-source.ts`, beside `LIST` and `CALENDAR`.

Four things are worth carrying forward, because each is a trap rather than a
detail:

- **`CELL` is a block of its own, and that is the amendment that matters.**
  `cell.status` and `cellSource.status` are *different* bindings and the runtime
  prefers the first (`matrix.cell.status ?? matrix.cellSource.status`,
  `matrix-runtime.ts`). The syntax `ui-language-addendum.md` had sketched since
  Phase 29 carried one flat top-level `STATUS`, which cannot say which of the
  two it means. Nesting each directive under the structure it belongs to
  removes the ambiguity by construction rather than by convention.
- **`UNSET_VALUE null` is not the same as no `UNSET_VALUE`.** `unsetValue` is
  `JsonPrimitive`, which includes `null`, and `resolvePresentationMatrixEdit`
  distinguishes an absent key from an explicit `null`. A printer branch using
  `if (edit.unsetValue)` — or a parser that folded `null` into `undefined` —
  changes the model silently. Both directions are pinned by a printed-text
  assertion, not only by a round-trip.
- **A status candidate of kind `map` with neither `field` nor `value` had no
  spelling at all**, and `printPresentationStatusCandidate` threw on it. It
  means "use the status map's own declared field", the validator handles it
  explicitly, and it is what the presentation conformance corpus's two matrices
  actually use — so the corpus could not be printed even after the `MATRIX`
  refusal was removed. It is now `STATUS <map>()`, and the parentheses are
  load-bearing: `STATUS <map>` without them reparses as a *direct* status
  reference named after the map, a different resolved model with a clean
  typecheck and a green suite. This affects `LIST` and `CALENDAR` equally.
- **The round-trip subject is the conformance corpus, not a reference app.**
  Neither Giggle Band nor Jointly Care declares a matrix — Giggle Band's
  availability board is a `LIST` over `BandMemberAvailability` — so
  `conformance/presentation/status-matrix-calendar.json`'s `resourceMatrix`
  model is the only real two-matrix application in the repository, and it was
  authored to exercise the runtime rather than the printer. Converting Giggle
  Band's board to a real `MATRIX` is the obvious follow-up and is a *content*
  change with a content change's costs (a `modelVersion` bump, a migration hop,
  a persisted-state upgrade test, `verify:push`), not a grammar change.

A pre-existing validator defect surfaced while writing the conformance
negatives and was **not** fixed here (Phase 104's non-goals exclude
`validate-model`): when a matrix declares a `cellSource.status` and no
`cell.status`, that binding is validated **twice** — once by
`validatePresentationMatrixCellSource` and again by `validatePresentationMatrix`
via `matrix.cell.status ?? matrix.cellSource.status` — so every diagnostic it
produces is emitted twice at the identical path. Reproduced from a
JSON-authored model, so it predates and is independent of the text syntax.

## Practical Guidance

- Keep matrix data shaping in read models or runtime services. Do not add direct
  IndexedDB/localStorage reads to browser matrix components.
- Add explicit default statuses for expected false/null derived facts to avoid
  runtime unmapped-value diagnostics.
- Calendar work may reuse semantic statuses, legends, date formatting, and
  runtime action dispatch patterns, but it should be a distinct presentation
  shape rather than overloading resource matrices.
