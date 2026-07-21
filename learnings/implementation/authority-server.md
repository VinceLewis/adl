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
