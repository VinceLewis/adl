# ADR 0008 - Passkey Identity, Provider Independence, and Offline Session Grace

Status: Accepted

Date: 2026-07-30

## Context

ADR 0007 deliberately deferred the auth provider decision "until the runtime
identity/session boundary and invite flow are ready to implement". Those are now
built: Phase 41 delivered opaque sessions, identity provisioning, invites,
membership grants and revocation; Phase 42 added the HTTP controls; Phase 46 added
the `UpstreamIdentityVerifier` switch, defaulting to a documented `bypass`.

The bypass accepts the supplied account proof *as* the identity subject. Anyone who
can reach a deployed authority can become any user by naming them, so the standing
rule from Phases 46, 47 and 48 has been that a real verifier must be in place
before any deployment holds real user data. Phase 48 established with evidence
that no deployment exists yet, so this decision is being made while it is still
free to make.

Three constraints were stated for this decision:

1. Identity must be **provider-independent and survivable** — the provider, the
   method, or the decision to use one at all must all be changeable later.
2. Offline operation must survive a **30-day grace** without contacting the
   authority, and must continue to work fully offline indefinitely after that,
   requiring a logon only to go online and sync. The grace restarts on every
   successful authentication to the backend, including a session rotation using a
   still-valid token.
3. Cost must not be a dependency. Every shortlisted option was £0 at this scale,
   so cost did not decide it.

## Decision

**Passkeys (server-side WebAuthn) are the first real credential.** The authority
issues a challenge, the authenticator signs it, and the authority verifies the
signature against a stored public key. No shared secret exists, so there is no
password store, no reset email, no credential stuffing and no breach exposure. It
needs no email sender and has no running cost.

**Recovery uses the existing invite system, not email.** A member who loses every
authenticator is re-admitted by an admin issuing a new invite code, claimed online,
which then registers a fresh passkey. This is the invite-code-not-email flow the
project already chose.

**Identity is keyed on a stable internal `userId` with linkable external
identifiers.** `adl_authority_identities` currently carries a single `subject` with
`unique (application_id, subject)`. That becomes a `(provider, subject) → userId`
link table. Changing provider, adding a second method, or running two in parallel
becomes linking an identifier, never re-keying data. This is the mechanism that
makes constraint 1 true, and it is independent of which provider is chosen.

**`UpstreamIdentityVerifier` remains the seam for bearer-proof providers.** Its
`verify(proof) => { subject }` shape suits a one-shot proof such as an OIDC
`id_token`, so "Sign in with Google" (free, no per-user charge) stays a drop-in
alternative. WebAuthn does **not** fit that shape — it needs a server-issued
challenge across two requests plus credential storage — so it is a sibling seam,
not an implementation of it. Both feed the same identity linking.

**The offline grace is a sync-policy property declared in the ADL model, not a
server environment variable.** Phase 46 correctly decided identity *verification*
is configuration rather than an ADL construct. The grace is not an identity
concern: it governs how long a device may sync without a fresh logon, and ADL
already models sync mode, conflict policy and offline dataset windows. It belongs
in that family. The authority loads the same resolved model and remains the
enforcement point.

**Local operation is never gated on a session.** Nothing in the runtime consults a
session today, and that stays true: reads and local-first writes work offline
indefinitely. The grace gates **sync only**.

**No local biometric gate is built.** A web app's local biometric check is a
boolean produced by client code, so it can never be an enforcement point, and the
device's own lock screen already covers the locked-device case with secure-enclave
backing. If shared devices later come into scope, the pattern to use is a WebAuthn
ceremony whose assertion is queued and verified by the authority on reconnect —
which makes a local bypass *detectable*, not prevented, and must be recorded as an
audit property rather than a control.

## Consequences

- A deployment can hold real user data once Phases 49 and 50 are complete. The
  standing pre-deployment rule is satisfied by those two phases together, not by
  either alone.
- `@simplewebauthn/server` becomes the repository's second runtime dependency
  after `pg`. It is confined to `src/server/` behind a structural interface, the
  same discipline `pg` already follows, so the language model stays dependency-free.
- `ADL_IDENTITY_VERIFICATION` gains a third mode. `bypass | upstream` no longer
  describes the space, because a passkey is verified by the authority itself rather
  than by an upstream provider.
- The offline grace becomes part of the resolved model, so it is inspectable,
  validatable and conformance-testable — and changing it is a model version change
  subject to the existing startup compatibility guard.
- A device inside its grace window can sync without a fresh logon, so a lost device
  retains sync capability until the grace expires or membership is revoked.
  `revokeMembership` already revokes the user's sessions first, deliberately, which
  is the compensating control. A per-session device list is the cheap addition that
  makes it self-service.
- Revocation never reclaims data already cached on a device. That was already true
  and already recorded; this decision makes it explicit and intentional.
- There is no remote wipe, and there cannot be a reliable one for a device that
  never reconnects.

## Rejected alternatives

- **Supabase Auth / GoTrue.** Free at this scale, but its store becomes the
  identity store and its subject format becomes the key, which is what constraint 1
  rules out. It also pulls a platform in to satisfy one function call.
- **Better Auth.** MIT, free, self-hosted, no per-MAU pricing, and a good library —
  but it owns a user table, so adopting it means two identity stores to keep
  consistent when the authority already has one.
- **Auth.js.** Free and its Credentials provider could bridge to this authority,
  but it is framework-shaped and only a few percent of it would be used.
- **Google Cloud Identity Platform / Firebase Authentication.** A different product
  from free "Sign in with Google": priced per MAU beyond 50,000, and it would own
  the user store.
- **Password credentials.** Fit the existing seam, but recovery needs an email
  sender anyway and the project would own hashing, reset and breach handling for no
  benefit over passkeys.
- **Magic links as the first method.** A good fit for the existing hashed
  one-time-token machinery, but needs an email sender and delivery-reliability
  ownership. Retained as a possible future method behind the same linking.
- **A local biometric gate as the authentication mechanism.** Unverifiable by the
  authority, so it would reintroduce the browser asserting its own identity — the
  exact property Phase 46 removed.
