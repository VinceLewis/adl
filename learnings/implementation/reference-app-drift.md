# A Kept `.adl` File Drifts Silently From Its `.adlj` Source (Phases 94, 98)

Read this before keeping any generated or superseded file on disk "for
reference", before adding a line-number citation into any file this repository
maintains, and before proposing that an application be represented twice on
disk in two encodings.

**Status: the specific case is closed.** Giggle Band's
`src/reference/giggle-band/domain.adl` and `ui.adl` were deleted in Phase 98.
There is no guard test any more — `tests/reference-adl-snapshot.test.ts` was
deleted with them, because a pin over a divergence needs two artifacts to
diverge. What follows is the class, and why the eventual answer was deletion
rather than a better pin.

## What the two files were

Not a view of `domain.adlj`/`ui.adlj`. A **frozen snapshot of the application
at model version 1.0.0**, while the `.adlj` source had reached 1.9.0. They
diverged in 32 measured ways — a set list became a many-to-many, the gig form
grew a child collection, `UserPolicy` moved from `ROLE BandMember` to
`AUTHENTICATED`, the shell moved its theme switch into the nav drawer, a legend
was dropped, two headings and a nav label were renamed. The inventory is in
`docs/phases/phase-94-adl-adlj-divergence.md`.

They were kept for two reasons, neither of which was currency: `docs/spec/
language.md` cited twenty exact line numbers into them, and they were this
repository's richest real `.adl` *text* corpus, parsed on every test run.
Phase 98 removed both reasons rather than defending them — see "How the two
reasons were retired" below.

## The drift class

**A superseded file kept "unmodified, for reference" does not stay accurate —
it stays *unmodified*, which is a different thing.** Everything it describes
keeps moving. The file is frozen, so nothing about it changes, so nothing
signals that it has stopped being true. Every reader who opens it gets a
confident, coherent, well-commented, wrong answer, and there is no diff
anywhere to suggest otherwise.

This produced real damage: `docs/phases/phase-92-*.md` cited `ui.adl:13-19` as
evidence that the `themeSwitch` shell control sat in the top bar. The running
application had moved it to the nav drawer commits earlier. A defect was
investigated against a control that was not where the citation said.

The trailing note was the root cause, not the file. It described the file as
"superseded as compiled source" — true, and read by everyone as "same content,
different encoding".

**The eliminating move is the one to reach for first.** Phase 94 pinned the
divergence; Phase 98 removed the second copy. A pin is a real improvement over
nothing — it converts silent drift into a failing test — but it is maintenance
forever on an artifact whose only defence is that something cites it. If the
duplicate can be deleted and its consumers converted, delete it: a class of
drift that has no second artifact cannot recur, and needs no test to say so.

## It could not be regenerated, and that decided most of the design space

`printPartialApplicationModelAsAdl` **refuses** the real Giggle Band source.
Iteratively stripping each refusal enumerates exactly three blockers, all in
`docs/spec/adlj.md`'s named list of constructs with no ADL text syntax at all:

- a calendar's `conflictOverlay` (Phase 86)
- a child collection's `projectedFields` (Phase 87)
- a child collection's `summary` (Phase 87)

So there is no `.adl` text that says what the `.adlj` says. Before proposing
"just regenerate the `.adl` from the `.adlj`" for any reference app, print it
and see: as the `.adlj` surface keeps growing constructs ahead of the text
grammar, the printable subset shrinks, and a regeneration that "succeeds" by
dropping refused constructs would launder declared content out of the file
silently. That refusal is now asserted directly in `tests/compile-adlj.test.ts`
so the claim is checked rather than remembered, and so it fails loudly if ADL
text ever grows the missing grammar.

## `.adl` text is the printout, so a checked-in `.adl` corpus is a liability

The repository's direction, restated during Phase 98: **`.adlj` is the
language; `.adl` text is its human-readable printout.** Nobody hand-authors
`.adl`. That single sentence resolves the whole design space above — a
hand-maintained `.adl` copy of an application is not a second encoding of the
truth, it is a stale printout that someone has to keep re-printing by hand.

The corollary bites when you go looking for test corpus. Two tests used the
kept snapshot as proof material (a printer round-trip and a `compileAdlProject`
regression), and the tempting fix — hand-author a purpose-built multi-file
`.adl` fixture — recreates exactly the artifact the framing says should not
exist. Prefer, in this order: an existing real `.adlj` source printed and
reparsed at test time; the existing `examples/` corpus; and only then a
reduction in coverage, stated plainly in the phase document. Phase 98 took the
first two and still lost coverage; it said so rather than calling it a
simplification.

## Pin how two things *differ*, not that they agree

Kept for the next time two artifacts genuinely cannot be merged.

When two artifacts can never be made equal but must not drift apart unnoticed,
the guard is a checked-in divergence set, not an equality assertion.

**A path list is not enough.** The first version of the Phase 94 guard recorded
the sorted set of resolved-model paths at which the two sides differ. Probing
it by renaming a nav label the two sides *already* disagreed about left the
path set identical and the test green. A shape pin is not a value pin. Each
entry then carried a digest over both sides' values at that path, so a new
divergence adds an entry, a changed divergence changes a digest, and a resolved
divergence removes one — all three fail, forcing the author to state what they
changed.

Two mechanics matter for making such a diff readable:

- **Re-key arrays of named entities by name before diffing.** Inserting one
  object into `model.objects` shifted every later index and buried five real
  differences under a hundred positional ones. Keying by `name` reduced the same
  comparison from 1,629 lines to 32.
- **Report the shallowest differing path and stop.** Do not descend into a
  subtree already known to differ, or one added object produces fifty entries.

## Line-number citations do not survive a living document

Checked across this repository, and the result was one-sided:

- Citations into the **frozen** `.adl` files all still resolved — 20 out of 20
  in `docs/spec/language.md`.
- Citations into **living** documents were mostly already broken. Of the
  `docs/phases/*.md` documents citing `docs/spec/language.md:NNN`, every one
  spot-checked landed on unrelated text or a blank line. The same was true of
  the older `docs/phases/*.md` citations into `domain.adl`/`ui.adl` written
  while those files were still being edited: `:207` and `:241` were blank
  lines, `:80` was thirteen lines off, `:12`/`:14` three and five off.

And here is the part that makes line numbers worse than they look: **all
twenty `language.md` citations resolved, and all twenty were misleading
anyway.** They landed exactly on the construct claimed, in a file that had
stopped describing the running application two years of phases earlier. A
line-number checker would have passed every one. There is no mechanical
citation check that catches "correct pointer, false surrounding claim".

So: cite a construct by **name**, in the file that actually declares it, and
quote the text you are talking about into the document that discusses it. That
survives edits to the source, and it puts the claim next to the evidence where
a reader can see both at once.

## How the two reasons were retired

Both defences of the kept files were removed rather than argued with:

1. **Citations.** `docs/spec/language.md`'s twenty line citations became
   quoted examples attributed by construct name to `domain.adlj`/`ui.adlj`.
   Each quoted block was re-checked against the current `.adlj` while
   converting it, which caught three claims that had gone false — a
   "verbatim" `HomeDashboard` still carrying a row `ICON` fragment the app had
   dropped, a `SHELL` described as having eleven `NAV` entries when it has ten,
   and a `SetListForm` pointer that omitted the two constructs `.adl` cannot
   express at all.
2. **Corpus.** The printer round-trip moved onto Jointly Care's real `.adlj`
   source plus `examples/purchase-order.adl`; the `compileAdlProject`
   regression moved onto `examples/`. Coverage fell — `STATUS_MAP`, `ICON_MAP`,
   presentation `TOGGLE`, `UNION`, a qualified `READ_MODEL SOURCE JOIN`,
   `ATTACHMENT` and multi-file `.adl` concatenation are no longer round-tripped
   by anything — and the phase document says so in those words.

## A frozen fixture hides printer gaps in whatever it does not contain

Moving the round-trip onto real `.adlj` source immediately found two defects
that the frozen corpus had covered for:

- **`MIGRATION` was never printed at all.** It has had text grammar since the
  beginning; `print-adl.ts` simply had no branch for it, so every hop vanished
  from the printed `.adl` — silently, against that printer's own stated
  contract that an unrenderable construct throws a named error. Neither
  round-trip fixture in place declared a migration, so nothing caught it until
  Jointly Care's four hops came back as `migrations: []`.
- **A policy rule's clause list swallowed a following `FIELDS`.**
  `FIELD_LIST_STOP_WORDS` in `src/parser/grammar/policy.ts` listed every clause
  keyword except `FIELDS`/`FIELD`, so `READONLY UPDATE ROLE R STATE S FIELDS F`
  parsed `FIELDS` and `F` as two more state names. Only the `FIELDS`-first
  spelling worked — and the printer emits `FIELDS` last, so the defect was
  reachable only by round-tripping a rule carrying both clauses.

Generalisable: a round-trip fixture proves the printer over the constructs the
fixture happens to use, and says nothing at all about the rest. When the
fixture is *frozen*, that blind spot is permanent and grows every time the
language gains a construct.

## Before keeping any superseded file on disk

1. Ask first whether it can simply be deleted and its consumers converted.
   That is the only answer that ends the drift class rather than managing it.
2. If it stays, say in the file what it **is** (a dated snapshot of *what*, at
   what version), not merely what happened to it.
3. Say whether it can be regenerated, and if not, exactly what blocks it.
4. Say what still consumes it — tests included — so nobody deletes live corpus
   on the strength of the word "superseded".
5. If line numbers in it are cited, put the note at the **end** (a header note
   shifts every citation) and hash everything above it in a test, so the
   byte-for-byte promise is enforced rather than requested.
6. Add a divergence pin against whatever superseded it, with value digests.
7. Set a condition for its removal, and record it. Steps 2–6 buy time; they do
   not make a second copy true.
