# Phase 83 — Persisted-State Upgrade Testing Requirement

> Commissioned directly by the user, from a testing-process learning
> surfaced by a `codex` session's work going poorly: *"The testing
> instructions should also explicitly require a persisted-state upgrade
> test whenever a resolved model or model version changes: seed IndexedDB
> using the previous version, load the actual app URL, and verify
> migration, retained data, and successful startup."*
>
> **Do not execute this phase until Phase 81 (`docs/phases/
> phase-81-compiler-model-layer-decomposition.md`) has landed on `main`
> and been verified by both the user and the assistant.** Phase 81 is a
> pure module-decomposition (no resolved-model shape change, no
> `modelVersion` bump — see its own Acceptance Criteria), so it should not
> itself require the upgrade test this phase is about, but this phase's
> execution should start from a clean, verified baseline rather than
> racing an in-flight refactor of the very compiler files
> (`resolve-model.ts`, `validate-model.ts`, `resolved-model.ts`) this
> phase's tests exercise indirectly through `resolveApplicationModel`.

## Objective

Make "a persisted-state upgrade test is required whenever a resolved
model shape or a reference/demo app's `modelVersion` changes" a
structural, enforced-by-process part of this repository's testing
discipline — not the reactive, one-app-only fix it was this time.

## Evidence and Dependency

Re-verify against current code before executing.

- **The bug this phase exists to stop from recurring**: `d020b2d`
  ("Make shell navigation explicit by default") changed resolved shell
  content for every reference app without bumping `modelVersion`. An
  existing browser installation of Giggle Band rendered a blank page on
  reload — `ADL_PERSISTED_MODEL_FINGERPRINT_STALE` — because the fail-closed
  fingerprint guard correctly refused to read persisted data whose
  fingerprint no longer matched the (same-numbered) model. `03c41b8`
  ("Migrate persisted demos after shell model change", `docs/phases/
  phase-82-reference-demo-shell-model-migration.md`) fixed this
  reactively, after the fact, from a manual repro
  ("An existing `http://localhost:5173/?demo=giggle-band` installation
  rendered a blank page after a hard refresh").
- **Why the existing visual gate didn't catch it**: Phase 82's own
  Evidence section states it directly — *"The visual suite did not
  reproduce this because Playwright creates fresh browser contexts and
  therefore had no pre-Phase-80 IndexedDB metadata. Its screenshots
  proved clean-install rendering, not upgrade compatibility."* This is
  the structural gap: `npm run verify:push`'s screenshot suite has never
  proven upgrade compatibility, only clean-install rendering, for any
  reference app, at any point in this repository's history.
- **The fix that shipped only covers one of the three apps it changed**:
  `03c41b8` bumped `modelVersion` for Giggle Band (`1.0.0` → `1.1.0`),
  Jointly Care (`1.0.0` → `1.1.0`, `src/reference/jointly-care/domain.adlj`),
  and the generic persistent browser demo (`0.1.0` → `0.2.0`,
  `src/ui/demo-fixture.ts:32`, migration declared at
  `src/ui/demo-fixture.ts:41`) — three apps, one version bump each. It
  added a real-browser persisted-upgrade test for exactly one:
  `tests/visual/giggle-band.visual.spec.ts` gained a ~80-line hand-authored
  test (`"opens and migrates a persisted pre-explicit-navigation
  installation"`) that deletes and reseeds Giggle's real IndexedDB
  database with stale `1.0.0` metadata, loads the real app URL, and
  asserts both successful rendering and that metadata advanced to
  `1.1.0`. `tests/visual/jointly-care.visual.spec.ts` has no equivalent
  (confirmed by grep: only `giggle-band.visual.spec.ts` contains
  `"persisted-upgrade"` or `"migrates a persisted"`). The generic
  persistent browser demo has **no dedicated visual spec file at all**
  today — `tests/visual/offline-shell.spec.ts` covers service-worker
  caching, not model-version upgrade; confirm at execution time whether
  one now exists or whether this phase creates the first one.
- **The complementary layer that already exists, and what it doesn't
  prove**: `tests/browser-model-migration.test.ts` (Phase 51) proves the
  migration *mechanism's* storage semantics — atomic metadata+record
  commit, revision preservation, refusal paths — against `fake-indexeddb`
  and a synthetic model built in the test file itself. It is a real,
  valuable, and correctly-scoped unit-level proof, but it proves the
  mechanism works in the abstract, not that any specific shipped
  reference app's specific version bump migrates correctly end to end.
  That second layer — real browser, real app URL, real reference app's
  actual before/after model — is what would have caught the Giggle Band
  blank-page bug before it shipped, and it is what this phase makes
  structurally required rather than optional-and-usually-skipped.
- **No existing testing-discipline text requires this**: `AGENTS.md`'s
  `## Testing` section (from line 47) requires `npm run verify:push` for
  anything touching rendering, real-backend integration tests for
  authority/PostgreSQL behaviour, and compile-checking any ADL/`.adlj`
  source before it's relied on — nothing about persisted-state upgrade
  compatibility when a resolved-model shape or a reference app's
  `modelVersion` changes. `learnings/implementation/
  model-versions-and-migrations.md` documents the migration mechanism
  thoroughly (declarative, total, pure; commit-together; preserve
  revision/actor/timestamps; never destroy as a fallback) but carries no
  testing obligation tied to invoking it.

## Decision

### 1. A new, explicit testing-discipline rule in `AGENTS.md`

Add a subsection under `## Testing` (siblings: "Backend/authority
integration testing", "Compile-check ADL source before presenting it"),
titled "Persisted-state upgrade testing", stating:

> Any phase that changes a resolved-model shape reachable from a shipped
> reference/demo app's model (adding, removing, or renaming a field;
> changing how a default resolves; changing shell, presentation, or any
> other content that participates in the model fingerprint) — **or**
> bumps a reference/demo app's `modelVersion` for any reason — MUST add
> or update a persisted-state upgrade test for **every** reference/demo
> app whose model changed, not one representative app. "It's the same
> kind of change as the app that already has a test" is not a reason to
> skip the others; Phase 82 shipping only Giggle Band's test while also
> changing Jointly Care and the generic demo is the failure mode this
> rule exists to close.
>
> The test must, against a real browser (Playwright) and a real app URL,
> not a mock:
>
> 1. Seed a real IndexedDB database with the *previous* version's actual
>    persisted shape — application metadata (`modelVersion`,
>    `modelFingerprint`) and at least one real record for an object the
>    migration touches (or, if the migration is a no-op empty-object
>    migration, at least one record proving byte-identical survival).
> 2. Load the actual app URL — not a synthetic test harness page.
> 3. Verify: migration is applied (not refused — the fail-closed guard
>    firing here is the bug, not the fix), the app renders its real start
>    view rather than a blank page or a thrown `RuntimeStartupError`, and
>    persisted metadata now reflects the new version.
>
> This is a real-browser-only requirement, distinct from and in addition
> to any `fake-indexeddb` unit coverage of the migration mechanism itself
> (see `tests/browser-model-migration.test.ts`, Phase 51) — the unit
> layer proves the mechanism; this layer proves a specific shipped app's
> specific transition.

### 2. A reusable helper, not another hand-rolled 80-line block per app

`03c41b8`'s Giggle Band test hand-authored raw `indexedDB.open`/
`transaction`/`objectStore` calls inline in the spec file. Extract this
into a shared helper — e.g. `tests/visual/support/persisted-upgrade.ts`
— exposing something like:

```ts
async function seedStalePersistedInstallation(
  page: Page,
  options: {
    dbName: string;
    staleMetadata: { modelVersion: string; modelFingerprint: string };
    seedRecords?: Array<{ key: string; object: string; record: unknown }>;
  },
): Promise<void>;

async function readPersistedApplicationMetadata(
  page: Page,
  dbName: string,
): Promise<{ modelVersion?: string } | undefined>;
```

parameterized so Jointly Care and the generic demo reuse it rather than
copy-pasting Giggle's version. Refactor Giggle Band's existing test to
use the extracted helper as part of this phase, proving the extraction
is behavior-preserving before it's relied on by the two new call sites.

### 3. Backfill the two apps Phase 82 changed but didn't test

- Add the equivalent persisted-upgrade test to
  `tests/visual/jointly-care.visual.spec.ts`, seeding Jointly's real
  pre-`1.1.0` metadata (`adl-jointly-care-example` or whatever its actual
  IndexedDB database name is — confirm at execution time) against the
  real `?demo=jointly-care` URL.
- Add the equivalent test for the generic persistent browser demo. If no
  visual spec file currently exercises it, create one (naming and
  Playwright project convention to match the existing `giggle-band.visual.spec.ts`
  / `jointly-care.visual.spec.ts` pattern); do not fold it into
  `offline-shell.spec.ts`, whose scope is service-worker caching, not
  model-version upgrade.

### 4. Record this as reusable knowledge

Update `learnings/implementation/model-versions-and-migrations.md` (or add
a short new learnings document if the existing one is about the migration
mechanism specifically and this is better kept as a testing-process note —
decide at execution time which reads more naturally) to state the
requirement and point at the extracted helper. Update `learnings/index.md`
so "changing a resolved model shape" and "bumping a reference app's model
version" task types route here.

## Scope

- `AGENTS.md`: new "Persisted-state upgrade testing" subsection under
  `## Testing`.
- New `tests/visual/support/persisted-upgrade.ts` (naming TBD to match
  existing `tests/visual/` conventions — check for an existing `support/`
  or shared-helper directory before creating one).
- `tests/visual/giggle-band.visual.spec.ts`: refactor the existing
  persisted-upgrade test to use the extracted helper.
- `tests/visual/jointly-care.visual.spec.ts`: new persisted-upgrade test.
- A new or extended visual spec for the generic persistent browser demo.
- `learnings/implementation/model-versions-and-migrations.md` (or a new
  learnings doc) and `learnings/index.md`.

## Constraints

- Real browser (Playwright), real app URL, real IndexedDB — no mocking
  the migration mechanism itself in these three tests. `fake-indexeddb`
  unit coverage stays exactly where it already is (Phase 51's
  `tests/browser-model-migration.test.ts`); this phase does not touch it
  except to reference it from the new `AGENTS.md` text.
- No change to the migration mechanism, the fingerprint guard, or any
  reference app's actual model content. This phase is testing-process
  and test-coverage only.
- The Giggle Band test's observable behavior must be unchanged after its
  refactor onto the shared helper — same seed data, same assertions, same
  screenshot.

## Deliverables

- `AGENTS.md`'s new subsection.
- The extracted helper.
- Three passing persisted-upgrade tests (Giggle Band refactored, Jointly
  Care new, generic demo new), each proving its app's actual last version
  transition.
- `learnings/` update.

## Acceptance Criteria

- `npm run verify:push` passes, including all three persisted-upgrade
  tests, with screenshots inspected.
- Each of the three tests independently fails if the fingerprint guard's
  refusal path is temporarily forced (confirm this by deliberately
  breaking one migration declaration locally, observing the corresponding
  test fail with `RuntimeStartupError`/a blank-page assertion failure,
  then reverting — do not commit the deliberate breakage). This is the
  proof that the tests actually exercise the failure mode Phase 82 fixed,
  not merely a happy-path click-through.
- `AGENTS.md`'s new text is unambiguous enough that a future phase
  changing only one of several affected apps' models would be caught by
  a reviewer (human or agent) reading the Testing section, not only by
  hindsight.
- No existing test's assertions or screenshots change other than Giggle
  Band's refactored test continuing to pass with identical behavior.

## Testing

- `npm run test:visual` (or the full `npm run verify:push`) for the three
  persisted-upgrade tests plus the full existing visual suite, screenshots
  inspected.
- `npm test` unaffected — this phase does not touch the fast hermetic
  suite's contents beyond documentation.

## Non-goals

- **Automated/CI enforcement** that mechanically detects "a `modelVersion`
  or resolved-model shape changed without a matching upgrade test" and
  blocks the change. Real, separable tooling work (would need to parse a
  diff for model-shape changes and cross-reference test coverage); this
  phase's enforcement is procedural — written into `AGENTS.md`'s binding
  Testing section — not mechanical. Named as a candidate for a later
  phase, not attempted here.
- Retroactively adding persisted-upgrade tests for version bumps further
  back in this repository's history than the three `03c41b8` changed.
- Any change to the migration mechanism itself, the fingerprint guard, or
  `learnings/implementation/model-versioning-guard.md`'s content.

## Dependencies

- Phase 81 (module decomposition) landed and verified — see the note at
  the top of this document.
- `docs/phases/phase-82-reference-demo-shell-model-migration.md` (the
  fix this phase generalizes).
- `tests/browser-model-migration.test.ts` (the unit layer this phase's
  new text explicitly distinguishes itself from).
- `learnings/implementation/model-versions-and-migrations.md`,
  `learnings/implementation/model-versioning-guard.md`.

## Tasks

1. Confirm Phase 81 has landed on `main` and been verified.
2. Re-verify the evidence above against current code, including whether a
   generic-demo visual spec file now exists.
3. Extract `tests/visual/support/persisted-upgrade.ts` from Giggle Band's
   existing test; refactor that test onto it; confirm identical behavior.
4. Add Jointly Care's persisted-upgrade test.
5. Add (or create the file for) the generic persistent browser demo's
   persisted-upgrade test.
6. Add `AGENTS.md`'s new "Persisted-state upgrade testing" subsection.
7. Update `learnings/` and `learnings/index.md`.
8. `npm run verify:push`; inspect screenshots; perform and revert the
   deliberate-breakage check described in Acceptance Criteria.
9. Commit and push.

## Planning Handoff

- **CI enforcement candidate** (see Non-goals): a check that flags a diff
  changing `ResolvedApplicationModel` or a reference app's `modelVersion`
  without a corresponding test change under `tests/visual/`. Real tooling
  work, not attempted here.

## Closing Note

Executed in full against `main`, starting from Phase 81 (`9d3d2cf`) plus its
verification fix (`68c6100`), as instructed.

**Re-verification findings (Tasks 1–2).** The doc's evidence held on file
existence and layout: `AGENTS.md`'s `## Testing` section, the `tests/visual/`
convention, `tests/browser-model-migration.test.ts` as the unit layer, and
"no generic-demo visual spec file exists yet" were all confirmed exactly as
described, and the new subsection was placed as a sibling of "Backend/
authority integration testing" and "Compile-check ADL source before
presenting it" as instructed. What had drifted was the *version numbers*
themselves: while this phase was being executed, three more real,
independently-authored commits landed on `main` from a concurrent session
working the complementary half of the same underlying problem — `010dfc8`
(Giggle Band and Jointly Care `1.1.0` → `1.2.0`, a dropped duplicate row-icon
fragment), `cf12207` (a `themeSwitch` control moved into the nav drawer,
believed at the time to be covered by `010dfc8`'s bump), and `517f874`
(correcting that belief: the theme-switch move needed its own `1.2.0` →
`1.3.0` bump). A fourth concurrent commit, `92043c4`, added a golden
model-fingerprint tripwire to the fast suite — explicitly coordinated with
this phase ("Phase 83 (in progress, separately)" in its own message) rather
than overlapping it: it closes the fast-`npm test` half of the gap, this
phase closes the real-browser half. None of these commits are part of this
phase's diff; this phase's tests were adapted to read the resulting reality
rather than a stale assumption.

**Deviation from the doc's literal helper shape, and why.** The doc sketched
`seedStalePersistedInstallation`/`readPersistedApplicationMetadata` built by
hand-constructing `StoredObjectRecord`s (mirroring Giggle Band's original
test). Building those by importing a reference app's model factory
(`band-app.ts`, `jointly-app.ts`) directly into a Playwright spec file
does not work: both transitively load `.adlj`/`.yaml` sources through Vite's
`?raw` import suffix, which Playwright's own module loader does not
understand, and the affected spec files failed to even parse. Jointly Care's
and the generic browser demo's tests were built on a stronger pattern
instead — mount the real app, let it seed its own real dataset through its
normal `seedIfEmpty` path, snapshot every persisted record, roll back only
the metadata row in place (`downgradePersistedApplicationMetadata`), reload,
and assert the full record snapshot is unchanged — which proves the entire
real seeded dataset survives byte-identical, not one hand-picked record, and
needs no reference-app import at all. The helper file also exposes
`readMountedModelVersion` (reads `<adl-app>`'s own `model.modelVersion` from
the page) so all three tests assert against the live model's actual current
version rather than a hard-coded string — necessary given the version churn
above, and now the documented pattern in `AGENTS.md` for future tests too.
Giggle Band's existing test was refactored onto `seedStalePersistedInstallation`
with identical seed data, assertions (now reading the live model version
instead of a literal), and screenshot, per the Constraint that its behavior
stay unchanged.

**Deliberate-breakage check (Acceptance Criteria).** Performed against the
generic browser demo's migration declaration in `src/ui/demo-fixture.ts`
(chosen because it was the one migration declaration not being concurrently
edited by another session at the time): changed `{ from: "0.1.0", to: "0.2.0" }`
to `{ from: "0.0.9", to: "0.2.0" }`, making the seeded `0.1.0` install
unreachable. `browser-demo.visual.spec.ts`'s persisted-upgrade test failed
exactly as expected (`expect(metadata?.modelVersion).toBe(liveModelVersion)`
— received `"0.1.0"`, expected `"0.2.0"`, i.e. the fail-closed guard
correctly refused rather than migrated). Reverted before committing;
`git diff --stat -- src/ui/demo-fixture.ts` confirmed a clean revert, and the
test was re-run green afterward.

**Verification.** `npm run typecheck`, `npm run format:check`, and the six
persisted-upgrade Playwright tests (three apps × desktop/mobile) all passed
in isolation, with all six `*-persisted-upgrade.png` screenshots inspected —
each shows the app's real start view fully rendered with real (not
placeholder) data, not a blank page. A full, uninterrupted `npm run
verify:push` was attempted repeatedly during execution but could not be
completed cleanly end-to-end: the shared working tree had a second,
concurrent session actively committing and re-editing `src/reference/
band-app.ts`, `src/reference/giggle-band/{domain,ui}.adlj`, `src/runtime/
presentation-runtime.ts` and related tests throughout this phase's
execution window (five commits landed on `main` while this phase was in
progress — `010dfc8`, `cf12207`, `517f874`, `92043c4`, and further
uncommitted work in flight at the time of the last check), which
intermittently broke the fast suite and full-suite `test:visual` runs for
reasons entirely unrelated to this phase's own files. This phase's own nine
files (the helper, three spec files, `playwright.config.ts`, `AGENTS.md`,
the two learnings files, and this document) were verified in isolation
against each stable point reached, typecheck- and format-clean throughout,
and the persisted-upgrade tests never failed for a reason traced back to
this phase's own changes. The caller should re-run `npm run verify:push`
once the concurrent work has landed and settled, as a final holistic
confirmation; nothing in this phase's own scope is expected to need further
changes for that to pass.

**Commit scope.** Given the concurrent, unrelated, in-flight changes present
in the working tree throughout execution, the commit for this phase stages
only the files this phase actually owns (via explicit paths, not `git add
-A`), leaving the other session's in-progress work exactly as it was found.
