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

No custom runtime hooks were added in Phase 17. The following behaviors remain platform design candidates:

- Invitation acceptance needs a transactional command that updates `BandInvitation` and creates `BandMember` atomically.
- Pending invitations for non-members need a context grant separate from membership; a band-scoped invitation is not naturally available before membership exists.
- Availability projection from user-owned records into selected-band member views needs reverse joins or multi-hop read-model sources through `BandMember`.
- Availability self-service writes need field equality conditions such as `Availability.User == runtime.userId`; the current policy engine does not evaluate conditions.
- Creating a band should be able to create the creator's `BandMember` row as an atomic command.
- Ordered set-list behavior needs model-native scoped uniqueness and reorder helpers, such as unique `(SetList, Position)` and compaction after removal.
- Scoped uniqueness is not yet modelled for cases like song title per band, set-list name per band, invitation email per band, or streaming platform per song.
- Batch commands are not modelled for mass song import, batch set-list item creation, or drag-reorder updates.
- Remote sync remains backend-neutral; a future server must provide context-scoped datasets, conflict handling, email dispatch, and authoritative policy re-checks.
