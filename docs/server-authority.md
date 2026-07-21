# Phase 39 Authority Server

The first authority slice is a TypeScript service that accepts operation intents,
not raw records. It creates `ApplicationRuntime` from the resolved model and
replays `create`, `update`, `delete`, `transition`, and `command` through that
runtime. SQL, routes, and authentication-provider configuration remain outside
the ADL model.

## Trust boundary

`OpaqueSessionAdapter` is the Phase 41 production adapter. It provisions a
stable identity from a trusted upstream account proof and issues random opaque
tokens that are stored only as SHA-256 verifiers in the authority database. It
validates expiry and identity status on every request and supports rotation,
sign-out, and user-wide revocation. The HTTP integration must carry the raw
token only in an HTTPS-only, Secure, HttpOnly, SameSite cookie (or an equivalent
server-managed credential); it must not put an ADL role or membership in a
token. `StaticSessionAdapter` remains development/test-only and must not be
wired into a production authority process.

The request cannot set a user id, global role, context role, audit actor,
accepted revision, or timestamp. Context roles are resolved from accepted
`BandMember` records through `RuntimeContextService` before the runtime applies
policy. A valid authentication session therefore proves identity only, not
business access.

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

## Identity, invites, and revocation

`AuthorityAccessLifecycleService` creates an invite only after the authenticated
caller passes the existing ADL `update` policy on the resolved membership
object in the target context. An invite contains a one-time hashed verifier,
target context, permitted role, optional recipient identity, and expiry. It is
claimed only online by a verified session. PostgreSQL locks the invite row and
in the same transaction inserts the membership record, marks the invite
claimed, and records an access audit event. Raw invite tokens never appear in
records, audit, sync state, outcomes, or logs.

Membership removal is likewise policy-gated, tombstones the server membership
record, emits access audit, and revokes the affected user's opaque sessions.
The next bootstrap or replay therefore fails authentication before returning or
accepting shared data. Existing cached browser records are not an access grant:
the client cannot claim or alter access offline, and the next authenticated
bootstrap remains policy-shaped and reconciles the permitted dataset.

## Production boundary and operations

Phase 42 adds the deployment-only HTTP/configuration edge under `src/server/`.
It requires HTTPS, exact configured origins, JSON size/content-type validation,
Secure HttpOnly SameSite=Strict `__Host-` session cookies, CSRF protection for
mutations, rate controls, and redacted structured security events. It never
adds routes, SQL, cookie settings, or identity providers to the ADL model.

Read the [production runbook](operations/authority-production-runbook.md) and
[threat model](security/phase-42-threat-model.md) before deploying. Production
uses `OpaqueSessionAdapter` and PostgreSQL only; `StaticSessionAdapter` is
rejected by configuration validation. Migration and traffic accounts are
separate, and recovery drills cover every authority projection.

## Authoritative reporting and administration

Phase 43 adds `AuthorityReportingService` and `AuthorityAdministrationService`.
Reports execute only a named resolved read model through `ApplicationRuntime`;
they do not accept SQL, arbitrary fields, filters, object names, or database
credentials. Runtime context scope, source `search`/`read` policy, field masks,
and read-model semantics shape every result before the service paginates it.
CSV export additionally requires the existing `export` policy for every source
record. Reports are limited to 500 rows, exports to 100 rows, and pages to 100
rows. Report and administration-list cursors are opaque, short-lived,
actor-bound server state.

The HTTP edge exposes POST-only, CSRF/origin/session/rate-protected endpoints
at `/v1/reports/execute`, `/v1/reports/export`, and narrowly scoped
`/v1/admin/*` review/response routes. Administration first requires existing
ADL membership-management (`update`) policy in one selected business context.
It returns status summaries only: no record JSON, audit before/after payload,
session verifier, invite verifier, outcome body, or raw access-audit event is
returned. Session revocation is limited to a target with active access in the
same managed context.

`0003_reporting_administration.sql` adds only a metadata-only administration
audit projection and context-review indexes. It does not expose SQL through
ADL, duplicate accepted records, or store credentials. Apply it with
`adl_migrator` before serving these endpoints.
