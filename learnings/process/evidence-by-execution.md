# Evidence By Execution

**A claim about what the running system does is only evidence once it has been
run. Reading the code that would do it is not evidence.**

This rule exists because it has been broken repeatedly in this repository, at
real cost, by people and agents who read carefully and were still wrong.

## Why reading is unreliable here specifically

This is not a general exhortation to test more. It is a property of this
codebase: **ADL degrades silently by design.** A denied read does not raise
where the reader can see it — the lookup resolver falls back to the raw record
id (`src/ui/components/adl-list-view.ts`, and `ReadModelService` since Phase
91). A policy that denies everything and a missing display projection are
therefore *indistinguishable by inspection*. Reading a resolver tells you what
it does **when permitted**. It never tells you whether it is permitted.

The same shape appears elsewhere: an unreachable `ROLE` principal reads exactly
like a working grant (`implementation/policy-engine.md`); an empty
`GRANT ... ON ALL TABLES` reads exactly like a grant that covers everything.
In each case the source text describes an intent that the runtime does not
carry out, and nothing in the text says so.

## The four incidents

1. **Phase 91's Evidence section was false.** It asserted, from reading
   `adl-list-view.ts`, that Giggle Band's object-backed `BandMemberList`
   rendered member *names* while the read-model-backed board rendered raw ids,
   and built the phase's scope on that contrast. Both rendered raw ids.
   `POLICY UserPolicy ON User` granted `READ`/`SEARCH` to `ROLE BandMember`,
   `User` is neither scoped to the `Band` context nor its bound object, so
   every rule matched nothing and *every* `LOOKUP ... DISPLAY` label in the app
   degraded. The phase was scoped against a contrast that did not exist.
   Phase 93 later made this class a compile error — but only after it had
   shipped twice.

2. **Phase 99's amendment had to say so out loud.** The body's analysis of the
   command-form gap was sound but reasoned, and the owner's amendment carries
   the instruction verbatim: "Re-verify that before designing anything; it was
   established by reading, not by running."

3. **Phase 102's first proposed fix was wrong.** The obvious repair for the
   authority grant gap — `ALTER DEFAULT PRIVILEGES FOR ROLE adl_migrator` —
   fails when executed by a non-superuser `CREATEROLE` database owner, which is
   exactly the role the production runbook names. No amount of reading
   `roles.sql` surfaces that. A throwaway `postgres:16-alpine` container
   following the runbook's own procedure surfaced it in minutes.

4. **Two Phase 99 defects were found only by looking at the rendered screen.**
   A "create a band" button was offered to people who were not signed in, whose
   click the server would have refused; and a newly registered person's first
   screen read `The active view does not have a runtime context.` instead of the
   welcome screen. No test caught either. Screenshot inspection did.

## What to do instead

- **Before writing a phase document's "Evidence and Dependency" section**, run
  the thing. A throwaway vitest against the seeded reference app with a real
  context is cheap — far cheaper than a phase scoped against a false premise,
  which is what later work then builds on.
- **Mark inferred claims as inferred, explicitly**, in the document. A reader
  cannot otherwise tell your measured claims from your reasoned ones, and will
  assume the stronger reading.
- **Prove server, projection, migration and grant behaviour against real
  PostgreSQL** under `tests/integration/`. A fake that pattern-matches SQL is
  never a correctness proof — it can only confirm that you wrote the SQL you
  meant to write, which was never the question.
- **Prove rendering by looking at it.** `npm run verify:push` produces
  Playwright screenshots; inspect them. See `process/visual-browser-verification.md`.
- **Delete the throwaway probe** once its result is in the document, or say you
  kept it and why.

## Corollary: running it is not enough if you do not read the result

Executing the check and then discarding its verdict is the same failure wearing
a different hat. **A pipeline reports the exit status of its last command.**
`npm run verify:push | tail -40` reports `tail`'s success while Playwright
reports `1 failed`. `cmd; echo $?` reports `echo`'s status, not `cmd`'s. Both
have masked a real failure in this repository, the second after the first had
already been caught.

Redirect to a file, check `$?` on the very next line, then read the file:

```sh
npm run verify:push > /tmp/verify.log 2>&1
VERIFY_EXIT=$?
echo "VERIFY_EXIT=$VERIFY_EXIT"
```

And read the number that prints. A green summary line inside the log is not the
same fact as a zero exit code; a run can print passing counts for the suites it
reached and still have failed.
