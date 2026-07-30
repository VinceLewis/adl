# Phase 49 - Passkey Identity and Provider-Independent Identity Keying

> Inserted by the Phase 48 handoff follow-up. The Phase 48 handoff named a real
> identity verifier as the highest-value gap repository-wide but could not sequence
> it, because choosing a method was a product decision rather than an
> implementation gap. That decision is now made and recorded in
> `docs/adr/0008-passkey-identity-and-offline-session-grace.md`, so the work is
> executable and takes the position the handoff said it deserved. The platform
> contract, membership projection, retention scheduling and reference-app phases
> each moved down two numbers; their evidence and scope are unchanged.

## Objective

Replace the identity bypass with a real, authority-verified credential, and key
identity so that the provider, the method, or the decision to use one at all can
change later without re-keying user data.

## Evidence and Dependency

**The bypass is the only way in, and it verifies nothing.** With
`ADL_IDENTITY_VERIFICATION` at its `bypass` default, `BypassIdentityVerifier.verify`
(`identity-verification.ts:35-42`) returns the supplied account proof *as* the
identity subject. `/v1/session/issue` (`authority-http.ts:106-127`) requires only
that the proof be at least 16 characters, then provisions the identity and issues a
session cookie. `AuthorityService.resolveContext` then resolves context roles from
accepted membership records keyed on that user id, so naming a user inherits their
memberships. There is no credential in the system to check, so no configuration can
make this safe. Phases 46, 47 and 48 each restated the resulting rule: **a real
verifier must be in place before any deployment holds real user data.**

**Identity is keyed 1:1 on the provider's subject string.** `AuthorityIdentity` is
`{ userId, subject, createdAt, disabledAt? }` (`opaque-session-adapter.ts:4-9`), and
`adl_authority_identities` enforces `unique (application_id, subject)`
(`0001_authority_projection.sql:48-56`). `provisionIdentity` looks up by subject and
mints a **new** `user-<id>` on a miss (`:67-78`). Memberships and
`adl_authority_sessions` both reference `userId`. So changing the provider changes
the subject, misses the lookup, mints a new identity, and orphans every membership
record and everything scoped by it: the user signs in successfully and sees nothing.
Phase 48 established that no deployment holds data, so this is the last point at
which the keying can change without a data migration.

**The existing seam suits a bearer proof, not a challenge ceremony.**
`UpstreamIdentityVerifier.verify(proof, expected)` (`identity-verification.ts:3-15`)
is single-shot and stateless. `ADL_UPSTREAM_IDENTITY_ISSUER` and
`ADL_UPSTREAM_IDENTITY_AUDIENCE` already exist and are required even while bypassed,
so an OIDC provider is genuinely a drop-in. WebAuthn is not: it needs a
server-issued challenge across two requests plus stored public-key credentials.

## Scope

- A `(provider, subject) → userId` identity link table replacing the single
  `subject` column, so one identity may hold several external identifiers and gain
  new ones without re-keying.
- Server-side WebAuthn registration and authentication ceremonies, with credential
  storage, and session issuance on a verified assertion.
- Recovery through the existing invite system: an admin re-invites, the claimant
  registers a fresh authenticator. No email sender is introduced.
- An identity-verification mode for a self-verified credential, since
  `bypass | upstream` no longer describes the space.
- The browser sign-in surface for registration and authentication, replacing the
  account-proof field.
- Retaining `UpstreamIdentityVerifier` unchanged as the bearer-proof seam, so an
  OIDC provider stays a drop-in alternative rather than a rewrite.

## Constraints

- **The browser never asserts its own identity.** The Phase 46 rule stands: the
  server derives the identity and tells the browser. A WebAuthn assertion is
  evidence the authority verifies, not a claim it accepts.
- **The challenge is server-issued, single-use, short-lived and bound to the
  ceremony it was issued for.** A replayed or client-chosen challenge must be
  refused, and the signature counter must be checked so a cloned authenticator is
  detectable.
- **No private key, raw assertion, or challenge secret enters records, audit, sync
  state, outcomes, or logs.** Public keys and credential ids are not secrets and may
  be stored; nothing else may. Phase 42 redaction rules apply unchanged.
- **A passkey grants identity only, never ADL roles.** Context roles keep resolving
  from accepted membership records through `RuntimeContextService` on every call.
- **Turning verification on must fail closed.** The Phase 46 rule that `upstream`
  never falls back to `bypass` extends to the new mode: a misconfigured verifier
  denies rather than authenticates.
- **Origin binding must be explicit.** A credential registered against one relying
  party id will not work against another, so development and production
  registrations are separate by design and must be configured, not inferred.
- `@simplewebauthn/server` (MIT) is confined to `src/server/` behind a structural
  interface, the discipline `pg` already follows, so the language model stays free of
  it. It must not be imported from `src/runtime/`, `src/model/` or `src/ui/`.
- Preserve Phase 42 HTTP controls, Phase 44 atomicity, Phase 45 scope/retention,
  Phase 47 recovery and Phase 48 record identity.

## Deliverables

- The identity link table, its ordered migration, and the adapter/store changes that
  consume it, with `provisionIdentity` taking a provider and a subject.
- WebAuthn registration and authentication endpoints, a credential store, and
  challenge storage, with rate buckets decided in `bucketFor` and the pre-session
  versus post-session CSRF boundary stated explicitly.
- Invite-based recovery, proven end to end.
- The new identity-verification mode, disclosed in the startup security event and
  `/readyz` exactly as the bypass is.
- The browser registration and sign-in surface.
- Real-PostgreSQL integration coverage, unit coverage for the ceremony rules, and
  updates to `docs/server-authority.md`, the runbook, the threat model, the
  `.env.authority.sample` and learnings.

## Acceptance Criteria

- A user registers an authenticator and signs in with it against a real authority
  over real PostgreSQL, and receives an ordinary opaque session.
- A forged, replayed, expired, wrong-origin or counter-regressed assertion is
  refused, and no session is issued.
- An identity holds two external identifiers and resolves to the same `userId`
  through either, with every membership intact — the proof that a provider or
  method change is survivable.
- A member who has lost every authenticator is re-admitted through an invite and
  registers a new credential, with no email sender involved.
- The bypass is no longer reachable in a production configuration, and the active
  mode is still disclosed in the startup event and `/readyz`.
- No private key material, challenge or raw assertion appears in any record, audit
  row, outcome, sync payload or log line.
- Phase 42 controls, Phase 44 atomicity, Phase 45 scope, Phase 47 recovery and Phase
  48 record identity are unchanged, proven by regression tests.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`. Run `npm run verify:push` because the
  sign-in surface changes — and note the gap below.

## Known verification gap

`npm run verify:push` screenshots the reference app with no authority configured, so
session chrome does not render and the visual suite **will not cover the new sign-in
surface**. Do not read a green visual run as coverage of it. Either drive the
sign-in surface from the integration suite through the real bridge, or add a visual
case that configures an authority; decide which during task 1 and say so.

## Non-goals

- The offline session lifetime, the 30-day sync grace, client-side identity
  persistence, and the `main.ts:139` signed-out-identity defect — all Phase 50. This
  phase makes sign-in real; that phase makes staying signed in survive being
  offline. **A deployment needs both.**
- Implementing an OIDC verifier. The seam and its configuration already exist and
  stay; wiring a provider is a later, optional swap.
- A local biometric gate, remote wipe, or a per-session device list (see ADR 0008;
  the device list is a candidate for Phase 50).
- Conformance cases and migrations for the changed contract (Phase 51).

## Dependencies

- Phase 41 opaque sessions, identity provisioning, invites and revocation.
- Phase 42 HTTP controls, rate limits and redaction.
- Phase 46 identity-verification switch and the browser transport.
- Phase 48 record identity, and its finding that no deployment holds data, which is
  what makes the keying change free.
- `docs/adr/0008-passkey-identity-and-offline-session-grace.md`.

## Parallel Execution Plan

Serial spine first, in one pass with no consumers:

1. The identity keying change — `AuthorityIdentity`, the store interface,
   `provisionIdentity(provider, subject)`, and the ordered migration. Every later
   stream reads this shape, and migration files must not be authored concurrently.
2. The credential/challenge store interfaces and the ceremony signatures.

Fan out after the spine:

- The registration ceremony and its unit tests.
- The authentication ceremony and its unit tests.
- Invite-based recovery.
- The browser sign-in and registration surface.
- The documentation bundle: `docs/server-authority.md`, runbook, threat model,
  `.env.authority.sample`, learnings.

Keep serial: `src/index.ts` exports, `bucketFor` and the route table in
`authority-http.ts` (one file, several new routes), ordered migration SQL, and the
`ADL_IDENTITY_VERIFICATION` mode change which the config, `/readyz` and the startup
event all read.

Barriers: one `npm run test:integration` after the ceremonies and the integration
stream land. One `npm run verify:push` at the very end.

## Tasks

1. Confirm the evidence above against current code, and decide how the new sign-in
   surface is actually verified given the visual-suite gap.
2. Replace the single `subject` with a `(provider, subject) → userId` link table,
   with its ordered migration, and prove two identifiers resolving to one identity.
3. Implement the registration ceremony and credential storage.
4. Implement the authentication ceremony, issuing an ordinary opaque session on a
   verified assertion, with challenge single-use, expiry, origin and counter checks.
5. Add invite-based recovery for a user with no remaining authenticator.
6. Add the identity-verification mode, keep the fail-closed rule, and keep the
   active mode disclosed.
7. Add the browser registration and sign-in surface.
8. Add real-PostgreSQL integration coverage and forgery/replay regression tests.
9. Update `docs/server-authority.md`, the runbook, the threat model,
   `.env.authority.sample` and learnings.
10. **Required next-phase planning handoff:** before Phase 49 closes, review
    `docs/phases/phase-50-offline-session-lifetime-and-sync-grace.md` and revise it
    if this phase's results change its scope, constraints, deliverables, or tasks.
    The handoff must justify Phase 50 as the highest-value remaining gap
    **repository-wide**, not merely the next gap in the subsystem this phase
    touched; if a higher-value gap exists elsewhere, say so and re-sequence. Then
    verify, commit, and push Phase 49.
