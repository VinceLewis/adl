# Phase 29 - UI Presentation Conformance and Spec Hardening

## Objective

Turn the implemented UI presentation layer into a tested, documented, and
inspectable contract suitable for future runtimes.

This phase follows the same philosophy as Phase 23, but scoped to presentation:
the language syntax, resolved presentation model, runtime evaluation, and
browser rendering expectations should be explicit and covered by conformance
cases where practical.

## Scope

Harden the UI presentation implementation:

- Add data-driven conformance cases for presentation model resolution,
  validation, local state defaults, list binding, filters, row-template
  evaluation, icon maps, formatting, ordering, and empty states.
- Extend inspection/explain tooling to include presentation defaults and
  reference resolution.
- Update the UI language addendum from proposed design toward implemented
  specification for the delivered subset.
- Update `docs/spec/language.md`, `docs/spec/resolved-model.md`, and
  `docs/spec/runtime-semantics.md` where UI presentation behavior is now
  implemented.
- Add regression cases for gaps found while building the Giggle dashboard.
- Clarify the status of presentation shell declarations: generic browser
  composed-view app-bar styling exists, but ADL `SHELL`/`TOP_BAR` syntax is not
  yet implemented in the parser, evaluator, or browser handoff.
- Document unsupported UI constructs explicitly.

This phase should not add large new UI features. It should stabilize and specify
the subset delivered in Phases 24-28.

## Design Constraints

- Conformance cases must be runtime-agnostic data wherever possible.
- Do not encode browser DOM snapshots as the only source of truth for
  presentation semantics. DOM tests can complement, but not replace, model and
  evaluator conformance.
- Keep syntax, resolved model, and runtime semantics separated in the docs.
- Inspection output should explain defaults and references without requiring
  parser AST data.
- Any defect found in implemented behavior should be fixed with a regression
  case.

## Expected Deliverables

- UI presentation conformance cases and harness integration.
- Inspection/explain output for presentation declarations and defaults.
- Updated `docs/spec/ui-language-addendum.md` describing the implemented subset.
- Updates to the three core spec docs where UI presentation touches language,
  resolved model, or runtime behavior.
- Regression tests for any defects discovered.
- Learning updates for UI presentation conformance and inspection.

## Acceptance Criteria

- Conformance cases cover at least: composed sections, local state defaults,
  toggle-controlled filters, list binding to a read model, row-template
  fragments, icon maps, deterministic date/time formatting, ordering, and empty
  states.
- The conformance harness can run UI presentation cases without importing
  browser DOM components.
- Inspection output shows presentation defaults and invalid reference
  explanations.
- Specs clearly distinguish implemented UI behavior from future proposals.
- The Giggle dashboard remains rendered from ADL and passes its regression
  tests.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-23-conformance-suite-and-spec.md, docs/phases/phase-24-ui-presentation-model-foundation.md through docs/phases/phase-28-giggle-dashboard-reference-implementation.md, learnings/implementation/conformance-suite.md, learnings/implementation/browser-ui-runtime.md, and docs/phases/phase-29-ui-presentation-conformance-and-spec-hardening.md as the source of truth.

Execute Phase 29 only. Add runtime-agnostic conformance coverage for the implemented UI presentation subset, including composed sections, local state, toggle filters, list binding, row templates, icon maps, formatting, ordering, and empty states. Extend inspect/explain output for presentation defaults and references. Update the UI addendum and the core spec docs to distinguish implemented behavior from future proposals. Fix only defects exposed by this hardening work, with regression cases. Run full verification, update learnings, commit, and push.
```

## Tasks

1. Inventory implemented UI presentation behavior from Phases 24-28.
2. Design presentation conformance case data that is independent of browser DOM
   components.
3. Add conformance cases for resolution, validation, evaluation, formatting,
   icon maps, filters, ordering, and empty states.
4. Integrate the cases into the existing conformance harness.
5. Extend inspection/explain output for presentation defaults and references.
6. Document implemented versus proposed presentation shell behavior.
7. Update `docs/spec/ui-language-addendum.md`, `docs/spec/language.md`,
   `docs/spec/resolved-model.md`, and `docs/spec/runtime-semantics.md`.
8. Fix defects found by conformance or inspection work with regression cases.
9. Update `learnings/` if the phase produces reusable project knowledge.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
