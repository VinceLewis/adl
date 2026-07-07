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

Run the strongest relevant commands available at that point, usually some combination of tests, typecheck, lint, format check, and build. If the project does not yet have one of those commands, do not invent unrelated tooling just to satisfy the word "test"; record the gap and proceed with the best available verification.
