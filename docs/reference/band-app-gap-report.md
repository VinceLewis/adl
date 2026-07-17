# Band Reference App Gap Report

Phase 17 added a model-driven band-management reference app in `src/reference/band-app.ts`.

The browser demo is available through the existing Vite app with:

```text
/?demo=band
```

It runs against the existing local runtime and IndexedDB storage. It does not require Giggle, PostgreSQL, an auth provider, an email sender, or a sync server.

## What The Model Proves

- `Band` is a first-class business context.
- `BandMember` resolves context-scoped `BandAdmin` and `BandMember` roles.
- A user can be an admin in one band and a member in another.
- `Event` models gigs and rehearsals with `EventType`.
- The cross-band home dashboard uses `HomeUpcomingEvents`, an all-available-context read model over `Event` joined to `Band`.
- Band-scoped objects are protected by runtime context scope and context-role policy checks.
- `Availability` is user-owned data with a `currentUser` offline scope.
- `SetListItem` represents ordered set-list entries with a positive `Position` field.
- Sync modes and scopes are explicit:
  - `currentUser`: `User`, `Availability`, `DevicePreference`
  - `currentContext`: `BandInvitation`, `Event`, `Song`, `SetList`, `SetListItem`, `StreamingLink`
  - `allAvailableContexts`: `Band`, `BandMember`
  - `onlineRequired`: `BandInvitation`
  - `cacheReadonly`: `StreamingLink`
  - `localPrivate`: `DevicePreference`

## Documented Gaps

Phase 18 promoted several Phase 17 gaps into generic model/runtime capabilities:

- Availability self-service policies now use model-declared field equality conditions, such as `Availability.User == runtime.userId`, enforced by the runtime policy engine.
- `AcceptBandInvitation` is represented as a generic command transaction that updates `BandInvitation` and creates `BandMember` without an app-specific hook.
- Scoped uniqueness is modelled with backend-neutral object constraints for cases such as song title per band, set-list name per band, invitation email per band, member per band, and streaming platform per song.
- Ordered set-list positions are modelled with a generic ordered object constraint that enforces positive integer positions and prevents duplicate positions within a set list.
- `BandInvitation` now uses a generic object-level validation to require `RespondedAt` whenever an invitation has been accepted or declined.

The following behaviors remain platform design candidates:

- Pending invitations for non-members still need a context grant separate from membership; the command currently requires the caller to supply the invitation's band context.
- Availability projection from user-owned records into selected-band member views still needs reverse joins or multi-hop read-model sources through `BandMember`.
- Band creation can now be described as a command pattern, but creating the new context and its initial membership in one command needs a command-created context grant or equivalent scoped-write model.
- Ordered set-list behavior still needs generic reorder helpers and compaction after removal.
- Batch commands are not modelled for mass song import, batch set-list item creation, or drag-reorder updates.
- Remote sync remains backend-neutral; a future server must provide context-scoped datasets, conflict handling, email dispatch, and authoritative policy re-checks.
