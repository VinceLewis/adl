# Phase 96 — Edit-Surface Batch Integration Failure

`npm run test:integration` has been reporting 157/158 for thirteen commits.
The single failure — `tests/integration/edit-surface-batch.test.ts > lands an
inline child edit beside a child create as one operation` — was found
incidentally while executing Phase 91 and recorded there as "pre-existing, not
caused by this phase and not fixed in it". Nobody had established whether the
defect was in the test or in the code under test. This phase settles that and
restores a green integration suite.

## Objective

Diagnose the failure to root cause, decide on evidence which side is wrong,
fix that side without weakening any claim the test makes, and leave the
integration suite green with the underlying rule pinned deliberately rather
than tripped over.

## Evidence and Dependency

### The failure

Reproduced against real PostgreSQL (Docker-provisioned `postgres:16-alpine`)
at branch point `524e110`:

```
FAIL  tests/integration/edit-surface-batch.test.ts
  > a staged batch replayed to a real authority over real PostgreSQL
  > lands an inline child edit beside a child create as one operation

Error: Expected an accepted outcome, got {
  "code": "ADL_RUNTIME_VALIDATION_FAILED",
  "status": "rejected",
  "message": "Object constraints failed.",
  "operationId": "op-batch-inline"
}
```

A rejected `AuthorityOutcome` is `{ status, operationId, code, message }` and
nothing else (`src/server/authority-types.ts:109-125`), so the message names no
constraint. The `RuntimeValidationError` thrown at
`src/runtime/object-store.ts:1496` does carry an `issues` array, and that array
is dropped at the service boundary. Instrumenting the throw site temporarily to
print it gave the actual cause — two issues, one per write in the batch:

```
ADL_RUNTIME_CONSTRAINT_UNIQUE
Constraint 'uniqueSongInSetList' requires fields SetList, Song to be unique on
object 'SetListItem'.   path: values.Song
```

### Why the batch is illegal

The test's fixture puts two existing children on the seeded set list —
`item-inline-edited` naming `songOne` at position 1, `item-inline-bystander`
naming `songTwo` at position 2 — and then submits a batch that

1. **creates** `item-inline-added` naming `seeded.songTwoId`, and
2. **updates** `item-inline-edited`, patching its `Song` to
   `seeded.songTwoId`.

`songTwo` is already on that set list. Both writes therefore duplicate
`(SetList, Song)`, and both are refused. The `getFinalConstraintRecords` pass
in `object-store.ts` evaluates the constraint over the batch's *final* state,
so this is not an ordering artefact: the final state genuinely holds `songTwo`
three times on one set list.

### When it started failing, and why

`uniqueSongInSetList` did not exist when the test was written.

- The test was introduced by `84732ab` — "Implement Phase 60 usable child
  editing", 2026-08-01.
- The constraint was introduced by `6b08065` — "Model Giggle Band's gig <->
  set-list relationship as a real ordered many-to-many", 2026-08-20 —
  as `src/reference/giggle-band/domain.adlj:1233`, with the rationale that
  giggle-new's `set_list_songs` carries `UNIQUE (set_list_id, song_id)` and
  that `SongPicker`'s `EXCLUDE_LINKED` "is a UI affordance, not enforcement —
  nothing stopped a direct create or a replayed authority write from making
  one."

Confirmed empirically rather than inferred, by checking the worktree out at
each commit and running the file against real PostgreSQL:

| commit | | result |
| --- | --- | --- |
| `684e6c5` | parent of the constraint commit | **12 passed** |
| `6b08065` | adds `uniqueSongInSetList` | **1 failed, 11 passed** |

`6b08065` touched `src/reference/band-app.ts`,
`src/reference/giggle-band/domain.adlj`, `src/reference/giggle-band/ui.adlj`,
`tests/band-reference-app.test.ts`, `tests/browser-model-migration.test.ts` and
`tests/compile-adl.test.ts`. It updated every hermetic test the constraint
broke and never touched `tests/integration/`, which `npm test` does not run.
`6b08065` is an ancestor of `02f8fa2`, which is why the failure reproduced on a
stashed tree there.

### Dependency

None. The change is confined to one integration test file, one learnings
document and this document; it touches no source under `src/`, so it does not
interact with the other phase branches in flight.

**Prior art read before deciding anything:** `AGENTS.md` (Testing),
`learnings/index.md`, `learnings/implementation/edit-surface-language.md`,
`learnings/implementation/authority-transaction-integrity.md`,
`learnings/implementation/offline-operation-identity.md`,
`learnings/implementation/storage-backend.md`,
`learnings/implementation/reference-app-models.md`.

## Decision

### The defect is in the test's fixture, not in the code

Stated plainly, because the standing rule is that a test is never weakened to
make verification pass, and this fix changes a test.

The code under test is behaving exactly as designed. `uniqueSongInSetList` is a
real object constraint on the shipped Giggle Band model, deliberately added so
that a *replayed authority write* — precisely what this test performs — cannot
put one song twice on one set list. The authority refusing the batch, and
refusing it whole, is the enforcement `6b08065` set out to add. There is no
transactional-integrity failure here: the batch is atomic, it is refused
atomically, and nothing lands.

What is wrong is the test's sample data. Written nineteen days before the
constraint existed, it reuses `seeded.songTwoId` for both the created child and
the patched child's new `Song`. That data became domain-illegal when the model
gained the constraint, and no one noticed because the fast suite does not run
`tests/integration/**`.

### The fix is the fixture, and the assertions stand untouched

The test's *claim* — an inline child edit lands beside a child create as one
operation, one outcome, one audit event each, siblings untouched — is a real
promise of the batch kind and is unchanged. Every assertion in the test is kept
verbatim; only the song ids the scenario uses are changed, so the scenario is
one the model permits. The patch still carries a required lookup, an enum, a
boolean and a date, which is the mix the test's own comment says it exists to
exercise, and the lookup still genuinely *changes* — it now moves to a song the
set list does not already hold.

This is correcting a fixture that was proven wrong, not relaxing an assertion
that was failing. The distinction is the whole point: had the assertion been
loosened (accepting a rejection, or dropping the `Song` patch) the promise
would have stopped being tested.

### The rule the old fixture was tripping over gets pinned deliberately

`uniqueSongInSetList` is proven at the hermetic runtime level
(`tests/band-reference-app.test.ts` — a direct `runtime.create` is refused) but
was **not** proven at the authority. That is the enforcement point `6b08065`'s
own rationale named, and the only evidence it worked was this test failing by
accident. A second test converts the accident into an explicit guard, covering
both shapes a staged batch can produce: a child created on a song the list
already holds, and an inline edit moving a child onto a sibling's song. The
second has no UI guard at all — `EXCLUDE_LINKED` filters the picker's
candidates for a *new* child.

## Scope

- `tests/integration/edit-surface-batch.test.ts`:
  - a `seedSong` helper beside the existing `seedItem`;
  - the inline-child-edit test's fixture made domain-legal, with its comment
    explaining the song allocation so the next reader does not undo it;
  - a new test pinning `uniqueSongInSetList` at the authority over a batch.
- `learnings/process/testing-expectations.md` and `learnings/index.md`: the
  reusable rule and its pointer.
- This document.

## Non-goals

- No change to `src/`. Nothing in the runtime, the unit-of-work or the
  authority is defective here.
- No change to `AuthorityOutcome`'s rejected shape. Carrying `issues` across
  the service boundary would have made this diagnosis immediate, but it is a
  protocol change with policy implications (an issue names a field, which is
  information the rejecting side may not owe the caller) and belongs in its own
  phase. Recorded in the Planning Handoff.
- No change to any reference-app `.adlj`. The model is right.
- `src/reference/giggle-band/domain.adl`'s staleness relative to `domain.adlj`
  is not fixed here. Recorded in the Planning Handoff.
- No Playwright, `verify:push` or build run — nothing rendering-facing changes,
  and another agent holds Playwright's fixed ports for the duration.

## Constraints

- The failing test must be proven against **real PostgreSQL**, per `AGENTS.md`.
  A fake that pattern-matches SQL is never an acceptable correctness proof, and
  none was used at any point, including for the bisect.
- Never weaken a constraint, loosen a test, or adjust a conformance case to
  make verification pass. Every assertion of the repaired test is preserved.
- The new guard must be **seen to fail** before it is trusted.
- `.adlj` is the authoring surface; `src/reference/**/*.adl` are superseded
  citation references and must not be edited.

## Acceptance Criteria

1. The root cause is established from evidence, not inference, and the
   breaking commit is identified by running the test at it and at its parent.
2. `npx vitest run --config vitest.integration.config.ts` reaches **158/158 or
   better**, from a 157/158 baseline.
3. Not one assertion of the repaired test is removed or relaxed; the diff to it
   is fixture data and comments.
4. The new `uniqueSongInSetList` guard is demonstrated failing with the
   constraint absent, and passing with it present.
5. `npx tsc --noEmit` clean.
6. `npx vitest run` stays at **61 files / 1,104 tests**, all passing.
7. `npx prettier --check` clean over the `format:check` glob.
8. No file under `src/` is modified.

## Testing

- `npx vitest run --config vitest.integration.config.ts` — the whole
  integration suite against a real Docker-provisioned PostgreSQL, before and
  after, with both counts reported.
- The negative proof for the new guard: remove `uniqueSongInSetList` from
  `src/reference/giggle-band/domain.adlj` in the working tree, observe the new
  test fail, restore the file byte-for-byte and confirm `git status` is clean.
- `npx vitest run` and `npx tsc --noEmit` for regression.
- `npx prettier --check` per `format:check`.
- No `verify:push`. Nothing here reaches the browser.

## Parallel Execution Plan

Do not fan out. This is one diagnosis over one test file, and the diagnosis
strictly precedes every edit — a second agent could only guess at the outcome
of the first agent's bisect. Serial, single-threaded.

The one thing that must be respected in parallel with the other phase branches
in flight: **do not run Playwright**. `npm run verify:push`, `npm run build`
and `npm run test:visual` bind fixed ports another agent is using. The
integration suite provisions its own throwaway container per run and is safe to
run concurrently.

## Tasks

1. Reproduce the failure against real PostgreSQL and capture the exact outcome.
2. Instrument `object-store.ts`'s constraint throw site temporarily to recover
   the dropped `issues`; identify the constraint by name. Revert the
   instrumentation.
3. Find the commit that introduced the constraint; run the test at it and at
   its parent to confirm the transition empirically.
4. Decide, and state explicitly, which side is wrong, with the evidence.
5. Repair the fixture; keep every assertion.
6. Add the guard for the constraint at the authority; prove it fails without
   the constraint.
7. `tsc`, fast suite, integration suite, prettier.
8. `learnings/` update, this document's Execution Note, one commit.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**, not merely the next gap in this subsystem.

## Execution Note

Executed in full on branch `phase-96-edit-surface-batch` from `524e110`,
serially, exactly as the Parallel Execution Plan directed. Every claim in the
Evidence and Dependency section above was produced during execution, not
assumed beforehand; the section was written from the results.

### Diagnosis

As above. The one thing worth restating: the outcome message "Object
constraints failed." is unactionable on its own, and the four minutes it took
to get a real answer were spent adding one `console.error` to
`src/runtime/object-store.ts:1496` and running the single test. That step is now
recorded in `learnings/process/testing-expectations.md` so the next person does
not start by reading the batch planner.

### The call: test, not code — and the evidence

The code is right. `uniqueSongInSetList` exists so a replayed authority write
cannot repeat a song on a set list, the batch under test does exactly that, and
the authority refuses it whole. The transactional property this test is *about*
was never in question and is untouched by the fix.

The fixture is wrong, and provably so: it passed at `684e6c5` and failed at
`6b08065`, with nothing between them but the constraint's introduction. The
data was legal when written and became illegal when the model changed.

The diff to the repaired test is fixture data and comments only:

- two extra `Song` records seeded (`song-inline-added` "Harbour Lights",
  `song-inline-edited` "Neon Dusk"), both before the `projectionCounts`
  snapshot, so every delta assertion is unaffected;
- the created child names `song-inline-added` rather than `seeded.songTwoId`;
- the patch moves the edited child's `Song` to `song-inline-edited` rather than
  `seeded.songTwoId`;
- the "untouched lookup target" assertion follows the patch to
  `song-inline-edited`, keeping its meaning — a lookup rewrites the child, never
  the row it names.

Nothing was removed. The `expect` count in that test is unchanged, and the
final state it asserts (one new row, one outcome, two audit events, three
records untouched whole) is identical.

### The new guard, seen to fail

`refuses a batch that would name the same song twice in one set list` asserts
both shapes, that neither lands a row or an audit event, and that each refusal
is durable under its own operation id. Proven to fail before being trusted: with
`uniqueSongInSetList` deleted from `domain.adlj` in the working tree, it fails
on the first assertion —

```
-   "code": "ADL_RUNTIME_VALIDATION_FAILED",
    "operationId": "op-batch-dup-create",
-   "status": "rejected",
+   "status": "accepted",
```

— while the other twelve tests in the file, including the repaired one, still
pass. `domain.adlj` was then restored from a byte-for-byte backup and
`git status` confirmed clean before anything else was run.

### Does it generalise?

There is no code defect to generalise, but the *fixture* class of defect was
checked:

- `tests/integration/edit-surface-batch.test.ts`'s other inline-edit test
  (`replays a staged inline child edit as one operation …`, over the HTTP edge)
  is legal by luck rather than design — the edited child keeps `songOne` and the
  created child takes `songTwo`, so the two never collide. It is left as-is; the
  new guard now documents the rule it happens to obey.
- `6b08065` also added `EventSetList` with its own `ORDERED` + `UNIQUE` pair.
  No file under `tests/integration/` references `EventSetList`, so nothing there
  could have been invalidated by it.
- The full integration suite passing at 159/159 is the general check: no other
  fixture in it violates any constraint the reference models have gained.

### Verification

| check | before | after |
| --- | --- | --- |
| `npx vitest run --config vitest.integration.config.ts` | 15 files, **157 passed / 1 failed** (158) | 15 files, **159 passed** (159) |
| `npx vitest run` | 61 files / 1,104 tests | 61 files / **1,104 tests**, all passing |
| `npx tsc --noEmit` | clean | clean |
| `npx prettier --check` (`format:check` glob) | clean | clean |

The integration total moves 158 → 159 because of the new guard; the previously
failing test now passes rather than being skipped or removed.

`npm run verify:push`, `npm run build` and `npm run test:visual` were **not**
run, deliberately: nothing rendering-facing changed, and Playwright's fixed
ports were held by another agent for the duration. The integrating agent runs
`verify:push` once over all merged branches.

### Not proven

- That `6b08065` was the *only* commit to leave an integration fixture illegal
  in this way. The suite is green now, which proves no such fixture survives
  today, but no historical audit of other model changes was attempted.
- That carrying `issues` through `AuthorityOutcome` would be safe to expose. It
  would have made this diagnosis immediate, but whether a rejecting authority
  owes the caller a field-level reason is a policy question this phase did not
  try to settle.

## Planning Handoff (post-execution)

**Recommended next phase: regenerate `src/reference/giggle-band/domain.adl`
from `domain.adlj`, and add a check that keeps the two in step.**

Found while diagnosing this phase, and the highest-value remaining gap
repository-wide on the evidence to hand. `domain.adl` is documented in-file as
the human-reviewable printed view of `domain.adlj`, and `docs/` cites it by
line number ("search the repository for `giggle-band/domain.adl:` before ever
editing"). It is stale: `6b08065` added 349 lines to `domain.adlj` — the whole
`EventSetList` object and `uniqueSongInSetList` — and never reprinted the view.
`src/reference/giggle-band/domain.adl:208-210` shows `SetListItem` carrying one
constraint where the model has two.

Why that ranks first:

1. It is actively misleading in the way that costs the most. Reading
   `domain.adl` is how an agent or a human orients in the reference app — this
   phase's own first look at the model showed no `uniqueSongInSetList` and
   briefly pointed the diagnosis at the `ORDERED` constraint instead.
2. Three test files (`tests/compile-adl-project-v2.test.ts`,
   `tests/compile-adlj.test.ts`,
   `tests/integration/authority-model-migration.test.ts`) compile `domain.adl`
   as a real source. They prove it parses; nothing proves it still describes
   the app. A drifting file that tests treat as real is worse than one that is
   obviously unused.
3. `src/compiler/print-adl.ts` already exists, so the work is a printer run
   plus a round-trip equality check (print `.adlj` → compare to the `.adl` on
   disk), which is cheap and permanently closes the drift.

The competing candidate is the `AuthorityOutcome` issues question from Not
Proven above. It is ranked below because it is a protocol and policy change
needing a design decision, where the `.adl` drift is a known-wrong artefact
with a mechanical fix and an existing tool.
