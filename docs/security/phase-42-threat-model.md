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

Residual risks: upstream identity-provider compromise, a trusted reverse-proxy
misconfiguration, and an attacker with database-owner access are outside the
authority process boundary. Those risks require provider controls, protected
infrastructure configuration, and database access review.
