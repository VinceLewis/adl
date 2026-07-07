# MINIL Repository Audit Learning

Read this before tasks that compare ADL with old MINIL, design ADL parser/model/validator concepts, or consider reusing MINIL implementation code.

## Key findings

- MINIL is a Dart/Melos monorepo with `minil_core`, `minil_cli`, `minil_lsp`, `minil_runtime`, and `minil_test`.
- Treat MINIL as prior art only. Do not copy its source tree, generated apps, build system, or Flutter runtime into ADL.
- Reusable concepts include keyword-first syntax, explicit `END.*` blocks, source spans, structured diagnostics, schema/auth registries, immutable AST nodes, role/group-role ideas, lifecycle/workflow examples, and `.test.minil` acceptance-test patterns.
- Reusable model vocabulary includes object/file, field/column, business key, display field, lookup/relationship, required/default/validation, auto ID, ownership, roles, views, lifecycle states/actions, and offline/sync declarations.
- Discard or quarantine the old main path: Dart/Flutter emitters, generated UI/app code, SQL/CouchDB emitters as the primary architecture, procedural modules, `DART.INLINE`, and `SQL.INTO`.
- ADL should reimplement any small helper ideas, such as deterministic name conversion, in TypeScript rather than importing MINIL packages.

## Practical guidance

- Start ADL phases from `ResolvedApplicationModel`, not parser syntax.
- Keep runtime enforcement in services, not generated UI code.
- Make defaults explicit and inspectable in resolved output.
- Use MINIL examples and tests later as behavioural fixtures, not dependencies.
- Preserve the repository boundary: ADL lives at `/home/vince/projects/personal/adl`; MINIL remains read-only at `/home/vince/projects/personal/minil`.
