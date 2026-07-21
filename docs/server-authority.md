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

Password/account recovery, invite claim, bootstrap/pull, persistent browser
queue storage, background sync, rate limiting, deployment, and monitoring are
not included in Phase 39.
