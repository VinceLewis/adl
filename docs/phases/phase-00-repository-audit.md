# Phase 0 - Repository Audit

## Objective

Understand the old MINIL repository well enough to identify reusable ideas, risks, and discarded implementation paths, without modifying MINIL. Establish this repository as the standalone ADL codebase.

## Scope

Work only in `/home/vince/projects/personal/adl`.

Treat `/home/vince/projects/personal/minil` as read-only prior art. Do not create `/home/vince/projects/personal/minil/adl`, do not copy large MINIL source trees into ADL, and do not reuse the MINIL build system.

## Expected Deliverables

- `NOTES_FROM_MINIL.md`
- `docs/adr/0001-runtime-model-not-transpiler.md`
- `docs/adr/0002-resolved-model-is-stable-contract.md`
- A short completion summary explaining the shape of the old MINIL repo and the current ADL repo

## Acceptance Criteria

- MINIL has been inspected but not modified.
- `NOTES_FROM_MINIL.md` separates reusable concepts, reusable code, discarded code, and risks.
- ADR 0001 records that ADL is runtime-model-first, not transpiler-first.
- ADR 0002 records that the resolved model is the stable runtime contract.
- The ADL implementation remains rooted at `/home/vince/projects/personal/adl`.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md as the source of truth.

Execute Phase 0 only. Work in /home/vince/projects/personal/adl. Treat /home/vince/projects/personal/minil as read-only prior art.

Inspect the MINIL repository enough to write NOTES_FROM_MINIL.md and create the first two ADRs. Do not modify MINIL. Do not create a nested adl/ folder. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-01-resolved-model.md if the actual findings require a change.
```

## Tasks

1. Confirm the current working directory is `/home/vince/projects/personal/adl`.
2. Inspect the ADL repository shape:

   ```bash
   find . -maxdepth 3 -type f | sort
   ```

3. Inspect the MINIL reference repository without modifying it:

   ```bash
   find ../minil -maxdepth 4 -type f | sort | sed 's#^\.\./minil/##'
   ```

4. Identify MINIL assets relevant to ADL:
   - Parser and lexer code
   - AST structures
   - Validator code
   - Language specs or notes
   - Example applications
   - Tests and fixtures
   - Dart/Flutter emitters
   - Elixir/Phoenix LiveView emitters
   - Procedural or inline-code features that should not drive the ADL MVP

5. Create `NOTES_FROM_MINIL.md` with these sections:
   - Repository shape
   - Reusable concepts
   - Reusable code or tests
   - Discarded code and why
   - Risks and unknowns
   - Recommendations for Phase 1

6. Create `docs/adr/0001-runtime-model-not-transpiler.md` with Context, Decision, Consequences, and Rejected alternatives.
7. Create `docs/adr/0002-resolved-model-is-stable-contract.md` with Context, Decision, Consequences, and Rejected alternatives.
8. Verify that no files under `../minil` were modified.
9. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
10. Review what happened in this phase and update `docs/phases/phase-01-resolved-model.md` if the actual findings require changed scope, constraints, deliverables, or tasks.
11. Commit all repository changes for this phase and push the current branch.
