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

Before tasks that integrate compile-time validation, runtime model startup checks, or parser-to-model validation, also read:

- `implementation/model-validator.md`

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
- `implementation/model-validator.md`: read before changing resolved-model validation, validation diagnostics, parser validation integration, or runtime model startup checks.
