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

Run the strongest relevant commands available at that point, usually some combination of tests, typecheck, lint, format check, and build. If the project does not yet have one of those commands, do not invent unrelated tooling just to satisfy the word "test"; record the gap and proceed with the best available verification.
