# Phase 94 — `.adl`/`.adlj` Reference-App Divergence

Giggle Band's `domain.adl` and `ui.adl` were kept on disk when the app's real
compiled source became `domain.adlj`/`ui.adlj`, on the stated understanding that
they were the same application in a different encoding. They are not. They have
drifted through nine model versions, and because a trailing note on each file
described them as merely "superseded as compiled source", every reader — human
and agent — has been treating a 1.0.0 snapshot as current evidence. This phase
measures the divergence, decides what the files are, and makes the drift
impossible to reintroduce silently.

## Objective

Establish what `src/reference/giggle-band/domain.adl` and `ui.adl` actually are
relative to the `.adlj` sources that supersede them, correct every document that
asserts something false about them, and leave a mechanical guard so the same
class of silent drift cannot recur.

This phase reconciles a *description* with its subject. It changes nothing about
what either application declares.

## Evidence and Dependency

### How the divergence was measured

Not by eye. Both sides were compiled and their **resolved models** compared with
a name-keyed structural diff (arrays of named entities re-keyed by name, so
inserting one object does not bury the real difference under a hundred
positional ones), reporting the shallowest differing path and never descending
into a difference:

- snapshot: `compileAdlProject` over `domain.adl` + `ui.adl`
- real source: `compileAdlProjectV2` over `domain.adlj` + `ui.adlj`

Both compile clean (`diagnostics: []`). The comparison is now the second test in
`tests/reference-adl-snapshot.test.ts`.

Printing the `.adlj` side back to `.adl` text and diffing the text — the
obvious approach — **is not possible**, which is itself the phase's most
load-bearing finding; see below.

### Inventory: 32 divergences

Giggle Band's kept `.adl` snapshot is at model version **1.0.0**; `domain.adlj`
is at **1.9.0** and carries the nine `MIGRATION` blocks that got it there. The
divergences, grouped:

**Domain model**

1. `model.modelVersion` — 1.0.0 vs 1.9.0.
2. `model.migrations` — none vs nine.
3. `model.modelFingerprint` — different, in consequence.
4. `Event.SetList` (a single set-list lookup) exists only in the snapshot;
   migration 1.3.0→1.4.0 drops it.
5. `Event.CreatedBy` (explicit creator lookup) exists only in the real source;
   migration 1.4.0→1.5.0 adds it.
6. `EventSetList` — a whole object, the ordered gig↔set-list many-to-many that
   replaced `Event.SetList` — exists only in the real source.
7. `SetListItem.uniqueSongInSetList` (a song may not appear twice in one set
   list) exists only in the real source.
8. `model.sync` — the real source carries `EventSetList`'s own `SYNC`.
9. `readModels.EventAvailabilityConflicts` exists only in the real source.

**Policy**

10–12. `EventSetListDefaultDeny`, `EventSetListPolicy`,
`EventSetListSystemAdminPolicy` exist only in the real source.

13–16. `UserPolicy` moved from `ROLE BandMember`
(`allowBandMemberSearchUsers`, `allowBandMemberReadUsers`) to `AUTHENTICATED`
(`allowAuthenticatedSearchUsers`, `allowAuthenticatedReadUsers`) — the Phase 91
fix for a context-scoped role condition that can never resolve against `User`.
The snapshot still shows the defective form.

**Presentation and edit surfaces**

17–19. `Event.BandEventForm`'s single `Fields` edit section became `Details`
(15 fields, heading `Event`) plus a `SetLists` child collection.
20. …and its `fields` list, in consequence.
21. `duplicateGig`'s row-action `INPUT SetList` exists only in the snapshot.
22. `MonthPlanner`'s `conflictOverlay` exists only in the real source.
23. `HomeDashboard`'s `UpcomingEvents` row dropped its redundant leading `ICON`
    fragment in the real source.
24–25. `SetListForm`'s `Songs` child collection gained `projectedFields` and a
`summary` (Phase 87) in the real source.
26–27. `BandMemberAvailabilityBoard` lost `LEGEND MyScheduleLegend` and renamed
its roster section heading from `Who is free` to `Availability` (Phase 92).

**Shell chrome**

28. `themeSwitch.placement` — `topBar` in the snapshot, `navDrawer` in the real
    source. **This is the divergence that caused visible damage.**
29–31. `topBar.controls` and `navDrawer.controls`, in consequence; and the
`SetListForm` nav item (`Set list editor`), removed in the real source.
32. `BandMemberAvailabilityBoard`'s nav label — `Who is free` vs
    `Band Availability`.

### The snapshot cannot be regenerated

`printPartialApplicationModelAsAdl` refuses the real source. Iteratively
stripping each refusal enumerated exactly three blockers:

```
THREW: calendar 'MonthPlanner' declares a conflictOverlay, which has no ADL text syntax yet.
THREW: child collection 'Songs' declares projectedFields, which has no ADL text syntax yet.
THREW: child collection 'Songs' declares a summary, which has no ADL text syntax yet.
```

All three are in `docs/spec/adlj.md`'s named list of constructs with a
resolved-model/JSON shape and **no ADL text syntax at all**. There is therefore
no `.adl` text that says what `domain.adlj`/`ui.adlj` say, and "regenerate the
`.adl` from the `.adlj`" is not an available option — not "expensive", not
"lossy in formatting", but unavailable, unless ADL text first grows three new
constructs, which is a language change and a different phase.

### The observed damage

The divergence is not academic. `docs/phases/phase-92-*.md` cited
`ui.adl:13-19` for `themeSwitch`'s placement in the top bar; the running
application had already moved it to the nav drawer, and a defect was reported
against a control that was not where the citation said. That is the failure mode
this phase exists to close.

### Citation inventory

Every citation of a kept `.adl` file across `docs/` and `learnings/`, checked
line by line against the file's current bytes:

**`docs/spec/language.md` — 20 line citations, all resolving correctly.**
`domain.adl:21,38,82,93,105,107,125,134,156,179,189,208,253,273,454,471` and
`ui.adl:1,24,252,363` each land on exactly the construct claimed. The spec is
internally accurate; what it was wrong about is *currency* — it presented these
as the reference app's declarations, present tense, and three of its claims no
longer hold of the running app:

- the quoted `HomeDashboard` block (`ui.adl:24`) is called "verbatim" and still
  carries the `ICON EventTypeIcon(EventType)` row fragment the real source
  dropped;
- the `SHELL` block (`ui.adl:1`) says "three of its **eleven** `NAV` entries" —
  the real shell has ten;
- `domain.adl:208` is offered as "the full object declaration" of `SetListItem`,
  which now also carries `uniqueSongInSetList`.

One unrelated pre-existing nit found while checking: `language.md` calls
`ui.adl:252` "Giggle Band's own `MyInvitationList` list" — `MyInvitationList` is
the *view*; the list is `SentInvitationsList`. Left alone as out of scope.

**`docs/spec/ui-language-addendum.md:691` — stale, no line number.** Named
`ui.adl` as the implementation target and showed an `app.yaml` source listing of
`domain.adl`/`ui.adl`. `app.yaml` lists `.adlj`.

**`learnings/implementation/adl-parser.md:30` — factually wrong.** Claimed
`domain.adl` "is the current authored source listed by that manifest" and that
`band-app.ts` "compiles them with `compileAdlProject`". `band-app.ts` imports
`domain.adlj`/`ui.adlj` and uses `compileAdlProjectV2` behind a lazy dynamic
`import()`.

**`learnings/implementation/reference-app-models.md:46`** — "the Giggle home
dashboard stays in `ui.adl`", inside a section headed *Key decisions from Phase
28*. Dated framing; left as history.

**`learnings/implementation/adlj-json-authoring-surface.md:412`** — the
implementation record of why the trailing note exists. Still accurate about the
decision; its description of the note's wording needed a pointer forward.

**`docs/phases/*.md` — 13 line citations across 11 documents, most already
stale before this phase.** Spot-checked: `phase-56:91` cites `domain.adl:207`
for `SYNC CACHE_READONLY` (line 207 is blank, and `CACHE_READONLY` appears
nowhere in the file); `phase-61:116` and `phase-62:73` cite `domain.adl:241` for
`DevicePreference.OfflineHomeLimit` (blank line; the field does not exist);
`phase-53:31` cites `:80` for a `SYNC` line that is at `:93`; `phase-65:47`
cites `:54-61` for `BandMember`, which starts at `:58`; `phase-58:73` cites
`:12` for a control that is at `:15` and a `TOP_BAR` "on line 14" that is at
`:19`. These drifted while the `.adl` files were still live and being edited,
years before they were frozen.

### The keep-note's own claims were false

The trailing note asserted the file "is not reparsed, tested, or kept in sync".
Two tests parse both files on every run: `tests/compile-adlj.test.ts`'s printer
round-trip (the proof that the `.adl` printer's construct coverage is real) and
`tests/compile-adl-project-v2.test.ts`'s `compileAdlProject` regression proof.
They are live test corpus, not inert.

## Decision

### The files are a frozen snapshot and an `.adl`-text corpus — not a view

The four options were weighed:

**Regenerate from `.adlj`.** Unavailable, as measured. The printer refuses three
constructs the real source uses. Regenerating "the printable subset" would
silently drop declared content, which is the exact failure being fixed.

**Regenerate and repair the citations.** Same blocker, so moot; and it would
have traded ~33 accurate line citations for a large mechanical edit that future
`.adlj` drift reopens.

**Delete and convert citations to a durable form.** Genuinely viable, and there
is precedent — Jointly Care's kept `.adl` files were deleted in `c167fea` once
they covered no gap. But here they still cover two: they are the richest real
`.adl` *text* in the repository and the proof material for two named tests, and
`.adl` text remains a supported, specified surface. Deleting them means either
losing that proof or hand-authoring a replacement corpus — hand-authored `.adl`
text, for new work, against the repository's own primary-authoring-surface rule.
Not now.

**Keep, and guard against drift.** Correct, but insufficient on its own: the
existing drift still has to be resolved, and "resolved" here cannot mean
"eliminated".

**The decision is a combination, and it turns on reclassification rather than
reconciliation.** The two `.adl` files are not a stale view of the `.adlj`
source that ought to be refreshed. They are a *dated snapshot of Giggle Band at
model version 1.0.0*, plus a live `.adl`-text test corpus. Under that
description there is no drift to fix — there is a mislabelled artifact, and a
set of documents that read it as current. So:

1. **Relabel the artifact.** Rewrite each file's trailing note to say what is
   now measured: a frozen 1.0.0 snapshot, not a view of the `.adlj`; 32
   enumerated divergences; unregenerable, and why; kept for citations and for
   corpus; and correcting the false "not reparsed, tested" claim. The note sits
   below the last declaration line, so rewriting it shifts no cited line.

2. **Frame the citations, do not renumber them.** `docs/spec/language.md`'s
   twenty line citations are all *accurate against the snapshot* — what was
   missing is the reader knowing it is a snapshot. One framing subsection at the
   top of the spec makes all twenty honest at once, keeps every line number
   valid, and is immune to future `.adlj` drift, because the document no longer
   claims currency. This is the durable citation form for a document that
   specifies `.adl` **text**: quote the frozen text, and say it is frozen.

3. **Fix what is outright wrong**, in the two living documents that assert false
   facts rather than dated ones (`ui-language-addendum.md`, `adl-parser.md`).

4. **Leave dated `docs/phases/*.md` alone.** A phase document is a record of
   what was true when the work was done. Rewriting its Evidence to match today
   would falsify the record, and most of those citations were already stale for
   ordinary reasons long before the `.adlj` conversion. What they needed was not
   repair but a reader who knows the file is a snapshot — which item 1 and item
   2 provide.

5. **Guard mechanically**, so the next `.adlj` change cannot repeat this.

### The guard pins the divergence, not the agreement

The obvious guard — "the `.adl` must resolve to the same model as the `.adlj`" —
can never pass and would have to be deleted. The guard that works pins *how* the
two disagree: a sorted list of divergent paths, each with a digest over both
sides' values at that path. Any new divergence adds an entry; any change to what
an already-divergent path says on either side changes its digest; any resolved
divergence removes an entry. All three fail the test and force the author to
state what they changed.

The path-only version of this was built first and **measured to be
insufficient**: changing a nav label the two sides already disagreed about left
the path set identical and the test green. The digest was added in response.

A second, cheaper assertion hashes everything above the trailing note in each
file, turning "byte-for-byte frozen, same line numbers forever" from an
honour-system comment into a failing test. A third asserts the printer still
refuses the real source, so that the "cannot be regenerated" claim is checked
rather than remembered — and so that it fails loudly if ADL text ever gains the
missing grammar.

## Scope

- `tests/reference-adl-snapshot.test.ts` — new; the three guards above.
- `src/reference/giggle-band/domain.adl`, `ui.adl` — trailing note only, below
  the last declaration line. No declaration changed; proven by the frozen-region
  hash.
- `docs/spec/language.md` — one new subsection, "Reference-app citations point
  at a frozen snapshot".
- `docs/spec/ui-language-addendum.md` — three corrections.
- `learnings/implementation/adl-parser.md` — one correction.
- `learnings/implementation/adlj-json-authoring-surface.md` — forward pointer.
- `learnings/implementation/reference-app-drift.md` — new.
- `learnings/index.md` — routing entry.

## Non-goals

- Changing what either application declares. Every divergence above is a real,
  deliberate difference between two releases, not a defect to fix here.
- Adding ADL text grammar for `conflictOverlay`, `projectedFields` or `summary`.
- Deleting the kept `.adl` files, or replacing the `.adl`-text corpus the two
  pipeline tests depend on.
- Renumbering or repairing citations inside dated `docs/phases/*.md`.
- Fixing `language.md`'s unrelated `MyInvitationList`/`SentInvitationsList`
  naming nit, or its `SHELL` example's synthetic `ORDER 30`.

## Constraints

- No kept `.adl` file may be hand-edited above its trailing note. Enforced by
  test, not by convention.
- Any `.adlj` touched must be compile-checked with `compileAdlj` and its
  diagnostics inspected. (None was touched; the two temporary probe edits were
  reverted and are proven gone by `git status`.)
- No constraint weakened, no test loosened, no conformance case adjusted.

## Acceptance Criteria

1. Every divergence between the kept snapshot and the real `.adlj` source is
   enumerated in a checked-in artifact, not prose alone.
2. Introducing a new divergence, or changing an existing one, fails a test.
3. Hand-editing a declaration line in a kept `.adl` file fails a test.
4. No document still asserts that the kept `.adl` files are the reference app's
   compiled source, or that they are untested.
5. Every line number cited into a kept `.adl` file still resolves to the same
   text after this phase.
6. `npx tsc --noEmit` clean; full suite green; `prettier --check` clean.

## Testing

`tests/reference-adl-snapshot.test.ts`, three cases. Each was proven to fail
before it was made to pass — see the Execution Note.

The existing `.adl`-text pipeline tests (`tests/compile-adlj.test.ts`,
`tests/compile-adl-project-v2.test.ts`, `tests/adl-to-adlj.test.ts`,
`tests/compile-adl.test.ts`) are unmodified and must stay green: they are the
reason the snapshot is worth keeping.

## Parallel Execution Plan

Serial. The phase is one measurement, one decision derived from it, and a set of
edits that all depend on the measured numbers — 32 divergences, three printer
blockers, two frozen-region hashes. Fanning out would mean agents predicting
those values instead of receiving them, which is the specific failure mode
`learnings/process/phase-execution.md` warns about. The document edits are small
and touch six files, none of them shared-spine files.

## Tasks

1. Measure the divergence mechanically; establish that the printer cannot render
   the real source and enumerate exactly which constructs block it.
2. Inventory every citation of a kept `.adl` file and check each against the
   file's current bytes.
3. Build the guard; prove each case fails on real drift before it passes.
4. Rewrite the trailing notes.
5. Repair the living documents; leave the dated ones.
6. Record the drift class in `learnings/`.

## Planning Handoff

**Next phase: Phase 95 — a compile-time diagnostic for an unreachable `ROLE`
principal**, the candidate Phase 91's handoff raised and Phase 92 did not
consume. A `specific` principal naming a role only ever earned through a
context's `MEMBERSHIP`, on an object that is neither scoped to that context nor
that context's bound object, can never match; it is decidable exactly where
`ADL_POLICY_SEARCH_CONDITION_UNREACHABLE` and
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` already are.

Justification as the highest-value remaining gap repository-wide: **both**
shipped reference apps hit it. Jointly Care found it by hand and worked around
it; Giggle Band shipped it, and it silently denied every `User` read in the app
until Phase 91. This phase's own inventory makes that concrete — divergences
13–16 are nothing but that footgun being fixed in one app while the other
document still shows the defective form. A documented footgun that has now
recurred across every application in the repository is a missing diagnostic, and
it is the second such gap in this repository's policy layer. It beats the other
live candidate — deleting the kept `.adl` files and giving the two `.adl`-text
pipeline tests a purpose-built corpus — because that one is a cleanup of a class
now under test and no longer bleeding, while this one is an active, repeating,
silent correctness failure in the language itself.

**Left explicitly for the repository owner, not decided here:** whether the kept
`.adl` files should eventually be deleted. The measurement needed to make that
call is now complete and in this document; what it turns on is a judgement this
phase cannot settle — whether `.adl` text is a surface the repository intends to
keep supporting well enough to want a rich, real, hand-maintained corpus for it,
or whether a purpose-built fixture would do. If the answer is "a fixture would
do", the work is: build an `.adl` corpus that exercises the printer's full
construct coverage, repoint `tests/compile-adlj.test.ts` and
`tests/compile-adl-project-v2.test.ts` at it, convert `language.md`'s twenty
citations to quoted constructs without line numbers, and delete both files. Not
done here, because doing it would have committed the repository to that answer
on a phase that was scoped to measure, not to choose.

## Execution Note

### The load-bearing finding arrived early and reshaped the phase

The task was framed as "find and resolve the divergence", with regeneration as
the leading option. The third measurement killed it: the printer cannot render
`domain.adlj`/`ui.adlj` at all. Everything downstream follows from that. Two of
the four options evaporated, "resolve" stopped meaning "make them agree", and
the phase became a reclassification — which is why the largest edits are notes
and framing rather than content.

### The first guard passed when it should not have

The divergence guard was built as a sorted list of divergent *paths*. Probe:
change `Band Availability` to `Band Availability (probe)` in `ui.adlj` — a
one-word edit to a nav label the two sides already disagreed about. **The test
stayed green**, because the path set was unchanged. A shape pin is not a value
pin. Rebuilt with a digest over both sides' values at each path; the same probe
then failed. Recorded because the mistake is easy to repeat: pinning "where they
differ" feels like pinning "how they differ" and is not.

### Proving the guards fail

Three probes, each reverted:

| Probe | Result |
|---|---|
| `ui.adlj`: `Band Availability` → `Band Availability (probe)` (value change at an already-divergent path) | divergence test fails |
| `ui.adlj`: section heading `Schedule` → `Schedule (probe)` (fresh divergent path) | divergence test fails |
| `ui.adl`: insert a comment line at line 6 (frozen region) | frozen-hash test fails, with the shifted hash shown |

`git status` clean of both fixtures afterwards.

### One framing paragraph beat twenty citation edits

`docs/spec/language.md`'s twenty line citations were all *correct*. The document
was wrong at a level line numbers cannot express: it said "is" where the truth
was "was, at 1.0.0". Repairing that at each site would have been twenty edits,
each independently able to rot. One subsection stating the framing once fixes
all twenty and cannot rot, because it stops claiming currency at all.

The subsection does shift `language.md`'s own line numbers by 26. Five
`docs/phases/*.md` documents cite `language.md:NNN`. Those citations were
checked and **were already stale before this phase** — `language.md:62` and
`:68`, cited by `phase-62`, are a blank line and a sentence about manifest
order; `:160`, `:189`, `:310`, `:398`, `:926`, cited by `phase-72`, all land on
unrelated text. Line-number citations into a living document do not survive it
being edited; this is the same lesson as the `.adl` snapshot, one level up.
Recorded rather than papered over.

### Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 62 files, 1,107 tests, all passing (baseline 61/1,104; +1
  file, +3 tests, all from this phase).
- `npx prettier --check` over the `format:check` glob — clean.
- `npm run verify:push` was **not** run in this worktree; its Playwright stage
  is being run once in the primary tree after integration. No rendering, shell
  chrome, CSS or reference-app content changed here, so no screenshot delta is
  expected.

### Not proven

- Integration tests were not run. Nothing here touches the authority server,
  PostgreSQL, migrations or HTTP.
- The claim that ADL text has *exactly* three constructs blocking regeneration
  is proven for Giggle Band's current source only. It is not a proof about the
  printer's coverage in general; `docs/spec/adlj.md` lists eleven such
  constructs, and a future `.adlj` edit could reach any of the other eight.
- Whether deleting the files is right. Deliberately left open above.
