# Notes from MINIL

Phase 0 audit of `/home/vince/projects/personal/minil` as read-only prior art for the standalone ADL implementation in `/home/vince/projects/personal/adl`.

## Repository shape

The current ADL repository is intentionally small. At phase 0 it contains the implementation brief, phase documents under `docs/phases/`, and project/process learnings under `learnings/`. There is no nested `adl/` implementation directory.

MINIL is a Dart/Melos workspace. Its root `pubspec.yaml` defines these packages:

- `packages/minil_core`: lexer, parser, AST, validators, schema/auth registries, and emitters.
- `packages/minil_cli`: build, test, migration, and deployment commands.
- `packages/minil_lsp`: VS Code/LSP services.
- `packages/minil_runtime`: Flutter runtime, app shell, panel configs, data bridge, auth, offline, workflow, and theme support.
- `packages/minil_test`: `.test.minil` parser, seeding, expectation checking, and test runner.

Other important MINIL areas:

- `minil-spec.md`: broad language and architecture specification.
- `implementation_plan/`: prior phased plans and test scripts.
- `constraints/` and `specs/`: design constraints and feature templates.
- `example/`, `example_postgres/`, and `giggle/`: source `.minil` applications and tests.
- `example_app/`, `example_postgres_app/`, and `giggle_app/`: generated Flutter application outputs.
- `vscode_minil/`: VS Code extension artefacts.

The old MINIL flow is broadly:

```text
MINIL source -> lexer/parser AST -> validators/registries -> emitters/build tooling -> generated Dart/Flutter, SQL, CouchDB, migrations, runtime config
```

ADL must keep the useful language/runtime lessons without inheriting that transpiler-first shape.

## Reusable concepts

- Keyword-first syntax and explicit block endings make authored files readable and parser recovery simpler.
- Source spans and structured diagnostics are worth preserving for parser, validator, and later LSP work.
- Schema concepts map well to ADL model concepts: `FILE` to `OBJECT`, `COLUMN` to `FIELD`, `KEY` to business key, `LOOKUP` to relationship, `REQUIRED` and `DEFAULT` to field constraints/defaults, and `VALIDATE` to validators.
- MINIL's implicit `_guid` in table creation is directly relevant. ADL should model immutable system identity separately from business keys and display fields.
- The type vocabulary is useful: text, number, date, date with time, time, boolean, and attachment.
- UI layout concepts such as list, detail, form, dashboard, master/detail, composite, grid, and calendar are useful as runtime-rendered view kinds.
- Workflow ideas are reusable at the conceptual level: state machines, state entry behaviour, events, role guards, terminal states, and timeouts. ADL should reframe these as object lifecycles and actions rather than procedural workflow modules.
- Auth/access ideas are useful background: platform roles, group roles, inherited roles, ownership, and `READ/WRITE/DELETE` with `OWN/ANY`. ADL needs a finer runtime policy model covering rows, fields, states, actions, and channels.
- Offline declarations and CouchDB topology work expose useful sync concerns, but ADL should express sync as object policy, not as a global database-emitter decision.
- The `.test.minil` structure is a good acceptance-test concept: `GIVEN`, `RUN`, `FIRE.EVENT`, `EXPECT`, and `ASSERT`.
- Registry patterns are useful: schema/auth lookup maps built from parsed declarations make validation and runtime resolution deterministic.
- Naming/default helpers, such as dot-name to snake-case conversion, are small enough to reimplement in TypeScript where needed.

## Reusable code or tests

No MINIL source tree should be copied into ADL. MINIL is Dart and strongly tied to Melos, Flutter, generated application output, and the old AST/emitter contracts.

Potentially reusable as behavioural references:

- `packages/minil_core/lib/src/diagnostics.dart`: diagnostic severity and source-span shape.
- `packages/minil_core/lib/src/lexer.dart`, `parser.dart`, and parser part files: recursive-descent parser organisation and error recovery patterns.
- `packages/minil_core/lib/src/ast*.dart`: immutable model-node style and domain separation.
- `packages/minil_core/lib/src/schema_registry.dart` and `auth_registry.dart`: registry construction, implicit user defaults, and role inheritance resolution.
- `packages/minil_core/lib/src/emitter/naming.dart`: simple name-normalisation behaviour to reimplement if ADL needs storage-name defaults.
- `packages/minil_core/test/` parser, validator, schema, workflow, auth, offline, and emitter tests: examples of edge cases and expected behaviour.
- `packages/minil_test/`: acceptance-test grammar ideas and test-runner concepts.
- `example/schema.minil`, `example/order-workflow.minil`, and `example/tests/*.test.minil`: compact business-app fixtures.
- `giggle/schema.minil` and `giggle/tests/*.test.minil`: larger real-app fixtures for later parser/importer tests.

Emitter, migration, and runtime tests can inform expected behaviour, but should not become ADL dependencies.

## Discarded code and why

- MINIL's Melos/Dart/Flutter workspace should not be reused. ADL starts as a standalone TypeScript runtime project.
- `DartEmitter`, `PanelEmitter`, `AppEmitter`, generated Flutter app entry points, and generated panel configs are the old primary architecture. ADL's runtime must consume a resolved model instead.
- Flutter runtime widgets in `packages/minil_runtime` are prior art only. ADL's initial browser runtime should be framework-light TypeScript/Web Components or similar, not Flutter.
- Generated app directories such as `example_app/`, `example_postgres_app/`, and `giggle_app/` should not be copied.
- Procedural authoring constructs such as `FETCH`, `STORE`, `LOOP`, `SET`, `CHECK`, `REPEAT`, `TRANSACTION`, `DART.INLINE`, and `SQL.INTO` should not drive the ADL MVP. They are implementation-level or escape-hatch concepts.
- SQL, CouchDB, and migration emitters should not shape phase 1. Storage details can be revisited behind runtime abstractions after the model is stable.
- LSP and VS Code extension code is deferred. Parser and diagnostics must come first.
- CouchDB placement/security emitters are useful evidence of sync/auth complexity, but ADL's early sync model should stay object-policy-first.

## Risks and unknowns

- MINIL dot notation and storage-name conversion had edge cases, especially `@FILE.COLUMN` splitting where both file and column names may contain dots. ADL should choose predictable names and avoid ambiguous references in the resolved model.
- MINIL's access rules are too coarse for ADL. Reusing them directly would miss field-level, state-specific, action-specific, and channel-specific enforcement.
- MINIL workflows update row state through procedural side effects. ADL lifecycle transitions must be first-class runtime operations with policy, validation, audit, and operation-log semantics.
- MINIL defaults are sometimes embedded in emitters or registries. ADL defaults must be explicit in the resolved model and explainable.
- MINIL offline support mixes source declarations, generated config, database topology, and runtime bridge behaviour. ADL should avoid baking storage topology into the model too early.
- Generated UI config accumulated many behaviours. ADL phase 1 should resist importing all view surface area before the core resolved model is stable.
- The `.test.minil` pattern is useful, but it is procedural-module oriented. ADL tests should target resolved model and runtime operations first.
- The MINIL repository contains build artefacts, generated applications, and VCS internals. Future audits should focus on source, specs, examples, and tests.

## Recommendations for Phase 1

- Define `ResolvedApplicationModel` first as a JSON-compatible TypeScript contract.
- Include `modelVersion`, object `schemaVersion`, immutable system identity, business key, display field, platform metadata, lifecycle, policies, views, themes, sync policy, audit concepts, and operation-log concepts.
- Keep parser AST and runtime model separate from the start.
- Make deterministic defaults explicit in resolved output: `_guid`, table/storage names, metadata fields, default sync mode, default views, and default deny policy.
- Reimplement any small naming/default helpers in TypeScript; do not import MINIL packages.
- Add focused tests around hardcoded partial models and deterministic resolution before introducing ADL text syntax.
- Use MINIL examples as later behavioural fixtures, not as dependencies or copied implementation.
