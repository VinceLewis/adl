# Authority Production Operations

## Deployment

Terminate TLS at the authority process or a trusted proxy. The Node adapter
accepts requests only when the resulting request URL is HTTPS; a proxy must set
`x-forwarded-proto: https` only after it has validated TLS. Do not expose it
directly behind an untrusted proxy.

Set `ADL_ENV=production`, `ADL_DATABASE_URL`, `ADL_ALLOWED_ORIGINS` (comma
separated HTTPS origins), `ADL_COOKIE_SECURE=true`,
`ADL_UPSTREAM_IDENTITY_ISSUER`, and `ADL_UPSTREAM_IDENTITY_AUDIENCE`. Create
configuration with `loadAuthorityConfiguration` and use only
`OpaqueSessionAdapter` with PostgreSQL identity/session storage. The process
refuses `StaticSessionAdapter` in production. The upstream verifier must
validate signature, issuer, audience, expiry, and intended proof type before
returning a subject. Do not place a proof, session token, or role claim in a
browser-readable store.

Wire `createAuthorityHttpHandler` (or `createAuthorityNodeServer`) with a
database readiness function that performs a bounded `select 1`. `/healthz`
means process alive; `/readyz` must be 503 if migrations are incomplete or the
database/model projection is unavailable. Scrape `/metrics`; alert on readiness
failure, elevated 401/403/429 counts, replay rejection spikes, failed migration,
and membership-revocation failures.

## Starting the process

`npm run start:authority` compiles the server sources and runs the composed
entrypoint: deployment configuration, a `pg` pool, PostgreSQL identity/session,
record, outcome, access and administration stores, the transactional
unit-of-work, and the Node HTTP adapter. It applies no migrations — run those
separately as `adl_migrator` (see below) before starting traffic. It registers
the application's model metadata row, which accepted records reference by
foreign key.

Additional process variables: `ADL_HOST`, `ADL_PORT`, `ADL_APPLICATION_ID`
(required; pins the projection this process owns) and `ADL_MODEL_PATH` (the ADL
project directory whose `app.yaml` and sources are compiled at startup). See
[`.env.authority.sample`](../../.env.authority.sample) for the full list.

## Identity verification mode

`ADL_IDENTITY_VERIFICATION` selects the upstream verifier and defaults to
`bypass`. **The bypass accepts the supplied account proof as the identity
subject without contacting any provider.** It is a temporary development state
pending a real identity-provider decision, and it is deliberately impossible to
run unnoticed:

- The startup security event `identity_verification_configured` states `mode`,
  `verifier` and `bypassed`. No proof value is ever logged.
- `/readyz` returns `identityVerification: { mode, verifier, bypassed }`.
- Production refuses to start with the bypass unless
  `ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true` is set deliberately.

Alert on `bypassed: true` in any environment that serves real users, and treat
it as an open finding until a provider verifier is supplied. Setting the switch
to `upstream` without a provider implementation selects a verifier that rejects
every proof (`authentication_failed`) — it never falls back to the bypass, so a
mis-set switch fails closed rather than open.

## Browser client, sessions, and invitations

The browser reaches the authority only when it is built with
`VITE_ADL_AUTHORITY_URL` set to the authority origin. That is a build-time
value: changing it requires a rebuild and redeploy, not a restart. With it unset
the application is a purely local demo, makes no network call, and renders no
session, invite or recovery chrome at all. Phase 46's `VITE_ADL_ACCOUNT_PROOF`
and `?account=` development configuration no longer exist; a person establishes
identity by signing in.

**The development-mode banner.** The sign-in panel reads `/readyz` and shows a
"Development mode" warning whenever the authority reports
`identityVerification.bypassed: true`. It appears in both the signed-out and the
signed-in state, and it means exactly what the readiness body means: this
authority accepts the supplied account proof as the identity subject without
contacting any provider, so the signed-in name is asserted, not verified. Treat
the banner in any environment serving real users the same way you treat
`bypassed: true` in readiness — as an open finding. It disappears only when
`/readyz` reports `bypassed: false`, which requires a real upstream verifier
behind `ADL_IDENTITY_VERIFICATION=upstream`.

The browser fails safe. An unknown or missing `bypassed` flag counts as
bypassed, so a readiness body the browser cannot fully parse produces the banner
rather than a clean-looking sign-in. If the banner appears on a deployment you
believe is verified, check what `/readyz` actually returns to a browser (it is a
GET outside the CSRF and session surface, so a signed-out page can read it, but
it still needs the origin allow-list) before concluding the identity switch is
wrong.

An authority the browser cannot reach at all is a third state: the panel reads
"The authority could not be reached. The app is running on local data." rather
than showing the sign-in form, and the session is held internally as development
so an unreachable authority is never mistaken for a verified one. That message
means the readiness or session call failed — reachability, TLS, origin
allow-list — not that an identity was refused.

**Sessions need HTTPS and same-site hosting.** The session cookie is
`__Host-` Secure HttpOnly SameSite=Strict. A browser will not accept it over
plain HTTP, and will not send it to an authority that is not same-site with the
page. If sign-in appears to succeed and every subsequent call is unauthenticated,
suspect the hosting arrangement before the identity configuration: front the
authority with TLS and serve it same-site with the application, or put it behind
a same-origin path on the same host.

**Claiming an invitation needs connectivity.** It is online-only and
server-authoritative. An offline claim is refused in the browser before any
request is made — nothing is queued, cached, or optimistically granted — and the
user is told to reconnect and claim again. The operational consequence when
triaging a "my invitation did not work" report: if there is no access-audit event
for that invite, the claim never reached the server, and reissuing the invite is
not the fix. The newly permitted context's records appear only on the bootstrap
that follows the server's confirmation, so a user who claims successfully but
sees nothing has a bootstrap problem, not a membership problem — check the
membership record and their selected context.

**Conflicts and rejections are now visible to the user.** A refused or
conflicted operation stays on the client's persisted queue carrying the
authority's verdict until the model's declared conflict policy or the user
resolves it, and it survives a reload. A rejection can only be acknowledged; it
is never resubmitted. A replay or conflict spike therefore now has a user-facing
symptom — items accumulating in the client's recovery panel — as well as the
server metrics. Continue to triage it from aggregate metrics and redacted
operation ids, and never repair state by accepting raw browser records.

**A replayed create names its own record.** Since Phase 48 the create intent
carries the client's own record id and the authority accepts the record under it,
so an accepted record has one identity end to end. Two consequences for triage:

- A create request without a `recordId`, or with one that is empty, longer than
  320 characters, whitespace-padded or bearing a control character, is answered
  `malformed_request` (400) at the edge. A spike of these means a client built
  against the pre-Phase-48 contract, or a tampered client — not an outage. Check
  the deployed browser bundle's version before anything else.
- `ADL_RUNTIME_RECORD_ID_TAKEN` rejections mean a create arrived under an id that
  already names an accepted record, tombstones included. The existing record is
  never overwritten, merged with, or adopted. Genuine random collision is not a
  plausible explanation at any volume, so treat a cluster of these as a client
  defect or a replay of another user's captured intent, and inspect the redacted
  operation ids and the actor rather than the record contents. Do not "fix" one by
  deleting the incumbent record.

The record id is an identifier and never an authorisation: naming a record grants
no access to it, and revision, actor, timestamps, accepted state and scope all
remain server-derived. Never accept a client-supplied revision or actor as a
remedy for one of these rejections.

## Offline application shell

The application ships a web app manifest (`/manifest.webmanifest`) and a service
worker emitted unhashed at the build root as `dist/sw.js`. The page registers
`/sw.js?v=<modelVersion>`, where `modelVersion` is the resolved model's version —
the same notion of version the runtime startup compatibility guard applies to
persisted local data. There is deliberately no second versioning scheme.

**When the model version changes there is nothing to do manually.** The version
change changes the worker's script URL, so the browser installs the new worker;
the new worker activates immediately, deletes every `adl-shell-*` cache that is
not `adl-shell-<current version>`, and claims open clients. A stale worker
therefore cannot keep serving assets incompatible with the persisted local state.
Do not add a cache-busting step, and do not hand-delete caches as a release task.

Registration is production-only. A non-production build unregisters any ADL
worker a previous production visit left behind, so a developer is never served a
stale production shell. A failed registration is not fatal: that session simply
runs online-only.

**Confirming a deployment serves the expected worker.** After a release:

1. `curl -sI https://app.example/sw.js` returns 200 with a JavaScript content
   type. The file must be at the site root — a worker only controls the scope it
   is served from — and must not be renamed or hashed by the CDN.
2. `curl -sI https://app.example/manifest.webmanifest` returns 200.
3. In a browser, Application → Service Workers shows one activated ADL worker
   whose script URL is `/sw.js?v=<version>` with the deployed model version.
4. Application → Cache Storage contains exactly one `adl-shell-*` cache and its
   suffix is that same model version. More than one means an activation did not
   complete; reload and re-check before investigating further.
5. No entry in that cache is an authority response. Nothing under `/v1/` may ever
   be cached, and the only JSON permitted in it is the web app manifest. A `/v1/`
   URL in cache storage is a defect, not a configuration issue — escalate it
   rather than clearing the cache and moving on.
6. With the network disabled, a full reload still loads the shell and operates on
   local data.

Records live in IndexedDB under the runtime persistence boundary, never in the
service worker cache. Note that signing out ends the server session but does not
clear locally cached records or unsynced queued work — clearing them would
destroy a user's offline work. Do not deploy this application to a shared or
kiosk browser: see the residual risk in the
[threat model](../security/phase-42-threat-model.md).

## Database roles and migrations

Use a database owner only to create roles. Run
[`roles.sql`](../../src/server/migrations/roles.sql) once, then apply ordered
`0001_authority_projection.sql`, `0002_security_operations.sql`,
`0003_reporting_administration.sql`,
`0004_authority_transaction_integrity.sql`, and
`0005_authority_audit_scope_and_retention.sql` as `adl_migrator`. Run the process as
`adl_authority`; it has DML only and cannot create schema objects or run
migrations. Use a pinned PostgreSQL client for any multi-statement transaction.

Wire the authority with a `PostgresAuthorityUnitOfWork` (constructed from a
connection pool that hands out pinned clients). Accepted replay then commits the
accepted record, its runtime audit projection, and the actor-bound outcome in
one transaction; an infrastructure failure at any stage rolls all three back and
surfaces as a retryable error rather than a durable rejection. The in-process
backend without a unit-of-work remains test/development wiring only.

Before release: backup, apply migration, run readiness and HTTP smoke tests,
then retain the previous application build until the restore point is verified.
Never run DDL through the traffic connection string.

## Backup, recovery, and retention

Take encrypted daily logical backups and point-in-time WAL backups. Include all
`adl_authority_*` tables: accepted records, model metadata, memberships,
session/invite verifiers, outcomes, runtime audit, and access audit. Retain 35
daily, 12 monthly, and the current legal/audit retention period; get legal
approval before deleting audit data. A daily job may remove expired/revoked
session and invite verifier rows only after 35 days. That job must never delete
accepted records.

Runtime audit (`adl_authority_audit_events`) and operation outcomes
(`adl_authority_operation_outcomes`) have a bounded retention path via
`AuthorityRetentionService.prune` (Phase 45). It is application-scoped and
deletes only rows older than the effective cutoff, which is clamped to no later
than `now - minimumRetentionMs`, so nothing inside the minimum retention window
is ever removed. It refuses to run when `legalHold` is set, throws on a
non-positive minimum window, and never touches accepted records, sessions,
invites, or identities. Configure `minimumRetentionMs` to at least the legal
audit-retention period and obtain legal approval before enabling it. Pruning an
ancient outcome only drops that long-past operation id from the idempotency
cache; accepted state and Phase 44 atomicity are unaffected. Its result is
metadata-only (counts and the effective cutoff) and must not be logged with any
payload.

`adl_authority_audit_events` is now a populated transactional projection (Phase
39 defined it; Phase 44 writes it inside the accepted-replay transaction).
Restore it together with the accepted-record and outcome projections; a restore
that recovers outcomes but loses their referenced records is inconsistent.

Phase 43 adds the metadata-only `adl_authority_administration_audit_events`
projection. Include it in the same backup, restore-count, and legal retention
process. It records report/export and operational-review metadata, not report
rows, raw audit payloads, session/invite verifiers, or credentials. Report
pages are intentionally short-lived server state and are not recoverable data.

Quarterly restore drill:

1. Restore an encrypted backup into an isolated database and apply WAL to the
   chosen recovery point.
2. Apply migrations with `adl_migrator`; connect only with `adl_authority`.
3. Verify row counts for every `adl_authority_*` table and sample a record,
   membership, session verifier, invite verifier, outcome, audit, and
   access-audit event without printing protected JSON.
4. Run `AuthorityProjectionIntegrity.verify` against the restored database. It
   returns metadata-only counts plus `consistent`, `acceptedOutcomeRecordsMissing`,
   `orphanRecords`, and `auditScopeInconsistent`, and must report
   `consistent: true`. A non-zero `acceptedOutcomeRecordsMissing`, `orphanRecords`,
   or `auditScopeInconsistent` (a half-populated runtime-audit context scope, e.g.
   from a bad migration or restore) means an inconsistent set; do not switch
   traffic. Outcomes are application-scoped since Phase 45, so the outcome count is
   per application. `AuthorityProjectionIntegrity.recoveryStatus` backs the
   administration recovery view with the same result and prints no protected JSON.
5. Run `/readyz`, an authenticated bootstrap, an idempotent replay retry, an
   invite claim fixture, and a revoked-session rejection against the restored
   instance. Record backup id, recovery point, elapsed time, and results.
6. Destroy the isolated restore and rotate any credentials used for the drill.

## Incidents

**Suspected session compromise:** revoke the affected user's sessions, revoke
membership if access itself is suspect, rotate the session cookie on next login,
preserve redacted security/access events, and force a policy-shaped bootstrap.

**Invite misuse:** revoke the invite in its original context, inspect only its
access-audit id and metadata, revoke the claimed membership if needed, then
revoke that user's sessions.

**Database loss/corruption:** stop writes, select a recovery point, restore to
an isolated database, complete the drill checks above, switch traffic only once
readiness passes, then have clients bootstrap before replaying queued intents.

**Replay/conflict spike:** inspect aggregate metrics and redacted operation ids
only; confirm model/version deployment compatibility, pause affected client
release if necessary, and keep idempotent retries enabled. Never repair state
by accepting raw browser records or bypassing `AuthorityService`.

**Report/export concern:** use the context-bounded access-audit and
administration-audit summaries to identify the actor, report name, and time.
Do not query the database for a raw report payload: no report payload is kept.
If membership access is suspect, revoke that membership (which revokes sessions)
and have the user bootstrap again. A context manager may revoke sessions only
for a user with active membership in that same context.
