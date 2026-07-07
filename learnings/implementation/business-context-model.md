# Business Context Model Implementation

Read this before changing business context, object scope, view context, or read-model resolution and validation.

## Key decisions from Phase 12

- Business contexts and read models are available through `PartialApplicationModel` and `ResolvedApplicationModel`; Phase 12 intentionally did not add textual ADL parser syntax.
- Context and read-model top-level properties are optional and are omitted by `resolveApplicationModel` unless the partial model declares them. This keeps existing MVP resolved JSON unchanged for models that do not use contexts.
- A business context names a context object and may name one membership object. Context object defaults to the context name.
- Context selection is declarative only. The resolved model currently records `selection.mode` as `required` or `optional`; runtime selection, persistence, and UI affordances remain later work.
- Membership validation checks that the membership object exists, that user/context/role fields exist, that the membership context field looks up the context object, and that the membership role field is text.
- Object scope validation checks that scoped objects name a known context and that their scope field looks up the context object.
- View context modes are `none`, `required`, `optional`, and `all`. Modes other than `none` must name a known business context.
- Read models are backend-neutral declarations with named object sources and named output fields. They do not embed SQL, materialisation strategy, or execution behavior.
- Read-model source aliases default to the source object name. Output field types are inferred only when the output field directly references a known source field.

## Practical guidance

- Use TypeScript or JSON partial-model fixtures for context work until a later parser phase defines textual syntax.
- Runtime phases should consume `ResolvedApplicationModel.contexts`, object `scope`, view `context`, and `readModels` only as resolved-model declarations.
- Do not implement read-model execution while adding context authorization; Phase 15 owns query behavior and dashboard rendering.
