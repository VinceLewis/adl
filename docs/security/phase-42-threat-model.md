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
