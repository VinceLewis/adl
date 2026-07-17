# Giggle Band ADL Example Review

The example app is available in the browser demo at:

```text
/?demo=giggle-band
```

It uses the same model-driven runtime as the rest of ADL. The app definition
lives in `src/reference/giggle-band/`: `app.yaml` is the app manifest and
`domain.adl` is the current ADL source listed by that manifest.
`src/reference/band-app.ts` compiles the manifest-listed ADL sources and owns
browser-demo seed data. The browser shell is generic Web Components under
`src/ui/components/`.

## Buildable Now

- Business objects for users, bands, memberships, invitations, events,
  availability, songs, set lists, ordered set-list items, streaming links, and
  device preferences.
- Band as a first-class business context with per-band `BandAdmin` and
  `BandMember` roles.
- Users belonging to multiple bands with different roles per band.
- Band-scoped authorization and filtering enforced by runtime services, not only
  by UI hiding.
- Cross-band home dashboard backed by the `HomeUpcomingEvents` read model.
- Selected-band lists and forms for events, members, invitations, songs, set
  lists, set-list items, streaming links, and band profile data.
- Plain create/update/delete event management for the current selected band.
- Availability self-service rules that require records to belong to the runtime
  user.
- Generic invitation acceptance command in the runtime model, including atomic
  update-plus-membership creation semantics.
- Scoped uniqueness constraints for membership, invitations, songs, set lists,
  availability, and streaming links.
- Ordered set-list position validation and duplicate-position rejection.
- Explicit sync modes and scopes, including local-first, online-required,
  cache-readonly, local-private, current-user, current-context, and
  all-available-context datasets.
- Local browser persistence through IndexedDB for the example route.

## Major Gaps

- There is no production server authority yet. Shared data still needs a server
  that re-checks identity, policy, validation, lifecycle legality, revisions,
  and sync replay.
- Auth is represented by seeded runtime contexts, not a real identity provider
  or login/session flow.
- Email dispatch and invitation delivery are not implemented. The invitation
  object and acceptance command exist, but sending and accepting from a
  non-member grant path remain platform work.
- The generic UI does not yet expose model-declared commands as first-class
  buttons/forms. `AcceptBandInvitation` is covered by runtime tests but not by a
  polished browser workflow.
- Availability projection into band member calendars needs reverse joins or
  multi-hop read-model sources.
- Calendar, rehearsal planning, drag reorder, mass song import, and batch
  command workflows are not built as generic UI/runtime capabilities yet.
- Ordered set lists validate positions, but do not yet have compaction or
  drag-reorder helper commands.
- Remote sync, conflict resolution, background dataset refresh, and attachment
  upload/download are still backend design work.
- The browser UI is a generic ADL CRUD/dashboard shell. It is useful as an
  example app, but not yet a product-grade Giggle-specific experience.
