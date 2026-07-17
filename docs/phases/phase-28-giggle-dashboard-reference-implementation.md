# Phase 28 - Giggle Dashboard Reference Implementation

## Objective

Use the UI presentation language and generic renderer to make the Giggle Band
home dashboard closely match the real Giggle dashboard screenshot, while keeping
the implementation model-driven and reusable.

This phase is the reference-app proving ground. Any gap discovered here should
either be solved generically in the platform or documented as a future platform
gap. It should not introduce app-specific browser components for Giggle.

## Scope

Complete the Giggle Band dashboard as an authored ADL example:

- Refine `src/reference/giggle-band/ui.adl` for the home dashboard.
- Ensure the supporting read models expose the data needed for dashboard rows.
- Seed representative events and invitations for visual verification.
- Configure the app start view to the authored home view.
- Align the browser output with the screenshot-level target:
  - blue top app bar
  - left menu action
  - centered band/app title
  - right band selector or equivalent context selector
  - `Welcome Back!`
  - inline Gigs/Rehearsals/Unavailable toggles with icons
  - compact Schedule section
  - compact Invitation section with empty state
  - event type icons
  - formatted date and time
  - bold event title

## Design Constraints

- Do not hard-code Giggle row layout, event type icon rules, or dashboard
  sections in TypeScript. They must come from the authored UI ADL and resolved
  presentation model.
- If a needed construct is missing, prefer adding a generic platform capability
  in the smallest safe scope rather than adding an app-specific workaround.
- Keep business data in domain/read-model declarations. Keep presentation
  choices in UI declarations.
- The target is "very similar" to the screenshot, not pixel-perfect cloning.
  Preserve generic renderer quality and responsiveness over brittle coordinates.
- Existing CRUD screens for Giggle should remain available for management tasks.

## Expected Deliverables

- A completed Giggle Band `ui.adl` home dashboard.
- Any required read-model refinements in Giggle ADL source.
- Seed data that makes the dashboard visually meaningful in the demo.
- Browser UI refinements needed for screenshot-level similarity.
- Tests proving the dashboard is authored through ADL and rendered generically.
- Documentation updates to `docs/reference/giggle-band-adl-example.md`.
- A gap report update if any screenshot behavior remains unsupported.

## Acceptance Criteria

- Running `/?demo=giggle-band` opens on the authored Giggle home dashboard.
- The dashboard is rendered from ADL/project manifest input through parser,
  compiler, resolved model, presentation runtime, and generic browser renderer.
- The visible layout contains the expected shell/top-bar, welcome heading,
  toggles, schedule feed, and invitation empty state.
- Seeded schedule rows show at least three ordered events with the expected
  icon, formatted date/time, band name, bold title, and venue/time text.
- The left-side toggles can show and hide relevant event types.
- No Giggle-specific DOM component or TypeScript rendering branch is added.
- Existing tests pass, and a browser build succeeds.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-27-browser-composed-view-renderer.md, learnings/implementation/reference-app-models.md, learnings/implementation/browser-ui-runtime.md, and docs/phases/phase-28-giggle-dashboard-reference-implementation.md as the source of truth.

Execute Phase 28 only. Complete the Giggle Band home dashboard as an authored UI ADL example in src/reference/giggle-band/ui.adl, with supporting read-model/source refinements as needed. Make /?demo=giggle-band open on the authored home view and look very similar to the provided real Giggle dashboard screenshot: app bar, menu action, title/context selector, Welcome Back, event-type toggles, compact Schedule feed, event icons, formatted dates/times, bold title, and Invitations empty state. Keep the renderer generic and avoid Giggle-specific UI code. Add tests, update docs/gap notes and learnings, run verification, commit, and push.
```

## Tasks

1. Compare the real dashboard screenshot against the current generic Giggle demo.
2. Refine Giggle read models and UI ADL to supply the needed dashboard data and
   presentation declarations.
3. Configure the app start view and demo fixture to open on the home dashboard.
4. Add or adjust seed data for representative gigs, rehearsals, unavailable
   rows, and empty invitations.
5. Polish generic renderer styling only where the change benefits composed
   views broadly.
6. Add tests proving the dashboard source path is ADL-driven and generic.
7. Update `docs/reference/giggle-band-adl-example.md` and any gap report.
8. Update `learnings/` if the phase produces reusable project knowledge.
9. Run typecheck, relevant tests, format check, and build.
10. Commit all repository changes for the phase and push the current branch.
