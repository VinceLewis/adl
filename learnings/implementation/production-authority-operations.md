# Production Authority Operations

Phase 42 provides a framework-neutral `Request`/`Response` authority edge and
a small Node adapter. Production configuration is deliberately deployment-only:
it is loaded from environment variables, demands HTTPS origins and secure
cookies, and rejects `StaticSessionAdapter`. `OpaqueSessionAdapter` remains the
replaceable identity-only adapter; an injected upstream verifier proves a
subject but never sends ADL roles to the authority.

The HTTP edge accepts session credentials only in `__Host-` Secure HttpOnly
SameSite=Strict cookies. Mutations require an allowed Origin and a
double-submit CSRF token; request JSON is content-type and byte limited. It
does not log bodies, proofs, cookies, tokens, records, or payloads. Use the
structured logger/metrics interfaces rather than adding ad-hoc console output.

Replay outcomes are bound to the authenticated actor. Authenticate before any
outcome lookup; otherwise a guessed operation id can disclose a prior result.
The HTTP edge exempts only an already-stored retry for that same authenticated
actor from replay rate cost, preserving idempotency without turning rate
limiting into an authorization bypass.

Operational source of truth is `docs/operations/authority-production-runbook.md`.
Apply migrations with the migration role and run traffic with the DML-only
authority role. Restore drills must cover every `adl_authority_*` projection,
including verifier and audit tables, and must not print protected JSON.
