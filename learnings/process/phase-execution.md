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
