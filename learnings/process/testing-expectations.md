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
