# AGENTS.md

## Project

This repository is the standalone ADL implementation:

```text
/home/vince/projects/personal/adl
```

The old MINIL repository is read-only prior art:

```text
/home/vince/projects/personal/minil
```

Do not create a nested `adl/` implementation folder inside either repository. Do not modify MINIL unless the user explicitly asks for that.

## Source of Truth

Before implementation work, read:

1. `ADL_Codex_Implementation_Brief_v2.md`
2. The current phase file in `docs/phases/`
3. `learnings/index.md`
4. Any learning documents that `learnings/index.md` says are relevant to the task

## Phase Discipline

Execute one phase at a time. Do not start later phases unless needed to complete the active phase safely.

Every phase must end with:

1. Updating `learnings/` if the phase produced reusable project knowledge.
2. Reviewing what happened and updating the next phase document if actual results require changed scope, constraints, deliverables, or tasks.
3. Committing all repository changes for the phase and pushing the current branch.

## Testing

For code phases, add or update tests that prove the behavior introduced by the phase. Run the relevant test, typecheck, lint, format, or build commands that exist in the project at that point. If a command cannot run, record why in the final summary.

For documentation-only phases, no automated tests are expected, but verify the requested files exist and that instructions do not contradict the repository boundary.

## Implementation Boundaries

- The runtime consumes the resolved model, not parser AST nodes.
- ADL is runtime-model-first, not transpiler-first.
- Do not generate Dart, Flutter, Elixir, LiveView, or bespoke application code as the primary architecture.
- Policy enforcement belongs in runtime services. UI behavior must not be the only enforcement point.
- Keep implementation scoped to the active phase and existing project patterns.
