# Testing Expectations

The phase documents include test or verification tasks.

Phase 0 is documentation and repository audit work, so automated tests are not expected. Verification should confirm that MINIL was not modified and that the requested documentation exists.

Code phases should add or update tests that prove the behavior introduced by the phase:

- Phase 1: type imports and resolved model default resolution
- Phase 2: model validation diagnostics
- Phase 3: runtime CRUD, policy, lifecycle, audit, and operation log behavior
- Phase 4: UI behavior where practical, plus runtime enforcement tests for bypass cases
- Phase 5: theme resolution and UI token behavior
- Phase 6: parser and compiler behavior
- Phase 7: policy hardening and decision explanations
- Phase 8: lifecycle transition flow
- Phase 9: storage abstraction and persistence behavior
- Phase 10: sync policy behavior
- Phase 11: model and schema version guards
- Phase 12: business context model resolution and validation
- Phase 13: context runtime, scoped roles, and policy enforcement
- Phase 14: context UI selection and navigation behavior
- Phase 15: read-model query behavior and dashboard rendering
- Phase 16: context-aware offline dataset selection
- Phase 17: band-app reference model, runtime authorization, and browser demo behavior
- Phase 18: generic platform gaps from the band reference app, including policy conditions, commands, scoped uniqueness, and ordered constraints
- Phase 19: documentation consistency only; verify architecture docs and ADRs exist, reference the July design notes, and no runtime code changed
- Phase 20: expression evaluator behavior, type checking diagnostics, decimal/date semantics, parser round trip, policy/validation integration, and initial expression conformance cases
- Phase 21: object validation, decision tables, lifecycle guards, command preconditions, compile-time diagnostics, and direct runtime enforcement
- Phase 22: computed-field evaluation, computed-field write denial, dependency-cycle diagnostics, read-model expression fields, and direct runtime enforcement
- Phase 23: data-driven conformance corpus, conformance harness, spec consistency, inspect/explain tooling, and regression tests for any defects fixed
- Phase 24: UI presentation resolved-model defaults, validation diagnostics, and model-resolution fixtures
- Phase 25: UI ADL parser/compiler syntax, multi-source app manifests, malformed block diagnostics, and Giggle `ui.adl` compilation
- Phase 26: presentation runtime evaluation for local state, list binding, filters, row templates, icons, formatting, ordering, and empty states
- Phase 27: browser composed-view rendering, toggle interaction, compact feed rendering, and preservation of existing CRUD UI behavior
- Phase 28: Giggle dashboard reference implementation, ADL-driven rendering path, representative seed data, and browser build verification
- Phase 29: UI presentation conformance cases, inspect/explain output, spec consistency, and regression tests for any defects fixed

## Scope of this document

Two kinds of content live here. **The doctrine sections** — every positive test
needs a matching negative one, proving a test can fail, absence assertions,
declaring expected failures — are project-agnostic and are written so they can
be lifted into a shared testing kit without edit. Their ADL incidents stay with
them: a rule without its scar tissue gets argued away in the next codebase.
**The ADL-specific sections** — the per-phase list, the real-PostgreSQL rule,
the reference-app fixture rule — are about this repository and do not travel.

## Every positive test needs a matching negative test

**Rule: no functionality and no defect fix is complete with positive tests
alone. Each one needs at least one negative test paired with it — a case
asserting that the thing correctly does *not* happen, is *not* permitted, is
*not* accepted, or fails in the declared way. If you arrive at code whose tests
are positive-only, write the missing negative tests first, before the change
you came to make.**

### Why pairing, and not simply "more tests"

A positive-only suite cannot tell "this works" apart from "this always allows".
A negative-only suite cannot tell "this correctly denies" apart from "this
always denies". Neither half pins the boundary; only the pair does. Both
failure modes have shipped here:

- **Always denies, and nothing failed.** `POLICY UserPolicy ON User` granted
  `READ`/`SEARCH` to `ROLE BandMember`, but `User` is neither scoped to the
  `Band` context nor its bound object, so every rule matched nothing and every
  `LOOKUP ... DISPLAY` label in the app silently degraded to a raw record id.
  Any negative test — "a stranger is denied" — passed perfectly. The missing
  case was the positive one: *a member is permitted*. This shipped twice before
  Phase 93 made the class a compile error.
- **Always allows, and nothing failed.** The authority grant gap survived nine
  migrations and 163 green integration tests, because the shared harness
  database runs as one superuser owning every table. Every positive write
  assertion passed and could not have done otherwise. Phase 102's fix ships
  `expectDdlAndTruncateRefused` alongside `expectFullDmlOnEveryProjectionTable`
  precisely so neither half can drift into vacuity.

### What counts as the negative half

Not "a second test". A case that would pass if the implementation were replaced
by a constant. Concretely, in this repository:

- **Policy:** for every "principal X may do Y" case, a case that principal Z may
  not — and, where the grant is field-scoped, that the *fields outside the
  grant* are absent from the result rather than merely that no exception was
  raised. Assert on rendered values. ADL degrades silently, so an absence of
  errors proves nothing (see `evidence-by-execution.md`).
- **Validation and diagnostics:** for every source that compiles clean, a source
  that must produce a named diagnostic — and assert the diagnostic's identity,
  not merely that `diagnostics` is non-empty.
- **Grants and roles:** for every "this role can", a "this role cannot".
- **Lifecycle, preconditions, constraints:** for every accepted transition or
  write, a refused one, asserting the refusal's reason.
- **Commands:** for every satisfied precondition, a violated one.
- **Browser specs:** for every rendered affordance, a case proving it is absent
  when it should be — Phase 99 shipped a "create a band" button offered to
  people who were not signed in, whose click the server would have refused.
  Use the Phase 107 helpers rather than a bare `toHaveCount(0)`, which is the
  browser form of the vacuous negative: it is satisfied equally by "correctly
  not offered", "the page never mounted" and "the selector was renamed". This
  repository carried exactly that — a `not.toContainText("Sign out")` on
  `.adl-topbar-tools` that would have survived the whole top bar disappearing.
  `expectAbsentWithin` requires a present-anchor; `expectRequestRefused`
  separates "never requested" from "was permitted"; `expectAuthorityDenied`
  asserts the **server's** own record of the refusal, which is the only thing
  that distinguishes a hidden control from an enforced one. See
  `process/visual-browser-verification.md`.

### The negative test goes in first, and must be seen to fail

Write it before the change, watch it fail against the unmodified code, then make
it pass. A negative assertion written after the fix is the easiest kind of test
to write vacuously, because it passes the moment you write it and nothing tells
you whether it *could* fail. Phase 102's report went further and removed each
half of its fix separately to confirm each broke a distinct, non-overlapping set
of assertions; that is the standard to aim at when the fix has more than one
moving part.

### Where the rule bends, and what to do instead

Some behaviour has no meaningful negative counterpart — a pure formatter, a
printer round-trip. Do not manufacture a hollow one to satisfy the rule. Say in
the phase report which cases have no negative half and why. That is a
disclosure, not an exemption: it is reviewable, whereas a silently positive-only
suite is not.

## Prove the test can fail: the mutation check

**A test you have not seen fail is a claim, not a check.** Writing it before the
change and watching it go red is the cheap version. The reliable version is the
mutation check: **break the implementation on purpose and confirm the test goes
red.**

The question to ask of every assertion is: *what would satisfy this that
shouldn't?* Then create exactly that condition and run it.

### Two ways a test proves nothing, and both look identical from the outside

**1. Nothing exercises the behaviour.** The test asserts a refusal that would
hold for any input, because the case it names is never reached.

Phase 103 shipped this and caught it by mutation. Its "a `SELF` grant confers no
search" test declared `ALLOW READ SELF` and `ALLOW UPDATE SELF`, then asserted
`search` was refused. It passed — and it **still passed with the policy engine
mutated to allow everything**, because the model named no `search` rule at all,
so the refusal held for every principal and said nothing whatever about `SELF`.
The discriminating shape was `ALLOW * SELF`, which does name `search`. The
executor's own words: *the mutation found this, not review.*

**2. A different mechanism is satisfying it.** The test passes, the behaviour it
names is broken, and some other check is quietly doing the work.

Phase 107 shipped two of these and caught both by mutation. Its `request-failed`
and `http-error` gates each had a `test.fail()` case to prove the gate could
fail — and both cases **still failed with the gate under test deleted**, because
aborting a request and fetching a 404 each *also* log a console error, and the
console gate was catching them. The fix was to allow the console error inside
each case, leaving the gate under test as the only unallowed signal. Its own
words: *without the mutation check I would have shipped two gates whose
self-checks proved nothing.*

The second mode is the more dangerous, because the test is exercising real
behaviour and failing for a real reason — just not the reason it claims.

### The discipline

- **Mutate per moving part, not per fix.** Phase 102 removed each half of its
  two-part fix separately and confirmed each broke a **distinct, non-overlapping**
  set of assertions (five failures and two). Overlapping sets mean one of the
  halves is not actually covered.
- **Mutate toward the permissive answer.** Replace the check with "always
  allow", "always true", "always found". That is the constant a hollow test
  cannot distinguish.
- **Delete the branch, not just the value.** Phase 104's nine mutations included
  removing a printer branch entirely, which is how it learned that a missing
  branch emits an *empty* clause that reparses as the permissive default —
  silent widening, not a crash.
- **Restore the file.** A mutation left in place is a defect.

Four consecutive phases used this and it found something in three of them. It is
the highest-yield verification practice this repository has, and it is the one a
test's own author is least likely to perform unprompted — which is an argument
for a reviewer who is not the author.

## An absence assertion needs a present-anchor

**"X is not there" is satisfied by nothing being there at all.** Every assertion
of absence must be paired, in the same assertion, with something whose
*presence* proves the subject was actually rendered, returned or evaluated.

Measured in this repository: `giggle-band.visual.spec.ts:476` asserted that the
top bar did not contain "Sign out". It passes when the top bar disappears
entirely. Phase 107 replaced the pattern with `expectAbsentWithin`, whose
present-anchor argument is **required** so a blank page cannot satisfy it.

The rule is not browser-specific. It applies to a field absent from a policy
result (assert the whole result by equality, so absence is asserted rather than
inferred), a row missing from a query (assert the rows that should be there), a
diagnostic not emitted (assert the diagnostics that should be), and a request
never made (distinguish "never happened" from "was permitted" — a bare
count-of-zero conflates the two).

Related and equally load-bearing: **never assert on the absence of an
exception.** In a system that degrades silently, "no error was raised" is
compatible with everything being wrong. Assert rendered values, and assert
diagnostics by code and path rather than by `diagnostics` being non-empty.

## Declare expected failures from measurement, never from prediction

A suite that deliberately provokes failures needs a way to say "this one is
meant to happen". That list must be built from **a report-only run that records
what actually occurs**, never from reasoning about what the code should emit.

Phase 107 predicted four things about its own suite and was wrong about all
four. Its offline test would produce a storm of failed requests: it produced
**zero**, because the service worker serves everything from cache. Its
startup-failure test would produce a page error "by construction": the app
catches it and nothing escapes. A deliberate abort would produce "many"
failures: it produced three. And the **dominant signal in the whole suite was
not a deliberate provocation at all** — it was ordinary signed-out startup,
which no test provokes and which would have failed eight honestly-passing tests
on the first day the rule was switched on.

Three rules follow, and they generalise to any allowlist, any expected-failure
list, and any "known issues" file:

- **Inventory first, declare second.** Report-only pass, then write the list
  against what it recorded.
- **Every entry carries a written reason, and the reason is printed wherever the
  entry applies.** An allowance should annotate the output, not silence it — the
  report should say "12 failures, all allowed: *the network is disabled on
  purpose*", never "0 failures".
- **Scope each entry to the window that provokes it**, not to the whole test,
  and pair it with a positive control proving the allowed path still works —
  otherwise an allowance is satisfiable by a run in which the behaviour never
  happens at all.

An entry that matched nothing should be **reported**, not failed: it usually
means the deliberate failure stopped happening, which is worth a human look but
is not itself an error.

## Backend/authority integration testing (real, not mocked)

Any test that verifies authority-server behaviour, PostgreSQL projections,
migrations, the transactional unit-of-work, or the HTTP edge MUST run against a
real backend. A fake `pg` that pattern-matches SQL in memory is not an
acceptable correctness proof for backend behaviour — it silently passed a Phase
44 defect where the runtime-audit `audit_id` used NUL-byte separators, which
real PostgreSQL rejects (`invalid byte sequence for encoding "UTF8": 0x00`) and
which would have rolled back every accepted replay in production. Real
PostgreSQL also validates SQL syntax, jsonb operators, constraints, and true
row-level locking that a fake cannot.

- Real integration tests live in `tests/integration/` and run with
  `npm run test:integration` (separate `vitest.integration.config.ts`).
- The global setup provisions a throwaway `postgres:16-alpine` container via
  Docker, or uses `ADL_TEST_DATABASE_URL` when set; it applies the real
  `src/server/migrations/*.sql` once and truncates projections between tests.
- Tests run over a real `pg` pool (which structurally satisfies the ADL
  `PostgresPool`/`PostgresQueryable`/`PostgresPoolClient` contracts) and drive
  the HTTP edge over a real localhost socket with `fetch`.
- The default `npm test` excludes `tests/integration/**` so it stays hermetic
  and Docker-free; never let backend behaviour be covered only by a mock.
- Fault injection at a specific write stage is done with a thin `faultyPool`
  decorator over the real pool (see `tests/integration/pg-harness.ts`), so real
  begin/commit/rollback still executes.
- The shared harness database runs as **one superuser that owns every table**,
  so no test using it can see whether the deployment's DML-only traffic role
  actually holds its grants. `tests/integration/authority-role-grants.test.ts`
  (Phase 102) is the only test that provisions the real `adl_migrator` /
  `adl_authority` split, and it brings its own throwaway database to do it. It
  needs `CREATE DATABASE` and `CREATE ROLE`; if `ADL_TEST_DATABASE_URL` names a
  role without them the test **fails naming the missing capability rather than
  skipping**. Grant the capability. A silent skip is exactly how the gap it
  covers survived nine migrations and 163 green integration tests.

Run the strongest relevant commands available at that point, usually some combination of tests, typecheck, lint, format check, and build. If the project does not yet have one of those commands, do not invent unrelated tooling just to satisfy the word "test"; record the gap and proceed with the best available verification.

For browser UI rendering, shell chrome, reference app screens, presentation
runtime output, or CSS changes, run `npm run verify:push` before committing and
pushing. That command includes `npm run test:visual`, which captures Playwright
desktop and mobile screenshots for every Giggle Band app page. Inspect the
generated screenshots under `test-results/visual/` before pushing; DOM and unit
tests alone are not enough for UI layout changes.

## A reference-app constraint change invalidates fixtures the fast suite never runs

The reference apps are not only demos: `tests/integration/` builds its fixtures
out of `createGiggleBandExampleModel()`, so every object constraint in
`src/reference/giggle-band/domain.adlj` is a rule those fixtures have to obey.
`npm test` excludes `tests/integration/**`, so a constraint added with a green
fast suite can leave an integration fixture illegal and nobody sees it.

That is exactly what happened. `6b08065` ("Model Giggle Band's gig <-> set-list
relationship as a real ordered many-to-many") added
`CONSTRAINT uniqueSongInSetList UNIQUE SCOPE SetList FIELDS Song` to
`SetListItem`, and updated the three hermetic test files it broke. It never ran
`npm run test:integration`, and
`tests/integration/edit-surface-batch.test.ts`'s inline-child-edit fixture —
written at Phase 60, before the constraint existed — had been naming the same
`Song` on two children of one set list all along. The authority correctly began
refusing that batch, and the failure sat undiagnosed for thirteen commits until
Phase 96.

The rule: **a change to any object's `constraints`, field requiredness, or
`IN (...)`/validator set in a shipped reference app's `.adlj` is a change to the
legality of every fixture built from that model. Run
`npm run test:integration` in the same pass, not only `npm test`.** This sits
beside `AGENTS.md`'s persisted-state upgrade rule — both exist because a
reference-app model edit reaches much further than the app it appears to be
about.

Two second-order lessons from the diagnosis itself:

- A rejected `AuthorityOutcome` carries only `{ code, message }`. The
  `RuntimeValidationError`'s `issues` array — which names the constraint and the
  field — is dropped at the service boundary, so "Object constraints failed."
  says nothing about which constraint. Diagnosing it meant temporarily
  instrumenting the throw site in `src/runtime/object-store.ts` to print the
  issues. Do that first when an integration replay is rejected and the reason is
  not obvious.
- When a test fails because a *fixture* violates a rule the model added later,
  the fix is the fixture, not the assertion. Correct the data so the scenario is
  legal and the original claim is under test again, then pin the rule the
  fixture was accidentally exercising with its own explicit test, so the
  accident becomes a guard. Do not relax the assertion — see
  `process/phase-execution.md` on never weakening a check to make verification
  pass.
