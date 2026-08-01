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

## Open: a record revision is only unique within one process

Found while writing Phase 60's real-PostgreSQL coverage for a batch containing an
inline child edit, and verified independently before being recorded.

`ObjectStore` mints revisions from `private nextRevisionId = 1`
(`src/runtime/object-store.ts:153`) and never rehydrates it from persisted state.
A record created and updated three times through one `ApplicationRuntime` reaches
`rev-4`; a second `ApplicationRuntime` over the **same backend** updates it and it
comes back as `rev-1`. The value is persisted, so this is durable.

`AuthorityService` compares revisions for equality and nothing else
(`authority-service.ts:340` for a single intent, `:409` for a batch write). A
device holding `rev-3`, an authority restart, and three further writes by other
devices put the record back at `rev-3` as a *different version wearing the same
name* — and the stale write is then accepted silently. This is the only known
place in this repository where the platform accepts a write it promises to
refuse, and it is undetectable after the fact.

Two things to know before touching it:

- **The `rev-N` literal is a contract, not an implementation detail.** It is
  asserted 41 times in `conformance/` and across eight test files. Nothing parses
  it numerically, so the value is already opaque in behaviour; the corpus is what
  has to stop asserting the literal.
- **The device mints revisions offline**, so any replacement rule has to work
  with no round trip and no database sequence.

Planned as Phase 61 (`docs/phases/phase-61-record-revision-integrity.md`).
