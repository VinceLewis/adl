# Context Membership Projection and Scoped Access

Read this before changing how membership records are written, resolved, reviewed
or revoked; before adding a scope-indexed read model over accepted records; or
before touching `adl_authority_context_memberships`, `ContextMembershipIndex`,
or the authority's startup advisory lock.

Phase 54 gave `adl_authority_context_memberships` a writer and made the four
membership reads scope-indexed. It builds directly on the division Phase 45
established for runtime-audit context scope — see
[[authority-transaction-integrity]].

## The shape that made it work: an optional runtime port

`ContextMembershipIndex` (`src/runtime/context-membership-index.ts`) is a runtime
port, not a server type. That matters because the scan being replaced —
`RuntimeContextService.getActiveRecords` — is runtime code shared with the
browser, and the projection is a PostgreSQL table. Making the port optional is
what let one concept serve both sides:

- The authority passes `PostgresContextMembershipIndex` through
  `ApplicationRuntimeOptions.membershipIndex`.
- The browser, the in-memory backends, and every existing unit test pass nothing
  and keep the full scan, which is correct for a device-sized dataset.

Every consumer follows the same two-step shape, and it is the reason the port can
be trusted:

1. The index **names** candidate membership records.
2. The caller **reads each record through storage** and applies exactly the
   filtering it applied before.

So the record, never the index, decides. A stale or extra candidate costs one
extra read; it cannot grant a membership, and a role the index claims but the
record does not carry is not resolved. Both are pinned by
`tests/context-membership-index.test.ts`, including a case asserting the indexed
result equals the scanned result exactly.

## Where the writer lives, and why it is two places rather than one

The projection is written by `ContextMembershipProjectionWriter`, which never
opens a transaction of its own — it issues statements on whatever handle it was
given, so it always joins the caller's existing commit boundary.

- **`PostgresObjectStorageBackend` owns it for every accepted record write.**
  Putting it there rather than in `AuthorityService` or `AuthorityTransaction`
  means ordinary replay, multi-record commands and model-migration rewrites are
  all covered without any caller having to remember, and under an ambient
  transaction it joins the unit-of-work's transaction structurally.
- **`PostgresAuthorityAccessStore` also syncs it**, because `claimInvite` and
  `revokeMembership` write `adl_authority_records` with their own SQL rather than
  through the backend. Each does so inside its own store transaction, so the
  grant or tombstone, its access-audit event and the projection row commit or
  roll back together.

If a third path ever writes `adl_authority_records` directly, it must sync the
projection too. The startup rebuild and the integrity counters exist partly so
that mistake surfaces instead of silently removing someone's access.

## Two decisions that are easy to get wrong

**Revoked rows are retained, not deleted.** Membership review reports a revoked
membership as `revoked`; deleting the row would have silently dropped it from the
review. `revoked_at` mirrors the record's tombstone, `listForUser` filters it out
for resolution and access checks, and `listForContext` keeps it for review.

**A membership record that cannot be fully indexed gets no row at all.** If any
of the declared user/context/role fields is absent or not a non-empty string,
`readMembershipFields` returns undefined and any existing row is deleted rather
than left half-populated — the same "index it fully or not at all" rule Phase 45
applied to audit scope. This is safe precisely because such a record is one
membership resolution already skips, so nothing becomes resolvable or
unresolvable by being indexed. Integrity's "missing row" check applies the same
predicate in SQL, otherwise it would report an inconsistency no operator could
ever clear.

## The table was re-created, not altered

The original Phase 39 shape keyed on
`(application_id, context_name, context_id, user_id, role)` with only a
user-scoped index. That cannot support this work: two membership records with the
same user/context/role would collide on one row, so "every accepted membership
record has exactly one projection row" was unverifiable in either direction;
there was no context-scoped index for the review page; and without `object_name`
a row could not be joined back to `adl_authority_records`, which is keyed on
`(application_id, object_name, record_id)`.

`0008_membership_projection.sql` drops and re-creates it keyed on
`(application_id, membership_record_id)`. That was only safe because the table had
never held a row — Phase 47 confirmed it stayed empty after a real invite claim,
and Phase 48 confirmed no deployment exists. Do not assume a future projection
table can be re-created this cheaply.

## Startup rebuilds the projection, under an advisory lock

`migrateAcceptedState` now holds
`pg_advisory_lock(hashtext('adl_authority_startup:<applicationId>'))` for the
whole of startup, and rebuilds the membership projection from the accepted
records after any model migration has been applied. Three reasons, in order of
how likely they are to bite:

1. A projection written before it had a writer (the exact Phase 47 state).
2. An out-of-band restore that recovered records but not the projection.
3. A model migration hop that rewrote membership field values.

The rebuild is idempotent and derives everything from accepted records, so it can
neither invent nor drop a membership. The advisory lock is session-level and
released in a `finally`; releasing an unlocked lock logs a PostgreSQL warning, so
only unlock what was actually taken.

Proving mutual exclusion needs care. Starting two processes concurrently and
asserting the result is correct proves nothing, because both rebuilds are
identical and idempotent — the test passes with or without the lock. The
deterministic proof is to take the same advisory lock on a separate client, start
a process, assert it has **not** settled after a generous wait, release, and then
assert it completes. That fails immediately if the lock is removed.

## The consequence to remember when writing tests

Seeding a membership record with raw SQL into `adl_authority_records` no longer
produces a usable membership: the projection stays empty, so context resolution
finds nothing and the seeded user holds no context at all. This broke
`tests/integration/authority-retention-scope.test.ts` on first run and the fix
was to seed through `PostgresObjectStorageBackend.create`, which is the honest
path anyway. `tests/integration/authority-postgres.test.ts` still raw-seeds and
still passes only because it wires its access-lifecycle service without an index
and therefore keeps the scan.

Where a test deliberately wants the drifted state — to exercise the startup
rebuild or an integrity counter — raw seeding is the right tool, and
`authority-membership-projection.test.ts` names that helper
`seedRecordWithoutProjection` so the intent is visible.

See [[authority-server]], [[identity-invites-and-access-lifecycle]],
[[context-runtime]] and [[testing-expectations]].
