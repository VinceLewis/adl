# Phase 39 Authority Server

The first authority slice is a TypeScript service that accepts operation intents,
not raw records. It creates `ApplicationRuntime` from the resolved model and
replays `create`, `update`, `delete`, `transition`, and `command` through that
runtime. SQL, routes, and authentication-provider configuration remain outside
the ADL model.

## Trust boundary

`AuthoritySessionAdapter` verifies a server-issued opaque session token and
returns only an identity. The request cannot set a user id, global role, context
role, audit actor, accepted revision, or timestamp. Context roles are resolved
from the accepted `BandMember` records through `RuntimeContextService` before
the runtime applies policy. The included `StaticSessionAdapter` is deliberately
development/test-only: production deployments must use an adapter that validates
an HTTPS-only, Secure, HttpOnly, SameSite cookie or an equivalent server-side
session, rotates/revokes sessions, and rate-limits authentication endpoints.

Never put ADL business roles in a bearer token and never log a session token.

## PostgreSQL

Apply [`0001_authority_projection.sql`](../src/server/migrations/0001_authority_projection.sql)
to the authority database with a least-privilege migration role. The runtime
record projection, model metadata, membership projection, idempotent outcomes,
and audit projection use separate tables. `PostgresAuthorityOutcomeStore` uses
parameterised SQL and can accept a standard `pg` pool without exposing `pg` in
the language contract.

The application service must wrap accepted record projection, audit projection,
and outcome persistence in one PostgreSQL transaction. The current in-process
runtime backend is intentionally useful for tests; production wiring must supply
a PostgreSQL record backend before serving shared traffic.

## Outcome and replay rules

An operation id is idempotent: a retry returns the previously stored outcome.
Stale base revisions become `conflict` (or `manualResolution` for manual model
conflict policy). Runtime policy, validation, lifecycle, command preconditions,
scope and constraints determine `rejected`. Response records must be shaped for
the authenticated context; do not return raw audit, conflict, or protected data.

## Deferred work

## Remote bootstrap and browser reconciliation

Phase 40 adds `AuthorityService.bootstrap(...)`. It accepts only a verified
session and an optional selected business context. The service derives identity
and context roles server-side, excludes `localPrivate` objects, and passes every
accepted record through normal runtime context-scope and read-policy shaping
before it is returned. Denied rows and invalid context selection both produce
an empty result; they are not distinguishable to the caller. Cursors are opaque,
bounded, and advance only through records already visible to that caller.

`AuthoritySyncClient` continues to submit only `localFirst` queue entries.
The IndexedDB `syncState` database persists queue entries and operation-log
outcomes separately from object records, with a model-version startup guard.
Conflict outcomes carry only a deterministic recovery strategy from the resolved
object sync policy (`serverWins`, `clientWins`, `stateTransitionWins`, or
`manual`); protected authority records are never attached to a conflict.

The client applies accepted and bootstrap records through the runtime's trusted
sync-projection path. That path creates no new operation-log, audit, or queue
side effect and marks the local projection `synced`; user-facing reads still go
through normal `ApplicationRuntime` policy checks. A complete recovery UI
remains follow-up work.

Password/account recovery, invite claim, background scheduling, rate limiting,
deployment, and monitoring remain deferred.
