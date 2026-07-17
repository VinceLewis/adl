# Phase 27 - Browser Composed View Renderer

## Objective

Render composed presentation views in the generic browser UI using the Phase 26
presentation runtime output.

This phase turns renderer-neutral presentation data into a usable browser
experience: sections, headings, compact feed lists, toggles, semantic icons,
inline formatted fragments, bold text, empty states, and shell/top-bar behavior
where supported.

## Scope

Extend the existing native Web Component UI runtime to render composed views:

- Detect when a selected view has composed presentation content.
- Render sections and headings.
- Render view-local toggles and update local state.
- Render compact feed lists from evaluated presentation rows.
- Render text fragments, formatted values, and bold fragments.
- Render semantic icons through a small browser icon mapping.
- Render empty states.
- Preserve existing CRUD list/form navigation for normal object views.
- Support a basic app shell/top bar if the Phase 24-26 model/runtime contract
  includes shell declarations; otherwise keep shell rendering as a documented
  follow-up.

## Design Constraints

- Keep components generic over resolved presentation data. Do not hard-code
  Giggle Band object names or row layouts in browser components.
- Do not introduce a frontend framework dependency unless the phase explicitly
  proves the native Web Component path cannot reasonably handle the renderer.
- Icons should use semantic names from the resolved model. Avoid raw SVG in ADL
  source.
- UI state changes should not write object-store records unless explicitly bound
  to a persistent model action.
- Presentation output must remain policy-shaped. Do not fetch hidden or denied
  records directly from UI components to work around runtime services.
- Keep text and controls responsive across desktop and mobile widths.

## Expected Deliverables

- Browser components or component extensions for composed views.
- CSS for compact sections, toggle rows, compact feeds, icons, inline fragments,
  and empty states.
- UI tests for composed view rendering and toggle interaction.
- Browser demo route coverage for the Giggle Band app.
- Screenshot/manual verification notes for the local browser demo if automated
  screenshots are not yet available.
- Learning updates for browser rendering behavior.

## Acceptance Criteria

- `/?demo=giggle-band` renders the Giggle home view through generic composed
  view support, not app-specific DOM code.
- The view shows Welcome, filter toggles, Schedule, and Invitations sections.
- Schedule rows display semantic event icons, formatted dates/times, band name,
  bold event title, and compact feed spacing.
- Toggle changes immediately filter visible Schedule rows.
- Empty invitation state displays `No pending invitations`.
- Existing CRUD/list/form screens still render and operate.
- `npm run typecheck`, relevant UI tests, `npm run format:check`, and
  `npm run build` pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-26-ui-presentation-runtime-evaluation.md, learnings/implementation/browser-ui-runtime.md, learnings/implementation/context-ui-navigation.md, and docs/phases/phase-27-browser-composed-view-renderer.md as the source of truth.

Execute Phase 27 only. Extend the generic browser UI runtime to render composed presentation views from the presentation evaluator output. Add generic rendering for sections, headings, local toggles, compact feed lists, semantic icons, inline text fragments, bold fragments, formatted values, and empty states. Do not hard-code Giggle-specific DOM or introduce a frontend framework. Preserve existing CRUD list/form behavior. Add UI tests, verify the Giggle demo route, update learnings, run verification, commit, and push.
```

## Tasks

1. Inventory current `adl-app`, list, form, and field-renderer component
   boundaries.
2. Add composed-view rendering entry points that consume Phase 26 output.
3. Render sections, headings, controls, lists, rows, fragments, icons, and empty
   states generically.
4. Wire toggle events to local presentation state updates and re-evaluation.
5. Add CSS for compact feed dashboard presentation without breaking existing
   CRUD screens.
6. Add UI tests for rendering and toggle interaction.
7. Verify the Giggle Band browser route locally.
8. Update `learnings/` if the phase produces reusable project knowledge.
9. Run typecheck, relevant tests, format check, and build.
10. Commit all repository changes for the phase and push the current branch.
