# Identity, Invites, and Access Lifecycle

Phase 41 selects a custom TypeScript opaque-session adapter rather than making
an identity provider part of ADL. `OpaqueSessionAdapter` provisions a stable
identity from a trusted upstream account proof, stores only SHA-256 session
token verifiers, and validates expiry, sign-out, rotation, and user-wide
revocation through `AuthorityIdentitySessionStore`. `StaticSessionAdapter` is
strictly development/test wiring.

`AuthorityAccessLifecycleService` is server infrastructure, not a new ADL
language feature. It derives the membership record object and fields from the
resolved business-context membership declaration. Invite creation requires the
caller to pass normal ADL `update` policy for that membership object in the
selected context. Claiming a valid, recipient-bound invite is a narrowly scoped
server capability: the PostgreSQL store locks the invite and atomically writes
the declared membership record, claim state, and access audit event. Auth tokens
never contain roles; context roles are still resolved from membership records at
request time.

Membership revocation tombstones the membership record and calls
`revokeUserSessions` when the configured session adapter supports it. The next
authority bootstrap or replay rejects that session. Browser sync already maps a
server rejection to a rejected local operation; it must never attempt invite or
membership mutation while offline. Cached local records remain non-authoritative
until a later policy-shaped bootstrap reconciles them.

## Practical guidance

- Raw session and invite tokens are credentials. Return them only from the
  issuing server endpoint, persist only their hash, and exclude them from audit,
  outcomes, logs, object storage, and sync-state persistence.
- Production HTTP wiring must use HTTPS-only Secure, HttpOnly, SameSite cookies
  (or an equivalent server-managed credential), enforce endpoint rate limits,
  and provide an upstream account-proof flow. Those HTTP/operational controls
  are intentionally Phase 42 work.
- An invite is not a general policy bypass. Its issuer is policy-authorized;
  claim only creates the exact membership specified by the server-stored invite.
  Keep invitation context checks in storage transactions so an administrator of
  one context cannot revoke or alter an invite for another.
