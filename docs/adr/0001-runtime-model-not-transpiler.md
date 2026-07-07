# ADR 0001 - Runtime Model, Not Transpiler

Status: Accepted

Date: 2026-07-07

## Context

MINIL proved many useful business-language ideas, but its main path became a transpiler and build pipeline. It parsed MINIL source and emitted Dart/Flutter application code, panel configuration, SQL, CouchDB artefacts, migrations, and generated application projects.

The ADL implementation brief changes the centre of gravity. ADL should define business applications in terms of objects, fields, lifecycles, policies, views, themes, sync behaviour, APIs, and audit. The product is the runtime that executes an explicit resolved model, not generated application source code.

## Decision

ADL is runtime-model-first.

The primary ADL flow is:

```text
ADL source or fixture -> partial model -> resolved application model -> runtime services
```

ADL must not generate Dart, Flutter, Elixir, LiveView, or bespoke application code as its primary architecture. Runtime services such as validation, policy, lifecycle, storage, audit, sync, and UI rendering consume the resolved model and enforce behaviour directly.

ADL may later generate helper artefacts such as schema files, migrations, type definitions, documentation, or SDK wrappers, but generated application code is not the main execution model.

## Consequences

- Runtime improvements apply to every ADL application without regenerating application code.
- Parser work can be deferred until the resolved model and runtime are stable.
- UI behaviour is generic and model-driven rather than per-object generated code.
- Runtime services must be carefully designed because they become the product boundary.
- Some behaviours that are easy to hard-code in generated output need explicit runtime abstractions.

## Rejected alternatives

- Continue MINIL's Dart/Flutter transpiler path under the ADL name.
- Add a second primary emitter for Elixir/Phoenix LiveView or another application framework.
- Make ADL a thin source-to-source generator where generated app code owns policy, lifecycle, and validation.
- Let parser AST nodes become the runtime execution model.
