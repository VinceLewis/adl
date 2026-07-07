# Phase 2 - Model Validator

## Objective

Validate resolved models before runtime execution and return structured diagnostics suitable for tests, developer tools, and a future language server.

## Scope

Implement validation over `ResolvedApplicationModel`. The validator must not depend on ADL syntax or parser AST nodes.

Do not implement runtime CRUD, UI, storage persistence, or parser work in this phase.

Phase 1 represents platform metadata separately from business fields. Validator reference checks should use business fields for ordinary author-facing references, and should also recognise metadata fields where the runtime contract permits them, such as the default lifecycle `_state` field.

Phase 1 also represents default deny as a policy with `defaultEffect: "deny"` and no deny-all rule. Do not treat an empty default policy rule list as invalid when the policy exists only to encode fallback deny behaviour.

## Expected Deliverables

- `src/compiler/validate-model.ts`
- Diagnostic types if not already defined
- Tests for valid and invalid resolved models
- Stable diagnostic codes

## Acceptance Criteria

- The validator returns all relevant diagnostics instead of throwing on the first issue.
- Diagnostics include severity, stable code, message, and a path.
- Tests cover invalid object, field, lifecycle, policy, sync, hook, theme, and view references where those model concepts exist.
- Valid fixture models pass validation with no errors.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-02-model-validator.md as the source of truth.

Execute Phase 2 only. Implement structured resolved-model validation and tests. Do not modify ../minil. Do not build runtime services, parser, or UI. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-03-minimal-runtime.md if required.
```

## Tasks

1. Review the resolved model and defaults produced in Phase 1.
2. Decide where shared diagnostic types live, then define:

   ```ts
   export interface Diagnostic {
     severity: "error" | "warning" | "info";
     code: string;
     message: string;
     path?: string;
     sourceRange?: SourceRange;
   }
   ```

3. Create `src/compiler/validate-model.ts`.
4. Implement validation for:
   - unique object names
   - unique field names within each object
   - business key field exists
   - display field exists
   - lifecycle state field exists in business fields or allowed metadata fields
   - lifecycle action `from` and `to` states exist
   - policy object references exist
   - policy field references exist
   - view object and field references exist
   - required fields have compatible defaults
   - auto ID is only used on text fields
   - lookup target object and display field exist
   - sync mode is valid
   - theme references are valid
   - hook references are syntactically valid
5. Assign stable diagnostic codes, for example `ADL_OBJECT_DUPLICATE` and `ADL_VIEW_FIELD_UNKNOWN`.
6. Ensure validation returns a list of diagnostics and does not mutate the model.
7. Add tests that prove multiple diagnostics are returned from a single invalid model.
8. Add tests for at least one valid model produced by `resolveApplicationModel`.
9. Add tests proving the Phase 1 default deny policy shape is valid.
10. Run typecheck and tests.
11. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
12. Review what happened in this phase and update `docs/phases/phase-03-minimal-runtime.md` if the actual results require changed scope, constraints, deliverables, or tasks.
13. Commit all repository changes for this phase and push the current branch.
