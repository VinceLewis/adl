# Phase 42 Threat Model

## Assets and trust boundaries

The authority database contains accepted records, model metadata, memberships,
opaque session and invite verifiers, idempotent outcomes, runtime audit, and
access-audit projections. Since Phase 49 it also contains identity links
(`(provider, subject) → user_id`), registered WebAuthn credentials (credential
id, COSE public key, signature counter) and short-lived ceremony challenges.
Browsers, queue contents, selected contexts, request bodies, cookies in transit,
upstream identity proofs, and WebAuthn attestations and assertions are untrusted
inputs. An identity verifier — an upstream proof verifier or a passkey ceremony
the authority itself challenged — establishes only a stable identity; ADL roles
are resolved from accepted membership records on every authority call.

| Threat | Control | Verification |
| --- | --- | --- |
| Stolen browser session | HTTPS, `__Host-` Secure HttpOnly Strict session cookie; expiry, rotation, sign-out and membership-triggered user-wide revocation | HTTP and access-lifecycle tests |
| CSRF or hostile origin | Exact HTTPS origin allow-list, credentialed preflight, Strict cookie, double-submit CSRF token for every authenticated mutation | HTTP tests |
| Crafted role/context/record request | Typed shape limits; server derives identity/context roles; replay/bootstrap use the runtime | authority-service tests |
| Credential or protected-data log leak | Credential-only cookies, generic errors, structural redaction and metadata-only structured events | HTTP redaction tests |
| Invite abuse | Policy-gated issue, hashed one-time verifier, recipient/expiry checks, locked PostgreSQL claim transaction, endpoint limits | access-lifecycle tests |
| Replay flood or outcome disclosure | Actor-bound durable outcome lookup after session verification; rate limits exempt only a stored retry for that same actor | authority HTTP/service tests |
| Database compromise or operator mistake | Dedicated migration and traffic roles, backups, restore drills, retention and incident runbooks | operations drill |
| Cross-context report/export enumeration | Named resolved read models only; runtime scope/read/masking; source-record export policy; bounded actor-bound cursors | Phase 43 reporting tests |
| Admin/audit disclosure or over-broad response | Existing context membership-management policy, status-only response DTOs, metadata-only administration audit, endpoint rate/CSRF/origin controls | Phase 43 administration/HTTP tests |
| Partial projection after a failed or interrupted write | Single PostgreSQL unit-of-work commits accepted record, runtime audit, and actor-bound outcome together; outcome insert gates duplicate/idempotent submissions; infrastructure failures roll back and stay retryable instead of caching a false rejection | Phase 44 transaction-integrity tests |
| Inconsistent or incomplete restore set | Metadata-only projection integrity/restore verification (`consistent`, `acceptedOutcomeRecordsMissing`, `orphanRecords`, `auditScopeInconsistent`) that prints no protected JSON and blocks traffic switch when inconsistent | Phase 44/45 integrity tests, operations drill |
| Cross-context runtime-audit disclosure via a sparse/empty page | Audit rows stamped with the record's declared context scope; review filtered to one authorised context in SQL, with the per-row runtime read retained as the disclosure boundary | Phase 45 scope tests |
| Retention job destroys accepted state, in-retention audit/outcomes, or bypasses legal hold | Application-scoped prune that clamps the cutoff to no later than `now - minimumRetentionMs`, refuses under legal hold, rejects a non-positive window, and never touches accepted records, sessions, invites, or identities | Phase 45 retention-boundary tests |

| Unverified account proof while identity verification is bypassed | **Closed for production by Phase 49**: a production configuration in `bypass` is refused at startup and the Phase 46 acknowledgement variable is removed. In development the switch still defaults to `bypass` and is disclosed in the startup security event and `/readyz`; the proof is shape-checked; and the bypass widens nothing else — sessions stay opaque and ADL context roles are still resolved from accepted membership records | Phase 46 identity-switch tests, Phase 49 configuration tests |
| Session, CSRF or credential leak through the browser transport | Session cookie stays `__Host-` Secure HttpOnly SameSite=Strict and is never readable by client code; only the double-submit CSRF cookie is read; transport failures raise an error instead of a fabricated outcome | Phase 46 transport and integration tests |

| Session token or protected record body written into the service worker cache | A service worker cache is readable by any script in the origin and survives sign-out, so the single cache write point refuses non-GET, cross-origin, any `/v1/` path, non-ok/opaque/error responses, `set-cookie` responses, `no-store`/`private` responses, and JSON bodies; records stay in IndexedDB under the runtime persistence boundary | Phase 47 service-worker policy tests, plus an integration case that runs a real authority response through the predicate |
| Manifest exception used to smuggle an authority body into the cache | The web app manifest is allowed only structurally (destination `manifest` or a `.webmanifest` path) and `/v1/` is refused before the exception is consulted, so no authority response can reach it | Phase 47 service-worker policy tests |
| Stale worker serving assets incompatible with persisted local state | The worker URL and its cache name both carry the resolved model version, so a model change installs a new worker; `activate` purges every other `adl-shell-*` cache and claims clients; registration is production-only and a non-production build unregisters a stale worker | Phase 47 service-worker and registration tests |
| Conflict recovery surface disclosing a protected server record | `SyncRecoveryItem` carries queue and verdict metadata only — no record or field value reaches the recovery component — and the server stays authoritative for the outcome; a rejection permits acknowledgement alone and is never resubmitted | Phase 47 recovery tests |
| Silent loss of a refused or conflicted write | A verdict is stored on the persisted queue entry instead of discarding it; only a declared strategy or a user resolution removes it, and a transport failure leaves the entry replayable | Phase 47 recovery tests, real-PostgreSQL integration tests |
| Client-supplied record id used to overwrite, adopt or probe another caller's record | A create's `recordId` names a record and authorises nothing: an id that already names an accepted record — tombstones included — is refused with `ADL_RUNTIME_RECORD_ID_TAKEN` rather than overwritten, merged with or adopted, and the check runs only after the create is otherwise authorised, so an unauthorised caller is denied instead of learning whether an id exists. Revision, actor, timestamps, accepted state and scope stay server-derived | Phase 48 record-identity tests, real-PostgreSQL collision test |
| Malformed record id reaching PostgreSQL as a text key | `isValidRecordId` (non-empty, ≤320 characters, no surrounding whitespace, no control characters) is enforced independently at the HTTP edge (`malformed_request`, 400) and in the runtime (`ADL_RUNTIME_RECORD_ID_INVALID`), before any insert — a NUL in a text key is a real PostgreSQL failure, and an undetected collision would surface as a retryable infrastructure error the client would replay forever | Phase 48 record-identity tests, real-PostgreSQL edge and runtime cases |
| Offline invite claim pre-granting or caching access | The claim is refused in the browser bridge before any request is made, so nothing is queued, cached or optimistically granted; the granted context's records appear only on the bootstrap after the server's confirmation | Phase 47 integration test asserting nothing reached the wire and no access-audit row was written |

## The passkey surface (Phase 49)

A passkey has no shared secret, so a whole class of threats has no surface to
attack rather than a control mitigating it: **there is no password store to
steal, no reset email to intercept or spoof, no credential to stuff from another
site's breach, and nothing in this database whose disclosure would let anyone
authenticate.** What the authority holds is the *public* half of an asymmetric
key pair.

| Threat | Control | Verification |
| --- | --- | --- |
| Replayed, client-chosen or expired challenge | The challenge is server-issued, stored, single-use, short-lived (`ADL_WEBAUTHN_CHALLENGE_TTL_SECONDS`, default 300) and bound to the ceremony it was issued for; `consumeChallenge` marks it used in the same `update … where consumed_at is null and expires_at > now and ceremony = $ceremony`, so a replay, an expiry, or a challenge issued for the other ceremony returns nothing and refuses with `ADL_PASSKEY_CHALLENGE_INVALID` | Phase 49 ceremony unit tests, real-PostgreSQL integration tests |
| Forged assertion, or one presented against a different relying party or origin | Verification checks the signature against the stored COSE public key and the assertion against `ADL_WEBAUTHN_RP_ID` and `ADL_WEBAUTHN_ORIGINS`, both explicit configuration and never inferred from the request; a library exception is converted to a refusal rather than propagated, because its message can quote response material. No session is issued (`ADL_PASSKEY_ASSERTION_INVALID`) | Phase 49 forgery/wrong-origin regression tests |
| Cloned authenticator | The signature counter is checked on every assertion and advanced in the `where` clause rather than by read-then-write, so a counter that fails to advance while the stored one is non-zero updates nothing and refuses with `ADL_PASSKEY_COUNTER_REGRESSED`. A counter-less authenticator that always reports zero is permitted; a previously non-zero counter may never stall or return to zero | Phase 49 counter-rule tests |
| Anonymous identity minting through the registration ceremony | Registration is never anonymous: the caller either holds a valid session (adding an authenticator to their own identity, reusing that identity's existing user handle) or presents a valid invite, and nothing else can mint an identity (`ADL_PASSKEY_UNAUTHORIZED`). A credential id that is already registered is refused (`ADL_PASSKEY_CREDENTIAL_IN_USE`), never re-pointed at a new identity | Phase 49 registration tests |
| CSRF against an endpoint that must work before a session exists | The boundary is stated by presence, not by path: a request carrying a valid session cookie must still carry a matching double-submit token or is refused `csrf_denied`, so the session-gated path is protected exactly as every other authenticated mutation is; a request with no session cookie has no ambient credential to abuse and is bound instead by the allowed `Origin`, the dedicated `webauthn` rate bucket, and the server-issued single-use challenge | Phase 49 HTTP edge tests |
| Ceremony endpoints used to brute-force or to exhaust an authenticated caller's allowance | `/v1/webauthn/*` has its own `webauthn` bucket (`ADL_RATE_WEBAUTHN`, default 20), enforced before the session and CSRF checks, so pre-session ceremonies neither spend nor are limited by session-endpoint allowances | Phase 49 HTTP edge tests |
| Raw invite token reaching challenge storage | Only the token's SHA-256 hash is stored on the challenge; the raw token is re-supplied at finish and must hash to the one the ceremony was started with, so challenge storage never holds a usable invite credential | Phase 49 recovery tests |
| Recovery invite used to escalate privilege or create a second identity | A recipient-bound invite re-links the new credential to the identity it names, and `redeemInviteForIdentityRecovery` consumes and audits it as `identityRecovered` **before anything is written**, granting no membership at all. A simultaneously claimed or revoked invite refuses with nothing granted | Phase 49 recovery tests, real-PostgreSQL integration test |
| Signing in with a passkey conferring ADL roles | A verified assertion issues an ordinary opaque session and nothing more. Context roles keep resolving from accepted membership records through `RuntimeContextService` on every call, and a disabled identity is refused after verification (`ADL_PASSKEY_UNAUTHORIZED`) | Phase 49 ceremony and authority-service tests |
| Ceremony refusal leaking credential, challenge or invite material | A refusal states only its stable `ADL_PASSKEY_*` code with a 401; no challenge, assertion, invite token or key material enters a response, a log line, an audit row, an outcome, or sync state. Phase 42 redaction rules are unchanged | Phase 49 HTTP redaction tests |

**What is stored.** `adl_authority_webauthn_credentials` holds the credential id,
the base64url COSE **public** key, the signature counter, transports and the
backed-up flag. `adl_authority_identity_links` holds `(provider, subject) →
user_id`, where a passkey subject is the WebAuthn user handle — an opaque random
value, not an email address or any other personal identifier. None of these are
secrets: an attacker holding all of them still cannot produce a valid assertion,
because the private key never leaves the authenticator.

**What is never stored.** No private key. No raw assertion or attestation object
— registration requests `attestationType: "none"`, so no attestation statement is
even collected, and none of the privacy-sensitive device data it would carry ever
has to be protected. No raw invite token, only its hash. No challenge outside its
own short-lived table.

**Why the challenge is stored at all.** A challenge must be verified against the
assertion that answers it, and the authority is the only party that may decide
whether the challenge was one it issued — so it has to persist across the two
requests of a ceremony. `adl_authority_webauthn_challenges` is therefore
authentication-flow state, not a credential store: rows are single-use,
short-lived and prunable by expiry, they hold no accepted data, and a challenge
value discloses nothing that helps an attacker who cannot also produce a
signature over it with a registered private key. Excluding the table from a
restore is acceptable; an in-flight ceremony is simply restarted.

Residual risks: upstream identity-provider compromise, a trusted reverse-proxy
misconfiguration, and an attacker with database-owner access are outside the
authority process boundary. Those risks require provider controls, protected
infrastructure configuration, and database access review.

**Closed in Phase 49 — the identity verification bypass.** Phase 46 built the
identity seam but deliberately did not choose a provider, so while
`ADL_IDENTITY_VERIFICATION=bypass` (still the default) anyone who can reach
`/v1/session/issue` with an allowed origin obtains a session for any subject they
name, bounded only by the account-proof rate limit. Phase 47 surfaced that to the
person signing in — the panel is labelled a development mode in both the
signed-out and signed-in states, and an authority whose readiness cannot be read,
including one that cannot be reached at all, is held as development rather than
verified — but it did not close the risk.

Phase 49 closes it for any deployment: the bypass is **development-only** and a
production configuration in `bypass` is refused by
`loadAuthorityConfiguration`, so the process does not start rather than serving
unverified identities. The Phase 46 `ADL_IDENTITY_BYPASS_ACKNOWLEDGED` escape
hatch is **removed**, deliberately: with a real verifier available, no operator
should be able to opt production back into accepting an unverified identity. A
development or test environment may still run the bypass, and the readiness flag
still discloses it, so `bypassed: true` in any environment that serves real users
remains an open finding.

Note what this does and does not settle. The standing pre-deployment rule from
ADR 0008 is satisfied by Phases 49 and 50 **together**, not by either alone:
Phase 49 makes signing in real, and Phase 50 makes staying signed in survive
being offline.

**Residual risks accepted in ADR 0008.** These are decisions, not oversights, and
they are unchanged by Phase 49:

- **A lost device retains sync capability until membership is revoked.** A device
  inside its grace window can sync without a fresh logon. `revokeMembership`
  revokes the user's sessions first, deliberately, which is the compensating
  control; a per-session device list is the cheap addition that would make it
  self-service, and it is not built. Revoking the *credential* alone does not
  end an existing session — revoke the sessions, or the membership if access
  itself is in doubt.
- **Revocation never reclaims data already cached on a device.** That was already
  true and already recorded; the decision makes it explicit and intentional.
- **There is no remote wipe**, and there cannot be a reliable one for a device
  that never reconnects.
- **No local biometric gate is built.** A web app's local biometric check is a
  boolean produced by client code, so it can never be an enforcement point; the
  device's own lock screen covers the locked-device case with secure-enclave
  backing. If shared devices come into scope, the pattern is a WebAuthn ceremony
  whose assertion is queued and verified by the authority on reconnect — which
  makes a local bypass *detectable*, not prevented, and must be recorded as an
  audit property rather than a control.
- **There is no first-admin bootstrap flow.** Registration is session- or
  invite-gated and never anonymous, so a brand-new database admits its first
  identity only through an out-of-band operator procedure with direct database
  access — see the
  [production runbook](../operations/authority-production-runbook.md). Anyone who
  can perform it already has database-owner-level access, which is outside the
  authority process boundary, but it is a privileged manual step and should be
  performed once and audited.

**Residual risk — signing out leaves local data behind.** Sign-out ends the
server session and clears the invite state; it does not clear locally cached
records or unsynced queued work. Clearing them would destroy a user's offline
work, so it is deliberately not done. On a shared browser the consequence is
real: the next signed-in user can see the previous user's cached, non-authoritative
records until a policy-shaped bootstrap reconciles them. Those cached records are
not an access grant — every authority call is still policy-shaped server-side —
but they are a local disclosure. Do not treat a shared or kiosk browser as an
acceptable deployment target until this is addressed.

**Fixed in Phase 48 — the offline-create duplication.** The create intent now
carries the client's own record id and the authority accepts the record under it,
so an offline-created record has one identity end to end. The new input is
analysed in the table above. Two properties are worth restating because they are
the whole reason the change is safe: a client-supplied id is an identifier and
never an authorisation, and a collision is a refusal rather than an overwrite.

**Residual risk — a rejected create leaves its local row behind.** Acknowledging a
rejected create discards the queue entry but not the local record it was created
from, and a bootstrap cannot remove a record the server never accepted. With
Phase 48's collision rejection this now has a second instance: when a create is
refused because its id is taken, the following bootstrap replaces that local row
with the *authority's* record under the same id, so the user's local values for it
are gone from the row while only the verdict metadata remains in the recovery
panel. That is consistent with every other `keepServer` resolution, and no
client-side merge is invented to paper over it, but it is a real loss of local work
and it is not yet surfaced as such to the user.

## The offline session grace (Phase 50)

The grace is a **deliberate widening** of the session lifetime, from 8 hours to
the model's declared 30 days, made so that a device that has been away can still
sync without a fresh logon. It is recorded here as an accepted trade with named
compensating controls, not as a control in itself.

| Threat | Control | Verification |
| --- | --- | --- |
| A lost or stolen device syncing for weeks on its existing session | The grace is a **maximum, never a minimum**: revoking a session, or a membership (which revokes the user's sessions first, deliberately), takes effect on that device's next contact regardless of remaining grace. The owner can end any of their own sessions from a self-service device list without an operator | Phase 50 real-PostgreSQL session-lifetime tests; Phase 41 access-lifecycle revocation tests |
| A client ignoring its own grace check and syncing anyway | The client-side gate is an affordance only. The session it would present has genuinely expired, so `verify` refuses it and every authenticated endpoint answers `unauthenticated` (401). Rotation is not a way back in either: it requires a still-valid session | Phase 50 real-PostgreSQL refusal cases for expired, revoked and rotated-away sessions |
| An operator lengthening the window past what the application declared | `ADL_SESSION_TTL_MINUTES` is a **cap**: it may only shorten the declared grace. The effective value is disclosed once at startup in a `session_lifetime_configured` event with a `capped` flag | Phase 50 configuration tests |
| A persistent session cookie surviving where the CSRF cookie did not | Both cookies carry the same `Max-Age`, so a restored session cannot end up able to read but not write. Both remain `__Host-` Secure SameSite=Strict; the session cookie stays HttpOnly and unreadable to page script | Phase 50 cookie tests, real-PostgreSQL edge case |
| The cached browser identity used as a credential | It is a user id and a timestamp in IndexedDB, never a token, and it is never sent to the authority as proof of anything. The server-derived identity wins on every successful contact, and an authority that reports no session causes it to be dropped rather than kept as a shadow account | Phase 50 offline-session tests |
| A signed-out browser operating as a stand-in identity | With an authority configured and no session, the context runs as `adl-signed-out`, which matches no membership, so context roles resolve to nothing and policy denies. The previous fallback to `LOCAL_DEMO_IDENTITY` — a local demo device, not an account — is gone | Phase 50 offline-session regression tests |
| The device list disclosing a session verifier or another identity's sessions | The list is scoped by the caller's own session token rather than any request field, carries no token hash, excludes revoked and expired rows, and is capped at 100. An unknown session id and someone else's session both answer `session_not_found` (404), so it cannot be used to probe which ids exist | Phase 50 real-PostgreSQL device-list tests |

**Accepted, and unchanged by this phase: a device inside its grace retains sync
capability.** That is the point of the grace, and revocation is the control. Two
consequences follow and are intentional:

- **Cached data is never reclaimed.** Revoking a session or a membership stops
  future sync; it does not remove what is already in that device's IndexedDB.
- **There is no remote wipe, and there cannot be a reliable one** for a device
  that never reconnects. Treat a lost device as a disclosure of whatever was
  cached on it at the time and scope the incident accordingly, rather than
  expecting a revocation to undo it.

**Residual risk — rotation grows the sessions table.** Each restart of the grace
inserts a session row and revokes the previous one. Revoked and expired rows are
excluded from everything user-facing and from the device list, so this is not a
disclosure, but nothing in this repository prunes them; it sits alongside expired
ceremony challenges as an operator retention item.
