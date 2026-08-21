# Compiler Model-Layer File Map

Read this before touching `ResolvedApplicationModel` types, `validateApplicationModel`,
or `resolveApplicationModel` — or before grepping any of those three names expecting
one giant file. Phase 81 split all three into directories of domain-named files. This
document is the map from "I need to touch X" to "the file is `<domain>.ts` in
`resolved-model/`, `validate-model/`, and/or `resolve-model/`".

## Why this exists

`src/model/resolved-model.ts` (2,493 lines, ~230 type/interface/const declarations),
`src/compiler/validate-model.ts` (8,009 lines, 136 functions), and
`src/compiler/resolve-model.ts` (1,912 lines, 105 functions) were each a single flat
file. A task touching one concern (e.g. "fix calendar-view validation") cost reading
or grepping through the whole file to find the ~100-300 relevant lines. Phase 81 split
each into `<name>/` directories of domain files, with `<name>.ts` reduced to a
one-line barrel (`export * from "./<name>/index.js";`) so every existing import path
still resolves to the same exports. No behavior changed; this is a pure navigation aid.

## The domain-file map (same domain names used across all three directories)

"Everything about shell navigation" lives in `shell.ts` in all three directories
(where that directory has a `shell.ts` at all — `resolved-model/` is the only one of
the three with a `runtime-records.ts`, since sync-log-only types have no
validate/resolve counterpart).

| Domain file | Covers |
|---|---|
| `core.ts` | `ResolvedApplicationModel`, model migrations, `ResolvedModelDefaults`, `ResolvedApp`, `PartialApplicationModel`(Fragment), `PartialAppModel`; `validateApplicationReferences`, `validateModelMigrations`, `validateModelMigrationObject`; `resolveModelMigrations`, `resolveModelMigrationObject`, `resolveModelMigrationStep`. |
| `shell.ts` | Shell chrome: nav drawer/top bar/controls/visibility, `ShellControlKind`/`Placement`/etc. |
| `context.ts` | Business contexts, context grants, selection policy, membership, roles. |
| `object-field.ts` | Objects, fields, computed fields, validators, lookups, auto-id, object constraints (unique/ordered/protectedRole), object validation. Largest domain in `validate-model/` and `resolve-model/` after `presentation-core.ts`/`decision-table.ts`. |
| `expression.ts` | `ResolvedExpression` family and its validate/resolve/evaluate-adjacent helpers (`validateExpression`, `resolveExpression`, `collectExpressionFieldReferences`, etc.) — not the runtime evaluator itself, which lives in `src/runtime/expression-evaluator.ts` and was untouched. |
| `lifecycle.ts` | States, lifecycle actions/guards, hook refs, object policy/sync-policy reference validation. |
| `policy.ts` | Policies, policy rules, policy conditions, principal selectors. |
| `view.ts` | Views, view context, sort, edit sections, relationship pickers. |
| `presentation-core.ts` | The presentation dispatcher (`ResolvedViewPresentation`, `resolveViewPresentation`/`validateViewPresentation`) plus everything shared across list/matrix/calendar sources: state, icon maps, status/status-map, legend, sections, controls, and the shared field-reference helpers (`getViewFieldReferences`, `mergeFieldReferences`, etc.). The single largest domain file in both `validate-model/` (967 lines) and `resolve-model/` (277 lines). |
| `presentation-list.ts` | List-source presentation only. |
| `presentation-matrix.ts` | Matrix-source presentation: axis/cell sources, date-column axis, matrix edit. |
| `presentation-calendar.ts` | Calendar-source presentation: month, calendar status binding. |
| `presentation-row-format.ts` | Row templates/fragments, format, icon refs — the rendering primitives shared by list/matrix/calendar rows, plus `validatePresentationActionControl`/`Layout`/`Density`/`FragmentStyle`/`Format`. |
| `read-model.ts` | Read models, read-model sources/joins/fields, `RECORD_ID_JOIN_FIELD`. |
| `decision-table.ts` | Decision tables, plus the entire `analyze*`/`constraint*`/`range*` overlap-detection cluster in `validate-model/decision-table.ts` (538 lines — the largest single validate-model domain after presentation-core). |
| `command.ts` | Commands, command steps (create/update/read), command input, value-expression cloning helpers. |
| `theme.ts` | Themes, theme tokens, base-token resolution, base-cycle detection. |
| `sync.ts` | Sync policy, sync window, object audit policy, audit model. |
| `runtime-records.ts` | `resolved-model/` only: `PlatformRecordMetadata`, `StoredObjectRecord`, `AuditEvent`, `ResolvedOperationLogModel`, `LocalCommandRecordId/Operation`, `LocalBatchWrite/Operation`, `LocalOperation`. No validate/resolve counterpart. |
| `shared.ts` | Cross-domain helpers with no single natural home: `resolved-model/shared.ts` has `JsonPrimitive`/`JsonValue`/`FieldType`; `validate-model/shared.ts` has `NamedReference`, `ModelIndexes`, `diagnostic()`, `reportDuplicateNames`, `indexByName`, field-type/expression-type conversion helpers, plus module-private lookup constants used from more than one domain (`FIELD_TYPES`, `SYNC_MODES`, `SYNC_SCOPES`, `CONFLICT_STRATEGIES`, `VIEW_CONTEXT_MODES`, `ExpressionFieldReference`, `ExpressionStaticType`); `resolve-model/shared.ts` has `asArray`/`uniqueStrings`. |
| `codes.ts` | `validate-model/` only: `Diagnostic`, `DiagnosticSeverity`, `SourcePosition`, `SourceRange`, `MODEL_VALIDATION_CODES` (~331 keys). Deliberately kept as one flat object — not sharded by domain. `validate-model/index.ts` re-exports it (`export * from "./codes.js";`) so the top-level barrel still surfaces `MODEL_VALIDATION_CODES`/`Diagnostic`/`DiagnosticSeverity` without listing them itself. |
| `index.ts` | `resolved-model/index.ts` is a pure re-export of every domain file (no orchestrator — it's all types). `validate-model/index.ts` and `resolve-model/index.ts` each hold exactly one thing beyond their own imports and (for validate) the `codes.js` re-export: the top-level orchestrator (`validateApplicationModel` / `resolveApplicationModel`), body moved verbatim, calling the extracted domain functions in the exact same order the original single-file version did. |

## Module-private lookup constants also moved

Beyond the ~230 exported types and 136+105 functions, `validate-model.ts` also had
~50 module-private (non-exported) `const` lookup `Set`s (e.g. `SHELL_CONTROL_KINDS`,
`PRESENTATION_LAYOUTS`, `NAMED_VALIDATOR_RULES`) and a few private types
(`ExpressionStaticType`, `DecisionConstraint`, `CommandStepIteration`, ...). These
were not named in the Phase 81 planning document's domain table (which only
enumerated exported/public declarations); they were assigned by finding which
domain's functions actually reference each one. Where a constant is used from
exactly one domain's functions, it now lives in that domain file (as `export const`,
since cross-file use requires it). Where it's used from more than one domain
(`FIELD_TYPES`, `SYNC_MODES`, `SYNC_SCOPES`, `CONFLICT_STRATEGIES`,
`VIEW_CONTEXT_MODES`, `ExpressionFieldReference`, `ExpressionStaticType`), it moved
to `shared.ts`. If you add a new module-private helper that only one domain needs,
keep it un-exported and colocate it in that domain file rather than reflexively
exporting it or dropping it in `shared.ts`.

## Practical notes for future edits

- **Import paths into `resolved-model.js`/`defaults.js`/`fingerprint.js` are one
  level deeper than they were.** Domain files under `validate-model/` and
  `resolve-model/` reach the model layer via `../../model/resolved-model.js` (not
  `../model/resolved-model.js` — that directory is now two levels down from
  `src/compiler/`).
- **Cross-domain references inside `validate-model/` and `resolve-model/` are plain
  `import { fn } from "./other-domain.js"` for functions/consts and
  `import type { T } from "./other-domain.js"` for types** (this repo's `tsconfig.json`
  has `verbatimModuleSyntax: true`, so the two must not be mixed in one specifier
  list without the inline `type` keyword). A helper that used to be reachable by
  simply being in the same file now needs `export` added if another domain file
  calls it — check for `TS2459: ... declares '<name>' locally, but it is not
  exported` if you move a call between domain files and it doesn't compile.
- **Only `<name>.ts` (the barrel) and `<name>/index.ts` are meant to be imported by
  other subsystems.** `src/index.ts` and every other consumer in the repository
  still import from `../model/resolved-model.js`, `./validate-model.js`,
  `./resolve-model.js` — never from a domain file directly. Domain files are an
  internal decomposition, not a new public surface; do not add cross-directory
  imports that reach a domain file inside another top-level module's directory.
- **`validateApplicationModel`'s and `resolveApplicationModel`'s call order is
  behavior, not style.** Diagnostics are order-sensitive (some tests assert
  `diagnostics[0]`, and array order is part of the returned contract). If a phase
  ever needs to reorder validation, that is a deliberate behavior change requiring
  its own test updates — never an accidental side effect of moving code between
  domain files.
- No domain file should grow past ~1,200 lines (`validate-model/presentation-core.ts`
  at 967 lines and `validate-model/decision-table.ts` at 538 lines are the largest
  today) or, for `resolved-model/`, past ~500 lines. If ordinary feature work pushes
  one past that, that is a signal the domain itself has grown enough to need its own
  sub-split, not a reason to force unrelated content into a neighboring file.

## Verification method for any future split like this one

Content-preservation was proven mechanically, not by inspection: sort every
non-blank line of the original file and of the concatenated new files, diff the
two sorted sets, and confirm every line in the diff is an expected artifact
(a relocated `import`, an added `export` keyword, or Prettier's line-wrapping) —
never a line that simply disappeared. Combined with `npm run typecheck`, `npm test`,
and a byte-diff of the orchestrator function body against the pre-split original,
this is strong evidence of zero behavioral change without needing to hand-review
every one of ~500 relocated declarations.
