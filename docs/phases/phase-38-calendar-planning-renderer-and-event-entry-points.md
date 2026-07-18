# Phase 38 - Calendar Planning Renderer and Event Entry Points

## Objective

Add a generic month-calendar planning renderer while treating the calendar as one
event entry point, not the only or primary event authoring surface.

The compact home feed remains the better default for "what is coming up?"
workflows. The calendar is useful for spatial planning, conflict scanning, and
date-prefilled creation.

## Scope

Implement calendar planning presentation:

- Month grid renderer with configurable week start and date range.
- Status and legend integration from Phase 36.
- Event/count/conflict cell summaries from read-model data.
- Month navigation and deterministic date handling.
- Cell actions such as "add event on this date" or "view events on this date".
- Multiple-event selection behavior for crowded dates.
- Integration with Phase 32 view/global actions so "Add Event" can also appear
  from home, list, nav, or shell surfaces.
- Reference app updates showing home/dashboard quick action plus calendar cell
  action without duplicating event form logic.

This phase should not replace compact feeds with calendars. It should make the
calendar a planning view over the same business model and commands.

## Design Constraints

- Calendar cells consume read-model/runtime output, not app-specific data fetches.
- Calendar rendering must use semantic status data rather than hard-coded colors.
- Event creation must route through the same command/form path as other entry
  points.
- The calendar should remain optional. A list/feed-only app must still be valid.
- Mobile behavior must avoid dense desktop-only grids where a list or agenda view
  is more usable.
- Reuse Phase 37 date/status/action patterns where useful, but keep calendars as
  a distinct month-planning presentation shape rather than overloading
  resource/date matrices.

## Expected Deliverables

- Resolved presentation support for calendar month views.
- Runtime evaluation for calendar cell data and navigation state.
- Browser calendar renderer with legends, cell summaries, and actions.
- Shared event create/edit flow usable from home quick action, nav/list action,
  and date-prefilled calendar cell action.
- Tests for month layout, statuses, conflicts, multiple events, action dispatch,
  and mobile fallback/constraints.
- Documentation updates describing calendar as a planning renderer.

## Acceptance Criteria

- A calendar view can render a month grid from model/read-model data.
- Dates with events, rehearsals, unavailability, and conflicts resolve semantic
  statuses and legend entries.
- Clicking an empty permitted date can open a date-prefilled create flow.
- Clicking a date with multiple events can open a selection/details flow.
- The same event create/edit command/form path is available from non-calendar
  actions such as the home dashboard.
- Calendar rendering does not become required for apps that only need compact
  feeds or lists.
- Mobile viewport behavior is tested and usable.
- Browser visual smoke verification captures and checks every Giggle Band app
  page at desktop and mobile widths before push.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-32-action-placement-and-command-aware-controls.md, docs/phases/phase-35-command-backed-multi-table-actions.md, docs/phases/phase-36-semantic-status-and-legends.md, docs/phases/phase-37-availability-resource-matrix-and-range-editing.md, learnings/implementation/read-model-runtime.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/browser-ui-runtime.md, and docs/phases/phase-38-calendar-planning-renderer-and-event-entry-points.md as the source of truth.

Execute Phase 38 only. Add a generic calendar month planning renderer with semantic statuses, legends, month navigation, cell summaries, multiple-event selection, and date-prefilled actions. Reuse the same event create/edit flow from home/list/nav actions and calendar cell actions. Do not make calendar the required primary event UI. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory date formatting, read-model, action, status, and browser rendering
   support from earlier phases.
2. Design calendar month declarations and resolved runtime output.
3. Add validation for calendar source fields, status mappings, date fields, and
   cell actions.
4. Implement runtime calendar evaluation and month navigation state.
5. Implement browser calendar rendering with semantic statuses and legends.
6. Wire cell actions to shared create/edit command/form flows.
7. Add non-calendar event entry points to the reference app where appropriate.
8. Add tests for layout, statuses, conflicts, multiple events, action dispatch,
   and mobile behavior.
9. Update docs and learnings as needed.
10. Run typecheck, full tests, format check, build, and Playwright visual smoke
    screenshots through `npm run verify:push`.
11. Commit all repository changes for the phase and push the current branch.
