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

## Practical guidance

- Avoid app-specific runtime hooks in reference apps unless a phase explicitly asks for them. If a workflow needs hooks or commands, document the gap and promote it to a generic platform phase.
- Prefer one domain object with a type field when the current read-model runtime cannot express a union of several source objects.
- When modeling user-owned records, remember that current policy conditions cannot express field equality such as `record.User == runtime.userId`; tests should not imply that guarantee exists until the platform supports it.
