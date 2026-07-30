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

Still outstanding after Phase 48, in sequence order: passkey identity and
provider-independent identity keying (Phase 49) and offline session lifetime and
sync grace (Phase 50) — **together the deployment gate**, since until both land the
bypass is the only way in; then conformance depth and model migrations (Phase 51),
membership-projection scoping (Phase 52), retention scheduling and its
administration UI (Phase 53), and reference-app gaps (Phase 54). Outside the phase
plan: TLS termination, secret management, CI/CD, and a hosting provider decision.
The identity method itself is no longer open — see
[ADR 0008](adr/0008-passkey-identity-and-offline-session-grace.md).

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
bypass. In production the bypass must additionally be acknowledged with
`ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true`, so it cannot be reached by omission.

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
