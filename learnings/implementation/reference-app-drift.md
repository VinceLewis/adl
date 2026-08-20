# A Kept `.adl` File Drifts Silently From Its `.adlj` Source (Phase 94)

Read this before citing, quoting, or reasoning from
`src/reference/giggle-band/domain.adl` or `ui.adl`; before keeping any generated
or superseded file on disk "for reference"; and before adding a line-number
citation into any file this repository maintains.

## What the two Giggle Band `.adl` files are

Not a view of `domain.adlj`/`ui.adlj`. A **frozen snapshot of the application at
model version 1.0.0**, while the `.adlj` source is at 1.9.0. They diverge in 32
enumerated ways — a set list became a many-to-many, the gig form grew a child
collection, `UserPolicy` moved from `ROLE BandMember` to `AUTHENTICATED`, the
shell moved its theme switch into the nav drawer, a legend was dropped, two
headings and a nav label were renamed. The full inventory is in
`docs/phases/phase-94-adl-adlj-divergence.md`; the machine-checked form is
`tests/reference-adl-snapshot.test.ts`.

They are kept for two reasons, neither of which is currency:

1. `docs/spec/language.md` cites twenty exact line numbers into them, and a
   dozen `docs/phases/*.md` documents cite more.
2. They are this repository's richest real `.adl` **text** corpus, and two tests
   parse them on every run: `tests/compile-adlj.test.ts`'s printer round-trip
   and `tests/compile-adl-project-v2.test.ts`'s `compileAdlProject` regression
   proof. An earlier trailing note claimed the files were "not reparsed,
   tested"; that was never true, and believing it would let someone delete live
   test corpus.

## The drift class

**A superseded file kept "unmodified, for reference" does not stay accurate — it
stays *unmodified*, which is a different thing.** Everything it describes keeps
moving. The file is frozen, so nothing about it changes, so nothing signals that
it has stopped being true. Every reader who opens it gets a confident, coherent,
well-commented, wrong answer, and there is no diff anywhere to suggest
otherwise.

This produced real damage: `docs/phases/phase-92-*.md` cited `ui.adl:13-19` as
evidence that the `themeSwitch` shell control sat in the top bar. The running
application had moved it to the nav drawer commits earlier. A defect was
investigated against a control that was not where the citation said.

The trailing note was the root cause, not the file. It described the file as
"superseded as compiled source" — true, and read by everyone as "same content,
different encoding". The fix was to make the note say what the file *is* (a
dated 1.0.0 snapshot, unregenerable, kept for citations and corpus) rather than
what happened to it.

## It cannot be regenerated, and that decides most of the design space

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
silently.

## Pin how two things *differ*, not that they agree

When two artifacts can never be made equal but must not drift apart unnoticed,
the guard is a checked-in divergence set, not an equality assertion.

**A path list is not enough.** The first version of
`tests/reference-adl-snapshot.test.ts` recorded the sorted set of
resolved-model paths at which the two sides differ. Probing it by renaming a nav
label the two sides *already* disagreed about left the path set identical and
the test green. A shape pin is not a value pin. Each entry now carries a digest
over both sides' values at that path, so:

- a new divergence adds an entry,
- a changed divergence changes a digest,
- a resolved divergence removes an entry,

and all three fail, forcing the author to state what they changed.

Two mechanics matter for making such a diff readable:

- **Re-key arrays of named entities by name before diffing.** Inserting one
  object into `model.objects` shifted every later index and buried five real
  differences under a hundred positional ones. Keying by `name` reduced the same
  comparison from 1,629 lines to 32.
- **Report the shallowest differing path and stop.** Do not descend into a
  subtree already known to differ, or one added object produces fifty entries.

## Line-number citations do not survive a living document

Checked across this repository, and the result is one-sided:

- Citations into the **frozen** `.adl` files all still resolve — 20 out of 20 in
  `docs/spec/language.md`.
- Citations into **living** documents are mostly already broken. Of the
  `docs/phases/*.md` documents citing `docs/spec/language.md:NNN`, every one
  spot-checked lands on unrelated text or a blank line. The same is true of the
  older `docs/phases/*.md` citations into `domain.adl`/`ui.adl` that were
  written while those files were still being edited: `:207` and `:241` are blank
  lines, `:80` is thirteen lines off, `:12`/`:14` are three and five off.

So: a line number is only a durable citation into a file that is frozen *and
labelled as frozen*. Into anything under active edit, cite the construct by name
and quote the text.

## The framing paragraph beats the mechanical repair

`docs/spec/language.md`'s twenty citations were individually accurate. The
document was wrong at a level line numbers cannot express: present tense about a
past release. Repairing that per site would have been twenty edits, each able to
rot again on the next `.adlj` change. One subsection at the top — "these files
are a frozen 1.0.0 snapshot, cited deliberately, read them as ADL text
illustrating a construct and never as evidence about the running app" — makes
all twenty honest at once and cannot rot, because the document stops claiming
currency.

Generalisable: when many citations are wrong the *same* way, fix the frame, not
the citations. When they are wrong in different ways, fix the citations.

## Before keeping any superseded file on disk

1. Say in the file what it **is** (a dated snapshot of *what*, at what version),
   not merely what happened to it.
2. Say whether it can be regenerated, and if not, exactly what blocks it.
3. Say what still consumes it — tests included — so nobody deletes live corpus
   on the strength of the word "superseded".
4. If line numbers in it are cited, put the note at the **end** (a header note
   shifts every citation) and hash everything above it in a test, so the
   byte-for-byte promise is enforced rather than requested.
5. Add a divergence pin against whatever superseded it, with value digests.
