# Phase 70 - Composite-Key NUL Byte Source Hygiene

> This phase is not derived from re-reading a subsystem a prior phase touched.
> Phase 69's agent, while grepping unrelated code, found that three files
> `src/compiler/validate-model.ts`, `src/conformance/runner.ts`, and
> `src/runtime/command-service.ts` each carry a literal raw `0x00` byte in a
> composite-key template literal, and recorded it in
> `learnings/process/phase-execution.md`. The user then commissioned closing
> it directly, by name, with the exact file/line evidence already in hand —
> the two conditions the rolling handoff's stopping rule (see that same
> document, "The Rolling Handoff Stopped At Phase 63") requires before code
> may drive another phase. Consistent with Phase 69's own closing note, this
> phase does not write a further handoff; the next phase, if any, again awaits
> the user's next concrete instruction.

## The defect

A raw NUL byte (`0x00`) physically present in a source file, rather than the
two-character escape sequence `\0`, produces the identical runtime string
inside a template literal — but many `grep`/`ripgrep`/`ugrep` implementations
treat a file containing one as binary and silently return nothing for any
search that touches it, with no error. This is the same failure mode that
Phase 58 introduced once already, by accident, in `src/server/sync-client.ts`
(recorded in `learnings/process/phase-execution.md`), and it produced a
concrete cost there: two independent Phase 56 reconnaissance agents reported
`src/compiler/validate-model.ts` "contains no validation," defeated by exactly
this defect, for a 6,878-line validator that plainly does.

## What was found

A byte-safe repo-wide sweep (`grep -laP '\x00'` over every file tracked by
`git ls-files`; a raw NUL embedded in a bash argument via `$'\x00'` is
silently truncated by argv before `grep` ever sees it, so the sweep used the
four-character escape text `'\x00'` as the pattern, not an embedded byte)
found five occurrences of the defect, two more than the three the learnings
document had already named:

| File | Line(s) | Composite key |
| --- | --- | --- |
| `src/compiler/validate-model.ts` | 1019 | `` `${migration.from}\0${migration.to}` `` |
| `src/conformance/runner.ts` | 1117 | `` `${left.object}\0${left.recordId}` `` (twice on one line, `left` and `right`) |
| `src/runtime/command-service.ts` | 522 | `` `${entry.objectName}\0${entry.recordId}` `` |
| `src/runtime/startup-compatibility.ts` | 304, 311 | `` `${entry.objectName}\0${entry.record.meta.guid}` `` |
| `tests/authority-retention-configuration.test.ts` | 116 | a deliberately-embedded NUL in a test literal, exercising PostgreSQL's own refusal of a NUL in a text key |

`docs/giggle-screenshots.docx` also matched the sweep; it is a binary Office
document (a NUL byte is normal there) and is out of scope.

## What was done

1. Replaced each of the five raw `0x00` bytes with the literal two-character
   escape `\0`, verified byte-for-byte via `perl -i -pe 's/\x00/\\0/g'` per
   file (each file had exactly as many NUL bytes as expected — one apiece,
   except `runner.ts` and `startup-compatibility.ts` at two — and zero
   remained afterward). `git diff` on each file shows only the intended
   single-byte-to-two-character change; nothing else in any file moved.
2. Confirmed no other raw NUL byte exists anywhere else in the repository
   (excluding the one binary asset) with the same byte-safe method.
3. Added `tests/composite-key-nul-separator.test.ts`:
   - Asserts, for all five files above, that they contain no raw `0x00` byte
     (read as a `Buffer`, not text, so the assertion itself cannot be fooled
     by the same defect it is checking for).
   - Exercises `validateModelMigrations` (via the exported
     `resolveApplicationModel` / `validateApplicationModel`) with two
     migrations whose `from`/`to` are chosen so a no-separator concatenation
     would collide (`"A"+"BC"` and `"AB"+"C"` both give `"ABC"`) and asserts
     they are **not** reported as `MIGRATION_DUPLICATE` — the direct
     behavioural proof the `\0` separator exists and does its job — plus a
     control case asserting a genuine duplicate `from`/`to` pair still is.
   - Verified the test actually catches the regression: reintroducing a raw
     NUL byte into `validate-model.ts` and re-running the file fails the
     source-encoding assertion; restoring the fix passes again.
4. `src/runtime/command-service.ts`'s `SuppliedRecordIds` path already has
   behavioural coverage from `tests/command-authority-replay.test.ts`
   ("accepts the same id under two different objects, because storage keys
   per object"), which continues to pass unchanged and exercises the same
   composite key this phase touched.
5. `src/conformance/runner.ts`'s `runAuthorityBootstrapCase` sort key and
   `src/runtime/startup-compatibility.ts`'s `applyMigration` lookup key are
   covered by the source-encoding guard only; both require a full
   authority-bootstrap conformance fixture or a multi-object migration
   harness respectively to pin behaviourally, which is disproportionate to a
   change this small and purely encoding-preserving. Neither key is
   persisted to or read from PostgreSQL — both are transient in-memory `Map`
   keys / sort comparators — so `npm run test:integration` was not required
   and was not run; this was checked by grep, not assumed.
6. Updated `learnings/process/phase-execution.md` to close the loop: the
   entry that recorded the three-file finding as still-open now records that
   Phase 70 fixed it, names the two additional files the wider sweep found,
   and points at the new regression test.

## Verification

- `npm test` — 956 tests pass (52 files), including the 7 new cases.
- `npm run typecheck` — clean.
- `npm run format:check` — clean (after `prettier --write` on the two files
  its line-wrapping touched).
- `npm run verify:push` — not run; no UI, shell chrome, or presentation
  rendering was touched.
- `npm run test:integration` — not run; see point 5 above.

## Closing Note

This phase closes the exact five-instance defect named above and stops. No
Phase 71 is written. The next phase, if there is one, again awaits the user's
next concrete instruction rather than a re-reading of this fix's own code.
