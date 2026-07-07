# ADR 0002 - Resolved Model Is Stable Contract

Status: Accepted

Date: 2026-07-07

## Context

ADL will eventually have multiple authoring and input formats: hand-written ADL source, JSON or YAML fixtures, tests, visual designers, importers from old MINIL subsets, and possibly assistant-generated definitions.

If runtime services depend on parser AST nodes or source syntax, each authoring path would need special runtime handling. That would make defaults hard to inspect and would couple UI, policy, lifecycle, storage, and sync behaviour to one syntax.

The implementation brief requires defaults to be explicit and inspectable, and requires the runtime to consume a resolved model rather than parser AST nodes.

## Decision

`ResolvedApplicationModel` is the stable runtime contract.

All authoring inputs compile or convert into a partial model, then resolve into a fully explicit resolved model. Runtime services consume only the resolved model, including:

- validation
- policy enforcement
- lifecycle transitions
- object storage
- audit
- operation logging
- sync behaviour
- view rendering
- theme resolution

Parser AST nodes are syntax artefacts. They may carry source spans and diagnostics, but they are not runtime inputs.

## Consequences

- Defaults must be deterministic and materialised in resolved output.
- Runtime tests can start with hardcoded TypeScript or JSON models before the ADL parser exists.
- Future importers and designers can target the same contract as the parser.
- Model versioning becomes important because persisted data and runtime services depend on this contract.
- The resolved model needs to represent enough metadata for enforcement, not only UI rendering.

## Rejected alternatives

- Runtime services read directly from parser AST nodes.
- Each source format has a separate runtime adapter.
- Defaults remain implicit inside UI, storage, parser, or emitter code.
- The model is treated as a transient compiler detail rather than a versioned runtime contract.
