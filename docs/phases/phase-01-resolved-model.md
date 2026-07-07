# Phase 1 - Define the Resolved Model

## Objective

Create the canonical TypeScript model consumed by the ADL runtime before building parser or UI work.

## Scope

Build a standalone TypeScript project in `/home/vince/projects/personal/adl`. The resolved model is the stable contract. Runtime services must eventually consume `ResolvedApplicationModel`, not parser AST nodes.

Do not implement the ADL text parser in this phase. Do not generate Dart, Flutter, Elixir, LiveView, or application source code.

## Expected Deliverables

- `package.json`
- `tsconfig.json`
- Vitest or equivalent test setup
- `src/model/resolved-model.ts`
- `src/model/defaults.ts`
- `src/compiler/resolve-model.ts`
- Focused tests proving the model can be imported and a hardcoded partial model can be resolved

## Acceptance Criteria

- The project installs and runs tests.
- The resolved model contains `modelVersion`.
- Each resolved object contains `schemaVersion`.
- The model represents app, object, field, validator, lookup, lifecycle, lifecycle action, policy, view, theme, sync policy, record metadata, and local operation log concepts.
- Default resolution is deterministic.
- Defaults are explicit in the resolved output, including `_guid`, storage names, table names, metadata fields, default sync mode, and default deny policy.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-01-resolved-model.md as the source of truth.

Execute Phase 1 only in /home/vince/projects/personal/adl. Create the standalone TypeScript/Vitest project, define the resolved model interfaces, implement the first default resolution functions, and add tests. Do not modify ../minil and do not build the parser or UI. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-02-model-validator.md if required.
```

## Tasks

1. Review `ADL_Codex_Implementation_Brief_v2.md`, `NOTES_FROM_MINIL.md`, ADR 0001, ADR 0002, and `learnings/minil/repository-audit.md`.
2. Create or update the TypeScript project files:
   - `package.json`
   - `tsconfig.json`
   - test configuration
3. Create `src/model/resolved-model.ts` with interfaces for:
   - `ResolvedApplicationModel`
   - app metadata
   - objects
   - fields
   - validators
   - lookups
   - lifecycle
   - lifecycle actions
   - policies
   - views
   - themes
   - sync policy
   - record metadata
   - audit and local operation log concepts where needed by later phases
4. Define a partial authoring-side model shape sufficient for default resolution. Keep it JSON-compatible.
5. Create `src/model/defaults.ts` for deterministic default constants and helper functions.
6. Create `src/compiler/resolve-model.ts` with:

   ```ts
   resolveApplicationModel(input: PartialApplicationModel): ResolvedApplicationModel
   ```

7. Implement default resolution for:
   - table name from object name
   - storage name from field name
   - implicit `_guid`
   - default metadata fields
   - default lifecycle state field when lifecycle exists
   - default views when none are specified
   - default sync mode
   - default deny policy
8. Add tests for importing the model types and resolving a minimal hardcoded model.
9. Add tests proving deterministic output for the same input.
10. Run formatting, typecheck, and tests using the commands available in the created project.
11. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
12. Review what happened in this phase and update `docs/phases/phase-02-model-validator.md` if the actual results require changed scope, constraints, deliverables, or tasks.
13. Commit all repository changes for this phase and push the current branch.
