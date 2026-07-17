# Conformance Suite and Inspection Tooling

Read this before changing runtime semantics, resolved-model defaults, policy
decision behavior, or the executable conformance corpus.

## Key decisions from Phase 23

- The conformance corpus is versioned JSON under `conformance/`. It carries
  stable case ids, spec references, operation input, runtime context, and
  expected output.
- Shared models may live in a suite-level `models` map and be referenced by
  `modelRef`. This keeps data-driven cases readable while preserving a
  runtime-agnostic corpus.
- `src/conformance/runner.ts` is the TypeScript semantic harness. It executes
  corpus cases through public compiler/runtime surfaces and returns normalized
  pass/fail results. It is not a second runtime.
- The harness supports expression, model resolution, model validation,
  inspection, policy decision explanation, CRUD/search, lifecycle transition,
  command execution, decision tables, read models, offline dataset evaluation,
  sync-mode write denial, and startup compatibility cases.
- Dynamic record ids are normalized to setup aliases in conformance results, so
  cases can assert behavior without depending on generated GUID text.
- `explainResolvedModel` returns the resolved model plus origin entries for
  platform defaults, derived defaults, and source-supplied values. Supplying the
  partial source model gives the most precise origin classification.
- `explainPolicyDecision` and `explainPolicyRequest` expose the winning decision,
  reasons, request, context summary, and precedence category without changing
  authorization behavior.
- The three written spec layers live under `docs/spec/`: language syntax,
  resolved-model contract, and runtime semantics.

## Practical guidance

- Add or update conformance cases whenever a semantic behavior changes. Each
  case must have a stable id and a `specRef` pointing at the relevant spec
  section.
- Keep expected outputs focused on the semantic surface being pinned. The
  harness uses partial matching for expected objects but exact ordering for
  arrays.
- Do not make conformance JSON import TypeScript modules or runtime internals.
  Use resolved expressions, partial models, runtime context data, and operation
  inputs as plain JSON.
- If implementation and intended semantics disagree, fix the implementation only
  when it is a defect in already-implemented behavior; otherwise update the spec
  and corpus to match current behavior.
