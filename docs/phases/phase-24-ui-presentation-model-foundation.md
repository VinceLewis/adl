# Phase 24 - UI Presentation Model Foundation

## Objective

Turn the proposed UI language addendum into a concrete resolved-model contract
for composed views, without implementing ADL syntax or browser rendering yet.

This phase establishes the runtime-facing shape for presentation declarations:
sections, local view state, controls, list bindings, row templates, icon maps,
format declarations, empty states, and layout hints. It keeps the architectural
boundary intact: runtime services consume a resolved presentation model, not ADL
parser AST nodes.

## Scope

Design and implement the resolved-model foundation for UI presentation:

- **Presentation model types.** Add JSON-compatible resolved types for composed
  views, sections, local state, controls, list presentation, row fragments,
  formatting, icon maps, empty states, layout, density, and optional shell
  declarations.
- **Partial model input shape.** Add matching partial-model structures so JSON
  fixtures and future parser output can describe the same presentation
  contract.
- **Resolution and defaults.** Resolve optional UI properties deterministically,
  including default layout, density, list render style, local state defaults,
  and row-template defaults.
- **Validation.** Validate references from presentation declarations to
  read models, objects, fields, local state, icon maps, and known fragment
  styles.
- **Specification alignment.** Promote the design portions of
  `docs/spec/ui-language-addendum.md` that become implemented behavior into
  resolved-model documentation, while keeping proposed-only syntax clearly
  marked.

This phase should not parse new ADL UI syntax and should not introduce a new
browser component implementation. Existing CRUD/list/form rendering should
continue to work unchanged.

## Design Constraints

- The resolved presentation model is the stable runtime contract. Browser UI
  components must not depend on parser AST nodes.
- UI presentation declarations are optional. Existing apps with object/list/form
  views must resolve and render as before.
- The model must remain renderer-neutral. Do not encode DOM tags, CSS selectors,
  framework component names, SVG paths, or web-only event handlers.
- Keep presentation separate from business semantics. Read models shape data;
  presentation maps that data into sections, controls, icons, text fragments,
  and formatting.
- Use deterministic defaults and validation diagnostics. Invisible UI magic
  should be inspectable in the resolved model.
- Do not add a special `Dashboard` view type unless a distinct runtime semantic
  is proven necessary. Composed views should be ordinary views with composition
  children.

## Expected Deliverables

- Resolved and partial model TypeScript types for presentation declarations.
- Resolver support for presentation defaults.
- Validator diagnostics for invalid presentation references and unsupported
  presentation values.
- Focused model-resolution and validator tests.
- Updates to `docs/spec/resolved-model.md` and
  `docs/spec/ui-language-addendum.md` describing implemented model behavior.
- Learning updates for any durable model or validation decisions.

## Acceptance Criteria

- Existing test fixtures and reference apps still resolve without adding UI
  presentation declarations.
- A JSON or TypeScript partial-model fixture can define a composed view with at
  least two sections, a local Boolean state value, a toggle, a read-model-backed
  list, an empty state, an icon map, and a row template.
- Invalid presentation references produce structured validation diagnostics,
  not runtime crashes.
- The resolved model contains explicit defaults for layout, density, list render
  style, local state defaults, and text fragment behavior.
- `npm run typecheck`, relevant model/validator tests, `npm run format:check`,
  and `npm run build` pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, learnings/implementation/browser-ui-runtime.md, learnings/implementation/model-validator.md, learnings/architecture/resolved-model-defaults.md, and docs/phases/phase-24-ui-presentation-model-foundation.md as the source of truth.

Execute Phase 24 only. Add the resolved-model and partial-model foundation for UI presentation declarations: composed view sections, local state, controls, list bindings, row templates, icon maps, formatting, empty states, layout/density hints, and optional shell declarations. Add deterministic resolution defaults and validator diagnostics for invalid references. Do not add ADL parser syntax yet and do not replace the browser renderer yet. Update the resolved-model and UI addendum docs to distinguish implemented model contract from proposed syntax. Add focused tests, run the relevant verification commands, update learnings if reusable knowledge was discovered, commit, and push.
```

## Tasks

1. Inventory current `ResolvedView` and partial-view shapes to decide whether
   presentation lives directly on views or under a separate presentation
   collection.
2. Define renderer-neutral resolved types for sections, local state, controls,
   list bindings, row fragments, icon maps, formatting, empty states, layout,
   density, and shell regions.
3. Add matching partial-model types.
4. Implement resolver defaults for omitted presentation properties.
5. Add validator checks for object, read-model, field, local-state, icon-map,
   style, and format references.
6. Add focused tests for a valid composed view and invalid references.
7. Update `docs/spec/resolved-model.md` and
   `docs/spec/ui-language-addendum.md` to reflect the implemented model layer.
8. Update `learnings/` if the phase produces reusable project knowledge.
9. Run typecheck, relevant tests, format check, and build.
10. Commit all repository changes for the phase and push the current branch.
