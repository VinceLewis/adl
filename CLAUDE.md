# CLAUDE.md

This is the standalone ADL implementation: a runtime-model-first application
definition language, its TypeScript reference runtime, browser UI runtime, and
authority server.

`AGENTS.md` is the source of truth for project rules. This file exists so a fresh
session loads the right context automatically; it does not replace `AGENTS.md`.

## Read Before Working

1. `AGENTS.md`
2. The active phase document in `docs/phases/`
3. `learnings/index.md`, plus every learning document it says is relevant to the
   task at hand
4. `ADL_Codex_Implementation_Brief_v2.md`

`learnings/index.md` maps task types to the learning documents that must be read
first. Follow it rather than guessing which ones matter.

Before authoring any new `.adl` or `.adlj` application content — a reference
app, an example fixture, a spec example, a conformance case, anything being
generated rather than hand-edited — also read `docs/spec/adlj.md`. `.adlj`,
not `.adl` text, is the primary authoring surface: `.adl` text is a
generated, human-reviewable view produced from `.adlj` via
`src/compiler/print-adl.ts`, not a source to hand-author for new work. See
also `docs/spec/language.md` for grammar/semantics (still authoritative for
what a construct means; `.adlj` resolves to the same semantics, JSON-shaped).

## Phase Discipline

Work is organised as one executable document per phase in `docs/phases/`. Execute
one phase at a time. The next phase is the lowest-numbered document whose work is
not yet implemented; confirm against `git log` rather than assuming. Phase numbers
equal execution order.

Before starting a phase, verify its "Evidence and Dependency" section still holds
against the current code. If the evidence has gone stale, say so and adjust that
phase's scope before executing it.

Every phase ends with: relevant verification, a `learnings/` update if the phase
produced reusable knowledge, the document's required planning handoff, a commit
of all the phase's changes, and a push.

A planning handoff must justify its next phase as the highest-value remaining gap
**repository-wide**, not merely the next gap in the subsystem just touched. See
`learnings/process/phase-execution.md` for why this rule exists.

## Commits

Commit phase work directly to `main` and push. This is the established convention
for every phase in this repository's history; do not create a branch for phase
work unless asked.

## Testing

- `npm test` is the fast hermetic suite and excludes `tests/integration/**`.
- Authority server, PostgreSQL projection, migration, unit-of-work and HTTP edge
  behaviour MUST be proven against real PostgreSQL under `tests/integration/`
  via `npm run test:integration`. A fake that pattern-matches SQL is never an
  acceptable correctness proof. Docker must be running, or set
  `ADL_TEST_DATABASE_URL`.
- `npm run verify:push` before pushing anything that affects browser rendering,
  shell chrome, reference app screens, presentation output, or CSS. Inspect the
  generated Playwright screenshots before committing.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour in order to make verification pass. If a case reveals a real
  defect, fix the defect and record it.
- Any ADL source drafted or edited must be run through the compiler and its
  `diagnostics` checked before it is presented, committed, or relied on. Unlike
  Go or TypeScript, ADL has no pretrained prior behind it, so a spec-plausible
  draft is a guess until the compiler has actually run over it. New content
  should be authored as `.adlj` (`docs/spec/adlj.md`) and checked with
  `compileAdlj`; `compileAdl` remains the check for hand-authored or reviewed
  `.adl` text. See `AGENTS.md`'s Testing section for both patterns.
- Every positive test needs at least one matching negative test — a case proving
  the thing is correctly refused, absent, or fails in the declared way. If the
  tests you find are positive-only, write the missing negative ones first, before
  the change you came to make, and watch them fail. A positive-only suite cannot
  tell "works" from "always allows"; both failure modes have shipped here.
- Never assert what the running system does on the strength of having read the
  code. ADL degrades silently — a denied read falls back to the raw record id —
  so a policy that denies everything is indistinguishable by inspection from a
  missing display projection. Run it. This has already produced a phase document
  whose Evidence section was false. Mark inferred claims as inferred. And note
  that a piped command reports its last stage's exit status, so redirect to a
  file and check `$?` on the next line. See
  `learnings/process/evidence-by-execution.md`.

## Local Development

To run the browser demo against a real local authority server, follow
`docs/development/local-https-development.md`. It is real TLS end to end,
because `loadAuthorityConfiguration` refuses a non-HTTPS allowed origin in every
environment, the session cookie is `__Host-` Secure, and a WebAuthn ceremony
needs a secure context. None of those three gets a development mode: do not add
one. `npm run dev` on its own stays plain HTTP and entirely local.

## Parallel Execution

Each phase document carries a `## Parallel Execution Plan`. You are authorised to
use the Agent tool for its fan-out stages, with worktree isolation where the plan
says so, without asking first.

- Serial spine first: shared types, signatures, defaults and validation in one
  pass with no consumers. Later agents then receive real outputs instead of
  predicting them.
- Keep serial what several streams would otherwise write concurrently. In this
  repository that reliably means `src/index.ts`, `src/ui/components/register.ts`
  and shell chrome, ordered migration SQL, the conformance runner and case
  schema, reference app fixtures, and specification updates.
- Run `npm run test:integration` once at a barrier, not per agent: concurrent
  runs are safe but each provisions its own throwaway PostgreSQL.
- Run `npm run verify:push` exactly once, at the end. Its screenshot pass is the
  slowest step here and its inspection is manual.

## Implementation Boundaries

The runtime consumes the resolved model, not parser AST nodes. ADL is
runtime-model-first, not transpiler-first. Policy enforcement belongs in runtime
services; UI behaviour must never be the only enforcement point. Keep changes
scoped to the active phase. See `AGENTS.md` for the full list.
