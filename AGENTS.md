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

Before authoring any new `.adl` or `.adlj` application content — a reference
app, an example fixture, a spec example, a conformance case, anything being
generated rather than hand-edited — also read `docs/spec/adlj.md`. `.adlj`,
not `.adl` text, is the primary authoring surface: `.adl` text is a
generated, human-reviewable view produced from `.adlj` via
`src/compiler/print-adl.ts`, not a source to hand-author for new work. See
also `docs/spec/language.md` for grammar/semantics (still authoritative for
what a construct means; `.adlj` resolves to the same semantics, JSON-shaped).

## Phase Discipline

Execute one phase at a time. Do not start later phases unless needed to complete the active phase safely.

Every phase must end with:

1. Updating `learnings/` if the phase produced reusable project knowledge.
2. Reviewing what happened and updating the next phase document if actual results require changed scope, constraints, deliverables, or tasks.
3. Committing all repository changes for the phase and pushing the current branch.

## Testing

For code phases, add or update tests that prove the behavior introduced by the phase. Run the relevant test, typecheck, lint, format, or build commands that exist in the project at that point. If a command cannot run, record why in the final summary.

### Backend/authority integration testing

Tests that exercise the authority server, PostgreSQL projections, migrations, the unit-of-work, or the HTTP edge MUST run against a real backend, not a mock or in-memory fake of PostgreSQL. Fakes that pattern-match SQL are not acceptable as the correctness proof for backend behaviour: they hide real defects (for example, a NUL byte in a text key that only real PostgreSQL rejects, or real transaction/locking semantics).

- Real backend tests live under `tests/integration/` and run with `npm run test:integration`.
- They provision a throwaway PostgreSQL via Docker automatically (`postgres:16-alpine`), or use `ADL_TEST_DATABASE_URL` if set (e.g. a CI Postgres service). Docker (or that env var) is required to run them.
- They apply the real `src/server/migrations/*.sql`, exercise the code over a real `pg` pool, and drive the HTTP edge over a real local network socket with `fetch`.
- The fast hermetic suite (`npm test`) excludes `tests/integration/**` so it needs no Docker; do not add backend behaviour that is only covered there.
- When adding or changing authority/server behaviour, add or update the matching real integration test and run `npm run test:integration`. In-memory stores remain acceptable only as test wiring for non-backend units, never as the backend under test.

Before pushing any change that affects browser UI rendering, shell chrome, reference app screens, presentation runtime output, or CSS, run `npm run verify:push`. This includes Playwright desktop and mobile screenshots for every Giggle Band app page through `npm run test:visual`; inspect the generated screenshots before committing.

For documentation-only phases, no automated tests are expected, but verify the requested files exist and that instructions do not contradict the repository boundary.

### Persisted-state upgrade testing

Any phase that changes a resolved-model shape reachable from a shipped reference/demo app's model (adding, removing, or renaming a field; changing how a default resolves; changing shell, presentation, or any other content that participates in the model fingerprint) — **or** bumps a reference/demo app's `modelVersion` for any reason — MUST add or update a persisted-state upgrade test for **every** reference/demo app whose model changed, not one representative app. "It's the same kind of change as the app that already has a test" is not a reason to skip the others: Phase 82 shipping only Giggle Band's test while also changing Jointly Care and the generic persistent browser demo is the failure mode this rule exists to close, and it recurred three more times (`010dfc8`, `cf12207`, `517f874`) in the very session that authored this rule — real content changes that bumped `modelVersion` without, at the time, a matching test update, including one (`517f874`) that corrected a *previous* bump's own mistaken claim that no further version bump was needed.

The test must, against a real browser (Playwright) and a real app URL, not a mock:

1. Seed a real IndexedDB database with the *previous* version's actual persisted shape — application metadata (`modelVersion`, `modelFingerprint`) and at least one real record for an object the migration touches (or, if the migration is a no-op empty-object migration, at least one record proving byte-identical survival).
2. Load the actual app URL — not a synthetic test harness page.
3. Verify: migration is applied (not refused — the fail-closed guard firing here is the bug, not the fix), the app renders its real start view rather than a blank page or a thrown `RuntimeStartupError`, and persisted metadata now reflects the new version.

Assert the resulting version by reading it back from the real mounted app in the page (its `<adl-app>` element's own `model.modelVersion`), not a hard-coded version string: a reference app's `modelVersion` moves independently of any one phase, and a hard-coded expected value goes stale the next time it does, for reasons unrelated to the test itself. Do not import a reference app's model factory (`band-app.ts`, `jointly-app.ts`, `demo-fixture.ts`) directly into a Playwright spec file to compute this instead — anything that transitively loads `.adl`/`.adlj`/`.yaml` via Vite's `?raw` imports fails to parse under Playwright's own module loader, which does not share Vite's transform. Read whatever the test needs from the real page instead.

This is a real-browser-only requirement, distinct from and in addition to any `fake-indexeddb` unit coverage of the migration mechanism itself (see `tests/browser-model-migration.test.ts`, Phase 51) — the unit layer proves the mechanism; this layer proves a specific shipped app's specific transition. A shared helper for seeding and reading back persisted state lives at `tests/visual/support/persisted-upgrade.ts`; use it rather than hand-rolling raw `indexedDB` calls per app. See `tests/visual/giggle-band.visual.spec.ts`, `tests/visual/jointly-care.visual.spec.ts`, and `tests/visual/browser-demo.visual.spec.ts` for worked examples, and `learnings/implementation/model-versions-and-migrations.md` for the mechanism these tests exercise end to end.

### Design/UX review before a UI-affecting change is done

`npm run verify:push`'s screenshots prove a change doesn't crash and prove *upgrade* compatibility (see above); neither proves the result is good to look at or usable. Three real, user-facing UI/UX defects shipped to `main` in one session despite `npm test` and, in two of the three cases, `npm run verify:push` passing clean: a duplicated status icon on every schedule row, a theme-picker dropdown with white text on a white background (unreadable except on hover), and a mobile top bar where every control rendered as its own full-viewport-width stacked block, consuming close to a third of the screen before any content appeared. None were caught by an automated check; all three were found by a human testing on an actual phone.

Before considering any change to browser UI rendering, shell chrome, reference app screens, presentation runtime output, or CSS done — not just before pushing — run `/impeccable audit <changed files>` (or, for a more holistic pass on a screen rather than a diff, `/impeccable critique <target>`) and address what it finds, the same way a finding from the automatic post-edit hook is already required to be triaged rather than ignored (see the hook's own instructions: fix real findings, explicitly record contextually-intentional ones as false positives, never suppress a real finding just to silence it). This does not replace `verify:push` or a human visually inspecting the generated screenshots; it is a second, differently-shaped pass — `impeccable` catches known categories (contrast ratios, layout patterns, spacing) mechanically and consistently, where a quick eyeball of a screenshot is exactly the kind of check that is easy to skim past under time pressure, which is how the white-on-white dropdown shipped past a screenshot inspection that would only have shown the dropdown *closed*.

### Compile-check ADL source before presenting it

Any ADL source drafted or edited by an agent — reference app source, spec
examples, conformance fixtures, anything — must be run through the compiler
and its `diagnostics` inspected before the source is presented, committed, or
relied on, the same way a TypeScript change is never considered done before
`tsc` is clean. Do not treat a syntactically-plausible draft as correct on the
strength of having read the spec; ADL has no pretrained prior behind it the
way Go or TypeScript do, so a spec-plausible draft is a guess until the actual
compiler has run over it. A diagnostic is ground truth over any assumption
about what the grammar should accept — fix the source, not the check.

Until a dedicated CLI exists for this (see `docs/phases/phase-72-*.md` for a
candidate), check with a throwaway vitest file rather than assuming an
unlisted tool (`tsx`, `ts-node`) is installed, since only `vitest` is a
project dependency today.

New ADL content should be authored as `.adlj` (see `docs/spec/adlj.md`) and
checked with `compileAdlj` — this is the primary pattern:

```ts
// tests/scratch-compile-check.test.ts (delete after use — never commit it)
import { describe, it, expect } from "vitest";
import { compileAdlj } from "../src/compiler/compile-adlj.js";

it("compiles cleanly", () => {
  const doc = { app: { name: "..." }, objects: [ /* ...draft .adlj content... */ ] };
  const { diagnostics } = compileAdlj(JSON.stringify(doc));
  expect(diagnostics).toEqual([]);
});
```

When hand-authoring or reviewing `.adl` text directly — editing an existing
`.adl` file, or reviewing text that `print-adl.ts` printed from a `.adlj`
source — use `compileAdl` on the text the same way:

```ts
import { compileAdl } from "../src/compiler/compile-adl.js";

it("compiles cleanly", () => {
  const { diagnostics } = compileAdl(`...draft ADL source...`);
  expect(diagnostics).toEqual([]);
});
```

```bash
npx vitest run tests/scratch-compile-check.test.ts
```

### Establish behavioural claims by running, not by reading

The same rule as the section above, applied one level up: **a claim about what
the running system does is only evidence once it has been run.** Reading the
code that would do it is not evidence, and in this codebase it is actively
misleading — ADL degrades silently by design. A denied read falls back to the
raw record id rather than raising, so a policy that denies everything is
indistinguishable by inspection from a missing display projection; an
unreachable `ROLE` principal reads exactly like a working grant; an empty
`GRANT ... ON ALL TABLES` reads exactly like a grant covering everything.
Reading a resolver tells you what it does *when permitted*, never whether it
is permitted.

This has produced a false "Evidence and Dependency" section that a whole phase
was then scoped against. Before asserting runtime behaviour — especially in a
phase document, which later work builds on — execute it. A throwaway vitest
against the seeded reference app with a real context is cheap. Mark inferred
claims as inferred, explicitly, so a reader can tell them from measured ones.
Prove rendering by inspecting the `verify:push` screenshots, not by reading the
template. See `learnings/process/evidence-by-execution.md` for the four
incidents behind this rule.

Corollary: running a check and discarding its verdict is the same failure. **A
pipeline reports its last command's exit status**, so `npm run verify:push |
tail -40` reports `tail`'s success while Playwright reports `1 failed`, and
`cmd; echo $?` reports `echo`'s. Redirect to a file, capture `$?` on the very
next line, print it, and read the number.

## Implementation Boundaries

- The runtime consumes the resolved model, not parser AST nodes.
- ADL is runtime-model-first, not transpiler-first.
- Do not generate Dart, Flutter, Elixir, LiveView, or bespoke application code as the primary architecture.
- Policy enforcement belongs in runtime services. UI behavior must not be the only enforcement point.
- Keep implementation scoped to the active phase and existing project patterns.
