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

## Practical Guidance

- Keep matrix data shaping in read models or runtime services. Do not add direct
  IndexedDB/localStorage reads to browser matrix components.
- Add explicit default statuses for expected false/null derived facts to avoid
  runtime unmapped-value diagnostics.
- Calendar work may reuse semantic statuses, legends, date formatting, and
  runtime action dispatch patterns, but it should be a distinct presentation
  shape rather than overloading resource matrices.
