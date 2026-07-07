# ADL Learnings Index

This folder records reusable knowledge discovered while building ADL. Use it to avoid relearning project-specific constraints, decisions, and implementation details.

## How to Use This Index

Before any phase, read:

- `project/repository-boundaries.md`
- `process/phase-execution.md`
- `process/testing-expectations.md`

Before tasks that inspect or compare old MINIL, also read:

- `project/repository-boundaries.md`
- `minil/repository-audit.md`

Before tasks that design the ADL resolved model, parser, validator, lifecycle, policy, or runtime test concepts based on old MINIL prior art, also read:

- `minil/repository-audit.md`

Before tasks that change resolved model defaults, model validation, policy evaluation, storage metadata, or runtime record handling, also read:

- `architecture/resolved-model-defaults.md`
- `implementation/model-validator.md`
- `implementation/policy-engine.md`

Before tasks that change business context/scope modelling, context-scoped roles, relationship-aware policies, cross-context views, read models, sync dataset design, or backend persistence assumptions, also read:

- `architecture/business-contexts-and-backends.md`
- `implementation/business-context-model.md`

Before tasks that integrate compile-time validation, runtime model startup checks, or parser-to-model validation, also read:

- `implementation/model-validator.md`

Before tasks that change ADL lexer/parser syntax, AST conversion, `compileAdl`, parser examples, or parsed policy/theme behaviour, also read:

- `implementation/adl-parser.md`

Before tasks that change runtime services, UI runtime integration, lifecycle execution, audit, operation log handling, sync policy enforcement, or runtime tests, also read:

- `implementation/runtime-services.md`
- `implementation/policy-engine.md`
- `implementation/sync-policy.md`

Before tasks that change runtime persistence, object storage backends, browser demo seeding, sync replay storage, or persisted record tests, also read:

- `implementation/storage-backend.md`
- `implementation/model-versioning-guard.md`
- `implementation/sync-policy.md`

Before tasks that change runtime startup compatibility checks, persisted application metadata, object schema version guards, or future migration handling, also read:

- `implementation/model-versioning-guard.md`

Before tasks that change browser UI runtime components, browser demo fixtures, UI policy or sync presentation, or browser verification, also read:

- `implementation/browser-ui-runtime.md`
- `implementation/policy-engine.md`
- `implementation/sync-policy.md`

Before tasks that change resolved theme tokens, theme resolution, UI CSS custom properties, or parser support for `THEME`, also read:

- `implementation/theme-system.md`

Before tasks that change the phase plan, also read:

- `process/phase-execution.md`

Before tasks that add or modify code, also read:

- `process/testing-expectations.md`

## Where to Add New Learnings

Add new documents under the most relevant subfolder:

- `architecture/` for durable architecture decisions and model/runtime concepts
- `implementation/` for codebase-specific implementation notes
- `minil/` for findings from the old MINIL reference repository
- `process/` for workflow, phase execution, testing, and review practices
- `project/` for repository boundaries, setup, and project-level facts

When adding a new learning document, update this index with when future agents should read it.

## Current Learning Documents

- `project/repository-boundaries.md`: read before any task that touches paths, setup, repository structure, or MINIL.
- `process/phase-execution.md`: read before executing a phase or updating phase documents.
- `process/testing-expectations.md`: read before code implementation or verification work.
- `minil/repository-audit.md`: read before comparing ADL with MINIL, reusing MINIL concepts, or designing parser/model/validator/runtime-test behaviour informed by MINIL.
- `architecture/resolved-model-defaults.md`: read before changing model resolution, model validation, policy evaluation, storage metadata, or runtime record handling.
- `architecture/business-contexts-and-backends.md`: read before changing business context/scope modelling, context-scoped roles, relationship-aware policies, cross-context views, read models, sync dataset design, or backend persistence assumptions.
- `implementation/model-validator.md`: read before changing resolved-model validation, validation diagnostics, parser validation integration, or runtime model startup checks.
- `implementation/adl-parser.md`: read before changing ADL lexer/parser syntax, AST conversion, `compileAdl`, parser examples, or parsed policy/theme behaviour.
- `implementation/runtime-services.md`: read before changing runtime services, UI runtime integration, lifecycle execution, audit, operation log handling, or runtime tests.
- `implementation/storage-backend.md`: read before changing runtime persistence, object storage backends, browser demo seeding, sync replay storage, or persisted record tests.
- `implementation/model-versioning-guard.md`: read before changing runtime startup compatibility checks, persisted application metadata, object schema version guards, or future migration handling.
- `implementation/business-context-model.md`: read before changing business context, object scope, view context, or read-model resolution and validation.
- `implementation/browser-ui-runtime.md`: read before changing browser UI runtime components, browser demo fixtures, UI policy presentation, or browser verification.
- `implementation/policy-engine.md`: read before changing policy evaluation, runtime record returns, UI policy presentation, lifecycle action visibility, or tests that assert policy-shaped output.
- `implementation/sync-policy.md`: read before changing object sync modes, runtime write gating, sync queue behavior, operation-log replay, or UI sync-state presentation.
- `implementation/theme-system.md`: read before changing resolved theme tokens, theme resolution, UI CSS custom properties, or parser support for `THEME`.
