# Phase 98 — Delete Giggle Band's Kept `.adl` Snapshot

Phase 94 measured Giggle Band's kept `src/reference/giggle-band/domain.adl` and
`ui.adl` against the `.adlj` source that superseded them, found 32 structural
divergences and no way to regenerate the text, and deliberately left one
question open for the repository owner: whether to keep the files at all. The
answer is no. This phase deletes them and converts everything that depended on
them.

## Objective

Remove the two `.adl` files, leave no reader pointed at a path that is not
there, and replace the test coverage they were carrying with coverage that does
not depend on hand-authored `.adl` text — stating honestly what is lost where
nothing replaces it.

## Evidence and Dependency

### The decision, and the framing that settles it

Phase 94's inventory stands and was not re-measured: the snapshot sits at model
version 1.0.0 while the real source is at 1.9.0, across 32 divergences
including three whole policies, a `UserPolicy` still showing the `ROLE
BandMember` form Phase 91 proved was a dead access-control rule, and a
`themeSwitch` in the wrong shell region — the divergence that already cost one
misdirected defect investigation (`docs/phases/phase-92-*.md`).

What decides it is not the count. It is the repository owner's restatement of
the language's direction, given during this phase:

> `.adlj` is the language; `.adl` text is only the human-readable printout of
> it. Nobody authors `.adl` by hand.

Under that framing a checked-in `.adl` copy of an application is not a second
encoding of the truth. It is a printout that someone has to re-print by hand,
and that nobody did for nine model versions. Phase 94's two reasons for keeping
it — twenty line citations in `docs/spec/language.md`, and the repository's
richest `.adl`-text corpus — are reasons to convert consumers, not reasons to
maintain a stale copy of an application's model.

### Verified before starting

- `src/reference/giggle-band/app.yaml` lists only `domain.adlj` and `ui.adlj`,
  so deleting the `.adl` text cannot affect the running app or either demo.
- `tests/integration/authority-model-migration.test.ts` names `domain.adl`, but
  writes its own into a `mkdtemp` directory; its one reference to
  `src/reference/giggle-band` is a *directory* path handed to
  `ADL_MODEL_PATH`, which reads that directory's `app.yaml`. Not a dependant.
- The dependants that do read the deleted bytes are exactly three tests:
  `tests/reference-adl-snapshot.test.ts` (Phase 94's guard),
  `tests/compile-adlj.test.ts`'s printer round-trip, and
  `tests/compile-adl-project-v2.test.ts`'s `compileAdlProject` regression. The
  brief named two of these; the printer round-trip was found by sweep and is
  the more valuable of the two.
- `compileAdlProject` (v1) has no remaining runtime caller. `band-app.ts`,
  `jointly-app.ts` and `src/server/authority-entrypoint.ts` all use
  `compileAdlProjectV2`. It remains public API through `src/index.ts`.

### Two printer/parser defects the frozen corpus was hiding

Repointing the round-trip at real sources found two defects immediately. Both
are fixed here, because a phase that discovers a defect while replacing the
thing that was covering for it does not get to leave it in place.

1. **`MIGRATION` was never printed.** It has had text grammar since the
   beginning (`src/parser/grammar/app.ts`), and `print-adl.ts` simply had no
   branch for it — so every version hop vanished from the printed `.adl`,
   *silently*, against that printer's own documented contract that a construct
   it cannot render throws a named error rather than dropping content. Neither
   round-trip fixture in place declared a migration (task-tracker has none; the
   snapshot was 1.0.0), so nothing caught it. Jointly Care's four hops came
   back as `migrations: []` with a different `modelFingerprint`.

2. **A policy rule's clause list swallowed a following `FIELDS`.**
   `FIELD_LIST_STOP_WORDS` in `src/parser/grammar/policy.ts` listed every
   clause keyword except `FIELDS`/`FIELD`. So

   ```text
   READONLY UPDATE ROLE Requester STATE Draft FIELDS InternalNotes
   ```

   parsed `FIELDS` and `InternalNotes` as two further *state* names and failed
   resolution with `ADL_POLICY_STATE_UNKNOWN` against states nobody wrote. Only
   the `FIELDS`-first spelling worked, which is why no hand-authored source
   ever hit it — and `print-adl.ts` emits `FIELDS` last, so the defect was
   reachable only by round-tripping a rule that carries both clauses.
   `examples/purchase-order.adl` has exactly such a rule.

### The citation failure mode is not a broken link

Phase 94 checked all twenty `docs/spec/language.md` citations into the snapshot
and found 20/20 resolving to exactly the construct claimed — while three of the
surrounding claims were false of the running application. A line-number checker
passes all twenty. So converting them to another line-number form is not a fix,
and neither is any mechanical check. They are converted to quoted examples
attributed by construct name.

## Decision

**Delete both files. Convert citations to named, quoted examples. Replace
`.adl`-text pipeline coverage with real `.adlj` sources and the `examples/`
corpus, and state the reduction where one remains.**

Three options existed for the coverage the snapshot carried.

**Build a purpose-built multi-file `.adl` fixture, authored as `.adl` on
purpose.** Rejected, and not by preference: it recreates the exact artifact the
owner's framing says should not exist, and re-establishes the drift class this
phase closes. A hand-maintained `.adl` file is a hand-maintained printout.

**Repoint everything at `examples/`.** Viable, and taken for
`compileAdlProject`. On its own it reduces the printer round-trip — the actual
proof that the printer's construct coverage is real — to a 37-line fixture.

**Print a real `.adlj` source at test time and round-trip that.** Taken for the
printer proof, and better than what it replaces: it exercises the printer
against a live application that will keep changing, in exactly the direction
the owner describes (`.adl` as the printed view of `.adlj`), with nothing on
disk to drift. Giggle Band cannot be that source — the printer refuses it —
but Jointly Care can, and its refusal of Giggle Band becomes a test of its own.

### `.adl`-text pipeline coverage, before and after

**Before** (`tests/compile-adlj.test.ts`, `tests/compile-adl-project-v2.test.ts`):

| Proof | Subject |
|---|---|
| printer round-trip | `examples/task-tracker.adl`; Giggle Band `.adl` snapshot (1,124 lines) |
| `compileAdlProject` regression | Giggle Band `.adl` snapshot, two-source manifest |
| printer refuses unprintable constructs | `tests/reference-adl-snapshot.test.ts` |

**After**:

| Proof | Subject |
|---|---|
| printer round-trip | `examples/task-tracker.adl`; `examples/purchase-order.adl`; **Jointly Care's real `.adlj`**, compiled → printed → reparsed (667 printed lines) |
| `MIGRATION` printing | inline `.adlj`, both hop shapes, printed text pinned literally |
| `compileAdlProject` regression | `examples/purchase-order.adl`, **one-source** manifest |
| printer refuses unprintable constructs | Giggle Band's real `.adlj` (`tests/compile-adlj.test.ts`) |

**Coverage is reduced, in two specific places, and this is a reduction, not a
simplification:**

1. **Constructs no round-trip fixture reaches any more:** `STATUS_MAP`,
   `ICON_MAP`, presentation `TOGGLE`, `UNION` read models, a qualified
   `READ_MODEL SOURCE ... JOIN`, and `ATTACHMENT` fields. Jointly Care declares
   none of them and neither does `examples/`. The printer code for them is
   unchanged and still exercised by unit tests where those exist, but the
   end-to-end print→reparse→identical-model proof no longer covers them.
2. **Multi-file plain-`.adl` concatenation is no longer covered at all.**
   `compileAdlProject`'s only non-trivial multi-file behaviour is
   `"\n\n".join` over the manifest's sources, and every `.adl` file in
   `examples/` declares its own `APP` block, which the parser refuses in
   anything but first position. There is no way to build a two-source `.adl`
   manifest from existing corpus, and building one means hand-authoring `.adl`.
   Multi-source *merging* remains covered by `compileAdlProjectV2`'s two cases,
   one of which merges an `.adl` source with an `.adlj` one.

Both reductions are recorded in the tests themselves, not only here.

### `docs/phases/*.md` citations are left alone, deliberately

Thirteen line citations across eleven phase documents point into the deleted
files. They are not repaired, renumbered or removed. A phase document is a
record of what was true when the work was done; rewriting its evidence to match
today falsifies the record. Phase 94 established this and found most of those
citations had already gone stale years earlier, while the `.adl` files were
still live and being edited. What such a reader needs is not a repaired line
number but the knowledge that the file is gone and why — which
`learnings/implementation/reference-app-drift.md`, `docs/spec/language.md`'s
framing subsection and this document all now supply.

## Scope

- **Deleted:** `src/reference/giggle-band/domain.adl`, `ui.adl`,
  `tests/reference-adl-snapshot.test.ts`.
- `src/compiler/print-adl.ts` — print `MIGRATION` blocks.
- `src/parser/grammar/policy.ts` — add `FIELDS`/`FIELD` to
  `FIELD_LIST_STOP_WORDS`.
- `tests/compile-adlj.test.ts` — Jointly Care round-trip, purchase-order
  round-trip, `MIGRATION` printing, and the printer-refusal assertion rescued
  from the deleted guard.
- `tests/parser.test.ts` — clause-order test for the `FIELDS` stop word.
- `tests/compile-adl-project-v2.test.ts` — `compileAdlProject` regression
  repointed at `examples/purchase-order.adl`.
- `docs/spec/language.md` — framing subsection rewritten; all 20 line citations
  converted to named, quoted examples; three claims corrected.
- `docs/spec/adlj.md`, `docs/spec/ui-language-addendum.md`,
  `docs/reference/band-app-gap-report.md`,
  `docs/reference/giggle-band-adl-example.md` — corrections.
- `learnings/implementation/reference-app-drift.md` — rewritten.
- `learnings/implementation/adl-parser.md`, `reference-app-models.md`,
  `adlj-json-authoring-surface.md`, `shell-navigation.md`,
  `ui-presentation-model.md`,
  `learnings/process/syntax-uniformity-and-behavioral-guardrails.md`,
  `learnings/index.md` — corrections and routing.
- Code/test comments in `src/parser/grammar/command.ts`, `object-field.ts`,
  `src/reference/jointly-app.ts`, `tests/parser.test.ts`,
  `tests/band-reference-app.test.ts`, `tests/adl-to-adlj.test.ts`,
  `tests/visual/giggle-band.visual.spec.ts`, and five stale `.adl` path
  references inside both apps' `.adlj` comment strings.

## Non-goals

- Giving ADL text grammar to `conflictOverlay`, `projectedFields`, `summary`,
  or any of the other constructs `docs/spec/adlj.md` lists as having no text
  syntax. That is the follow-up phase named below.
- Hand-authoring any `.adl` fixture, corpus or example.
- Repairing citations inside `docs/phases/*.md`.
- Changing what any application declares. No `modelVersion` moved and no
  `modelFingerprint` changed (verified — see the Execution Note).
- Fixing the pre-existing `compileAdlj`/`compileAdl` cosmetic difference on
  absent `contexts`/`readModels` keys, found while building the migration
  fixture and already documented in
  `learnings/implementation/adlj-json-authoring-surface.md`.

## Constraints

- No new `.adl` text authored by hand, anywhere, including test fixtures.
- Any `.adlj` touched must be compile-checked with its diagnostics inspected,
  and must not change its app's `modelFingerprint`.
- No constraint weakened, no test loosened, no assertion deleted to make
  verification pass. Where coverage genuinely falls, it is stated as a
  reduction.
- No Playwright, `test:visual` or `verify:push` in this worktree.

## Acceptance Criteria

1. Both `.adl` files are gone, and so is the guard whose subject they were.
2. No file under `src/`, `tests/`, `docs/spec/` or `learnings/` points a reader
   at `giggle-band/domain.adl` or `giggle-band/ui.adl` as a live path.
3. `docs/spec/language.md` cites no line number into any deleted file, and
   every example it attributes to the reference app matches the current
   `.adlj`.
4. The printer round-trip proof runs against a real application source.
5. Every construct that loses round-trip coverage is named in writing.
6. `npx tsc --noEmit` clean; full suite green; `prettier --check` clean;
   integration suite at its baseline.

## Testing

- `tests/compile-adlj.test.ts`: Jointly Care `.adlj` → print → reparse →
  identical model; `examples/purchase-order.adl` round-trip; `MIGRATION`
  printing with a literal pin on the emitted text; the printer refusing Giggle
  Band's real source by name.
- `tests/parser.test.ts`: a policy rule's clauses parse identically in
  `FIELDS`-first and `FIELDS`-last order.
- `tests/compile-adl-project-v2.test.ts`: `compileAdlProject` over
  `examples/purchase-order.adl`.
- Both defect fixes were proven to fail before they passed — see the Execution
  Note.

## Parallel Execution Plan

Serial. The phase is one deletion plus a fan-out of small edits that all depend
on facts only established by doing the deletion first (which dependants exist,
what the replacement round-trip finds, which prose claims break). The two
defect fixes were discovered by the coverage work and could not have been
predicted by an agent given the file list up front. No shared-spine file is
touched: `src/index.ts`, `register.ts`, migration SQL, the conformance runner
and reference-app fixtures are all untouched.

## Tasks

1. Sweep for every dependant of the two files; classify each as live path,
   dated record, or generic example.
2. Establish the replacement round-trip subject by measurement (which real
   sources the printer accepts, and what they cover).
3. Fix the defects that measurement exposes; prove each fails first.
4. Delete the files and the guard.
5. Convert `docs/spec/language.md`'s citations, checking each quoted block
   against the current `.adlj` as it is converted.
6. Correct the living documents; leave the dated ones and say so.
7. Rewrite the drift learning around elimination rather than pinning.

## Planning Handoff

**Next phase: Phase 99 — make `print-adl.ts` a complete printout of `.adlj`.**
Give ADL text a grammar for the constructs that have none, starting with the
three that block Giggle Band (a calendar's `conflictOverlay`, a child
collection's `projectedFields` and `summary`), and reinstate a full round-trip
over both reference apps.

Justification as the highest-value remaining gap repository-wide: the owner has
now stated the contract — **`.adl` text is the human-readable printout of
`.adlj`** — and the printer does not meet it. It cannot render the flagship
reference application at all, and `docs/spec/adlj.md` lists eleven constructs
with no text syntax, a list that has grown every time the `.adlj` surface grew
(three of the eleven arrived in Phases 86 and 87 alone). Everything else this
phase touched is downstream of that one gap: the snapshot could not be
regenerated *because* of it, the citations had to be converted *because* it
could not, and the round-trip proof had to move to a second-choice application
*because* the first-choice one is unprintable. This phase also demonstrated,
twice, what the gap costs in defects nobody sees — `MIGRATION` printing missing
outright for the printer's entire existence, and a parser stop-word bug
reachable only through printed output. Both were found the moment a real
`.adlj` was printed. There is no other subsystem where a single stated contract
is this clearly unmet, and the trend is the wrong way: the printable subset
shrinks every time the language grows.

Two smaller candidates this phase surfaced and did not take, both weaker:
`compileAdlj` omitting `contexts`/`readModels` keys that `compileAdl` emits as
`[]` (cosmetic, already documented, no behaviour depends on it); and the loss
of multi-file plain-`.adl` concatenation coverage, which Phase 99 dissolves
anyway if a printed reference app becomes the round-trip subject for
`compileAdlProject` too.

## Execution Note

### The replacement subject had to be found by measurement, not by choice

The plan assumed the printer round-trip would either move to `examples/` (a
severe reduction) or need a new fixture (forbidden). The third option only
appeared after printing every candidate: Jointly Care's whole compiled
`partialModel` renders, reparses with zero diagnostics, and resolves to a model
that differed from the original in exactly two paths — `migrations` and, in
consequence, `modelFingerprint`. That two-path diff *was* the `MIGRATION`
defect. The measurement that chose the subject also found the bug.

Printing an individual `.adlj` *fragment* does not work
(`adljSourceToPartialApplicationModel` returns a fragment whose absent sections
are `undefined`, and the printer maps over them unguarded), which is why the
round-trip goes through `compileAdlProjectV2` and produces one printed document
rather than a two-file project. That is a real limitation, left alone as
outside this phase.

### Proving both defects fail first

| Probe | Result |
|---|---|
| Jointly Care round-trip, with `printMigration` removed | fails: `migrations` `[4 hops]` vs `[]`, `modelFingerprint` differs |
| `examples/purchase-order.adl` round-trip, with `FIELDS`/`FIELD` removed from `FIELD_LIST_STOP_WORDS` | fails: `ADL_POLICY_STATE_UNKNOWN` on states named `FIELDS` and `InternalNotes` |
| `tests/parser.test.ts` clause-order case, same removal | fails |

The stop-word fix was reverted and re-applied to confirm, and the suite re-run
green after restoring it.

### Checking every quoted example while converting its citation

Converting twenty citations meant reading each quoted block against the current
`.adlj` rather than against the line it used to cite. Three claims had gone
false, all three predicted by Phase 94's inventory:

- `HomeDashboard`, called "verbatim", still carried `ICON
  EventTypeIcon(EventType)` as its row's leading fragment. The real source
  dropped it. The line is removed from the example; everything else in that
  block was checked attribute by attribute against `ui.adlj` and does match.
- The `SHELL` example described "three of its **eleven** `NAV` entries". The
  real shell has ten (and six controls, which was right).
- The `SetListForm` pointer offered `.adl` line numbers "for the full form
  view". The real `Songs` child collection also declares `projectedFields` and
  a `summary`, which have no ADL text syntax — so no `.adl` example can ever be
  the full view. The text now says that.

One further correction was made in a sentence being rewritten anyway: the spec
called the row-action example "Giggle Band's own `MyInvitationList` list".
`MyInvitationList` is the *view*; the list is `SentInvitationsList`. Phase 94
found this and left it as out of scope; leaving a known-wrong name inside a
sentence this phase was editing would have been worse than fixing it.

### Five stale `.adl` paths inside `.adlj` comment strings

Both apps' `.adlj` files carry prose comments that name `domain.adl`/`ui.adl`.
Editing a comment is editing the `.adlj`, so the fingerprint question had to be
settled before touching them: it was measured, and a comment change leaves
`modelFingerprint` byte-identical (giggle-band stays
`sha256-20f7ee6c…`, jointly-care `sha256-e82da010…`, both before and after).
No `modelVersion` moved, no migration was needed, and no persisted-state
upgrade test is implicated. Both apps recompile with `diagnostics: []` and
`validateApplicationModel(...) === []`.

### The dangling-reference sweep

```
grep -rn "ui\.adl\b\|domain\.adl\b" src/ tests/ docs/ learnings/
```

After the change, every remaining hit is one of:

- past-tense history that says the files are gone ("`domain.adl` **was** the
  authored source"; "the original `domain.adl`/`ui.adl` **were** kept on disk …
  deleted in Phase 98");
- a dated record left deliberately: every `docs/phases/*.md` citation, the
  per-phase list in `learnings/process/testing-expectations.md`, and
  `learnings/process/syntax-uniformity-and-behavioral-guardrails.md`'s quotation
  of a past phase's own Scope section (its *live* practical-guidance bullet,
  which told a reader to survey `domain.adl`/`ui.adl` for canonical spellings,
  was repointed at `src/reference/*/{domain,ui}.adlj`);
- a section inside `learnings/implementation/reference-app-models.md` or
  `adlj-json-authoring-surface.md` covered by that document's new top-of-file
  framing note;
- a generic illustrative filename in `docs/spec/adlj.md`'s manifest-merge
  examples, or `examples/multi-source/domain.adl`, which exists and is read by
  `tests/compile-adl-project-v2.test.ts`;
- `tests/integration/authority-model-migration.test.ts`'s own temp-directory
  `domain.adl`, which it writes itself.

No hit anywhere is a live path into `src/reference/giggle-band/`.

Two learnings documents whose *every* section predates the conversion
(`reference-app-models.md`, `adlj-json-authoring-surface.md`) carry one framing
note at the top instead of dozens of edits — the same "fix the frame, not the
citations" move Phase 94 used on `language.md`, and for the same reason: when
many references are wrong the same way, one statement fixes all of them and
cannot rot.

### Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 61 files, 1,108 tests, all passing. Baseline was 62 files,
  1,107 tests. Accounting: −1 file and −3 tests from deleting
  `tests/reference-adl-snapshot.test.ts` (frozen-region hash, divergence pin,
  printer-refusal); −1 test from removing the Giggle Band `.adl` round-trip;
  +5 tests added (Jointly Care round-trip, purchase-order round-trip,
  `MIGRATION` printing, printer-refusal rescued into
  `tests/compile-adlj.test.ts`, parser clause order). 1,107 − 4 + 5 = 1,108.
  The only assertion that disappears without replacement is the frozen-region
  hash, whose subject no longer exists.
- `npx vitest run --config vitest.integration.config.ts` — 15 files, 159 tests,
  all passing; identical to baseline. Run because this phase changes the
  parser, even though no integration test was edited.
- `npx prettier --check` over the `format:check` glob — clean.
- `npm run verify:push` was **not** run here; its Playwright stage runs once in
  the primary tree after integration. No rendering, shell chrome, CSS or
  reference-app model content changed — the `.adlj` edits are comment prose and
  leave both fingerprints identical — so no screenshot delta is expected.

### Not proven

- That the constructs listed as losing round-trip coverage (`STATUS_MAP`,
  `ICON_MAP`, `TOGGLE`, `UNION`, qualified `JOIN`, `ATTACHMENT`) still print
  correctly. They did when the snapshot was last parsed, and nothing in this
  phase touches their printer code, but nothing now checks them end to end.
- That `MIGRATION` printing is correct for every step shape *in combination*
  with the constructs Giggle Band's unprintable source uses. It is proven for
  both hop shapes (empty, and `SCHEMA_VERSION` + rename/add/drop) and for
  Jointly Care's four real hops.
- Anything about the browser: no Playwright ran in this worktree.
