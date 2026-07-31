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

Everything the Phase 39 slice left open is now either implemented in a later
phase or still explicitly outstanding:

- Remote bootstrap and browser reconciliation — Phase 40, below.
- Identity, invites and access lifecycle — Phase 41, below.
- HTTP edge, deployment configuration and operations — Phase 42, below.
- Reporting and administration — Phase 43, below.
- Transactional projection integrity — Phase 44, below.
- Audit scope and retention — Phase 45, below.
- A runnable process, a client transport and an identity boundary — Phase 46,
  below.
- Conflict/rejection recovery, sign-in and invite-claim UI, and the offline
  shell — Phase 47, below.

- Offline operation identity and accepted-state convergence — Phase 48, below.
- Passkey identity and provider-independent identity keying — Phase 49, below.

- Offline session lifetime and sync grace — Phase 50, the **second half of the
  deployment gate**, since Phase 49 makes signing in real and Phase 50 makes
  staying signed in survive being offline.
- Conformance depth and model migrations — Phase 51.
- Conformance expressiveness — Phase 52.
- Sync-mode delivery and authority coherence — Phase 53.
- Membership projection and scoped access — Phase 54, below.
- Retention scheduling and the administration UI — Phase 55, below.

Still outstanding, in sequence order: reference-app gaps and documentation
hygiene (Phase 56). Outside the
phase plan: TLS termination, secret
management, CI/CD, and a hosting provider decision. The identity method itself is
no longer open — see
[ADR 0008](adr/0008-passkey-identity-and-offline-session-grace.md).

## Remote bootstrap and browser reconciliation

Phase 40 adds `AuthorityService.bootstrap(...)`. It accepts only a verified
session and an optional selected business context. The service derives identity
and context roles server-side, excludes `localPrivate` objects, and passes every
accepted record through normal runtime context-scope and read-policy shaping
before it is returned. Denied rows and invalid context selection both produce
an empty result; they are not distinguishable to the caller. Cursors are opaque,
bounded, and advance only through records already visible to that caller.

`AuthoritySyncClient` submits every queue entry: Phase 53 added `onlineRequired`
to the modes that queue, so an accepted online-required write has a delivery
path instead of being persisted locally and never sent. It also refuses a
`localPrivate` replay at the authority (`ADL_SYNC_POLICY_DENIED`), symmetrically
with `cacheReadonly`, so no accepted record can exist that the bootstrap above
would then withhold from every device. See
[runtime semantics](spec/runtime-semantics.md#each-modes-relationship-to-the-authority)
for the mode-by-mode statement of what is sent, accepted and returned.
The IndexedDB `syncState` database persists queue entries and operation-log
outcomes separately from object records, with a model-version startup guard.
Conflict outcomes carry only a deterministic recovery strategy from the resolved
object sync policy (`serverWins`, `clientWins`, `stateTransitionWins`, or
`manual`); protected authority records are never attached to a conflict.

The client applies accepted and bootstrap records through the runtime's trusted
sync-projection path. That path creates no new operation-log, audit, or queue
side effect and marks the local projection `synced`; user-facing reads still go
through normal `ApplicationRuntime` policy checks. The recovery surface that
Phase 40 deferred is delivered by Phase 47, below; a non-accepted outcome no
longer discards the queue entry.

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

## Transactional projection integrity

Phase 44 makes accepted replay atomic. `PostgresAuthorityUnitOfWork` owns one
pinned client and the `begin`/`commit`/`rollback` boundary; inside it a
transaction-scoped `ApplicationRuntime` (over `PostgresObjectStorageBackend` in
ambient-transaction mode) writes the accepted record, the runtime audit
projection is persisted into `adl_authority_audit_events`, and the actor-bound
outcome is inserted — all in the same transaction. The outcome insert is the
concurrency gate: a duplicate submission that races past the idempotency
pre-check finds the outcome already present and rolls its record write back
instead of committing a second accepted record. Multi-record commands keep their
existing all-or-nothing semantics through the same boundary.

A deterministic runtime rejection or revision conflict is persisted durably in a
short outcome-only transaction so a later retry stays idempotent. A
non-deterministic infrastructure failure rolls the whole transaction back and
surfaces (retryable) rather than being cached as a false verdict — the runtime
stays the semantic authority and SQL never reimplements policy, validation,
lifecycle, or command logic. Invite creation/revocation and membership
revocation likewise commit their invite or record change together with their
access-audit event.

`AuthorityProjectionIntegrity` provides restore verification: metadata-only
counts plus `consistent`, `acceptedOutcomeRecordsMissing`, `orphanRecords`, and
`auditScopeInconsistent`, computed with parameterised SQL and never printing
accepted values, audit payloads, tokens, or outcome bodies.
`0004_authority_transaction_integrity.sql` adds the runtime-audit review index;
apply it with `adl_migrator`.

## Audit scope and retention

Phase 45 makes runtime-audit review context-scoped in the projection and gives
runtime audit and outcomes a bounded retention lifecycle.
`0005_authority_audit_scope_and_retention.sql` adds `context_name`/`context_id`
to `adl_authority_audit_events` and `application_id` to
`adl_authority_operation_outcomes`, plus the supporting indexes; apply it with
`adl_migrator`.

The unit-of-work stamps each audit row with the record's business context,
derived only from the model's declared object scope (`ResolvedObject.scope`) —
the context id is the record's scope-field value, not a reimplemented policy.
Unscoped (global) objects leave both columns null and never appear in a
per-context review. `PostgresAuthorityAdministrationStore.listRuntimeAudit` now
filters to one authorised context in SQL, so a bounded page is neither dominated
nor emptied by other contexts' events; `AuthorityAdministrationService`
`runtimeAudit` still applies the per-row runtime read as the final disclosure
boundary, and an inaccessible row is never an existence oracle.

`AuthorityRetentionService.prune` is the application-scoped retention path for
runtime audit and outcomes. It deletes only rows older than an effective cutoff
clamped to no later than `now - minimumRetentionMs`, so in-retention rows are
never removed; it refuses under `legalHold`, throws on a non-positive minimum
window, and never touches accepted records, sessions, invites, or identities.
Its result is metadata-only (counts and the effective cutoff). Operational
detail is in `docs/operations/authority-production-runbook.md`.

## Membership projection and scoped access

Phase 54 gives `adl_authority_context_memberships` a writer and makes the four
membership reads scope-indexed. `0008_membership_projection.sql` re-creates the
table keyed on `(application_id, membership_record_id)` with `object_name`, a
`revoked_at` mirror of the record's tombstone, and both a user-scoped and a
context-scoped index; apply it with `adl_migrator`. It had held no row in any
deployment, so re-creating it loses nothing.

**It is derived, and the record stays authoritative.** A projection row is a
pointer to an accepted membership record, carrying only the three fields the
model already declares as that membership's user, context and role. Every caller
reads the record it names through storage and applies the runtime's read policy,
which remains the disclosure boundary. The index narrows the candidate set; it
never authorises, never re-derives a role, and never becomes an ADL construct —
the same division Phase 45 established for runtime-audit context scope. An index
that returned a stale or extra candidate costs an extra read; it cannot grant a
membership.

**It is written inside the boundary that changed the record.**
`PostgresObjectStorageBackend` maintains it on every accepted record write, so it
joins the authority unit-of-work's transaction under an ambient transaction and
covers ordinary replay, commands, and migration rewrites without any caller
having to remember. `PostgresAuthorityAccessStore` writes `adl_authority_records`
with its own SQL, so it also syncs the projection inside its own store
transaction: an invite claim's grant, its access-audit event and its projection
row commit or roll back together, and so do a revocation's tombstone, audit event
and row. A membership record whose declared user/context/role fields are not all
present as non-empty strings is not indexable and gets no row — it is exactly the
record membership resolution already skips.

**Four reads are now scoped.** `ContextMembershipIndex` is an optional runtime
port: the authority supplies `PostgresContextMembershipIndex`, and a device
supplies nothing and keeps its existing scan, which is correct for a device-sized
dataset.

| Read | Before | After |
| --- | --- | --- |
| Membership resolution (`RuntimeContextService`, on every bootstrap and replay) | scan all accepted records | rows for one user in one business context |
| Membership review (`AuthorityAdministrationService.memberships`) | scan all accepted records, filter in memory | bounded page for one context instance |
| Membership-manager check (`AuthorityAccessLifecycleService`) | scan all accepted records | rows for one user in one business context |
| Target-access check (`revokeUserSessions`) | scan all accepted records | rows for one user in one business context |

Review keeps revoked rows so a revoked membership is still reported as `revoked`
rather than silently omitted; resolution and access checks read only rows whose
`revoked_at` is null, and then confirm against the record itself.

**Startup rebuilds it, under an advisory lock.** The process holds
`pg_advisory_lock(hashtext('adl_authority_startup:<applicationId>'))` while it
applies any model migration and then rebuilds the membership projection from the
accepted records. The rebuild is idempotent and derives everything from accepted
records, so it can neither invent nor drop a membership; it brings up a
projection that predates its writer, one left behind by an out-of-band restore,
and one whose records a migration hop just rewrote. The lock means two processes
starting at once cannot both plan and apply the same hop or rebuild over each
other. `AuthorityProjectionIntegrity` reports
`membershipProjectionMissing`/`Orphaned`/`Stale` as metadata-only counts.

## First deployment slice

Phase 46 makes the authority a process that runs, gives it a switchable identity
boundary, and closes the browser-to-server loop.

**Identity switch.** `ADL_IDENTITY_VERIFICATION` selects the upstream verifier
and defaults to `bypass`. While it is `bypass`, no provider is contacted and the
supplied account proof is accepted as the identity subject; the proof is still
shape-checked, so a control character or an over-long value can never reach
identity storage. This is a deliberate, temporary development state pending a
real provider decision, and it is never silent: `selectUpstreamIdentityVerifier`
is disclosed in the `identity_verification_configured` startup security event and
in the `/readyz` body as `{ mode, verifier, bypassed }`. Setting the switch to
`upstream` without supplying a provider selects
`UnconfiguredUpstreamIdentityVerifier`, which rejects every proof with
`authentication_failed` — turning verification on never falls back to the
bypass. Phase 46 additionally allowed the bypass in production behind an
explicit `ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true`; **Phase 49 removes that escape
hatch entirely** — a production process now refuses to start in `bypass` at all
(see below).

Bypassed verification widens nothing else. Sessions are still opaque tokens
stored as SHA-256 verifiers, the request still cannot set a user id, role, audit
actor, accepted revision or timestamp, and context roles are still resolved from
accepted membership records through the runtime on every call.

**Runnable process.** `createAuthorityProcess` composes deployment
configuration, a real `pg` pool, PostgreSQL identity/session, record, outcome,
access and administration stores, the Phase 44 unit-of-work and the Node HTTP
adapter, and registers the application's model metadata row. Migrations stay out
of band with the migration role. `npm run start:authority` builds the server
sources and runs it. The resolved model is compiled from `ADL_MODEL_PATH`, so
the process serves the same ADL project the browser runs.

**Client transport.** `HttpAuthorityTransport` is the browser implementation of
`AuthorityTransport`. It carries only the Phase 42 credentials: the `__Host-`
Secure HttpOnly SameSite=Strict session cookie the user agent attaches, and the
readable double-submit CSRF cookie mirrored into `x-adl-csrf-token`. The raw
session token is unreadable to client code by design, so the `sessionToken`
parameter is ignored on that path. A network failure or non-2xx response raises
`AuthorityTransportError` rather than a fabricated outcome, which keeps the
queued operation retryable instead of recording a false verdict.

`AuthoritySyncClient.bootstrap` now follows `nextCursor` to exhaustion. Applying
only page one silently dropped permitted records; the walk stops on an empty
page or a repeated cursor rather than trusting the server to terminate it.

`reconcile` now resolves queue entries through `ObjectStore.getRecordForSync`, a
trusted tombstone-inclusive lookup. It previously used the active-record read,
so a queued delete — which by definition has no active local row — was skipped,
left in the queue, and never reached the authority.

**Browser identity.** `/v1/session/issue` and `/v1/session/current` return the
server-derived `userId` for that session and nothing else, so the browser can set
`RuntimeContext.userId` without ever being trusted to supply it. Authority sync
is opt-in through `VITE_ADL_AUTHORITY_URL`; when it is unset the browser demo
stays entirely local, which keeps the visual verification suite meaningful.

## Usable sync slice

Phase 47 makes the deployment slice usable by a person: settled operations get a
recovery surface, identity is established by signing in, and the application
shell loads offline.

**Recovery.** A non-accepted outcome no longer discards the queue entry. The
verdict is stored on the entry as `SyncQueueEntryRecovery` (status, code,
message, and the conflict strategy the server reported), so it survives a reload
through the existing persisted sync state. `AuthoritySyncClient.reconcile` sends
only entries with no verdict, so a settled operation is never resent behind the
user's back.

Resolution collapses to two primitives, and neither invents a winner:
`keepServer` abandons the local operation so the authority's state stands, and
`resubmitMine` sends the same operation again under a fresh operation id
(`<opId>-r<n>`), rebased on the authority's current revision, for the authority
to judge exactly as it judges any other replay. The model's declared conflict
policy chooses between them — `serverWins` keeps the server version, `clientWins`
resubmits, `stateTransitionWins` resubmits only a queued lifecycle transition and
keeps the server version otherwise, and `manual` presents the user those two
bounded choices. A rejection is terminal: it carries no strategy, `keepServer` is
its only permitted resolution, and it is never resubmitted. A transport failure
is still not a verdict — it propagates and leaves the entry replayable.

Order matters in `synchronize`: reconcile, then bootstrap, then apply automatic
recovery. `keepServer` relies on the bootstrap having already replaced the local
record, and `resubmitMine` rebases on the revision the bootstrap wrote. A user's
`keepServer` resolution is followed by a bootstrap for the same reason, so
"keep the server version" is true locally rather than merely a dropped queue
entry. The recovery surface itself carries only queue and verdict metadata: no
record value ever reaches it, so a conflict cannot disclose a server record the
caller could not read through a normal runtime read.

**Sign-in and invites.** Phase 46's `VITE_ADL_ACCOUNT_PROOF` and `?account=`
development configuration are removed; a person signs in through the UI, and
`VITE_ADL_AUTHORITY_URL` alone enables the authority path. The browser reads
`/readyz` to learn whether the authority runs a bypassed verifier, and when it
does the sign-in surface carries a development-mode warning in both the
signed-out and the signed-in state. An unreachable authority reports
`unavailable` and is still treated as development: a missing or unreadable flag
is never read as a verified deployment. The `admin-ui` fixture constant is
retired in favour of `LOCAL_DEMO_IDENTITY` (`local-demo-device`), which is
explicitly a local demo device identity and is replaced by the server-derived
identity whenever an authority is configured. With no authority configured there
is no bridge and no session, invite or recovery chrome at all.

Claiming an invitation is online-only and server-authoritative. An offline claim
is refused in the bridge before any request is made — proven over a real socket
by asserting that nothing reached the wire and that no access-audit row was
written — and the granted context's records appear only on the bootstrap that
follows the server's confirmation.

**Offline shell.** `public/manifest.webmanifest` and a service worker built to
`dist/sw.js` give the application shell an offline load path;
`registerAdlServiceWorker(model.modelVersion)` registers `/sw.js?v=<version>`
and the worker caches under `adl-shell-<modelVersion>`. A model-version change is
therefore both a different worker URL and a different cache name, and `activate`
purges every other `adl-shell-*` cache before claiming clients — reusing the
existing startup compatibility guard's notion of version rather than adding a
second versioning scheme. Registration is production-only; a non-production build
proactively unregisters a stale worker.

The cache boundary is a security boundary. It refuses non-GET requests,
cross-origin requests, any `/v1/` path, non-ok/opaque/error responses, responses
carrying `set-cookie`, responses marked `no-store` or `private`, and JSON bodies.
The single narrow exception is the web app manifest, identified structurally
(destination `manifest` or a `.webmanifest` path); it cannot match an authority
body because `/v1/` is refused first. Records stay in IndexedDB under the
existing runtime persistence boundary.

The offline-create duplication defect Phase 47 recorded here is fixed by Phase
48, below.

## Offline operation identity

Phase 48 makes an offline-created record converge to a single accepted record.
Before it, a create intent carried values and no record id, so the authority
minted its own: the accepted record came back under an id the browser had never
seen, `reconcileRemoteRecord` created a *second* local row, and the originating
row kept its local guid and `syncStatus: "local"` forever — its queue entry
already discarded as accepted, so nothing would ever resend or reconcile it. A
hermetic fake had masked this for two phases by echoing the client's guid back;
only a real authority over real PostgreSQL exposed it.

**The create intent now carries `recordId`, and it is required.** The client names
the record it already holds, and the authority accepts the record under that id,
so an update, delete or transition issued immediately afterwards addresses the
same id with no translation step. This is a breaking wire-contract change: a
create request without a `recordId` is answered `malformed_request` (400).

**A client-supplied id is an identifier, never an authorisation.** Naming a record
grants nothing. The caller may not assert revision, actor, timestamps, accepted
state or scope; every one of those stays server-derived, as it was before.

**The id is untrusted input and is shape-checked at both layers.** It must be a
non-empty string of at most 320 characters with no surrounding whitespace and no
control characters — the same rules `BypassIdentityVerifier` applies to an
identity subject, because a NUL in a text key is a real PostgreSQL failure (the
Phase 44 `audit_id` defect). `isValidRecordId` is enforced by the HTTP edge
(`malformed_request`, 400) and independently by the runtime
(`ADL_RUNTIME_RECORD_ID_INVALID`); neither layer assumes the other ran. Unlike an
identity subject, the id is never trimmed first: the accepted record has to come
back under the exact id the caller holds, so a padded id is refused rather than
silently rewritten into a different one.

**A collision is a rejection, and it is terminal.** A create whose id already
names a record — a tombstone included, so a create cannot resurrect a deleted
record — is refused with `ADL_RUNTIME_RECORD_ID_TAKEN`. It is never an overwrite,
a merge, or a silent adoption of the existing record. The refusal surfaces through
the Phase 47 recovery path as an ordinary rejection: no strategy, so automatic
recovery leaves it alone, and `keepServer` ("Dismiss") is its only permitted
resolution. Asking to resubmit one falls back to abandoning it, so a refused write
can never be resurrected as accepted. A collision is deliberately *not* modelled
as a conflict: `resubmitMine` would resend the same id forever, and there is no
client-side primitive that re-mints an id, by design.

**The refusal is checked in the runtime, before storage.** `PostgresObjectStorage`
writes a create with a plain `insert`, so an undetected collision would raise a
unique violation — not a `RuntimeError`, therefore classified as a retryable
infrastructure failure that the client would replay forever. The guard also runs
*after* the create is otherwise authorised, so an unauthorised caller is denied
rather than told whether an id exists.

**Idempotency stays keyed on the operation id, not the record id.** A retried
create returns the stored outcome and applies once. A *different* operation
reusing an accepted record's id is a new operation and is refused as a collision —
the record id never becomes a second idempotency key.

**Command-produced records need no separate treatment.** The sync client never
emits a `command` intent: a locally executed command enqueues an ordinary create
or update operation per step, each carrying its own local record id, so each
replays through the create path above. The `command` intent variant remains
reachable only by a caller invoking the service directly, where the authority
mints ids for steps no client holds. If a future phase makes commands replayable
*as commands*, each step would need a client-supplied id.

**No stranded local rows exist to converge, and this is evidence, not
assumption.** The duplication only occurs on a replay, and a replay only happens
when the browser bundle was built with `VITE_ADL_AUTHORITY_URL` set — with it
unset there is no bridge, no sync client, and no create ever leaves the browser.
No deployment exists that could have set it: the repository has no deployment
artifact, container image, CI pipeline or hosting configuration; the only
committed environment file is `.env.authority.sample`, a sample with `CHANGE_ME`
placeholders; `start-local.sh` and the Playwright visual suite both run with the
variable unset; and the authority entrypoint itself first landed in Phase 46, two
phases ago. The one observed instance of the defect was produced by a Phase 47
integration test against a throwaway PostgreSQL container that is destroyed with
the run. A convergence sweep would therefore be code that deletes user rows on
inference with no population to fix, so none was added. A developer whose own
browser profile holds an orphan from a manual Phase 47 session can clear site data
for the origin.

## Passkey identity and provider-independent keying

Phase 49 replaces the identity bypass with a credential the authority verifies
itself, and re-keys identity so the provider, the method, or the decision to use
one at all can change later without re-keying user data. The decision is
[ADR 0008](adr/0008-passkey-identity-and-offline-session-grace.md).

**Identity is keyed on an internal `userId`, with linkable external
identifiers.** `AuthorityIdentity` is now `{ userId, createdAt, disabledAt? }`
and carries no external identifier at all. Every one of those lives in
`adl_authority_identity_links` as `(application_id, provider, subject) → user_id`
(`0006_passkey_identity.sql`, which backfills any pre-existing `subject` under
the `legacy` provider before dropping the column). `provisionIdentity(provider,
subject)` resolves the identity holding that pair and mints one only on a miss,
and `linkIdentity(userId, provider, subject)` adds a further identifier to an
existing identity — refusing an identifier already held by a different identity
rather than silently re-pointing it. Changing provider, adding a second method,
or running two in parallel is therefore linking an identifier, never re-keying
the `userId` that memberships, sessions and audit rows all reference. One
identity holding both a `passkey` and an `upstream` subject resolves to the same
`userId` through either.

**The third identity-verification mode.** `ADL_IDENTITY_VERIFICATION` accepts
`passkey | upstream | bypass`. In `passkey` mode the authority verifies a
WebAuthn assertion it challenged itself, so there is no bearer proof to exchange:
`PasskeyIdentityVerifier` refuses every proof and `/v1/session/issue` answers
`endpoint_unavailable` (503), so a passkey deployment keeps no second, weaker way
in. The active mode is still disclosed exactly as before, in the
`identity_verification_configured` startup security event and in `/readyz` as
`{ mode, verifier, bypassed }` (`{ mode: "passkey", verifier: "passkey",
bypassed: false }`). **The bypass is now development-only**: a `production`
configuration in `bypass` is refused by `loadAuthorityConfiguration`, and the
Phase 46 `ADL_IDENTITY_BYPASS_ACKNOWLEDGED` acknowledgement no longer exists —
there is deliberately no way for an operator to opt production back into
accepting an unverified identity.

**Relying-party binding is explicit configuration, never inferred from a
request.** `ADL_WEBAUTHN_RP_ID`, `ADL_WEBAUTHN_RP_NAME`, `ADL_WEBAUTHN_ORIGINS`
(defaulting to `ADL_ALLOWED_ORIGINS`) and `ADL_WEBAUTHN_CHALLENGE_TTL_SECONDS`
(default 300) are required in `passkey` mode, and startup refuses an origin that
is not the relying party id or a subdomain of it. A credential registered against
one relying party id will not work against another, so development and production
registrations are separate by design.

### Ceremony endpoints

Four POST endpoints, under the ordinary Phase 42 edge controls (HTTPS, exact
origin allow-list, `application/json`, size limit). They exist only in `passkey`
mode with a `PasskeyIdentityService` wired; otherwise they answer
`endpoint_unavailable` (503).

| Endpoint | Request body | Success |
| --- | --- | --- |
| `/v1/webauthn/register/begin` | `{ inviteToken? }` | 200 `{ challengeId, options }` |
| `/v1/webauthn/register/finish` | `{ challengeId, response, inviteToken? }` | 201 `{ userId, invite?, expiresAt? }`, with session and CSRF cookies only when the ceremony began without a session |
| `/v1/webauthn/authenticate/begin` | `{}` | 200 `{ challengeId, options }` |
| `/v1/webauthn/authenticate/finish` | `{ challengeId, response }` | 201 `{ userId, expiresAt }` plus session and CSRF cookies |

`options` is the relying party's own WebAuthn options object, passed straight to
the platform authenticator; `response` is the authenticator's JSON-encoded
attestation or assertion. `invite` reports how an invite was applied and is
either `membershipGranted` or `identityRecovered`.

**Registration is never anonymous.** A caller either already holds a valid
session — adding a further authenticator to their own identity, reusing the user
handle that identity already registered under so the credential joins it rather
than forking a new one — or presents a valid invite. Nothing else can mint an
identity. A begin call with neither is refused `ADL_PASSKEY_UNAUTHORIZED`.

**A session is issued only when the ceremony began without one.** An
invite-backed registration — a new member, or an identity being recovered —
receives an ordinary opaque session and its cookies. The session-gated "add
another authenticator" path receives none, and the edge writes no cookies:
replacing the cookie there would silently swap the caller's session and leave the
previous one live, so a person adding a second device would hold two.

**Cross-origin responses carry CORS headers, not just the preflight.** A browser
refuses to let a page read a cross-origin response unless the response itself
repeats `access-control-allow-origin` and `access-control-allow-credentials`, so
the edge echoes them on every response — including `GET /readyz` — whenever the
request's `Origin` is already on the allow list. An unlisted origin is still
refused and still cannot read what it was refused with. Without this a browser
hosted on a different origin from the authority cannot complete any call at all,
and the sign-in surface never learns the identity mode.

**Authentication needs no user name.** Credentials are registered discoverable
(`residentKey: "required"`) and `authenticate/begin` issues no allow-list, so the
authenticator names the credential and the authority is never told who is signing
in before it has verified an assertion.

A refusal states only its stable code, with a 401 status: no challenge,
assertion, invite token or key material appears in a response or a log line. The
codes are `ADL_PASSKEY_UNAUTHORIZED`, `ADL_PASSKEY_CHALLENGE_INVALID`,
`ADL_PASSKEY_ASSERTION_INVALID`, `ADL_PASSKEY_CREDENTIAL_IN_USE`,
`ADL_PASSKEY_CREDENTIAL_UNKNOWN`, `ADL_PASSKEY_COUNTER_REGRESSED` and
`ADL_PASSKEY_INVITE_INVALID`.

### The pre-session versus post-session CSRF boundary

The ceremony routes are the only mutating endpoints that may be reached without a
session, because a first registration and every authentication happen before one
exists. The boundary is therefore stated by **presence, not by path**:

- **No session cookie.** There is no ambient credential for a hostile page to
  abuse, so no double-submit token is required. The request is bound instead by
  the allowed `Origin`, the `webauthn` rate bucket, and the server-issued
  single-use challenge — an attacker's page cannot obtain a challenge bound to
  the victim's ceremony, and the assertion is verified against the configured
  origin and relying party id regardless.
- **A valid session cookie is present.** The request must still carry a matching
  `x-adl-csrf-token` double-submit token or it is refused `csrf_denied` (403).
  The session-gated "add another authenticator" path is therefore protected
  exactly as every other authenticated mutation is.

`bucketFor` puts every `/v1/webauthn/*` path in its own `webauthn` bucket
(`ADL_RATE_WEBAUTHN`, default 20). Most of these calls are pre-session, so they
must not share — or be limited by — an authenticated caller's session allowance.
The limit is enforced before the session and CSRF checks, and both halves of a
ceremony count against it.

### Challenge and credential rules

A challenge is **server-issued, single-use, short-lived, ceremony-bound, and
origin- and relying-party-bound**:

- It is generated by the relying party, stored in
  `adl_authority_webauthn_challenges`, and returned only as an opaque
  `challengeId` alongside the options.
- `consumeChallenge` marks it used and returns it in one statement — the `update
  … where consumed_at is null and expires_at > $now and ceremony = $ceremony`
  is itself the single-use gate, so two simultaneous finishes cannot both win,
  and an unknown, replayed, expired or wrong-ceremony challenge simply returns
  nothing and refuses.
- Verification checks the assertion against the configured origins and relying
  party id, so a client-chosen challenge, a wrong-origin assertion or a forged
  signature is refused with no session issued.
- The signature counter is checked on every assertion. `recordCredentialUse`
  carries the rule in its `where` clause rather than racing a read-then-write: a
  counter that did not advance while the stored one is non-zero updates nothing
  and refuses with `ADL_PASSKEY_COUNTER_REGRESSED`, which is the
  cloned-authenticator signal. An authenticator that implements no counter and
  always reports zero is permitted, but a previously non-zero counter may never
  return to zero or stall. In practice a stale counter is usually caught one
  layer earlier — `@simplewebauthn/server` refuses it during verification, which
  surfaces as `ADL_PASSKEY_ASSERTION_INVALID` — so `recordCredentialUse` is the
  backstop for a counter that advances concurrently between check and write.
  Either way the assertion is refused and no session is issued.

`adl_authority_webauthn_credentials` stores the credential id, the base64url
COSE public key, the signature counter, transports and the backed-up flag. None
of those are secrets. No private key, raw assertion or attestation object is ever
stored — registration requests `attestationType: "none"`, so no attestation
statement is even collected. A credential id that is already registered is
refused `ADL_PASSKEY_CREDENTIAL_IN_USE` rather than re-pointed.

`@simplewebauthn/server` is confined to `SimpleWebAuthnLibrary` in
`src/server/simplewebauthn-adapter.ts`, behind the structural `WebAuthnLibrary`
interface — the discipline `pg` already follows — and is composed only by the
authority entrypoint in `passkey` mode. It is deliberately not re-exported from
`src/index.ts`, which the browser bundle imports.

### Recovery, and what a passkey does not grant

**A passkey grants identity only, never ADL roles.** A verified assertion issues
an ordinary opaque session and nothing else; context roles keep resolving from
accepted membership records through `RuntimeContextService` on every call, and
the request still cannot set a user id, role, audit actor, accepted revision or
timestamp.

**Recovery re-links an existing identity.** A member who has lost every
authenticator is re-admitted by an admin issuing a **recipient-bound** invite.
`peekInvite` validates it without consuming it, so the ceremony can start for a
caller with no session; the invite's `recipientUserId` fixes the identity the new
credential will attach to, so the same `userId` and every existing membership
survive. At finish, `redeemInviteForIdentityRecovery` consumes and audits the
invite as `identityRecovered` **before anything is written**, and grants no
membership — the member never lost their memberships, only their authenticators.
A first-time member's invite, by contrast, is claimed through the ordinary
`claimInvite` path once the session exists, so the grant is written by the same
server-side transaction as every other claim.

The raw invite token is re-supplied at finish rather than stored: only its hash
lives on the challenge, and the token presented at finish must hash to the one
the ceremony was started with. No email sender is introduced anywhere in this
flow.

## Offline session lifetime and sync grace

Phase 50 makes the session model match how the application is actually used: a
device works fully offline indefinitely, and may sync for up to a declared grace
period since its last successful authentication before a fresh logon is
required. The decision is
[ADR 0008](adr/0008-passkey-identity-and-offline-session-grace.md).

**The grace is declared in the ADL model, not in the environment.**
`APP … OFFLINE_GRACE 30 DAYS` resolves to `model.app.offlineGraceDays`, a whole
number of days between 1 and 365 defaulting to 30. It is a sync-policy property
in the same family as sync mode, conflict policy and offline dataset windows; it
never declares how a credential is verified, which remains configuration.
Changing it is a model version change and passes through the startup
compatibility guard.

**The declared grace is the session lifetime.** The authority loads the same
resolved model, and `resolveSessionLifetime(configuration, model)` in
`authority-config.ts` sets `sessionTtlMinutes` to the declared grace before
anything that issues or verifies a session is composed.
`ADL_SESSION_TTL_MINUTES` is now an operator **cap**: it may only shorten the
declared grace, never lengthen it, because an environment variable must not
grant more time away than the application declared. Its unset default is
therefore the model's value rather than the old fixed 480 minutes. The effective
value is disclosed once at startup in a `session_lifetime_configured` security
event, with `capped` stating whether an operator cap applied.

**Both cookies are persistent, and both carry that lifetime.** `sessionCookie`
and `csrfCookie` now emit `Max-Age`. Without it these were browser-session
cookies, so closing the browser signed a user out no matter what the server-side
expiry said — which makes a grace measured in weeks meaningless. The CSRF cookie
gets the same lifetime deliberately: it is the double-submit half of every
authenticated mutation, so a session that survived a browser restart without it
would read but fail to write. The change is in `sessionCookie` itself, so all
writers get it: `/v1/session/issue`, `/v1/session/rotate` and both Phase 49
ceremony finishes.

**Rotation is what restarts the grace.** `/v1/session/rotate` already issued a
full fresh lifetime; it is now actually called. The browser rotates on connect
when a session exists, and after a successful sync once more than half the grace
has elapsed since the last confirmed authentication. Rotating on literally every
contact would write a session row and re-issue two cookies per sync for no added
safety; past the halfway point there is still a full half-grace of slack.

**The client-side gate is an affordance; the authority enforces.** The browser
refuses to *attempt* a sync once its grace has lapsed, which is neither a
transport failure nor a verdict — every queued entry keeps its place and nothing
is marked rejected. A client that skips that check gains nothing: the session it
would present has genuinely expired, `verify` refuses it, and
`tests/integration/authority-session-lifetime.test.ts` proves the refusal
against real PostgreSQL for expired sessions, revoked sessions and rotation.

**Local operation is never gated on a session**, before or after the grace
lapses. Nothing in the runtime consults one, and that is asserted rather than
assumed.

### Session list and revoke

Two endpoints, inside the ordinary session-and-CSRF gate and the existing
`session` rate bucket, so no new cross-origin surface is added and both inherit
the CORS wrapper Phase 49 added:

| Endpoint | Request body | Success |
| --- | --- | --- |
| `POST /v1/session/list` | `{}` | `{ sessions: [{ sessionId, issuedAt, expiresAt, current }] }` |
| `POST /v1/session/revoke` | `{ sessionId }` | `{ revoked: true }` |

- Both are scoped to the caller by their **own session token**, never by a
  request field, so neither can reach another identity's sessions.
- The list carries **no token hash**. The verifier for a live session never
  leaves the server, not even to its own holder.
- Only sessions that are neither revoked nor expired are listed, capped at 100
  rows. Rotation writes a row per restart of the grace, and that history must not
  read as a list of phantom devices.
- An unknown session id and someone else's session both answer
  `session_not_found` (404), so this cannot be used to probe which ids exist.

This is the compensating control for a grace measured in weeks. A lost device
keeps its ability to sync until the grace lapses or its session is revoked, so
its owner must be able to end it without an administrator.
`revokeMembership` still revokes the user's sessions **first**, deliberately, so
losing access ends sync on the next contact regardless of remaining grace.

## Retention scheduling and the administration UI

Phase 55 turns the two capabilities that existed only as services into things an
operator can actually run: retention gets an execution path, a schedule and a run
log, and the Phase 43 reporting and administration reads get a browser surface
instead of a hand-built request. Operational detail is in the
[production runbook](operations/authority-production-runbook.md).

### The retention execution path

`AuthorityRetentionService` (Phase 45) still holds the prune itself, and Phase 55
widens it from two projections to the four that grow with time rather than with
the accepted-record set: runtime audit, operation outcomes, sessions and WebAuthn
challenges. Each carries its own guard, and each guard is a floor rather than a
filter a request can argue down. Runtime audit and outcomes are clamped to no
later than `now - minimumRetentionMs`. Sessions and challenges are eligible only
once they have **already ended** — the predicate is
`least(coalesce(revoked_at, expires_at), expires_at) < cutoff`, which is
"whichever ending came first", so for a row that has not ended the expression is a
future instant and the cutoff is always in the past. An active session, including
one deep inside its offline grace, is structurally unreachable rather than merely
filtered out; so is a ceremony in flight.

**`adl_authority_context_memberships` is deliberately absent from the prunable
list and must stay absent.** It holds one row per accepted membership record, so
it is bounded by the record set rather than by time, and Phase 45's rule that
retention never touches accepted state extends to anything derived from it:
deleting a projection row would remove a live membership from resolution without
removing the membership. Accepted records, identities, identity links,
credentials and invites are likewise never touched.

`AuthorityRetentionRunner` runs the prune once, under mutual exclusion, and
records what happened. The lock is `pg_advisory_lock(hashtext(
'adl_authority_retention:<applicationId>'))` — the same session-level,
per-application pattern Phase 54 established for startup — taken for the duration
and released in a `finally`. A contender **waits** rather than skipping, so a
cron invocation and an in-process schedule may overlap freely and the second
simply proceeds once the first has committed. The four deletes and the run record
commit together on one pinned client, so a mid-run failure leaves every
projection exactly as it was rather than half-pruned with no record of it.

`AuthorityRetentionScheduler` drives the runner on an interval inside the
authority process. It is deliberately not a job runner: no queue, no
distribution, no persisted intent. `ADL_RETENTION_INTERVAL_MINUTES` is the only
thing that enables it and it is **absent by default**, so an authority that has
not been configured for retention prunes nothing. A deployment that prefers
`cron`, a Kubernetes `CronJob` or a systemd timer leaves the interval unset and
runs the one-shot entry point instead; the advisory lock makes both safe at once.

`runAuthorityRetentionOnce` and `authority-retention-main.ts` are that one-shot
entry (`npm run retention`, `npm run retention:dry-run`). It reads a deliberately
*small* environment — `ADL_DATABASE_URL`, `ADL_APPLICATION_ID` and the retention
windows — rather than the whole authority configuration. A retention job needs no
allowed origins, no identity verifier, no relying party and no cookie policy, and
requiring them would make the safest way to run retention the most awkward one to
configure. Its exit code is the scheduler's contract: 0 for completed, dry or
held, 1 for a failure.

A dry run reads the same predicates the real run deletes with, so its counts are
the counts rather than an estimate produced by a second, differently-shaped
query. It writes a run record with outcome `dryRun` and increments no deletion
counter.

`0009_retention_scheduling.sql` adds `adl_authority_retention_runs` and the two
indexes the new predicates need; apply it with `adl_migrator`. The run log is
metadata-only by construction — every column is a count, an instant, a boolean,
an outcome name or a reduced fault name such as `Error 42P01`, and there is no
column that could hold an accepted record, an audit payload, a token, a verifier
or an outcome body. It is also self-trimming: recording a run trims that
application's history to the most recent 200 rows in the same transaction, so the
table that exists to prove retention happened does not become a fifth thing
needing it.

Observability is `adl_authority_retention_runs_total{outcome}` and
`adl_authority_retention_deleted_total{projection}` on `AuthorityMetrics`, plus
the `retention_run_started`, `retention_run_completed`, `retention_run_held` and
`retention_run_failed` structured events. A failure is reported as a reduced
fault name only; a driver message can name hosts, roles and statement text.

### There is deliberately no HTTP trigger

Nothing at the HTTP edge starts a retention run. That is a design constraint, not
an omission.

**Retention is application-wide; every administration authorisation in this
repository is scoped to one business context.** `requireAdministration` gates each
`/v1/admin/*` call on the caller passing the existing ADL membership-management
policy in *one* selected context. A trigger route reachable under that gate would
therefore let a context manager start a destructive, deployment-wide delete
covering every other context's audit and outcome rows — a capability their
membership does not confer, obtained by reaching past their own scope. There is
no version of the route that fixes this: scoping a prune to one context would not
be retention, and gating it on a role the model does not declare would be a second
policy implementation living in the server.

Running retention therefore stays with whoever can start the scheduled process —
an operator with deployment access, not a session holder. The administration
surface is given a *read* of the run log instead.

### `/v1/admin/retention/status`

One POST route, under the same origin, CSRF, session and rate controls as every
other `/v1/admin/*` call, returning `{ retention: AuthorityRetentionStatusView |
null }`. `AuthorityAdministrationService.retention` requires administration in the
named context exactly as the other reads do, records a
`retentionStatusReviewed` administration-audit event, and returns metadata only:
whether this process runs an in-process schedule and at what interval, whether
legal hold is set, the three configured windows, and the last run's outcome,
cutoff and per-projection counts. It has no run argument, no dry-run argument and
no cutoff argument, so it adds no capability at all — only visibility of what a
run already did.

`null` means the deployment composed no retention path, and the surface reports
that rather than inventing a schedule. A run-log read failure degrades to "no last
run" rather than failing the whole view: an operator asking "is retention
configured?" must still get their answer when the run log cannot be read.

### Browser administration surfaces

Three components — `adl-audit-review`, `adl-access-review` and
`adl-report-runner` — sit over the endpoints Phase 43 already exposed: report
execution and CSV export, access-audit and runtime-audit review, membership and
invite status, recovery status, retention status, and session revocation.
`HttpAuthorityTransport` gains the matching client methods, and
`connectBrowserAuthority` holds the view state as `AdlAdministrationState`.

**The UI adds no authority.** It holds no operational credential — the session
cookie is `__Host-` Secure HttpOnly and unreadable to page script, exactly as
before — makes no authorisation decision, and is not a second scope
implementation. The server derives identity, role and scope on every one of these
reads, and the components render what the bridge gives them and dispatch intent
upward. The administration chrome renders for any signed-in caller rather than
only for one the shell believes is an administrator, precisely so that the browser
never becomes the place where scope is decided.

**Denial stays indistinguishable from absence.** A caller the authority refuses
sees the same empty lists as one whose context genuinely has nothing in it; no
wording anywhere says "you are not permitted"; and the `unavailable` state means
*no context is selected to administer*, never that the caller lacks permission.
Report execution follows the same rule — the server answers an unknown or
unauthorised read model with an empty report rather than an error, so the surface
reports "no rows" in both cases and cannot become an oracle for which reports
exist. Offering every declared read model as a runnable report is safe for the
same reason: the name is all that is ever sent, and the authority resolves it,
applies read policy and shapes the rows.

**Paging is the server's own.** `nextCursor` is opaque, short-lived and
actor-bound; the browser replays it untouched and neither composes nor interprets
one. Nothing is cached across contexts and nothing is merged — switching context
starts from empty, because a stale page from another context shown under a new
heading would be a disclosure the server never made. No count, total or aggregate
is computed in the browser, because a locally derived number could disclose more
than the server returned.

**Session revocation cannot escalate.** The authority refuses a target who is not
a current member of the context being administered, so an operator cannot reach
past their own scope or grant themselves anything; the bridge then reloads the
surface from the authority rather than adjusting anything locally, so an operator
is never shown a revocation that did not happen. Export is unchanged from Phase
43: the ordinary `export` policy is applied to every source record before the CSV
is composed, so it hands the browser exactly what that caller could already read.

The visual suite gains its own `administration` Playwright project with its own
authority-configured dev server, because the default visual projects run with **no
authority configured** and therefore render no authority chrome at all.
