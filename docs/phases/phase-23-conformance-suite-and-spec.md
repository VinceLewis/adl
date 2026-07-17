# Phase 23 - Conformance Suite and Semantic Specification

## Objective

Turn the resolved model and runtime semantics into an explicit, versioned,
runtime-agnostic contract: a data-driven conformance test suite that any future
runtime must pass, a three-layer written specification, and inspection/explain
tooling for defaults and policy decisions.

This makes "define once, run consistently" a verifiable claim rather than a
slogan, and gives the future TypeScript authority server a concrete contract for
server-side replay semantics. It also protects the project if any future
implementation surface ever needs to prove compatibility.

Combined-recommendation coverage: point 4 (create conformance tests). It also
delivers the three-layer documentation split and the inspection tooling that
both reviews called for. It expands the initial expression conformance seeds
from Phase 20 into the full runtime-agnostic suite.

## Scope

Design and produce:

- **Conformance suite (data-driven).** A corpus of cases expressed as data
  (model + input + `RuntimeContext` + expected result), independent of the
  TypeScript implementation, plus a harness that runs the current TypeScript
  runtime against the corpus. Cover: model resolution and defaults, validation,
  expressions and decimal money, computed fields, read-model expression fields,
  decision tables, policy decisions (allow/deny/
  readonly/mask/hidden with reasons), lifecycle transitions and guards, commands
  and preconditions, context and context-scoped roles, read models, sync modes,
  offline datasets, and schema-version compatibility.
- **Three-layer specification** under `docs/spec/`:
  1. `language.md` - the human-authored ADL syntax reference.
  2. `resolved-model.md` - the canonical resolved model / IR reference (the
     stable contract).
  3. `runtime-semantics.md` - what each runtime service must do with the model,
     including evaluation order, deny precedence, guard/precondition ordering,
     and decimal semantics.
- **Inspection/explain tooling.** A stable `explainResolvedModel` output and a
  policy-decision explanation surface, exposed through an `adl inspect`-style
  entry point (function and/or CLI) that shows the fully resolved model and the
  origin of each default.

This is primarily a specification and test phase. It should not change runtime
behaviour except to fix defects the conformance corpus exposes.

## Design Constraints

- The conformance corpus is the **source of truth for cross-runtime behaviour**.
  It must be readable and runnable without importing TypeScript runtime
  internals, so the TypeScript authority server and any future implementation
  surface can consume the same cases.
- Each conformance case carries a stable id and references the spec section it
  pins, so spec and tests stay linked.
- The spec must describe behaviour already implemented and verified; it must not
  invent new semantics. Where the implementation and the intended semantics
  disagree, record it as a defect and fix the implementation, not the spec.
- Keep the three spec layers cleanly separated: syntax vs IR vs runtime
  semantics. Do not let language syntax leak into the runtime-semantics doc or
  vice versa.

## Expected Deliverables

- A `conformance/` corpus of data cases with stable ids and expected results.
- A harness that runs the TypeScript runtime against the corpus and reports
  pass/fail per case.
- `docs/spec/language.md`, `docs/spec/resolved-model.md`,
  `docs/spec/runtime-semantics.md`.
- Inspection tooling: `explainResolvedModel` output and a policy-decision
  explanation, reachable via an `adl inspect` entry point.
- Defect fixes for any conformance mismatches found, with regression cases.

## Acceptance Criteria

- The TypeScript runtime passes the full conformance corpus.
- Each conformance case has a stable id and cites the spec section it pins.
- The corpus can be loaded and read without importing runtime-internal
  TypeScript modules.
- The three `docs/spec/` documents exist, are internally consistent, and match
  the current implemented behaviour.
- `adl inspect` (or equivalent) prints the fully resolved model and explains the
  origin of each default (source, platform default, inherited, override).
- A policy decision can be explained with its contributing rules and effect.
- Any behaviour change made in this phase is a defect fix backed by a
  conformance case, not a new feature.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/adr/0004-conformance-suite-is-the-cross-runtime-contract.md, learnings/implementation/expression-language.md, learnings/implementation/computed-fields-and-read-model-expressions.md, and docs/phases/phase-23-conformance-suite-and-spec.md as the source of truth. Treat docs/claude-review.md and docs/gpt-review.md as background review inputs, not source-of-truth documents.

Execute Phase 23 only. Create a runtime-agnostic, data-driven conformance suite covering resolution, validation, expressions, computed fields, read-model expression fields, decision tables, policy, lifecycle, commands, context, read models, sync modes, and offline datasets, with a harness running the TypeScript runtime against it. Expand the expression conformance seeds from Phase 20 into the full corpus. Write the three-layer specification under docs/spec/ (language, resolved-model, runtime-semantics) describing only implemented behaviour. Add inspection/explain tooling for the resolved model and policy decisions. Do not add new runtime features; fix only defects the corpus exposes. Keep TypeScript as the semantic reference runtime; do not build a Dart, Flutter, or Wasm runtime. Before final review, update learnings/ and learnings/index.md if required. Commit and push.
```

## Tasks

1. Inventory current behaviour across resolution, validation, expressions,
   computed fields, read-model expression fields, decision tables, policy, lifecycle, commands, context, read models, sync
   modes, and offline datasets.
2. Design the conformance case data format (model + input + context + expected
   result + stable id + spec reference).
3. Build the corpus, aiming for coverage of the inventory above, including
   negative/error cases and decision explanations.
4. Build the harness that runs the TypeScript runtime against the corpus.
5. Write `docs/spec/language.md` (authored syntax reference).
6. Write `docs/spec/resolved-model.md` (canonical IR/contract reference).
7. Write `docs/spec/runtime-semantics.md` (service behaviour, evaluation order,
   precedence, decimal semantics).
8. Implement/finish `explainResolvedModel` and policy-decision explanation, and
   expose an `adl inspect` entry point.
9. Fix any conformance mismatches as defects and add regression cases.
10. Run typecheck, tests, format check, and build.
11. Update `learnings/` and `learnings/index.md`.
12. Commit all repository changes for this phase and push the current branch.
