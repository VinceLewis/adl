# Storage Backend Implementation

Read this before changing runtime persistence, object storage, browser demo seeding, sync replay storage, or tests that depend on persisted records.

## Key decisions from Phase 9

- `ObjectStore` remains the runtime service that enforces validation, policy, audit recording, operation-log recording, lifecycle commit semantics, and public read shaping.
- Raw persistence sits behind `ObjectStorageBackend` in `src/runtime/object-storage-backend.ts`. Backends store and return full `StoredObjectRecord` values, not masked public responses.
- `InMemoryObjectStorageBackend` is the default for `ApplicationRuntime` and unit tests.
- `IndexedDbObjectStorageBackend` is the browser-local persistent backend. It stores records in IndexedDB by object name and record guid, and filters search text over the runtime-provided search field list.
- Delete remains a tombstone write. Storage backends reject delete calls that do not include `meta.deletedAt`, and normal runtime reads/searches exclude tombstoned records unless `includeDeleted` is requested.
- Runtime-generated record ids use collision-resistant ids instead of per-runtime sequential ids so a new browser runtime does not overwrite records persisted before reload.
- Browser demo seeding uses `seedBrowserDemoRuntimeIfEmpty(...)`, checking for existing records including tombstones before inserting fixture data. This prevents duplicate fixture rows after reload.
- Phase 9 persisted object records only. Audit events and operation-log entries still live in their existing runtime services; transition metadata remains explicit when those services record lifecycle transitions.

## Key decisions from Phase 35

- `ObjectStorageBackend` can advertise transactional write support through `supportsTransactions` and `commitTransaction(...)`. This capability is required for multi-write runtime commands.
- `InMemoryObjectStorageBackend` applies transaction writes against cloned record maps and swaps only after all checks pass.
- `IndexedDbObjectStorageBackend` applies transaction writes through one IndexedDB `readwrite` transaction.
- Storage backends still persist only object records. Command intent, audit events, operation-log entries, sync queue behavior, policy, validation, and constraints remain runtime-service concerns above the backend.

## Key decisions from Phase 61: a revision is durable state

`meta.revision` is persisted, in every backend. `PostgresObjectStorage` writes it
to its own `revision` column on insert and on update
(`src/server/postgres-object-storage.ts:152,166`); `IndexedDbObjectStorageBackend`
stores the whole `StoredObjectRecord`, revision included; the in-memory backend
holds it for as long as it holds the record. So a revision outlives the process
that minted it, and **no backend or runtime may treat it as a per-process value**.

That rule was learned the hard way. `ObjectStore` minted revisions from a counter
initialised to 1 in its constructor and never rehydrated from storage, so a
record persisted at `rev-4` came back as `rev-1` through the next runtime over
the same backend. Because a revision is compared only for equality
(`authority-service.ts:340` and `:409` are the only comparisons in `src/`), that
made a reissued revision a silent lost update rather than a display artefact. It
is the same class of mistake as the one Phase 9 already recorded for record ids —
"runtime-generated record ids use collision-resistant ids instead of per-runtime
sequential ids so a new browser runtime does not overwrite records persisted
before reload" — and it survived because the id rule was never carried across to
the other identifier in the same metadata block. When you add a value that
identifies persisted state, ask what a second runtime over the same storage
would mint for it.

The rule now lives in `createRecordRevision` (`src/runtime/record-identity.ts`),
which mints `rev-<sequence>-<uuid>`: a sequence read from the record's *own* prior
revision so it stays legible, and a random token so the value is unique by
construction and needs neither a database sequence nor a round trip. A device
mints offline, so nothing that requires either would have been usable.

### No migration for revisions already persisted in the old format

Phase 61 was required to decide what happens to records already carrying
`rev-<n>` revisions, and the decision is **no migration**. The reasoning, checked
against the code rather than assumed:

- A revision is only ever compared **per record and only for equality**. Nothing
  compares one record's revision with another's, and nothing orders, parses or
  does arithmetic on one. So an old-format value that a *different* record also
  carries is not a collision in any sense the system can observe: `rev-1` on two
  records was always true and was always harmless.
- Across the upgrade the change **fails closed**. An old-format `rev-<n>` can
  never be equal to a new-format `rev-<n>-<uuid>`, so a device holding a stale
  pre-upgrade base revision for a record that has since been written gets a
  `conflict` — the recovery path it should get — rather than a silent accept. The
  dangerous direction is a stale revision that *matches*, and this migration
  cannot produce one.
- The next write to each record moves it to the new format on its own, and
  `recordRevisionSequence` reads the old `rev-<n>` for its number, so the record
  counts on from where it stood rather than restarting.
- Rewriting revisions in place would break a rule this repository already holds.
  `revision`, actor and timestamps are preserved on migrated records
  (`docs/spec/runtime-semantics.md#model-migration`, and [[model-versions-and-migrations]]
  for why): a schema change that looks like a user's change breaks every audit
  surface, and bumping a revision as a side effect invalidates the base revision
  of every client holding the prior one — which is to say, a "repair" migration
  would manufacture conflicts for exactly the records it touched.

What the decision does **not** claim: it does not retroactively repair a
collision the old counter had already created — a device holding `rev-3` for a
record whose *current* revision is still an old-format `rev-3` minted for a
different version. That window exists per record and ends at that record's next
write, after which the record's revision is new-format and no old-format base
revision can ever match it again. Rewriting revisions in place would close the
window sooner, by invalidating every held base revision at once — which is
exactly the manufactured-conflict-per-record cost above, paid for a window that
closes by itself. And it would be paid over no population: as
[[offline-operation-identity]] established for the same class of question, no
deployment artifact, container image, CI pipeline or hosting configuration exists
in this repository, and the only committed environment file is
`.env.authority.sample` with placeholder values. **Before writing a migration to
repair a defect, establish that the defective state exists somewhere that
survives.**

There is no reset-revisions path in the codebase and there must not be one.

## Key decisions from Phase 74

- `ObjectStore.mintAutoIdValue` depends on `ObjectStorageBackend.search`'s
  `includeDeleted: true` behaviour to find the highest number an `AUTO_ID`
  field has ever used, deleted records included, so a tombstoned record's
  number is never reissued. Any new `ObjectStorageBackend` implementation
  must honour `includeDeleted` faithfully or `AUTO_ID` minting will silently
  reuse numbers over that backend. See [[auto-id-minting]] for the full
  design.

## Practical guidance

- Keep future sync policy, replay, and migration checks above the backend unless they are pure persistence concerns. Policy enforcement should still happen before the backend write.
- Do not make browser UI components write to `ObjectStorageBackend` directly. UI workflows should continue to call `ApplicationRuntime`.
- If a future phase persists audit or operation-log data, preserve `operation: "transition"`, `lifecycleAction`, `fromState`, and `toState`; do not reclassify lifecycle transitions as ordinary updates.
- A new `ObjectStorageBackend` must implement `search` (including
  `includeDeleted`) correctly before it can support `AUTO_ID` fields.
