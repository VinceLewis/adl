# Authority Production Operations

## Deployment

Terminate TLS at the authority process or a trusted proxy. The Node adapter
accepts requests only when the resulting request URL is HTTPS; a proxy must set
`x-forwarded-proto: https` only after it has validated TLS. Do not expose it
directly behind an untrusted proxy.

Set `ADL_ENV=production`, `ADL_DATABASE_URL`, `ADL_ALLOWED_ORIGINS` (comma
separated HTTPS origins), `ADL_COOKIE_SECURE=true`,
`ADL_UPSTREAM_IDENTITY_ISSUER`, and `ADL_UPSTREAM_IDENTITY_AUDIENCE` (the last
two are required in every mode). Production must also select a real identity
verifier — `ADL_IDENTITY_VERIFICATION=passkey` or `upstream`; the bypass is
refused outright there. Create configuration with
`loadAuthorityConfiguration` and use only
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
(required; pins the projection this process owns) and `ADL_MODEL_PATH`
(required; the ADL project directory whose `app.yaml` and sources are compiled
at startup). Neither has a default — an unset `ADL_MODEL_PATH` refuses to
start rather than silently serving the bundled Giggle Band reference app
behind a real deployment. See [`.env.authority.sample`](../../.env.authority.sample)
for the full list.

## Identity verification mode

`ADL_IDENTITY_VERIFICATION` selects how the authority establishes who a caller
is. It accepts three values and still defaults to `bypass`.

- **`passkey`** is the real credential and the mode a deployment runs. The
  authority issues a challenge, the authenticator signs it, and the assertion is
  verified against a stored public key. It requires the `ADL_WEBAUTHN_*` values
  (see below) and it makes `/v1/session/issue` unavailable
  (`endpoint_unavailable`, 503), so a passkey deployment keeps no weaker second
  way in alongside the ceremony.
- **`upstream`** requires a real bearer-proof verifier to be supplied to the
  process. With the switch on and no provider implementation, every proof is
  rejected (`authentication_failed`) — it never falls back to the bypass, so a
  mis-set switch fails closed rather than open.
- **`bypass`** accepts the supplied account proof as the identity subject
  without contacting any provider, so anyone who can reach the authority becomes
  any user by naming them. **It is development-only.** A production process
  refuses to start with it: `loadAuthorityConfiguration` raises a configuration
  error instead of serving traffic. The Phase 46 escape hatch
  `ADL_IDENTITY_BYPASS_ACKNOWLEDGED` has been **removed** — an operator can no
  longer opt a production deployment back into accepting an unverified identity.
  If you find that variable in a deployment's configuration, delete it; it does
  nothing.

No mode runs unnoticed:

- The startup security event `identity_verification_configured` states `mode`,
  `verifier` and `bypassed`. No proof value is ever logged.
- `/readyz` returns `identityVerification: { mode, verifier, bypassed }`. A
  passkey deployment reports
  `{ mode: "passkey", verifier: "passkey", bypassed: false }`.

Alert on `bypassed: true` in any environment that serves real users, and treat
it as an open finding.

## Switching a deployment to passkey identity

**Required configuration.** Set `ADL_IDENTITY_VERIFICATION=passkey` and:

| Variable | Meaning |
| --- | --- |
| `ADL_WEBAUTHN_RP_ID` | Registrable domain every allowed origin sits under. Host name only. |
| `ADL_WEBAUTHN_RP_NAME` | Name shown in the platform prompt. Defaults to the relying party id. |
| `ADL_WEBAUTHN_ORIGINS` | Comma-separated origins an assertion may come from. Defaults to `ADL_ALLOWED_ORIGINS`. |
| `ADL_WEBAUTHN_CHALLENGE_TTL_SECONDS` | Challenge lifetime, positive integer, default 300. |
| `ADL_RATE_WEBAUTHN` | Requests per window for `/v1/webauthn/*`, default 20. |

Startup refuses an origin that is not the relying party id or a subdomain of it,
so a mismatch is a failed start rather than credentials that silently fail to
verify later. Apply `0006_passkey_identity.sql` as `adl_migrator` before starting
the process.

**Origin binding is not a runtime detail; it is the credential's identity.** A
credential registered against one relying party id will not work against
another. Development and production registrations are therefore separate by
design, and changing `ADL_WEBAUTHN_RP_ID` on a live deployment invalidates every
credential already registered — every user would have to re-register through the
recovery path below. Treat that value as fixed for the life of the deployment.

**What the browser needs.** WebAuthn requires a secure context, and the session
cookie is `__Host-` Secure HttpOnly SameSite=Strict, so the same TLS and
same-site hosting requirements as every other session call apply. A user agent
with no WebAuthn support cannot sign in to a passkey deployment at all; the
sign-in surface says so rather than failing obscurely.

### First admin: there is no bootstrap flow (documented gap)

**This repository has no first-admin bootstrap flow, and that is a real gap, not
an oversight in this runbook.** Passkey registration is either session-gated or
invite-gated and is never anonymous; issuing an invite requires an authenticated
caller who already passes membership-management policy in the target context. A
brand-new database therefore has no way to admit its first identity through the
product surface. The first identity and its membership must be established **out
of band by an operator**, once, before anyone can sign in.

For a **local development** database, `scripts/dev/seed-local-admin.mjs`
(`npm run dev:seed`) performs exactly this step through the repository's own
server modules, so the records it writes are the shape the model validates. It
is developer tooling and is not a route: point it at a development database
only, and do the writes below for a real deployment.
See `docs/development/local-https-development.md`.

Do it as three writes plus one ordinary registration, using the model's own
membership declaration (for `giggle-band`, `CONTEXT Band … MEMBERSHIP BandMember
USER User CONTEXT_FIELD Band ROLE_FIELD Role`). Run the inserts as
`adl_migrator` or another DML-capable role, inside one transaction, and record
that you did so.

```sql
begin;

-- 1. The identity the first admin will sign in as. It deliberately has no
--    identity link yet: registration adds the (passkey, user handle) link.
insert into adl_authority_identities (application_id, user_id, created_at)
values ('giggle-band', 'user-bootstrap-admin', now());

-- 2. The business context record the membership points at, if it does not
--    already exist. Accepted records are whole StoredObjectRecord documents.
insert into adl_authority_records
  (application_id, object_name, record_id, revision, deleted_at, record)
values (
  'giggle-band', 'Band', 'band-bootstrap', 'rev-1', null,
  jsonb_build_object(
    'meta', jsonb_build_object(
      'guid', 'band-bootstrap', 'object', 'Band', 'schemaVersion', 1,
      'revision', 'rev-1', 'createdAt', now(), 'createdBy', 'operator-bootstrap',
      'updatedAt', now(), 'updatedBy', 'operator-bootstrap', 'syncStatus', 'synced'),
    'values', jsonb_build_object('Name', 'Giggle Band')));

-- 3. The membership record that grants the admin role. Context roles are
--    resolved from records like this one on every call, so this row - not the
--    identity row and not the passkey - is what confers access.
insert into adl_authority_records
  (application_id, object_name, record_id, revision, deleted_at, record)
values (
  'giggle-band', 'BandMember', 'membership-bootstrap-admin', 'rev-1', null,
  jsonb_build_object(
    'meta', jsonb_build_object(
      'guid', 'membership-bootstrap-admin', 'object', 'BandMember',
      'schemaVersion', 1, 'revision', 'rev-1', 'createdAt', now(),
      'createdBy', 'operator-bootstrap', 'updatedAt', now(),
      'updatedBy', 'operator-bootstrap', 'syncStatus', 'synced'),
    'values', jsonb_build_object(
      'User', 'user-bootstrap-admin', 'Band', 'band-bootstrap',
      'Role', 'BandAdmin')));

commit;
```

Populate every field the object declares `REQUIRED` — for `BandMember` that is
`User`, `Band` and `Role` — or the record will fail validation the first time it
is updated through the runtime. Then issue the recipient-bound invite described
below for `user-bootstrap-admin` and have that person register an authenticator.
From that point every further member is admitted through the ordinary invite
flow, and this procedure is never needed again for that database.

### Recovery for a member who has lost every authenticator

No email sender exists, and none is introduced. Recovery is the existing invite
system:

1. An admin issues a **recipient-bound** invite for the member's existing
   `userId` (`/v1/invites/create` with `recipientUserId`). The binding is what
   makes this recovery rather than a new account.
2. The claimant registers a fresh authenticator against that invite
   (`/v1/webauthn/register/begin` then `/finish`, both carrying the invite
   token). The raw token is presented again at finish and must hash to the one
   the ceremony started with.
3. The authority re-links: the new credential attaches to the **same `userId`**,
   so every existing membership, record and audit reference survives untouched.
   The invite is consumed and audited as `identityRecovered`, and **no membership
   is granted** — the member never lost their memberships, only their
   authenticators.

The registration response carries `invite: "identityRecovered"`, and the
access-audit row is the durable evidence. If you see `inviteClaimed` instead, the
invite was not recipient-bound and a *new* identity was created with a fresh
membership grant; that is the wrong outcome for a recovery, and the fix is to
revoke the accidental membership and re-run with a bound invite.

For the bootstrap case above, the operator can insert the invite directly rather
than issuing it through the API, because no admin session exists yet. Generate a
token of at least 32 characters, store only its SHA-256 hex digest, and hand the
raw token to the first admin over a channel you trust:

```sh
TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
printf %s "$TOKEN" | sha256sum   # the hex digest goes in token_hash
```

```sql
insert into adl_authority_invites
  (invite_id, application_id, token_hash, context_name, context_id, role,
   recipient_user_id, created_by, created_at, expires_at)
values (
  'invite-bootstrap', 'giggle-band', '<sha256-hex-of-TOKEN>', 'Band',
  'band-bootstrap', 'BandAdmin', 'user-bootstrap-admin', 'operator-bootstrap',
  now(), now() + interval '1 hour');
```

The raw token is a credential: it never goes in a ticket, a chat log, or this
repository, and only its hash is stored.

### Pruning expired ceremony challenges

`adl_authority_webauthn_challenges` grows by one row per started ceremony,
including abandoned ones. **This is no longer a manual procedure.** Since Phase
55 the challenge table is one of the four projections the retention job prunes,
under a guard that considers only challenges already consumed or expired, and
only once that ending is itself older than `ADL_RETENTION_CHALLENGE_DAYS`
(default 1 day). Configure and schedule it as described in
[Running retention](#running-retention).

Do not schedule a hand-written `delete` alongside it. A statement of your own
has no legal-hold check, writes no run record, emits no metric or security
event, and — unlike the job — is not serialised against a concurrent run.

The rows remain transient authentication-flow state: they hold no accepted data
and are not recovery-relevant, so excluding them from a restore is acceptable
and an in-flight ceremony simply has to be restarted.

### When a signature counter regresses

`ADL_PASSKEY_COUNTER_REGRESSED` means an assertion verified correctly but its
signature counter did not advance while the stored counter is non-zero. **That is
the cloned-authenticator signal.** The authority has already refused it and
issued no session; the write is guarded in the `where` clause, so nothing was
updated either.

1. Do not "fix" it by resetting `signature_counter`. That destroys the only
   evidence and re-enables the clone.
2. Identify the credential and its `user_id` in
   `adl_authority_webauthn_credentials` — metadata only; never print or export
   the public key or the credential id into a ticket.
3. Correlate with the access audit and the security events for that user. A
   single event from a user whose authenticator has always reported zero is not
   this signal: a counter-less authenticator that reports zero every time is
   permitted, and only a previously non-zero counter that stalls or returns to
   zero refuses.
4. If access is suspect, treat it as a session compromise: revoke that user's
   sessions, and revoke membership if the access itself is in doubt. Then delete
   the affected credential row so the authenticator must be re-registered
   through the recovery path above.

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
`/readyz` reports `bypassed: false`, which means the deployment runs
`ADL_IDENTITY_VERIFICATION=passkey` or a real verifier behind `upstream`. In
`passkey` mode the panel offers passkey registration and sign-in instead of an
account-proof field, because `/v1/session/issue` does not exist there.

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

## Offline session lifetime and sync grace

**The grace is in the model, not in your environment.** How long a device may
keep syncing since its last successful authentication is
`APP … OFFLINE_GRACE <days> DAYS` in the ADL source the authority serves
(`ADL_MODEL_PATH`), resolving to `model.app.offlineGraceDays`. Giggle Band
declares 30 days. Changing it is a model change and a redeploy, not a restart,
and because it is part of the resolved model it is also a **model version
change**: expect the startup compatibility guard to apply on the browser side
exactly as it does for any other model change.

**`ADL_SESSION_TTL_MINUTES` is now a cap, not the lifetime.** The effective
session lifetime is the declared grace; the variable, if set, may only shorten
it. Setting it longer than the declared grace has no effect — an environment
variable must not grant more time away than the application declared. With it
unset the lifetime is the full declared grace, which is why the old 480-minute
default no longer applies.

Confirm what actually resolved from the startup security log rather than from
the environment:

```text
{"event":"session_lifetime_configured","sessionTtlMinutes":43200,"capped":false,...}
```

`capped: true` means your `ADL_SESSION_TTL_MINUTES` shortened the declared
grace. If users report being signed out sooner than the application promises,
read that line first.

**Cookies are now persistent.** Both `__Host-adl_session` and `__Host-adl_csrf`
carry `Max-Age` equal to the effective lifetime. Closing the browser no longer
signs a user out. Both cookies carry the same lifetime deliberately: a session
that outlived its CSRF cookie could read but would fail every write with
`csrf_denied` (403). A cluster of `csrf_denied` from otherwise healthy
long-lived sessions is the symptom to look for if that ever diverges.

**Sessions rotate, so the sessions table churns.** The browser rotates on
connect and again once more than half the grace has elapsed since its last
confirmed authentication. Each rotation inserts a new session row and revokes
the previous one with `rotated_to_session_id` set. Row growth in
`adl_authority_sessions` is therefore expected and is not a leak; revoked and
expired rows are excluded from everything user-facing.

Since Phase 55 the retention job prunes that debris — see
[Running retention](#running-retention) — but only rows for sessions that have
**already ended**, and only once the ending is itself older than
`ADL_RETENTION_SESSION_DAYS` (default 30 days). A session that is neither
revoked nor expired, including one deep inside its offline grace, is structurally
unreachable by the prune, because pruning one would sign that person out
mid-grace with no way to tell them why. Never write a session `delete` of your
own to hurry this along.

**What a lapsed grace looks like.** The device keeps working — local reads and
local-first writes are never gated on a session, before or after the grace
lapses — and its queued work is preserved. What stops is sync: the browser
refuses to attempt it and shows a "Syncing is paused" prompt offering a fresh
passkey sign-in. Server-side, that device's session has genuinely expired, so a
client that ignored its own gate is refused with `unauthenticated` (401) anyway.
Triage consequence: a user reporting "my changes are not appearing on other
devices" while the app otherwise works is a grace-expiry report, not an outage.
Ask when they last signed in, and check for `unauthenticated` responses from
their client rather than looking for a sync failure.

**Users can list and revoke their own devices.** `POST /v1/session/list` and
`POST /v1/session/revoke` back a device list in the signed-in surface. Both are
scoped to the caller's own identity by their own session token, so there is no
operator-facing endpoint here and no way for one user to reach another's
sessions; an unknown id and someone else's id both answer `session_not_found`
(404). This is the compensating control for a grace measured in weeks. When
handling a lost-device report:

1. Have the user revoke that device from their own device list. This is the
   fastest path and needs no operator involvement.
2. If they cannot, revoking their **membership** revokes their sessions first,
   deliberately — that ends sync on the lost device's next contact regardless of
   how much grace remains, at the cost of ending their access everywhere.
3. **Data already on the device is not reclaimed, and there is no remote wipe.**
   That is intentional and cannot be made reliable for a device that never
   reconnects. Treat a lost device as a disclosure of whatever was cached on it
   at the time, and scope the incident accordingly.

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
`0004_authority_transaction_integrity.sql`,
`0005_authority_audit_scope_and_retention.sql`,
`0006_passkey_identity.sql`, `0007_model_fingerprint.sql`,
`0008_membership_projection.sql`, and `0009_retention_scheduling.sql` as
`adl_migrator`. Run the process as
`adl_authority`; it has DML only and cannot create schema objects or run
migrations. Use a pinned PostgreSQL client for any multi-statement transaction.

`0006_passkey_identity.sql` is the only migration so far that changes an
existing identity column: it moves `adl_authority_identities.subject` into
`adl_authority_identity_links` as `(provider, subject) → user_id`, backfilling
any existing row under the `legacy` provider before dropping the column, and it
adds the WebAuthn credential and challenge tables. Take the usual backup first —
the column drop is not reversible without one — and note that it is guarded on
the column still existing, so re-applying it is a no-op rather than an error.

Wire the authority with a `PostgresAuthorityUnitOfWork` (constructed from a
connection pool that hands out pinned clients). Accepted replay then commits the
accepted record, its runtime audit projection, and the actor-bound outcome in
one transaction; an infrastructure failure at any stage rolls all three back and
surfaces as a retryable error rather than a durable rejection. The in-process
backend without a unit-of-work remains test/development wiring only.

`0008_membership_projection.sql` **drops and re-creates**
`adl_authority_context_memberships`. That is safe because the table has never
had a writer and has never held a row in any deployment; Phase 54 gives it one.
It is re-keyed on `(application_id, membership_record_id)` — one row per accepted
membership record — and gains `object_name`, a `revoked_at` mirror of the
record's tombstone, and a context-scoped index. Nothing needs backfilling by
hand: the authority rebuilds the projection from the accepted records at every
start (see below).

`0009_retention_scheduling.sql` is additive and re-appliable. It creates
`adl_authority_retention_runs` — the metadata-only retention run log — and two
indexes the prune predicates need: a partial index on already-revoked sessions,
and a challenge index on `(application_id, expires_at)`. The Phase 42 session
retention index covers the same columns but not the expression the session guard
reads, which is why a further index is required rather than reused. Apply it
before scheduling retention: without the run-log table every run rolls back and
exits 1, and it cannot record why, so the structured log is the only report.

`0007_model_fingerprint.sql` adds a nullable `model_fingerprint` column to
`adl_authority_models`. It is additive and re-appliable, and it needs no
backfill: an existing row keeps a null fingerprint, which the authority treats
as "written before fingerprints existed" and backfills on its next start rather
than refusing.

Before release: backup, apply migration, run readiness and HTTP smoke tests,
then retain the previous application build until the restore point is verified.
Never run DDL through the traffic connection string.

### Startup is serialised by an advisory lock

Since Phase 54 the startup work — applying any model migration to the accepted
records, then rebuilding the membership projection — runs while the process
holds a session-level PostgreSQL advisory lock keyed on the application id
(`pg_advisory_lock(hashtext('adl_authority_startup:<applicationId>'))`). Rolling
a deployment, or starting a replica set, therefore serialises: the second process
waits, then finds the work already done. Each individual commit was already
atomic, so this closes a robustness gap rather than a demonstrated corruption.

Operationally this means one thing worth knowing: **a process that is slow to
start blocks its peers from starting.** The lock is released when startup
finishes, and also automatically if the backend dies, so it can never be held by
nobody. If a start appears to hang, look for a blocked advisory lock:

```sql
select pid, granted from pg_locks where locktype = 'advisory';
```

Never release another process's advisory lock by hand while it is still running;
terminate the stuck backend instead, which releases the lock as a side effect.

## Model versions and model migrations

There are two different things called a migration and they must not be confused.

- The ordered SQL files above migrate the authority's **projection tables**.
  They are applied out of band as `adl_migrator` and are not part of ADL.
- A `MIGRATION` block in an ADL model migrates the **accepted records** the
  projection holds. It is applied by the authority process itself, at startup,
  inside its own transaction, as `adl_authority`. It never emits DDL.

### Why a model change is now visible at all

The resolved model carries a declared `modelVersion` (`APP … MODEL_VERSION`) and
a derived `modelFingerprint`, a digest of the model's own content. Before this
existed, `modelVersion` was a platform constant with no ADL syntax behind it, so
editing model content left the version identical and the startup guard silent.
That had a security consequence rather than merely an operational one: the
authority derives its session lifetime from `app.offlineGraceDays`, so shortening
the declared grace began issuing shorter sessions while every already-running
device still believed it had the longer window, and nothing said so.

### Authoring a model migration

1. Change the model.
2. Bump `MODEL_VERSION` in the `APP` block.
3. Add a top-level `MIGRATION FROM '<old>' TO '<new>'` block describing what the
   change means for each affected object's records: `RENAME FIELD … TO …`,
   `ADD FIELD … DEFAULT …`, `DROP FIELD …`, and `SCHEMA_VERSION` where the
   object's schema version moved.
4. Compile. Validation refuses a migration that names an unknown object, renames
   into a field the model does not have, drops a field the model still has, does
   not move forward, is declared twice, or targets a version later than the
   model's own.

Skipping step 2 is not a silent success: the authority refuses to start with
`ADL_PERSISTED_MODEL_FINGERPRINT_STALE`, because the model that wrote the
persisted state is demonstrably not the model now running.

### Verifying a model migration before release

1. Restore the latest backup into a scratch database.
2. Point a staging authority at it with the new build. Starting successfully is
   the primary signal: the process applies the migration in one transaction and
   refuses to start if it cannot.
3. Check the startup log for `authority_model_migration` with
   `ADL_MODEL_MIGRATION_APPLIED` and the changed-record count. Those lines are
   metadata only — they carry codes, versions and counts, never record values.
4. Query the scratch projection for a sample of migrated records and confirm the
   shape.
5. Only then promote. Keep the backup until the restore point is verified.

### When a model migration cannot be applied

The authority refuses to start and leaves the projection **exactly as it was**.
Nothing is deleted, and no partial migration is ever committed. The refusal names
one of:

| Code | Meaning | Action |
| --- | --- | --- |
| `ADL_PERSISTED_MODEL_VERSION_MISMATCH` | No declared migration reaches the persisted version. | Deploy a build whose model declares a `MIGRATION` from that version. |
| `ADL_PERSISTED_MODEL_FINGERPRINT_STALE` | Same declared version, changed content. | Bump `MODEL_VERSION` and declare the migration. |
| `ADL_MIGRATION_PERSISTED_VERSION_AHEAD` | The projection is newer than this build. | This is a downgrade. Redeploy the newer build; do not "fix" the data. |
| `ADL_MIGRATION_FAILED` | The migration transaction rolled back. | The projection is unchanged and still at the old version. Treat as an infrastructure fault, investigate, retry. |

Rolling back an application build across a model migration is not supported by
the migration mechanism itself, because migrations only move forward. Roll back
by restoring the backup taken before the release, which is why step 5 above keeps
it until the restore point is verified.

The same mechanism runs in the browser over IndexedDB, so a device that has been
offline across several releases migrates its local records on next open. Two
things are deliberately never touched there: the cached identity, which is not a
record and is what stops a signed-in user losing their own data on an offline
reload; and the pending sync queue, whose operations are transformed by the same
declared steps but never created or discarded.

## Running retention

Four authority projections grow with time rather than with the accepted-record
set: runtime audit (`adl_authority_audit_events`), operation outcomes
(`adl_authority_operation_outcomes`), sessions (`adl_authority_sessions`, one
row per rotation) and ceremony challenges
(`adl_authority_webauthn_challenges`, one row per started ceremony). Phase 55
gives all four a single operator-driven prune path with a run log, metrics and
structured log events.

**Nothing prunes until you ask for it.** A deployment that has never configured
retention has no in-process schedule and deletes nothing. That is the intended
default: an unconfigured deployment grows, it does not silently discard
evidence.

### What is pruned, and what is never pruned

| Projection | Eligible when | Window |
| --- | --- | --- |
| `adl_authority_audit_events` | `occurred_at` is before the effective cutoff | `ADL_RETENTION_MINIMUM_DAYS` |
| `adl_authority_operation_outcomes` | `accepted_at` is before the effective cutoff | `ADL_RETENTION_MINIMUM_DAYS` |
| `adl_authority_sessions` | the session has **already ended** — revoked, or past its expiry — and that ending is before the cutoff | `ADL_RETENTION_SESSION_DAYS` |
| `adl_authority_webauthn_challenges` | the challenge is **finished** — consumed, or expired — and that ending is before the cutoff | `ADL_RETENTION_CHALLENGE_DAYS` |

Each window is a floor, not a preference. The requested cutoff is clamped to no
later than `now - window` for each projection independently, so asking for a more
recent cutoff cannot reach an in-retention row. The session and challenge guards
read "whichever ending came first" — `least(coalesce(revoked_at, expires_at),
expires_at)` — which is what makes a live row structurally unreachable: for a
session that is neither revoked nor expired the expression is `expires_at`,
which is in the future, while the cutoff is always in the past. A ceremony in
flight and a session inside its offline grace are therefore safe from a run that
happens to overlap them.

**What retention never touches, in any mode:**

- `adl_authority_records` — accepted records, tombstones included.
- `adl_authority_identities`, `adl_authority_identity_links`,
  `adl_authority_webauthn_credentials`.
- `adl_authority_invites`.
- `adl_authority_context_memberships`. This one matters most. It is a **derived**
  projection holding one row per accepted membership record, so it is bounded by
  the record set rather than by time and needs no pruning at all — and deleting a
  row there would remove a live membership from resolution **without removing the
  membership**, which is access loss with no audit trail and no record change
  behind it. It is deliberately absent from the prunable list in
  `authority-retention.ts` and must stay absent.

Pruning an ancient outcome only means that long-past operation id is no longer
idempotency-cached. Accepted state and the Phase 44 atomicity guarantees are
unaffected.

### Configuration

The retention job reads a deliberately small environment. It needs
`ADL_DATABASE_URL`, `ADL_APPLICATION_ID`, and the variables below — and **not**
the rest of the authority configuration. It requires no allowed origins, no
identity verifier, no relying party and no cookie policy, so the safest way to
run retention is also the simplest one to configure.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADL_RETENTION_MINIMUM_DAYS` | 365 | Minimum retention for runtime audit and outcomes. Rows newer than this are never pruned. |
| `ADL_RETENTION_SESSION_DAYS` | 30 | How long an **ended** session row is kept after it ended. |
| `ADL_RETENTION_CHALLENGE_DAYS` | 1 | How long a **finished** challenge row is kept after it finished. |
| `ADL_RETENTION_LEGAL_HOLD` | unset | `true` refuses every prune. Any other value, including unset, does not. |
| `ADL_RETENTION_INTERVAL_MINUTES` | unset | Interval for the authority process's own in-process schedule. **Absent means no schedule at all**, which is the default. |

Each day/minute value must be a positive integer; anything else is a startup
configuration error rather than a silent fallback. Set
`ADL_RETENTION_MINIMUM_DAYS` to at least your legal audit-retention period.

The in-process schedule, when enabled, runs inside the authority process. Its
first tick is one interval away rather than at startup, so a restart loop cannot
become a prune loop, and the timer is unreferenced so it never holds the process
open.

### The one-shot entry point

```sh
npm run retention           # one real run, then exit
npm run retention:dry-run   # report what would be pruned, delete nothing
```

Both compile the server sources first. On a deployed host with `dist-server`
already built — a container image, a release artifact — invoke the compiled entry
directly instead, which is what `cron`, a Kubernetes `CronJob` or a systemd timer
should call:

```sh
node dist-server/src/server/authority-retention-main.js [--dry-run]
```

It prints one line: the run's own metadata-only JSON summary, which the runner
has already written to the structured security log and the run log. A run that
faulted carries `failureCode`, a reduced fault name such as `Error 42P01`. A
configuration refusal that never reaches a run prints the error's name and
message on stderr — and nothing else, because a stack, a cause or a
configuration dump could carry a connection string.

**The exit code is the contract for the scheduler**, so a wrapper can alert
without parsing text:

| Exit code | Meaning |
| --- | --- |
| 0 | The run completed, was a dry run, or was held by legal hold. |
| 1 | The run failed, or the configuration was refused. |

Note that a legal hold exits 0. It is a policy state, not a fault; alert on it
from the `retention_run_held` event or the run log rather than from the exit
code.

Keep the connection string out of the crontab. Put it in a mode-0600 environment
file and invoke a small wrapper, because `cron` gives the job almost no
environment of its own:

```sh
#!/bin/sh
# /usr/local/bin/adl-retention
set -eu
set -a
. /etc/adl/retention.env    # ADL_DATABASE_URL, ADL_APPLICATION_ID, ADL_RETENTION_*
set +a
exec node /srv/adl/dist-server/src/server/authority-retention-main.js "$@"
```

```cron
17 3 * * * /usr/local/bin/adl-retention >> /var/log/adl/retention.log 2>&1
```

Daily is a reasonable default, because every window is measured in days. Running
it more often is safe but achieves little: a run with nothing eligible simply
records zero and releases the lock.

### Enabling it safely

1. Apply `0009_retention_scheduling.sql` as `adl_migrator`.
2. **Get legal approval before enabling pruning at all.** Retention deletes
   audit evidence. That is a records-management decision, not an operational one.
3. **Run a dry run and inspect it before configuring any schedule.** A dry run
   reads the same predicates the real run deletes with, so its counts are the
   counts rather than an estimate from a differently-shaped query. Confirm the
   per-projection numbers are what you expect for this deployment's age and
   traffic. A surprising number is a reason to stop, not to proceed.
4. Only then either add the cron entry, or set `ADL_RETENTION_INTERVAL_MINUTES`
   and restart the authority process.

A dry run deletes nothing, still writes a run record with outcome `dryRun`, and
increments no deletion counter.

### Overlapping runs are safe

Every run takes a session-level PostgreSQL advisory lock keyed per application:

```text
pg_advisory_lock(hashtext('adl_authority_retention:<applicationId>'))
```

It is held for the duration of the run and released in a `finally`, and a
contender **waits** rather than skipping — so a cron invocation and an
in-process schedule, or two schedulers, may overlap freely and the second simply
proceeds once the first has committed. `hashtext` keys it per application, so
unrelated applications sharing one database never serialise against each other,
and a crashed process releases the lock when its backend ends, so it can never
be held by nobody.

Inside the lock, the four deletes and the run record commit together on one
pinned client. A failure part-way through therefore leaves every projection
exactly as it was, rather than half-pruned with no record of it.

If a run appears to hang, look for a blocked advisory lock exactly as you would
for a blocked startup:

```sql
select pid, granted from pg_locks where locktype = 'advisory';
```

Never release another process's advisory lock by hand while it is still running.
Terminate the stuck backend instead, which releases the lock as a side effect.

### The run log

`adl_authority_retention_runs` is the durable evidence that retention happened.
It is **metadata-only by construction**: every column is a count, an instant, a
boolean, an outcome name, or a short reduced fault name such as `Error 42P01`.
No column could hold an accepted record, an audit payload, a session token or
verifier, an invite token, or an outcome body — which is why it is safe to
return from an operator status surface and safe to include in a support bundle.

It is **self-trimming**: recording a run also trims that application's history to
the most recent 200 rows, in the same transaction, so the table that exists to
prove retention happened does not itself become a fifth thing needing retention.

Include it in backup, restore and legal-retention procedures alongside the other
authority projections. It is the only place a completed run's counts survive
after the log has rotated.

Outcomes recorded there are `completed`, `dryRun`, `held` and `failed`. A failed
run is recorded after its rollback, on the same pinned client, so an operator can
see that a run failed and when — except where the failure is that the
application id is unknown to this database, in which case the foreign key refuses
the row and the structured log is the only report.

### Observability

Metrics counters, exposed by `AuthorityMetrics.prometheus()`:

| Metric | Labels |
| --- | --- |
| `adl_authority_retention_runs_total` | `outcome` = `completed` \| `dryRun` \| `held` \| `failed` |
| `adl_authority_retention_deleted_total` | `projection` = `runtimeAudit` \| `outcomes` \| `sessions` \| `webauthnChallenges` |

Deletion counters are incremented only for a `completed` run, so a dry run adds
nothing to them.

Structured security log events, all metadata-only — counts, a cutoff, an outcome
and a run id, never a row, payload or driver message:

| Event | When |
| --- | --- |
| `retention_run_started` | at the start of every run, before the lock is taken |
| `retention_run_completed` | a completed or dry run |
| `retention_run_held` | legal hold refused the prune (`outcome: "denied"`) |
| `retention_run_failed` | the run faulted (`reason` is the reduced fault name) |

Where to read those counters depends on which path ran:

- **The in-process schedule.** `createAuthorityProcess` gives the retention
  runner and the HTTP edge the same `AuthorityMetrics` and the same logger, so a
  scheduled run's counters appear on the authority's `/metrics` alongside every
  request counter, and its log events appear in the same stream.
- **The one-shot entry point.** It is a short-lived process with no endpoint to
  scrape, by design — a cron job should not have to open a port. Its evidence is
  the structured log line it writes and the row it commits to
  `adl_authority_retention_runs`.

Whichever path a deployment uses, the durable record is
`adl_authority_retention_runs` plus the four log events. Alert on absence rather
than on failure alone: treat "no `retention_run_completed` in the last N
intervals" as the signal that retention has stopped happening, because a job that
never ran emits nothing at all.

### Reading retention status from the browser

An operator who is already authorised to administer a business context can read
retention status from the application's administration surface: it shows whether
this deployment runs an in-process schedule and at what interval, whether legal
hold is set, the three configured windows, and the last run's outcome, cutoff and
per-projection counts.

It is a **read, and only a read**. There is no button that runs retention, no dry
run, and no cutoff argument, and `POST /v1/admin/retention/status` has no
counterpart that triggers one. That is deliberate: retention is application-wide
while every administration authorisation in this system is scoped to one business
context, so a trigger reachable from a context-scoped session would hand a
context manager a destructive deployment-wide action they do not otherwise have.
Running retention stays with whoever can start the scheduled process.

If the surface reports that retention status is unavailable, the deployment has
composed no retention path — it is not a permission message. If it reports a
schedule but the last run is old or absent, check the cron wrapper's exit codes
and the structured log before changing any window.

## Backup, recovery, and retention

Take encrypted daily logical backups and point-in-time WAL backups. Include all
`adl_authority_*` tables: accepted records, model metadata, memberships,
session/invite verifiers, outcomes, runtime audit, and access audit — and, since
Phase 49, `adl_authority_identity_links` and
`adl_authority_webauthn_credentials`. Those two are as recovery-critical as the
identity rows themselves: losing the links orphans every identity from its
credential, and losing the credentials locks every member out until each one is
re-admitted through a recipient-bound invite. They contain no secrets (a
credential id, a COSE public key and a counter), so they need no handling beyond
the existing encrypted backup. `adl_authority_webauthn_challenges` is transient
ceremony state and need not be restored. Retain 35
daily, 12 monthly, and the current legal/audit retention period; get legal
approval before deleting audit data. Ended session rows are pruned by the
retention job above rather than by a job of your own; invite verifier rows are
not pruned by anything in this repository, and a job that removes claimed,
revoked or expired ones only after 35 days remains the operator's own. No such
job may ever delete accepted records.

Runtime audit (`adl_authority_audit_events`), operation outcomes
(`adl_authority_operation_outcomes`), sessions and ceremony challenges have a
bounded, safeguarded retention path. Phase 45 built the prune; Phase 55 gives it
a schedulable process entry, a run log, metrics and log events. The whole
operating procedure — variables, the one-shot entry, the exit-code contract,
overlap safety, and what is and is not prunable — is
[Running retention](#running-retention). Obtain legal approval before enabling
it, and inspect a dry run before configuring any schedule.

`adl_authority_retention_runs` (Phase 55) is the metadata-only run log. Include
it in the same backup, restore-count and legal-retention process as the other
projections. It self-trims to the most recent 200 runs per application, so it
needs no retention job of its own, and it holds no accepted record, audit
payload, verifier or outcome body — only counts, instants, outcomes and reduced
fault names.

`adl_authority_audit_events` is now a populated transactional projection (Phase
39 defined it; Phase 44 writes it inside the accepted-replay transaction).
Restore it together with the accepted-record and outcome projections; a restore
that recovers outcomes but loses their referenced records is inconsistent.

`adl_authority_context_memberships` became a populated projection in Phase 54
(Phase 39 defined it; it had no writer until then). It is **derived**: the
accepted membership record stays authoritative and the projection only indexes
it, so a restore that recovers the accepted records but loses this table is
repaired automatically at the next start, which rebuilds it from those records
under the startup advisory lock. Back it up with everything else anyway — the
rebuild is a safety net, not a substitute for a complete backup — but never
restore it *without* its accepted records: a projection row with no backing
record is an inconsistency, not a membership.

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
   `orphanRecords`, `auditScopeInconsistent`, `membershipProjectionMissing`,
   `membershipProjectionOrphaned`, and `membershipProjectionStale`, and must report
   `consistent: true`. A non-zero `acceptedOutcomeRecordsMissing`, `orphanRecords`,
   or `auditScopeInconsistent` (a half-populated runtime-audit context scope, e.g.
   from a bad migration or restore) means an inconsistent set; do not switch
   traffic. The three membership counters mean, respectively: an accepted
   membership record with no projection row (its holder would resolve no
   context), a projection row with no accepted record behind it, and a row whose
   revoked state disagrees with its record. Restarting the process rebuilds the
   projection from the accepted records and clears all three — but treat an
   **orphaned** row as a warning first: it means the restored record set is
   missing a membership the projection still knew about, so the rebuild would
   quietly delete the evidence. Restore the record set again before starting on
   it. Outcomes are
   application-scoped since Phase 45, so the outcome count is per application.
   `AuthorityProjectionIntegrity.recoveryStatus` backs the administration recovery
   view with the same result and prints no protected JSON.
5. Run `/readyz`, an authenticated bootstrap, an idempotent replay retry, an
   invite claim fixture, and a revoked-session rejection against the restored
   instance. Record backup id, recovery point, elapsed time, and results.
6. Destroy the isolated restore and rotate any credentials used for the drill.

## Incidents

**Suspected session compromise:** revoke the affected user's sessions, revoke
membership if access itself is suspect, rotate the session cookie on next login,
preserve redacted security/access events, and force a policy-shaped bootstrap.

**Cloned authenticator suspected (`ADL_PASSKEY_COUNTER_REGRESSED`):** follow
[When a signature counter regresses](#when-a-signature-counter-regresses). Never
reset a stored signature counter as a remedy.

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
