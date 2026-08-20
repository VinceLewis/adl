# Calendar Presentation Runtime

Read this before changing calendar month planning views, calendar cell actions,
or event-entry behavior.

**Where the code is (Phase 90).** Calendar evaluation is no longer in a single
`presentation-runtime.ts`. The month arithmetic — the fixed 42-cell grid,
week start, navigation bounds, per-date row grouping, status counting and
precedence — is `src/runtime/presentation-runtime/calendar-grid.ts`; the
runtime methods that use it (`evaluateCalendar`, `resolveConflictOverlay`,
`bindCalendarRows`, `evaluateCalendarCell`, `evaluateCalendarItem`) are
`src/runtime/presentation-runtime/calendar-runtime.ts`. Every name below still
exists with the same name and body — see [[presentation-runtime-file-map]] for
the full map and the chain-ordering rule you must respect when adding one.

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
- Calendar item clicks may open records from a different object than the
  calendar's owning view, such as an Availability row inside an Event calendar.
  The browser app must preserve the current presentation view as the return
  surface and target only the edit form at the clicked record's object.

## A calendar's own `source` can show independent facts, never correlate them — `conflictOverlay` is the escape hatch

`BandEventCalendar`'s `conflict` status was declared (a `STATUS`, a `STATUS_MAP`
entry, a `LEGEND` entry, `PRECEDENCE 100`) but structurally unreachable: its
backing read model, `CalendarPlanningItems`, is a `UNION` of an `event` source
and an `availability` source, so every row comes from exactly one of the two
and no row can ever see whether the *other* source also has a matching record
for the same date. Fixing "a gig is booked and someone separately marked
themselves unavailable that same date" needs a real correlation — a `JOIN` —
and ADL's read-model grammar refuses a `JOIN` on any source of a `UNION`
read model (`ADL_READ_MODEL_JOIN_STRATEGY_INVALID`).

Switching `CalendarPlanningItems` itself to a `JOIN`-strategy read model does
not work either: a declared join in this codebase is an **inner** join
regardless of `CARDINALITY` — `applyDeclaredJoinedSource`
(`read-model-service.ts`) drops every partial row whose join produced zero
matches, for both `one` and `many` — so making `Event` the join's driving
side would silently delete every ordinary gig with no availability note that
date (the overwhelming majority), and making `Availability` the driving side
would delete every gig with no availability note the other way around. A
`UNION` and a `JOIN` cannot be combined in one read model, and neither
direction of a plain join can reproduce "show every independent fact,
correlate only where both exist."

The fix is a **second, purpose-built join-based read model**
(`EventAvailabilityConflicts` in `domain.adlj`) whose only job is naming the
correlated dates — because the join is inner, its rows are *already* exactly
the dates where both facts coincide, no extra filtering needed for the
correlation itself, only for narrowing "any coincidence" down to "a genuine
conflict" (`IsConflict: EventType == 'Gig' and AvailabilityStatus ==
'Unavailable'`, since a gig coinciding with someone merely *available* is not
a conflict). `CalendarPlanningItems` stays completely unchanged, still
showing every individual gig/rehearsal/unavailable row exactly as before.

Getting that second read model's rows onto the *same* calendar grid — not a
second, visually separate month widget — needed one small, generic platform
addition: `ResolvedPresentationCalendar.conflictOverlay`
(`{ readModel, dateField, flagField, status }`,
`src/model/resolved-model/presentation-calendar.ts`). `PresentationRuntime.evaluateCalendar`
executes that read model independently of the calendar's own `source`,
reduces it to the set of dates with `flagField: true`, and
`evaluateCalendarCell` pushes one synthetic `RuntimePresentationCalendarItem`
(no backing record — `sources: []`) for the overlay's declared `status` into
each matching cell's own `items`, *before* `statusCounts`/`hasConflict`/the
max-precedence `chooseEffectiveStatus` run. That is the whole trick: it
participates in every piece of existing cell-aggregation logic as an
ordinary item, so nothing about precedence, `HasConflict`, the legend, or
the mobile agenda fallback needed touching. `adl-composed-view.ts`'s
`renderCalendarItem` already renders a sourceless item as a plain,
non-interactive `<div>` rather than a clickable record button — that
fallback already existed and needed no change either.

`conflictOverlay` was `.adlj`/JSON-only when Phase 86 added it, the same
treatment as `MATRIX`. **Phase 100 gave it text syntax**, because `.adl` text
is the printed view of `.adlj` and an unprintable construct made the flagship
reference application unprintable in full:

```adl
CONFLICT_OVERLAY FROM READ_MODEL EventAvailabilityConflicts
  DATE_FIELD Date
  FLAG_FIELD IsConflict
  STATUS conflict
END.CONFLICT_OVERLAY
```

Block form with a `FROM READ_MODEL` header, inside `CALENDAR ... END.CALENDAR`.
All four parts are required, because
`ResolvedPresentationCalendarConflictOverlay` declares none of them optional —
an incomplete block is a parse failure rather than a partial model no resolver
can complete. `FROM READ_MODEL` is spelled out even though a read model is the
only thing an overlay can bind to: the whole point of the construct is that it
is a *second* read model, distinct from the calendar's own `source` on the line
above. See `docs/spec/language.md`'s Calendars section.

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
