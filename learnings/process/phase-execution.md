# Phase Execution

ADL work is organized as one executable markdown file per phase in `docs/phases/`.

Run one phase at a time. A fresh chat/session between phases is useful, but the repository state should remain intact.

Before executing a phase:

1. Read `ADL_Codex_Implementation_Brief_v2.md`.
2. Read the active phase file.
3. Read `AGENTS.md`.
4. Read `learnings/index.md` and any relevant learning documents it references.
5. Inspect current repository state and prior phase outputs.

During a phase, keep changes scoped to that phase unless a small adjacent change is required to complete it safely.

At the end of every phase:

1. Run relevant verification.
2. Update `learnings/` if reusable project knowledge was discovered.
3. Update the next phase document if actual results require changed scope, constraints, deliverables, or tasks.
4. Commit all repository changes for the phase and push the current branch.
5. Summarize what changed, what was verified, and what remains.

## Planning Handoff Must Be Repository-Wide

Phases 44, 45 and the original Phase 46 were each planned as "the next demonstrated gap" immediately after the phase that exposed it. All three landed inside the same `authority-*` projection subsystem, and none delivered a user-visible capability, while the client could not reach the server at all and no operator could start it. A handoff that only looks at the subsystem just touched is local search, and it drifts.

From Phase 46 onward, a next-phase handoff must justify its phase as the highest-value remaining gap **repository-wide**, not merely the next gap in the subsystem the current phase touched. If a higher-value gap exists elsewhere, say so and re-sequence. Phase numbers must continue to equal execution order, so re-sequencing means renumbering the affected documents.

## Parallel Execution Plan

Each phase document carries a `## Parallel Execution Plan` section so a phase can compress wall-clock time without racing on shared state. Write it as three parts:

1. **Serial spine.** Shared types, signatures, defaults and validation first, in one pass, with no consumers. This is skeleton-first: later agents receive real outputs instead of predicting them. `resolved-model.ts`, `resolve-model.ts`, `validate-model.ts`, `authority-config.ts` and any case/runner schema belong here.
2. **Fan out.** One agent per independent capability, test file, UI component group, or documentation bundle. Prefer many small independent files over shared ones.
3. **Keep serial.** Anything several streams would write concurrently. In this repository that reliably means `src/index.ts` (every server module is re-exported through it), `src/ui/components/register.ts` and shell chrome, ordered migration SQL files, the conformance runner and case schema, reference app fixtures, and specification updates that must reconcile all streams at once.

Use worktree isolation whenever two agents would write the same directory.

Barriers to plan for deliberately:

- A specification or triage update that genuinely needs every stream's result is a real barrier; use one.
- Run `npm run test:integration` once at a barrier, not per agent. Concurrent runs are safe — `tests/integration/global-setup.ts` gives each run a PID-unique container name and an ephemeral port — but each one provisions its own throwaway PostgreSQL and reapplies every migration.
- Run `npm run verify:push` exactly once, at the end. Its Playwright desktop and mobile screenshot pass is the slowest step in the repository and its screenshot inspection is manual, so it cannot be parallelised.

Do not fan out sequential code edits on one file, migrations, or anything where one agent's output is another agent's input.
