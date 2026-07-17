# Phase 25 - UI ADL Parser and Project Sources

## Objective

Add authored ADL syntax for the Phase 24 presentation model and prove that UI
source can live beside domain source in an app folder through `app.yaml`.

This phase makes UI presentation authorable in `.adl` files, including a
separate `ui.adl` file for the Giggle Band reference app. It should compile
through the same parser-to-partial-model-to-resolved-model pipeline as the rest
of ADL.

## Scope

Implement parser and compiler support for the first useful UI syntax subset:

- `VIEW` composition blocks with `LAYOUT` and `DENSITY` hints.
- `SECTION ... END.SECTION` with `HEADING`.
- local `STATE` declarations.
- `TOGGLE ... END.TOGGLE` controls.
- `LIST ... FROM ... END.LIST` blocks inside composed views.
- list `ORDER BY`, `WHERE`, `RENDER_AS`, `DENSITY`, and `EMPTY_TEXT`.
- `ROW ... END.ROW` templates.
- `TEXT` row fragments for literals, fields, `FORMAT`, and `STYLE bold`.
- `ICON` fragments and `ICON_MAP ... END.ICON_MAP`.
- App-folder source ordering through `app.yaml`, including `domain.adl` plus
  `ui.adl`.

This phase should not attempt to build every possible UI construct. Shell
syntax may be parsed only if the Phase 24 model contract made it clear enough;
otherwise leave it documented for a later phase.

## Design Constraints

- Extend the existing hand-written parser and AST-to-partial-model conversion.
  Do not bypass resolver or validator paths.
- Keep UI syntax declarative. Reject procedural render loops, arbitrary host
  functions, framework component names, raw CSS, and raw SVG.
- Preserve existing object/list/form view syntax and tests.
- Source files listed by `app.yaml` should remain an ordered module graph for
  one app folder. Do not introduce nested ADL implementation folders.
- Parser diagnostics should include source locations for malformed UI blocks.
- Runtime services must continue to consume resolved model data only.

## Expected Deliverables

- Parser AST nodes for the implemented UI syntax subset.
- Compiler conversion from UI AST nodes to Phase 24 partial presentation model
  declarations.
- `app.yaml`/project compiler coverage for multiple ADL source files.
- `src/reference/giggle-band/ui.adl` containing an authored draft of the home
  dashboard presentation.
- Parser/compiler tests for valid syntax and malformed UI block errors.
- Documentation updates to `docs/spec/language.md` and
  `docs/spec/ui-language-addendum.md`.
- Learning updates for parser/project-source decisions.

## Acceptance Criteria

- `compileAdlProject` compiles a manifest that lists `domain.adl` and `ui.adl`
  in order.
- A Giggle Band `ui.adl` file can declare the home composed view using sections,
  local state, toggles, lists, row templates, icon maps, formats, and empty
  states.
- Parser errors for malformed UI blocks include useful source locations.
- Existing ADL parser/compiler tests continue to pass.
- New tests prove that valid UI syntax compiles into the resolved presentation
  model produced in Phase 24.
- `npm run typecheck`, parser/compiler tests, `npm run format:check`, and
  `npm run build` pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-24-ui-presentation-model-foundation.md, learnings/implementation/adl-parser.md, learnings/implementation/reference-app-models.md, and docs/phases/phase-25-ui-adl-parser-and-project-sources.md as the source of truth.

Execute Phase 25 only. Add parser and compiler support for the initial UI ADL syntax subset: VIEW composition, SECTION, HEADING, local STATE, TOGGLE, LIST FROM, ORDER BY, WHERE, RENDER_AS, EMPTY_TEXT, ROW, TEXT fragments with FORMAT and STYLE bold, ICON fragments, and ICON_MAP. Ensure app.yaml can list domain.adl and ui.adl for the same app folder, then move the Giggle Band home presentation draft into src/reference/giggle-band/ui.adl. Do not implement browser rendering behavior in this phase beyond what is needed for tests. Update language docs and learnings, run verification, commit, and push.
```

## Tasks

1. Inventory the Phase 24 partial presentation model and existing parser block
   handling.
2. Add AST nodes and parse rules for the initial UI syntax subset.
3. Add AST-to-partial-model conversion for presentation declarations.
4. Add parser errors for unclosed or misplaced UI blocks.
5. Extend project compiler tests for ordered `app.yaml` source lists.
6. Add `src/reference/giggle-band/ui.adl` and update the manifest to include it.
7. Add parser/compiler tests for the Giggle home view syntax.
8. Update `docs/spec/language.md` and `docs/spec/ui-language-addendum.md`.
9. Update `learnings/` if the phase produces reusable project knowledge.
10. Run typecheck, relevant tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
