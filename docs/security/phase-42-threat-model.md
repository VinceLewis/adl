# Phase 42 Threat Model

## Assets and trust boundaries

The authority database contains accepted records, model metadata, memberships,
opaque session and invite verifiers, idempotent outcomes, runtime audit, and
access-audit projections. Browsers, queue contents, selected contexts, request
bodies, cookies in transit, and upstream identity proofs are untrusted inputs.
The upstream proof verifier establishes only a stable identity subject; ADL
roles are resolved from accepted membership records on every authority call.

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

| Unverified account proof while identity verification is bypassed | **Accepted temporary risk (Phase 46).** The switch defaults to `bypass` and is disclosed in the startup security event and `/readyz`; production requires an explicit acknowledgement variable; the proof is shape-checked; and the bypass widens nothing else — sessions stay opaque and ADL context roles are still resolved from accepted membership records | Phase 46 identity-switch tests |
| Session, CSRF or credential leak through the browser transport | Session cookie stays `__Host-` Secure HttpOnly SameSite=Strict and is never readable by client code; only the double-submit CSRF cookie is read; transport failures raise an error instead of a fabricated outcome | Phase 46 transport and integration tests |

| Session token or protected record body written into the service worker cache | A service worker cache is readable by any script in the origin and survives sign-out, so the single cache write point refuses non-GET, cross-origin, any `/v1/` path, non-ok/opaque/error responses, `set-cookie` responses, `no-store`/`private` responses, and JSON bodies; records stay in IndexedDB under the runtime persistence boundary | Phase 47 service-worker policy tests, plus an integration case that runs a real authority response through the predicate |
| Manifest exception used to smuggle an authority body into the cache | The web app manifest is allowed only structurally (destination `manifest` or a `.webmanifest` path) and `/v1/` is refused before the exception is consulted, so no authority response can reach it | Phase 47 service-worker policy tests |
| Stale worker serving assets incompatible with persisted local state | The worker URL and its cache name both carry the resolved model version, so a model change installs a new worker; `activate` purges every other `adl-shell-*` cache and claims clients; registration is production-only and a non-production build unregisters a stale worker | Phase 47 service-worker and registration tests |
| Conflict recovery surface disclosing a protected server record | `SyncRecoveryItem` carries queue and verdict metadata only — no record or field value reaches the recovery component — and the server stays authoritative for the outcome; a rejection permits acknowledgement alone and is never resubmitted | Phase 47 recovery tests |
| Silent loss of a refused or conflicted write | A verdict is stored on the persisted queue entry instead of discarding it; only a declared strategy or a user resolution removes it, and a transport failure leaves the entry replayable | Phase 47 recovery tests, real-PostgreSQL integration tests |
| Offline invite claim pre-granting or caching access | The claim is refused in the browser bridge before any request is made, so nothing is queued, cached or optimistically granted; the granted context's records appear only on the bootstrap after the server's confirmation | Phase 47 integration test asserting nothing reached the wire and no access-audit row was written |

Residual risks: upstream identity-provider compromise, a trusted reverse-proxy
misconfiguration, and an attacker with database-owner access are outside the
authority process boundary. Those risks require provider controls, protected
infrastructure configuration, and database access review.

**Accepted temporary risk — identity verification bypass.** Phase 46 builds the
identity seam but deliberately does not choose a provider. While
`ADL_IDENTITY_VERIFICATION=bypass` (the default), anyone who can reach
`/v1/session/issue` with an allowed origin can obtain a session for any subject
they name, bounded only by the account-proof rate limit. That is acceptable for
development and for the first deployment slice, and unacceptable for real user
data. Follow-up: select and implement a real `UpstreamIdentityVerifier` (OIDC,
Better Auth, or custom), then set the switch to `upstream` and remove the
production acknowledgement variable from the deployment. Until then, any
environment holding real data must treat a `bypassed: true` readiness response
as an open finding.

Phase 47 surfaces the bypass to the person signing in — the sign-in panel is
labelled a development mode in both the signed-out and signed-in states, and an
authority whose readiness cannot be read, including one that cannot be reached at
all, is held as development rather than verified — but it does not close the
risk. A real `UpstreamIdentityVerifier` is still not
chosen, and the hard sequencing rule stands: **one must be in place before any
deployment holds real user data**, regardless of which phase delivers it.

**Residual risk — signing out leaves local data behind.** Sign-out ends the
server session and clears the invite state; it does not clear locally cached
records or unsynced queued work. Clearing them would destroy a user's offline
work, so it is deliberately not done. On a shared browser the consequence is
real: the next signed-in user can see the previous user's cached, non-authoritative
records until a policy-shaped bootstrap reconciles them. Those cached records are
not an access grant — every authority call is still policy-shaped server-side —
but they are a local disclosure. Do not treat a shared or kiosk browser as an
acceptable deployment target until this is addressed.

**Known defect — an offline create duplicates.** A create intent carries values
but no record id, because the authority assigns the id. The accepted server
record is reconciled locally under the server's id while the original local row
remains, so a record created offline appears twice after sync. This predates
Phase 47 and was masked by a hermetic fake that echoed the client's id back; real
PostgreSQL exposed it. It is recorded here as a known defect and is **not fixed
in this phase**. Relatedly, acknowledging a rejected create leaves the local row
in place: local truth converges only on a later bootstrap, and a bootstrap cannot
remove a record the server never had.
