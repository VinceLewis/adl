# Reference App Models

Read this before adding or changing ADL reference applications, especially multi-context examples that exercise runtime policy, read models, offline datasets, or browser demo fixtures.

## Key decisions from Phase 17

- Reference apps should live in source-level fixtures, such as `src/reference/band-app.ts`, when browser code needs to import them. Test-only fixtures are still useful for narrow unit tests, but browser demos should not import from `tests/`.
- The band reference app uses the existing generic browser runtime. The local demo is selected with `/?demo=band` and uses IndexedDB through the existing storage backend.
- Context-role policies can match only when the target is a context object record or an object with an explicit `scope` field. Band-admin operations on objects such as invitations and set-list items need a `Band` lookup scope field.
- Current read models are primary-source plus lookup joins. Cross-band event feeds should use one primary `Event` object with an `EventType` field rather than separate `Gig` and `Rehearsal` primary sources.
- Offline dataset membership is separate from authorization. Phase 17 tests use both `evaluateOfflineDataset(...)` and `searchLocalDataset(...)` to prove that dataset selection and policy-shaped reads both work.
- `onlineRequired` objects are excluded from offline datasets. The band reference app models invitations as online-required because email dispatch and invitation acceptance need future remote/transaction support.
- Ordered set-list items are currently represented with a positive numeric `Position` field. Uniqueness, compaction, and batch reordering remain future generic platform work.

## Key decisions from Phase 18

- The band reference app now uses structured field equality policy conditions for user-owned `Availability` writes. Tests should assert direct runtime denials when `Availability.User` differs from `RuntimeContext.userId`.
- Invitation acceptance is represented by the generic `AcceptBandInvitation` command. It updates the invitation and creates membership through the runtime command service rather than a fixture-specific hook.
- The command-created `BandMember` write uses command authority, so direct non-admin membership creation remains denied while the command can complete after its invitation preconditions pass.
- The band fixture uses backend-neutral object constraints for scoped uniqueness and ordered positions: member per band, invitation email per band, availability date per user, song title per band, set-list name per band, streaming platform per song, and set-list item position per set list.
- Ordered set-list constraints now enforce positive integer positions and duplicate-position denial. Reorder/compaction behavior remains future generic command/helper work.

## Key decisions after the Giggle Band ADL conversion

- The band reference app is now a folder app under
  `src/reference/giggle-band/`. `app.yaml` lists the ADL source files and
  `domain.adl` currently holds the authored model. `src/reference/band-app.ts`
  remains the browser/runtime integration module and seed fixture, but the
  application definition is no longer a handwritten TypeScript partial model.
- Parser/compiler coverage for contexts, object scopes, constraints,
  view/read-model contexts, and read-model-backed views should be maintained
  with the Giggle Band compile test in `tests/compile-adl.test.ts`.

## Practical guidance

- Avoid app-specific runtime hooks in reference apps unless a phase explicitly asks for them. If a workflow needs hooks or commands, document the gap and promote it to a generic platform phase.
- Prefer one domain object with a type field when the current read-model runtime cannot express a union of several source objects.
- When modeling user-owned records, prefer structured policy conditions over owner-convention checks when the business owner is a field such as `User`.
