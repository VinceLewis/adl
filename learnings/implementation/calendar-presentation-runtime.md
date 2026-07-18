# Calendar Presentation Runtime

Read this before changing calendar month planning views, calendar cell actions,
or event-entry behavior.

## Decisions

- Calendars live under `ResolvedView.presentation.sections[].calendars`, beside
  lists and matrices. They are optional presentation shapes, not required event
  authoring surfaces.
- Calendar source rows bind through the same runtime boundaries as lists:
  object sources call policy-enforcing `search`, and read-model sources call
  `executeReadModel`.
- Month layout is deterministic and UTC-based. A calendar resolves a fixed
  month or a local state-backed month, applies a configured week start, and
  returns a stable 42-cell grid.
- Calendar cell statuses come from semantic status candidates over event rows.
  The effective cell status uses the same precedence and declaration-order
  rules as lists and matrices, while legends include statuses present on
  calendar items as well as effective cells.
- Calendar cell actions reuse `RuntimePresentationActionControl`. A create
  action opens the shared CRUD create form with resolved input as draft values;
  it does not write records directly from the calendar renderer.
- The browser renderer presents the month grid for planning and also emits an
  agenda fallback from the same evaluated cells for mobile layouts.

## Practical Guidance

- Keep compact feeds as the default "what is coming up" view. Add calendars
  when spatial planning, conflict scanning, or date-prefilled creation is useful.
- Prefer read models for cross-object or cross-context calendar facts. Object
  sources are appropriate for scoped calendars over one event object.
- Calendar actions should pass explicit date input from the cell pseudo-field
  `Date`. Other available cell action fields are `EventCount`, `HasEvents`, and
  `HasConflict`.
- Do not add app-specific data fetches to browser calendar rendering. Extend the
  resolved model and `PresentationRuntime` first.
