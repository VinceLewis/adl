# Phase 17 - Band App Reference

## Objective

Build the first real ADL reference application as a band-management app model and browser demo, using the multi-context features from Phases 12-16.

This should be functionally inspired by the existing Giggle band-management app, but it must be an ADL reference implementation, not a copy of Giggle code and not a nested implementation folder. The point is to prove that ADL can express the app shape: user context, selected band context, scoped roles, band-scoped data, cross-band home dashboard, local persistence, and offline-aware behaviour.

## Scope

Create ADL examples, fixtures, tests, and browser-demo wiring for a band-management reference app. Keep implementation model-driven. Add custom runtime hooks only where the current ADL model cannot yet express a required invariant, and document those gaps.

Do not modify `/home/vince/projects/personal/giggle-new`. Do not require PostgreSQL. Do not build a production auth provider, email sender, or sync server. Do not implement a specialised calendar grid unless a generic event list is proven insufficient.

## Expected Deliverables

- Band-management ADL example or JSON/TypeScript fixture
- Objects for users, bands, membership, invitations, gigs/rehearsals, availability, songs, set lists, and ordered set-list items
- Context declarations for selected band and all available bands
- Context-scoped roles for Admin and Member
- Cross-band home dashboard/read model as an event list
- Explicit sync scopes for user-level, selected-band, all-available-band, cache-readonly, and local-private datasets where the model needs them
- Local browser demo using existing ADL runtime components
- Tests for model validity and key runtime behaviours
- Gap report for behaviours still requiring hooks or future ADL features

## Acceptance Criteria

- The band app model validates.
- A user can belong to multiple bands with different roles.
- Band-scoped objects are filtered and protected by selected band context.
- Admin-only band operations are denied to non-admin members at runtime.
- Availability can be modelled as user-scoped data projected into band views.
- The home dashboard can show upcoming events across all available bands as a list.
- Offline dataset evaluation identifies the records needed for the selected-band views and the cross-band home dashboard without including online-required objects.
- Ordered set-list items are represented without bespoke application code where possible.
- The app works against local storage only.
- Any unavoidable custom hook is named, tested, and documented as a future ADL design candidate.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, docs/phases/phase-12-business-context-model.md through docs/phases/phase-16-context-aware-offline-datasets.md, and docs/phases/phase-17-band-app-reference.md as the source of truth.

Execute Phase 17 only. Build a model-driven band-management ADL reference application using multi-context support. Do not modify Giggle, do not require PostgreSQL, do not build production auth/email/sync, and do not add a specialised calendar widget unless a dense event list cannot satisfy the workflow. Before the final review, update learnings/ if required and create the next phase document only if the implementation exposes concrete missing platform work.
```

## Tasks

1. Review the existing Giggle app and docs as prior art without modifying them.
2. Define the reference app model:
   - `User`
   - `Band`
   - `BandMember`
   - `BandInvitation`
   - `Event` or `Gig` with `eventType`
   - `Availability`
   - `Song`
   - `SetList`
   - `SetListItem`
   - optional `StreamingLink`
3. Declare `Band` as a business context.
4. Declare membership and context-scoped roles.
5. Scope band-owned objects by `Band`.
6. Declare object sync scopes using Phase 16 dataset semantics:
   - user/profile data as `currentUser`
   - selected-band operational data as `currentContext`
   - home-dashboard sources as `allAvailableContexts`
   - reference/cache objects as `cacheReadonly` where appropriate
   - device-only preferences as `localPrivate`
7. Model cross-band home dashboard/read model as a date-sorted event list.
8. Model availability as user-owned data projected into band views where practical.
9. Model ordered set-list items with position constraints or document the missing constraint/action support.
10. Add model validation tests and runtime tests for context-scoped authorization and `evaluateOfflineDataset` / `searchLocalDataset` behavior.
11. Add or update browser demo routing/fixtures for the band app.
12. Document gaps such as batch commands, transactional workflows, ordered relation helpers, invitation accept semantics, and future remote sync needs.
13. Run typecheck, tests, and build.
14. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
15. Review what happened and create a follow-up phase document only for concrete missing ADL platform work discovered while building the reference app.
16. Commit all repository changes for this phase and push the current branch.
