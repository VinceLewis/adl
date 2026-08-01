# Authority Server and Sync Replay

Phase 39 adds the first authority boundary under `src/server/`. It accepts only
typed operation intents and creates an `ApplicationRuntime` over accepted-state
storage, so policy, validation, lifecycle, command, context scope, constraints,
and revision semantics remain the shared TypeScript runtime semantics.

`AuthoritySessionAdapter` establishes identity only. `AuthorityService` starts
with no roles, then resolves selected context roles from accepted membership
records with `RuntimeContextService`; caller supplied identities and roles are
not part of the transport contract. `StaticSessionAdapter` is test/development
only and requires long opaque tokens with constant-time comparison.

`AuthorityOutcomeStore` gives operation ids durable idempotency. PostgreSQL SQL
for model metadata, accepted records, memberships, outcomes, and audit
projection lives at `src/server/migrations/0001_authority_projection.sql`.
`PostgresAuthorityOutcomeStore` uses parameterised SQL through a structural pool
interface so ADL has no `pg` or SQL dependency in its language model.

The in-process backend is intentionally test wiring. Production work must add a
PostgreSQL object-storage backend and a transaction that commits accepted
records, audit entries, and stored outcome together before handling shared
traffic. Browser queue persistence and policy-shaped remote bootstrap are Phase
40 work.

## Decisions from Phase 61: a revision is unique for the life of the state

The conflict check is the mechanism the whole sync loop rests on, and it is a
plain equality comparison: `record.meta.revision !== intent.baseRevision` for a
single intent (`src/server/authority-service.ts:340`) and
`record.meta.revision !== write.baseRevision` for each write of a batch (`:409`).
Those two lines are the only comparisons of a revision anywhere in `src/` — there
is no ordering, no monotonicity check and no derivation to fall back on.

Because equality is the whole test, **a revision that can be issued twice is a
silent lost update**. Found while writing Phase 60's real-PostgreSQL coverage for
a batch containing an inline child edit, and verified independently before it was
acted on: `ObjectStore` minted revisions from `private nextRevisionId = 1`, set
in every constructor and never rehydrated, so a record updated to `rev-4` through
one `ApplicationRuntime` came back as `rev-1` through a second one over the same
backend. A device holding `rev-3`, an authority restart, and three further writes
by other devices then put the record back at `rev-3` as *a different version
wearing the same name*, and the device's stale write passed the equality check
and was applied — no conflict, no `manualResolution`, nothing unusual audited,
and nothing able to detect it afterwards, because the two versions were
indistinguishable by the only value that distinguishes versions. It was the only
place in this repository where the platform accepted a write it promises to
refuse.

**On a PostgreSQL authority it was worse than "after a restart", and this was
found while writing the integration coverage rather than while writing the phase
document.** `AuthorityTransaction` builds a *transaction-scoped*
`ApplicationRuntime` so a replay's record writes join the same transaction as its
audit and its outcome (`src/server/authority-unit-of-work.ts:54`), and
`authority-entrypoint.ts:162` wires that unit of work in production. A fresh
runtime is a fresh `ObjectStore`, so the counter restarted on **every replayed
operation**, not on every process restart: an accepted single-intent update minted
`rev-1` every time. A record therefore sat on `rev-1` write after write, and any
device holding `rev-1` — that is, any device that had read the record after
almost any earlier write — passed the equality check. The restart scenario is the
one that is easy to state; the per-transaction reset is the one that made it
routine. When a fix depends on state a class holds, check who constructs that
class and how often, not only when the process starts.

Phase 61 replaced the counter with `createRecordRevision(previous?)` in
`src/runtime/record-identity.ts`, which mints `rev-<sequence>-<uuid>`. Both halves
earn their place, and neither is decoration:

- the **sequence** is derived from the record's own prior revision, so a record's
  revisions still count up across a restart and stay legible in an audit trail or
  an operation-log entry rather than becoming noise; and
- the **uuid** makes the value unique *by construction* rather than unique within
  one process. That is what actually survives a restart, and it is what lets a
  device mint a revision offline with no round trip and no database sequence —
  a constraint the fix had to meet, because the device mints while it cannot
  reach the authority at all.

The sequence is derived, never trusted. `recordRevisionSequence` returns 0 for
any value whose shape it does not recognise — a fixture literal, a revision
another conforming runtime minted, the `revoked-<id>` tombstone revision
`AccessLifecycleService` writes on a revocation (`access-lifecycle.ts:337`) — so
an unfamiliar prior revision starts a new sequence instead of failing, and the
random token keeps that safe. It reads a pre-Phase-61 `rev-<n>` for its number,
so an existing record counts on from where it stood.

Two consequences worth keeping in mind at this boundary:

- **Every path that mints a revision has to follow the rule, including the ones
  outside `ObjectStore`.** `AccessLifecycleService` writes the invite-grant
  membership record directly, because the grant commits atomically with its
  access audit, and it used the constant `"rev-1"`. It now calls
  `createRecordRevision()` (`access-lifecycle.ts:506`). When you add a write that
  bypasses `ObjectStore` for atomicity, the revision rule does not come with it —
  apply it explicitly.
- **A restart is now something the conformance corpus can say.**
  `RuntimeConformanceStep.restartRuntime` rebuilds the `ApplicationRuntime` over
  the same storage, and `readRecordRevisions` reports what a record's revisions
  did as behaviour. See [[conformance-suite]]; the corpus previously had no way
  to express the scenario in which the defect was reachable, which is why a
  runtime that reissued revisions passed every case.

Records already persisted with old-format revisions are **not** migrated, and
that is a reasoned decision rather than an omission: see [[storage-backend]] for
why it fails closed.

The contract this all serves is written down in
`docs/spec/runtime-semantics.md#record-revisions`: a revision names one version
of one record, a write advances it, it is never reissued for the life of the
**persisted state** (not the life of the minting process), it is opaque, and
equality is the only defined operation on it.
