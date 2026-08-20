# Phase 81 — Compiler Model-Layer Decomposition

> Commissioned directly by the user, after a comparative review of the
> repository's largest files (this session, and a separate review by
> `codex` on the same question) identified `src/model/resolved-model.ts`,
> `src/compiler/validate-model.ts`, and `src/compiler/resolve-model.ts` as
> the highest-value, lowest-risk decomposition target: all three are
> already organised as long flat sequences of small, independent,
> domain-grouped declarations (pure types in one case, pure functions in
> the other two) with no shared mutable state — the split is mechanical,
> not a redesign. Per `learnings/process/phase-execution.md`'s standing
> rule for user-commissioned phases (the same condition that authorised
> Phase 69 through Phase 73), this does not require justifying itself as
> the next item in a rolling handoff.
>
> **This document is written to be executed by a lower-effort model than
> the one that authored it.** Every ambiguous judgment call has been
> resolved below; the remaining work is mechanical extraction plus
> verification. Where this document gives an exact line number, re-verify
> it against current `main` before using it — line numbers drift as the
> file is edited during execution, and other phases may land first.

## Objective

Split three large, single-file modules into directories of small,
domain-named files, with **zero behavioral change and zero consumer-visible
API change**. Every external import path (`from ".../resolved-model.js"`,
`from ".../validate-model.js"`, `from ".../resolve-model.js"`) continues to
resolve to the same exports it does today — nothing outside these three
files is edited.

This exists because these three files are large enough (8,009 / 2,493 /
1,912 lines) that a task touching one concern (e.g. "fix calendar-view
validation") currently costs reading or grepping through the whole file to
find the ~100–300 relevant lines. None of this is a performance change —
JS/TS execution speed does not depend on how code is distributed across
files. It is a navigability change, for both human and LLM readers.

## Evidence and Dependency

Re-verify against current code (main at `03c41b8`) before executing. Line
counts for the three target files were confirmed unchanged between
`d020b2d` (the shell-navigation change that last touched the compiler
model layer) and `03c41b8` (a later, unrelated reference-demo migration
fix, `git diff --stat` empty for these three files across that range).

- `src/compiler/validate-model.ts` — 8,009 lines, 136 top-level functions
  (one export, `validateApplicationModel`; 135 internal), plus
  `MODEL_VALIDATION_CODES` (a single flat `const` object, ~331 keys, lines
  142–735) and the `Diagnostic`/`DiagnosticSeverity`/`SourcePosition`/
  `SourceRange` type family (lines 111–140). No module-level mutable
  state — every function is pure, taking model pieces and returning
  `Diagnostic[]`. Confirmed no section-comment banners exist; the grouping
  below is inferred from function ordering and naming, not from existing
  headers.
- `src/compiler/resolve-model.ts` — 1,912 lines, 99 functions (one export,
  `resolveApplicationModel`; 98 internal). Same shape: pure functions, no
  module-level state.
- `src/model/resolved-model.ts` — 2,493 lines, ~230 top-level `type`/
  `interface`/`const` declarations. No logic at all — pure data-shape
  declarations. The file is physically two parallel, same-ordered halves:
  `Resolved*` types (lines 219–1638) followed by `Partial*Model` types
  (lines 1641–2493) that mirror the `Resolved*` types 1:1 in the same
  domain order, plus one cluster of runtime/sync-log-only types with no
  `Partial*` counterpart (`PlatformRecordMetadata`, `StoredObjectRecord`,
  `AuditEvent`, `ResolvedOperationLogModel`, `LocalCommandRecordId`,
  `LocalCommandOperation`, `LocalBatchWrite`, `LocalBatchOperation`,
  `LocalOperation` — lines 1426–1640).
- `validate-model.ts` and `resolve-model.ts` import from each other **not
  at all** (confirmed by grep) — they are only ever both consumed by
  `compile-adl.ts`. This makes them independently splittable in parallel.
- External consumers of these three files only ever import their public
  surface, never an internal helper:
  - `validate-model.js`: `validateApplicationModel`, `MODEL_VALIDATION_CODES`,
    `Diagnostic`, `DiagnosticSeverity` (grep across `src/` and `tests/`
    confirms no other symbol is imported from this path anywhere).
  - `resolve-model.js`: `resolveApplicationModel` only, from
    `compile-adl.ts`, `compile-adlj.ts`, `compile-adl-project-v2.ts`,
    `conformance/runner.ts`, `reference/band-app.ts`,
    `reference/jointly-app.ts`, `server/authority-entrypoint.ts`, one test.
  - `resolved-model.js`: 77 files import from it directly, plus
    `src/index.ts` re-exports it wholesale (`export * from
    "./model/resolved-model.js"`). `src/index.ts` also re-exports
    `validate-model.js` and `resolve-model.js` wholesale the same way.
  - This is the fact the whole plan depends on: converting each of the
    three files into a **barrel** (a thin file at the original path that
    re-exports everything from a new sibling directory) means none of
    those 77+ consumer files, and not `src/index.ts` either, need to
    change at all.

## Decision

### Strategy: directory-of-domain-files + barrel at the original path

For each of the three files, `X.ts` becomes:

```
X.ts              <- becomes a barrel: `export * from "./X/domain-a.js"; export * from "./X/domain-b.js"; ...`
X/domain-a.ts
X/domain-b.ts
...
```

The barrel file is the **only** file every existing consumer continues to
import from. This is the load-bearing decision that makes the whole phase
low-risk: it turns a "touch 77+ files" refactor into a "touch 3 files,
plus add ~55 new ones" refactor, and every new file is additive (no
existing file's contents are deleted, only relocated).

### Domain boundaries (same names, used consistently across all three files)

Each `Resolved*`/`Partial*Model` type pair, `validate*` function, and
`resolve*` function is assigned to the domain it most directly belongs to.
The same domain name is used in `resolved-model/`, `validate-model/`, and
`resolve-model/`, so "everything about shell navigation" lives in one
`shell.ts` per directory rather than three differently-named files.

| Domain file | Covers |
|---|---|
| `core.ts` | `ResolvedApplicationModel`, `ResolvedModelMigration*`, `ResolvedModelDefaults`, `ResolvedApp`, `PartialApplicationModel`(Fragment), `PartialModelMigration*Model`, `PartialAppModel`; `validateApplicationReferences`, `validateModelMigrations`, `validateModelMigrationObject`; `resolveModelMigrations`, `resolveModelMigrationObject`, `resolveModelMigrationStep`. (The two top-level orchestrators, `validateApplicationModel` and `resolveApplicationModel`, stay in each directory's `index.ts` — see below, not in `core.ts`.) |
| `shell.ts` | `ResolvedShell*`, `PartialShell*Model`, `ShellControlKind`/`Placement`/`ContextSelectorPlacement`/`MobileContextSelectorMode`/`NavigationMode`/`ShellVisibilityKind`; `validateShell`, `validateShellRegionControls`, `reportDuplicateShellOrders`, `validateShellNavItem`, `validateShellControl`, `validateShellVisibility`, `validateShellIcon`; `resolveShell`, `resolveShellNavItem`, `createDefaultShellControls`, `resolveShellControl`, `resolveShellVisibility`. |
| `context.ts` | `ResolvedBusinessContext`, `ResolvedContextGrant`, `ResolvedContextSelectionPolicy`, `ResolvedContextMembership`, `ResolvedRole`, `Partial` equivalents, `ContextSelectionMode`/`Persistence`/`Source`; `validateBusinessContext`, `validateContextGrant`, `validateContextMembership`, `validateMembershipField`; `resolveRoles`, `resolveBusinessContexts`, `resolveBusinessContext`, `resolveContextGrant`, `resolveContextSelection`, `resolveContextMembership`. |
| `object-field.ts` | `ResolvedObject`, `ResolvedObjectScope`, `ResolvedField`, `ResolvedComputedField`, `ResolvedMetadataField`, `ResolvedValidator` family, `ResolvedLookup`, `ResolvedAutoId`, `ResolvedObjectConstraint` family, `ResolvedObjectValidation`, `Partial` equivalents, `ValidatorKind`, `ObjectConstraintKind`, `OrderedCollectionReorder`/`Compaction`; `validateObjectScope`, `validateObject`, `validateObjectConstraint`, `validateConstraintFieldList`, `validateConstraintField`, `validateObjectValidation`, `validateNamedFieldValidator`, `validateField`, `validateComputedField`, `validateComputedFieldCycles`; `resolveObject`, `resolveComputedFields`, `resolveObjectValidation`, `resolveObjectScope`, `resolveField`, `resolveValidator`, `resolveLookup`, `resolveAutoId`, `resolveObjectConstraint`, `orderedComputedFieldNames`, `computeComputedFieldEvaluationOrder`. |
| `expression.ts` | `ResolvedExpression` family, `ExpressionValueType`/`RuntimeProperty`/`UnaryOperator`/`BinaryOperator`; `validateExpression`, `validateBinaryExpression`, `requireExpressionType`, `areComparableExpressionTypes`, `isValueCompatibleWithExpressionType`; `collectExpressionFieldReferences`, `visitExpressionFields`, `resolveExpression`. |
| `lifecycle.ts` | `ResolvedLifecycle`, `ResolvedState`, `ResolvedLifecycleAction`, `ResolvedLifecycleGuard`, `ResolvedHookRefs`, `Partial` equivalents; `validateLifecycle`, `validateLifecycleGuard`, `validateObjectPolicyReferences`, `validateObjectSyncPolicy`, `validateHookRefs`, `validateHookRefList`; `resolveLifecycle`, `resolveState`, `resolveLifecycleAction`, `resolveLifecycleGuard`, `resolveHookRefs`. |
| `policy.ts` | `ResolvedPolicy`, `ResolvedPolicyRule`, `ResolvedPolicyCondition` family, `ResolvedPrincipalSelector`, `ResolvedContextMemberPrincipal`, `Partial` equivalents, `PolicyEffect`/`Action`, `PrincipalMatch`, `PolicyConditionKind`/`RuntimeProperty`; `validatePolicy`, `validatePolicyRule`, `validatePolicyPrincipal`; `resolvePolicies`, `resolvePolicy`, `resolvePolicyRule`, `foldConditions`, `resolvePolicyConditionOperand`, `resolvePrincipal`, `groupPolicyNamesByObject`. |
| `view.ts` | `ResolvedView`, `ResolvedViewContext`, `ResolvedSort`, `ResolvedEditSection` family, `ResolvedRelationshipPicker*`, `Partial` equivalents, `ViewKind`, `EditContainerMode`, `EditSectionKind`/`ChildOperationKind`, `RelationshipPickerSourceKind`/`SelectionMode`, `ViewContextMode`; `validateView`, `validateViewEditSections`, `validateRelationshipPicker`, `validateRelationshipPickerCandidateField`, `validateObjectRelationshipPickerSource`, `validateReadModelRelationshipPickerSource`, `validateEditContainerMode`, `validateViewContext`; `resolveViews`, `createDefaultViews`, `getDefaultSearchFields`, `resolveView`, `resolveEditSections`, `resolveRelationshipPicker`, `resolveViewContext`, `resolveSort`. |
| `presentation-core.ts` | `ResolvedViewPresentation`, `ResolvedPresentationState`, icon-map/status/status-map/legend/section/control/shell-region types, `PresentationLayout`/`Density`/`ControlKind`/`ActionPlacement`/`ShellRegion`/`StatusThemeToken`/`LegendInclude`, `Partial` equivalents; `validateViewPresentation`, `validatePresentationState`, `validatePresentationStatus`, `validatePresentationStatusMap`, `validatePresentationLegend`, `validatePresentationSection`, `validatePresentationControl`, `validatePresentationStatusBinding` (shared by list/matrix/calendar — lives here, not in a source-specific file); `resolveViewPresentation`, `resolvePresentationState`, `defaultPresentationStateValue`, `resolvePresentationIconMap`, `resolvePresentationStatus`, `resolvePresentationStatusMap`, `resolvePresentationLegend`, `resolvePresentationSection`, `resolvePresentationControl`, `resolvePresentationEmptyState`, `resolvePresentationShell`, `resolvePresentationShellRegion`, `defaultPresentationStatusThemeToken`, `resolvePresentationStatusCandidate`, `resolvePresentationAction`. Also the shared field-reference helpers used by every presentation source kind: `getViewFieldReferences`, `getPresentationListFieldReferences`, `getPresentationMatrixSourceFieldReferences`, `getPresentationCalendarFieldReferences`, `getPresentationMatrixStatusMapFieldReferences`, `getPresentationCalendarStatusMapFieldReferences`, `getPresentationMatrixSourceFieldReferencesWithoutDiagnostics`, `getPresentationCalendarFieldReferencesWithoutDiagnostics`, `createCalendarActionFieldReferences`, `mergeFieldReferences`, `mergePresentationExpressionFields`, `isValidIsoDate`, `isValidIsoMonthOrDate`, `indexPresentationControls`. |
| `presentation-list.ts` | `ResolvedPresentationList`, `PresentationListSourceKind`/`RenderStyle`, `Partial` equivalent; `validatePresentationList`; `resolvePresentationList`. |
| `presentation-matrix.ts` | `ResolvedPresentationMatrix*`, `PresentationMatrixSourceKind`/`ColumnKind`/`BulkBehavior`, `Partial` equivalents; `validatePresentationMatrix`, `validatePresentationMatrixAxisSource`, `validatePresentationMatrixCellSource`, `validatePresentationMatrixStatusBinding`, `validatePresentationMatrixEdit`; `resolvePresentationMatrix`, `resolvePresentationMatrixAxisSource`, `resolvePresentationMatrixDateColumnAxis`, `resolvePresentationMatrixCellSource`, `resolvePresentationMatrixCell`, `resolvePresentationMatrixEdit`. |
| `presentation-calendar.ts` | `ResolvedPresentationCalendar*`, `PresentationCalendarSourceKind`/`WeekStart`, `Partial` equivalents; `validatePresentationCalendar`, `validatePresentationCalendarMonth`, `validatePresentationCalendarStatusBinding`; `resolvePresentationCalendar`, `resolvePresentationCalendarMonth`. |
| `presentation-row-format.ts` | `ResolvedPresentationRowTemplate`, `ResolvedPresentationRowFragment` family, `ResolvedPresentationFormat`, `ResolvedPresentationIconRef`, `PresentationRowLayout`/`FragmentStyle`/`FormatKind`, `Partial` equivalents; `validatePresentationActionControl`, `validatePresentationRowTemplate`, `validatePresentationRowFragment`, `validatePresentationIconRef`, `validatePresentationLayout`, `validatePresentationDensity`, `validatePresentationFragmentStyle`, `validatePresentationFormat`; `resolvePresentationRowTemplate`, `resolvePresentationRowFragment`, `resolvePresentationFormat`, `resolvePresentationIconRef`. |
| `read-model.ts` | `ResolvedReadModel*`, `Partial` equivalents, `ReadModelSourceScope`/`Strategy`/`JoinCardinality`, `RECORD_ID_JOIN_FIELD`; `validateReadModel`, `validateReadModelSourceJoin`, `validateReadModelJoinField`, `validateReadModelContext`; `resolveReadModels`, `resolveReadModel`, `resolveReadModelSource`, `titleCaseIdentifier`, `normaliseIdentifier`, `defaultReadModelSourceScope`, `resolveReadModelField`. |
| `decision-table.ts` | `ResolvedDecisionTable*`, `Partial` equivalents, `DecisionTableMatchPolicy`; `validateDecisionTable` and its full `analyze*`/`constraint*`/`range*` support cluster (the largest single cluster in `validate-model.ts` — everything from `analyzeDecisionTableRow` through `rangeIsContradictory`, ~550 lines, all decision-table-specific, keep together as one file); `resolveDecisionTables`, `resolveDecisionTable`, `resolveDecisionTableInput`, `resolveDecisionTableRow`. |
| `command.ts` | `ResolvedCommand*`, `Partial` equivalents, `CommandStepAction`/`Authority`/`RuntimeProperty`/`MetaProperty`; `validateCommand`, `validateCommandStepSyncCoherence`, `describeObjectSyncModes`, `validateCommandInput`, `validateCommandPrecondition`, `validateCommandStep`, `validateCommandStepIteration`, `validateCommandValueExpression`, `reportIteratingStepReference`; `resolveCommands`, `resolveCommand`, `resolveCommandPrecondition`, `resolveCommandInput`, `resolveCommandStep`, `cloneCommandValueExpressionMap`, `cloneCommandValueExpression`, `cloneJsonValue`. |
| `theme.ts` | `ResolvedTheme*`, `Partial` equivalents, `ThemeRadius`/`Density`/`Nav`; `validateTheme`, `findThemeBaseCycle`; `resolveThemes`, `resolveTheme`, `resolveThemeBaseTokens`. |
| `sync.ts` | `ResolvedSyncPolicy`, `ResolvedSyncWindow`, `ResolvedObjectAuditPolicy`, `ResolvedAuditModel`, `Partial` equivalents, `SyncMode`/`Scope`/`ConflictStrategy`/`Status`, `LocalOperationKind`/`Status`, `AuditOperation`, `RuntimeChannel`; `validateSyncPolicy`, `validateSyncScopeSelection`, `validateSyncWindow`, `isQueueableSyncMode`; `resolveObjectSync`, `resolveSyncWindow`, `resolveObjectAudit`, `stripObjectFromSync`. |
| `runtime-records.ts` | `resolved-model.ts` only, no `validate`/`resolve` counterpart: `PlatformRecordMetadata`, `StoredObjectRecord`, `AuditEvent`, `ResolvedOperationLogModel`, `LocalCommandRecordId`, `LocalCommandOperation`, `LocalBatchWrite`, `LocalBatchOperation`, `LocalOperation`. |
| `shared.ts` | Cross-domain helpers with no single natural domain home. `resolved-model.ts`: `JsonPrimitive`, `JsonValue`, `FieldType`. `validate-model.ts`: `NamedReference`, `ModelIndexes`, `reportDuplicateNames`, `indexByName`, `indexObjectExpressionFields`, `indexReadModelExpressionFields`, `commandInputFieldsByName`, `expressionTypeField`, `expressionTypeToFieldType`, `isDefaultCompatible`, `isValueCompatibleWithFieldType`, `isJsonObject`, `isPositiveInteger`, `diagnostic`. `resolve-model.ts`: `asArray`, `uniqueStrings`. |
| `codes.ts` | `validate-model.ts` only: `Diagnostic`, `DiagnosticSeverity`, `SourcePosition`, `SourceRange`, `MODEL_VALIDATION_CODES`. **Do not split this object by domain** — it is one flat lookup table (~331 keys), not scattered logic; sharding it into per-domain partials assembled via spread would add real risk (duplicate-key checking across files) for no comprehension benefit a big const table doesn't already have from being grep-able as-is. This was considered and rejected. |

Everything above accounts for all 136 `validate-model.ts` functions, all 99
`resolve-model.ts` functions, and every `resolved-model.ts` type alias that
has no `Resolved*`/`Partial*Model` interface counterpart. For every
`Resolved*`/`Partial*Model` interface pair not named explicitly above (the
majority — nested sub-types like `ResolvedPresentationMatrixCell` or
`ResolvedCommandCreateStep`), the rule is: **colocate with the domain file
holding the function that directly builds or validates it.** Where a type
is referenced from more than one domain file, export it from its primary
domain file and import it normally — do not duplicate a type definition
across files.

### Orchestrators stay in `index.ts`, not in a domain file

`validateApplicationModel` (the one exported entry point of
`validate-model.ts`) and `resolveApplicationModel` (the one exported entry
point of `resolve-model.ts`) call into most of the domain functions above
in sequence. Each becomes `validate-model/index.ts` /
`resolve-model/index.ts`: the orchestrator function plus its imports from
every domain file, nothing else. The original `validate-model.ts` /
`resolve-model.ts` at the top level become one-line barrels:
`export * from "./validate-model/index.js";` (and the same pattern for
`resolve-model.ts` and `resolved-model.ts`, whose barrel has no
orchestrator to place, just re-exports of every domain file).

### Diagnostic/behavioral-equivalence risk: preserve declaration order

`validateApplicationModel` builds its returned `Diagnostic[]` by calling
domain validators in a fixed sequence and concatenating their results.
Some existing tests likely assert on diagnostics in a specific order (or
on `diagnostics[0]`). **The orchestrator in the new `index.ts` must call
the extracted functions in exactly the same order they run in today** —
extraction must not reorder anything, only relocate function bodies
verbatim. This is the single highest-risk detail in an otherwise
low-risk mechanical move; get the call order byte-for-byte identical to
today's `validateApplicationModel` body before touching anything else.

## Scope

1. `src/model/resolved-model.ts` → `src/model/resolved-model/{index,shared,core,shell,context,object-field,expression,lifecycle,policy,view,presentation-core,presentation-list,presentation-matrix,presentation-calendar,presentation-row-format,read-model,decision-table,command,theme,sync,runtime-records}.ts`, per the table above. Pure types — zero runtime risk. Do this one first; both other files import types from it via the unchanged barrel path, so nothing downstream needs to know it moved.
2. `src/compiler/validate-model.ts` → `src/compiler/validate-model/{index,codes,shared,<domain files>}.ts`, per the table above.
3. `src/compiler/resolve-model.ts` → `src/compiler/resolve-model/{index,shared,<domain files>}.ts`, per the table above.
4. No other file in the repository is edited. `src/index.ts`'s existing
   `export * from "./model/resolved-model.js"` / `"./compiler/validate-model.js"` /
   `"./compiler/resolve-model.js"` lines are untouched and continue to work
   because those paths still exist, now as barrels.

## Constraints

- No behavioral change of any kind. No diagnostic gains a different code,
  message, or `path`. No diagnostic's position in the returned array
  changes. No resolved-model default value changes.
- No consumer file outside the three listed above is edited — not even an
  import path. If achieving the split requires touching a fourth file,
  stop and report why before proceeding; that means the "consumers only
  import the public surface" evidence above was wrong and the plan needs
  re-examining, not a workaround.
- No new npm dependency.
- Do not attempt `src/parser/parser.ts`, `src/ui/components/adl-app.ts`,
  or `src/runtime/presentation-runtime.ts` in this phase — see Non-goals.
- Keep `MODEL_VALIDATION_CODES` as one unsplit object (see table above).
- Preserve exact function-call order inside both orchestrators (see
  "Diagnostic/behavioral-equivalence risk" above).

## Deliverables

- The three directories listed under Scope, fully populated.
- The three original file paths converted to barrels.
- `npm run typecheck`, `npm test`, and `npm run format:check` passing with
  zero changes to any test file.
- `learnings/` entry documenting the domain-file map above as reusable
  knowledge for locating compiler-model-layer code, plus `learnings/index.md`
  updated to point task types ("touching object/field validation", "touching
  presentation-matrix resolution", etc.) at it.

## Acceptance Criteria

- `npm run typecheck` passes with no new `any`, no suppressed errors, no
  changed `tsconfig.json`.
- `npm test` passes with **zero test file changes** — if a test needs to
  change to keep passing, that is evidence of an accidental behavior
  change and must be fixed in the split, not in the test.
- `git diff --stat` shows the three original files reduced to barrels (a
  handful of `export *` lines each), ~55 new files added, and **no other
  file modified**.
- `git diff main -- src/model/resolved-model.ts src/compiler/validate-model.ts src/compiler/resolve-model.ts`
  combined with the new directories, applied and then reverted through
  the barrels, is behaviorally a no-op: run the full existing conformance
  suite before and after and diff the two runs' output — they must be
  identical.
- No new file in `validate-model/` or `resolve-model/` exceeds roughly
  1,200 lines (`decision-table.ts` and `presentation-core.ts` are expected
  to be the largest, at roughly 550–900 lines each); no domain file in
  `resolved-model/` exceeds roughly 500 lines.
- `npm run build` succeeds and the production bundle's gzip size does not
  regress by more than 1% (a barrel-and-split refactor should be exactly
  neutral for bundlers; a regression here means something was pulled into
  the browser bundle that previously tree-shook out, and needs
  investigating before this phase is considered done).

## Testing

- `npm run typecheck` and `npm run format:check` after every domain file
  extraction, not only at the end — catches a misplaced type or a broken
  import immediately, while the diff causing it is still small.
- `npm test` after each of the three files is fully split, as a
  per-file checkpoint, then once more at the end with all three done.
- `npm run test:integration` is not expected to be required — nothing in
  this phase touches the authority server, PostgreSQL, or any I/O
  boundary; confirm this still holds once the diff is final.
- `npm run verify:push` once, at the end, per this repository's standing
  rule for anything that could affect rendering — included here only as a
  safety net (this phase should not affect any rendered output at all,
  since the runtime consumes `ResolvedApplicationModel` values, not the
  module structure that produced them); inspect that the screenshot diff
  is empty.

## Non-goals

Named here, not attempted, as candidates for later phases — the same
"named candidate, not claimed" pattern Phase 73 used:

- **`src/parser/parser.ts`'s `AdlParser` class.** One class with genuinely
  shared state (the token cursor across ~180 methods). Splitting it is a
  real refactor (introduce a shared cursor/context object, then split by
  grammar area), not a mechanical extraction, and carries materially more
  regression risk than this phase's scope. Left for its own phase, at
  higher model/effort than this one (see the accompanying chat response
  for why).
- **`src/ui/components/adl-app.ts`'s `AdlAppElement` class.** ~140 methods,
  most independent `render*` functions reading `this.` state — more
  splittable than the parser, but still a live-DOM-rendering class where a
  mistake is a visible UI regression, not just a failing unit test. Belongs
  in a phase that runs `npm run verify:push` per extracted chunk, not just
  once at the end.
- **`src/runtime/presentation-runtime.ts`'s `PresentationRuntime` class**
  (lines 416–2158) and its already-standalone tail of ~40 calendar/matrix/
  formatting helper functions (lines 2158–3124). The tail is a safe,
  mechanical follow-up much like this phase's scope; the class itself has
  real internal clustering (calendar / matrix / row-list / status-legend)
  but, like `adl-app.ts`, touches live rendering.
- **`src/runtime/object-store.ts`'s `ObjectStore` class** and its tail of
  ordered-collection/sort helper functions (lines 1663–2139).
- **`src/conformance/runner.ts`**, split by concern (case runners vs.
  result normalisers vs. matchers) — safe and mechanical like this phase,
  but lower value since it is a test-support module, not code every
  feature phase touches.
- **Large test file splitting** (`tests/runtime.test.ts` 3,020 lines,
  `tests/model-validation.test.ts` 3,004, `tests/band-reference-app.test.ts`
  2,379, `tests/ui-child-collection.test.ts` 2,194 — each bundles multiple
  features into one file, unlike e.g. `tests/presentation-runtime.test.ts`
  which is already scoped to one module).
- **Any investigation of the `this.innerHTML = \`...\`` full-re-render
  pattern** used by every custom element in `src/ui/components/` (`adl-app`,
  `adl-form-view`, `adl-list-view`, `adl-composed-view`, `adl-session-panel`,
  `adl-field-renderer`, and others — confirmed by grep, not merely
  suspected). This is the repository's actual runtime-performance
  question; splitting files does not touch it either way. Real, separable
  scope requiring its own profiling-first phase.

## Dependencies

- `src/model/resolved-model.ts` (target of split #1).
- `src/compiler/validate-model.ts` (target of split #2).
- `src/compiler/resolve-model.ts` (target of split #3).
- `src/model/defaults.ts` (imported by `validate-model.ts` today; import
  path unchanged, just re-pointed from the new domain files that use it).
- `src/index.ts` (read-only reference confirming the barrel re-export
  contract; not modified).

## Parallel Execution Plan

1. **Serial spine**: split `src/model/resolved-model.ts` first, in full,
   with its barrel in place and `npm run typecheck` green. Both other
   files import types from it through the unchanged barrel path — nothing
   about their own split depends on how `resolved-model.ts` was
   internally reorganized, but starting here means Agent B and Agent C
   below are working against a codebase that already typechecks cleanly,
   rather than debugging their own split on top of an in-flight one.
2. **Fan out, two independent streams** (confirmed no cross-import between
   these two files):
   - Agent A: split `src/compiler/validate-model.ts` per the domain table,
     ending with its own `npm run typecheck && npm test` green.
   - Agent B: split `src/compiler/resolve-model.ts` per the domain table,
     ending with its own `npm run typecheck && npm test` green.
   Use `isolation: "worktree"` for A and B — both touch nothing outside
   their own file's new directory, but running them as literal concurrent
   edits to the working tree risks interleaved partial writes.
3. **Barrier**: merge both worktrees, run `npm run typecheck`, `npm test`,
   `npm run format:check`, `npm run build` once, together.
4. **Barrier**: `npm run verify:push`, once, at the end.

## Tasks

1. Re-verify the evidence above against current code (line numbers,
   import lists, the "no cross-import between validate-model.ts and
   resolve-model.ts" fact).
2. Split `src/model/resolved-model.ts` into `src/model/resolved-model/`
   per the domain table; convert the original path to a barrel; typecheck.
3. Split `src/compiler/validate-model.ts` into
   `src/compiler/validate-model/` per the domain table, preserving the
   orchestrator's exact call order; convert the original path to a
   barrel; typecheck; test.
4. Split `src/compiler/resolve-model.ts` into
   `src/compiler/resolve-model/` per the domain table; convert the
   original path to a barrel; typecheck; test.
5. Full verification: `npm run typecheck`, `npm test`, `npm run
   format:check`, `npm run build` (check bundle size), `npm run
   verify:push`.
6. `learnings/` new document naming the domain-file map; update
   `learnings/index.md`.
7. Planning handoff, naming the Non-goals above as named-not-claimed
   candidates for follow-up phases.
8. Commit and push.

## Planning Handoff

Named candidates, none claimed here, matching the Non-goals above:

- **Next open phase number candidate** (Phase 82 was independently
  claimed by another session for reference-demo shell migration work
  before this phase executed; use the next unclaimed number):
  `presentation-runtime.ts`'s and
  `object-store.ts`'s standalone helper tails, plus `conformance/runner.ts`
  — same mechanical, barrel-preserving pattern as this phase, lower risk
  than the class-based items below, but lower value since they are runtime
  and test-support code respectively rather than the compiler path every
  language-level phase touches.
- **Phase candidate, higher model/effort**: `parser.ts`'s `AdlParser`
  class — needs an actual design step (a shared cursor/context object)
  before any split, not just relocation.
- **Phase candidate, higher model/effort, `verify:push`-per-chunk**:
  `adl-app.ts`'s `AdlAppElement` class and `presentation-runtime.ts`'s
  `PresentationRuntime` class — splittable along their existing method
  clusters, but each touches live rendering, so needs visual verification
  at a finer grain than "once at the end."
- **Phase candidate, profiling-first**: the `this.innerHTML = \`...\`}`
  full-re-render pattern across every custom element. This is the
  repository's real runtime-performance question, separate from and
  unaffected by any file-decomposition work. Should start with
  measurement, not a rewrite.
- **Test file splitting** for the four large bundled-feature test files
  named above.

## Closing Note

Not yet executed. This document exists to make the split mechanical and
low-ambiguity before any code is touched: exact domain boundaries for all
136 + 99 functions and ~230 types, the barrel strategy that keeps every
external import path unchanged, and the one real risk (diagnostic call
order) called out explicitly. See the accompanying chat response for the
recommended executor (platform, model, effort) and why.

## Execution Note

Executed in full against `main` at `03c41b8`, in one session, without a
sub-agent fan-out — the mapping and cross-file import wiring were done with
small Python extraction/generation scripts run over each file (parse
top-level declaration boundaries, assign each to its domain per the table
above, emit domain files with computed cross-file imports, typecheck,
iterate), which made the "two parallel worktree agents" step in the Parallel
Execution Plan unnecessary: the scripted approach was faster than
coordinating two agents and gave exact, reproducible control over import
wiring and declaration order.

**Re-verification findings (Task 1):** line counts for all three files were
unchanged from the doc (2,493 / 8,009 / 1,912). The doc's function counts
were undercounts, not evidence of drift: `resolve-model.ts` has 105 functions
(doc said 99), `validate-model.ts` has 136 (doc's total was right, but its
"135 internal" broke down slightly differently once decision-table's `analyze*`/
`constraint*`/`range*` cluster — 16 functions not individually named in the
table — was counted). Every one of the 105 and 136 functions, and all 319
`resolved-model.ts` type/interface/const declarations, mapped cleanly onto
the table's named domains or its explicit fallback rules (decision-table's
"keep the whole analyze/constraint/range cluster together," and "colocate a
nested sub-type with the domain file that builds or validates it"); nothing
required stopping and re-examining the plan. The "no cross-import between
`validate-model.ts` and `resolve-model.ts`" and "consumers only import the
public surface" evidence both held exactly as stated.

**One thing the doc under-specified and this execution resolved by
extension of its own stated rule:** `validate-model.ts` also has ~50
module-private (non-`export`ed) top-level `const` lookup `Set`s (e.g.
`SHELL_CONTROL_KINDS`, `PRESENTATION_LAYOUTS`, `NAMED_VALIDATOR_RULES`) and a
handful of private types (`ExpressionStaticType`, `DecisionConstraint`,
`CommandStepIteration`, ...) that the doc's domain table never named, because
it only enumerated exported/public declarations. These were assigned
mechanically by finding which domain's functions reference each one (single
domain → that domain file, as `export const`, since cross-file use now
requires it; more than one domain → `shared.ts`) — the same colocation
principle the doc already applied to nested types, extended to private
constants. See `learnings/implementation/compiler-model-layer-file-map.md`
for the resulting list.

**Deviation from the doc's literal barrel wording:** the doc says
`validate-model.ts`'s top-level barrel is one line
(`export * from "./validate-model/index.js";`) and that `index.ts` holds
"the orchestrator function plus its imports from every domain file, nothing
else." Taken fully literally this would have dropped `MODEL_VALIDATION_CODES`,
`Diagnostic`, `DiagnosticSeverity`, `SourcePosition`, and `SourceRange` off
the public path, breaking real consumers (`compile-adl.ts`, `compile-adlj.ts`,
`runtime/runtime-types.ts`, etc.). `validate-model/index.ts` therefore also
has one `export * from "./codes.js";` line ahead of the orchestrator, keeping
the top-level barrel itself exactly one line as specified while still
satisfying the Evidence section's own listed consumer surface. No other
deviation from the plan.

**Verification results:**

- `npm run typecheck` — clean, no errors, on the first attempt for
  `resolved-model.ts` and `resolve-model.ts`; `validate-model.ts` needed one
  corrective pass (adding `export` to internal helpers now called
  cross-file, which surfaced as `TS2459` errors, plus their cascading
  implicit-`any` fallout) before it was clean too.
- `npm test` — 58 test files, 1,062 tests, all passing, with **zero test
  file changes**, both after each file's split and at the end.
- `npm run format:check` — clean after one `prettier --write` pass over each
  new directory (the generator scripts didn't match this repo's exact
  Prettier wrapping rules, which is expected and harmless).
- Orchestrator call order: `validateApplicationModel`'s and
  `resolveApplicationModel`'s function bodies were diffed byte-for-byte
  against the pre-split original (`git show HEAD:<path>`) — both are
  identical apart from one trimmed trailing blank line in
  `resolveApplicationModel`'s case. Call order is unchanged.
- Content preservation: every non-blank line of each original file and of
  its concatenated replacement files was sorted and diffed; every line in
  the diff was accounted for as an expected artifact (a relocated `import`
  line, an added `export` keyword, or Prettier re-wrapping a signature or
  import list across a different number of lines) — never a line that
  simply disappeared.
- `npm run build` — production bundle gzip size: `index-*.js` was
  170.49 KB before (baseline built from a `git worktree` at `03c41b8`) and
  170.74 KB after (+0.15%); `compile-adl-project-v2-*.js` unchanged at
  51.50 KB. Well inside the 1% acceptance threshold.
- `npm run verify:push` (typecheck + format:check + test + build +
  `test:visual`) — clean; all 46 Playwright desktop/mobile/offline-shell/
  passkey/administration tests passed with zero screenshot diffs and no
  changed snapshot files in `git status`, confirming this phase touched no
  rendered output.
- Largest resulting files: `validate-model/presentation-core.ts` at 967
  lines and `validate-model/decision-table.ts` at 538 lines (both under the
  ~1,200-line ceiling; `presentation-core.ts` ran slightly over the doc's
  550-900-line estimate but not the ceiling); no `resolved-model/` file
  exceeds 273 lines, well under its ~500-line ceiling.
- `git diff --stat` against `main` shows only the three barrels reduced to
  one line each (`+3 -12,414` across the three), plus 62 new files across
  `src/model/resolved-model/`, `src/compiler/validate-model/`, and
  `src/compiler/resolve-model/` (21 + 21 + 20 — slightly more than the
  doc's "~55" estimate, since `validate-model/` and `resolve-model/` each
  needed a `shared.ts` the estimate didn't itemize separately). No file
  outside those three directories and their barrels was modified.

Planning handoff: unchanged from the Non-goals/Planning Handoff sections
above — none of those candidates were claimed or started here.
