# Passkey Identity and Provider-Independent Keying

Read this before changing WebAuthn ceremonies, identity keying or identity
links, the authority's identity-verification mode, the passkey sign-in surface,
or invite-based identity recovery. The decision behind it is
`docs/adr/0008-passkey-identity-and-offline-session-grace.md`.

## Decisions from Phase 49

- **Identity is keyed on an internal `userId`, never on a provider's subject.**
  `AuthorityIdentity` is `{ userId, createdAt, disabledAt? }` and carries no
  external identifier at all; every one of those lives in
  `adl_authority_identity_links` as `(provider, subject) → user_id`. Before this,
  `adl_authority_identities` had a single `subject` with
  `unique (application_id, subject)`, so changing provider changed the subject,
  missed the lookup, minted a new user id and orphaned every membership — the
  user signed in successfully and saw nothing. Provisioning is now
  `provisionIdentity(provider, subject)`, and adding a method is
  `linkIdentity(userId, provider, subject)`. **A provider or method change is
  linking, not re-keying.** Do not reintroduce a single-identifier column, and do
  not key anything else in the system on a subject.
- **Linking refuses to steal an identifier.** `linkIdentity` rejects an
  identifier already held by a *different* identity rather than re-pointing it,
  and re-linking the same pair to the same identity is idempotent. Both halves of
  the key are shape-checked (`assertIdentityKeyPart`: non-empty, ≤320 characters,
  no control characters) because both reach a PostgreSQL text key — the Phase 44
  `audit_id` NUL defect applies to every identity key part, not just a subject.
- **`@simplewebauthn/server` is confined behind a structural interface.**
  `WebAuthnLibrary` is the seam; `SimpleWebAuthnLibrary` in
  `src/server/simplewebauthn-adapter.ts` is the only module in the repository
  that imports the package, and the authority entrypoint is the only place that
  composes it. It is **deliberately not re-exported from `src/index.ts`**,
  because the browser bundle imports that barrel and the package is a Node
  dependency. `src/index.ts` exports `webauthn-identity.js` (types, service,
  stores) and says why the adapter is missing. Adding the adapter to the barrel
  would break the browser build — the same discipline `pg` already follows.
- **Registration is never anonymous.** The caller either holds a valid session —
  adding a further authenticator to their own identity — or presents a valid
  invite. Nothing else can mint an identity. When a session exists, the ceremony
  reuses the user handle that identity already registered under
  (`listIdentityLinks` → the `passkey` link's subject) so the second credential
  joins the same identity instead of forking a new one.
- **Recovery re-links and grants nothing.** A recipient-bound invite names the
  identity the new credential attaches to, so the **same `userId` and every
  existing membership survive**. `redeemInviteForIdentityRecovery` consumes and
  audits the invite as `identityRecovered` before anything is written, and writes
  no membership row: the member never lost their memberships, only their
  authenticators. A first-time member's invite goes through the ordinary
  `claimInvite` path instead, so the grant is written by the same server-side
  transaction as every other claim. Keep those two paths distinct — collapsing
  them would either grant a membership on recovery or fail to grant one on a
  first admission.
- **The raw invite token is re-supplied at finish, not stored.** Only
  `hashSecret(inviteToken)` lives on the challenge row, so a usable invite
  credential never reaches challenge storage; the token presented at finish must
  hash to the one the ceremony started with. `peekInvite` exists for the same
  reason: it validates an invite **without consuming it**, so a ceremony can
  begin for a caller with no session, and only the finish call consumes it.
- **Single-use challenge consumption lives in the `update … where` clause.**
  `consumeChallenge` sets `consumed_at` and returns the row in one statement,
  filtered on `consumed_at is null and expires_at > $now and ceremony = $ceremony`.
  A read-then-write would let two simultaneous finishes both win. Unknown,
  consumed, expired and wrong-ceremony all collapse to "returns nothing, so
  refuse" — there is no separate branch to forget.
- **The counter rule is also a `where` clause, and it tolerates the always-zero
  authenticator.** `recordCredentialUse` updates only when
  `signature_counter < $new or (signature_counter = 0 and $new = 0)`; zero rows
  updated is the cloned-authenticator signal and refuses with
  `ADL_PASSKEY_COUNTER_REGRESSED`. Some authenticators implement no counter and
  always report zero, which is permitted; a previously non-zero counter may never
  stall or return to zero. `counterAdvanced` states the same rule for the
  in-memory store, and both must move together.
- **The CSRF boundary is stated by presence, not by path.** The ceremony routes
  are the only mutating endpoints reachable without a session. If the request
  carries a **valid session cookie**, a matching double-submit token is still
  required (`csrf_denied`, 403), so the session-gated path is protected exactly
  as every other authenticated mutation. If there is **no session cookie**, there
  is no ambient credential to abuse, and the request is bound instead by the
  allowed `Origin`, the rate bucket, and the server-issued single-use challenge.
  Never special-case a *path* out of CSRF; state the rule in terms of the
  credential actually present.
- **Ceremonies get their own rate bucket.** `bucketFor` maps `/v1/webauthn/*` to
  `webauthn` (`ADL_RATE_WEBAUTHN`, default 20) rather than to `session`, because
  most of these calls are pre-session and must neither spend nor be limited by an
  authenticated caller's session allowance. The limit is checked before the
  session and CSRF checks.
- **A passkey grants identity only.** A verified assertion issues an ordinary
  opaque session; context roles keep resolving from accepted membership records
  through `RuntimeContextService` on every call. A disabled identity is refused
  after verification, not before.
- **Origin binding is explicit configuration and is part of the credential's
  identity.** `ADL_WEBAUTHN_RP_ID` / `ADL_WEBAUTHN_ORIGINS` are validated at
  startup (every origin must be the relying party id or a subdomain of it) and
  passed through on every library call; nothing is inferred from the incoming
  request. A credential registered against one relying party id will not work
  against another, so development and production registrations are separate by
  design and changing the value invalidates every existing credential.
- **The bypass is development-only and has no escape hatch.** A `production`
  configuration in `bypass` is refused by `loadAuthorityConfiguration`, and the
  Phase 46 `ADL_IDENTITY_BYPASS_ACKNOWLEDGED` variable is gone. `upstream` is
  unchanged and still fails closed. The active mode is still disclosed in the
  `identity_verification_configured` startup event and in `/readyz`.
- **A passkey deployment keeps no second, weaker way in.** `/v1/session/issue`
  answers `endpoint_unavailable` (503) in `passkey` mode, and
  `PasskeyIdentityVerifier.verify` returns null, so there is no bearer proof to
  exchange anywhere in the process.
- **Library exceptions are refusals, not errors to propagate.** The adapter
  catches around `verifyRegistrationResponse`/`verifyAuthenticationResponse` and
  returns `{ verified: false }`, because the library's message can quote response
  material. Refusals surface as stable `ADL_PASSKEY_*` codes with a 401 and
  nothing else.

## Practical guidance

- **`npm run verify:push` does not cover the sign-in surface.** The visual suite
  screenshots the reference app with **no authority configured**, so no session
  chrome renders and the passkey surface is never on screen. A green visual run
  is not evidence about it. It is covered instead by three deliberately
  different proofs: `tests/ui-passkey-sign-in.test.ts` for what the surface
  renders and dispatches, `tests/integration/authority-passkey-identity.test.ts`
  for the ceremony against a real authority over real PostgreSQL, and the
  Playwright `passkey` project (`tests/visual/passkey-sign-in.spec.ts` with the
  `tests/visual/passkey-authority.ts` harness) for a real Chromium virtual
  authenticator against a configured authority. Keep `VITE_ADL_AUTHORITY_URL`
  unset for the `desktop`/`mobile` projects — that is what keeps those
  screenshots about the reference app rather than a network state; the `passkey`
  project gets its own dev server on port 5273 with the variable set.
- **The passkey project binds `localhost`, not `127.0.0.1`.** An IP address is
  not a valid WebAuthn relying party id, and a browser treats `localhost` as a
  secure context, so `__Host-` Secure cookies are stored there. Bind the harness
  listener by name too: on a dual-stack host `localhost` can resolve to `::1`
  first, and a listener pinned to `127.0.0.1` is then simply unreachable.
- A WebAuthn ceremony needs a secure context in the browser, and the session
  cookie is `__Host-` Secure HttpOnly SameSite=Strict. The same TLS and same-site
  hosting requirements as every other session call apply; plain-HTTP localhost
  will not do.
- Registration requests `attestationType: "none"` and `residentKey: "required"`.
  Discoverable credentials are why `authenticate/begin` issues no allow-list and
  the authority never has to be told who is signing in. Do not add an allow-list
  to "help" — it would leak whether a credential exists.
- Store nothing but the credential id, the COSE public key, the counter,
  transports and the backed-up flag. Public keys and credential ids are not
  secrets; private keys, raw assertions and attestation objects are never
  persisted, and no challenge value may enter records, audit, outcomes, sync
  state or logs.
- `adl_authority_webauthn_challenges` grows by one row per started ceremony.
  `PasskeyIdentityService.pruneChallenges` deletes only rows past `expires_at`,
  so it can never invalidate a ceremony in flight; nothing schedules it in this
  repository yet, so the runbook carries the operator procedure.
- **There is no first-admin bootstrap flow.** Because registration is session- or
  invite-gated, a brand-new database has no way to admit its first identity
  through the product surface; the operator does it out of band with direct
  database writes (identity row, context record, membership record, then a
  recipient-bound invite). If a future phase adds a bootstrap path, it must not
  become an anonymous registration route.
- **A session is issued only when the ceremony started without one.**
  `finishRegistration` returns a session for an invite-backed registration (a
  new member or a recovered identity, neither of whom had one) and deliberately
  returns none for the session-gated "add another authenticator" path, where the
  edge then writes no cookies. An earlier draft issued one unconditionally; that
  silently replaced the caller's session cookie and left the previous session
  live, so a person adding a second device ended up holding two sessions. The
  discriminator is `challenge.inviteTokenHash`, not `challenge.userId` — the
  latter is also set for recovery, which does need a session.
- **A browser cannot read a cross-origin authority response without CORS headers
  on the response itself, not only on the preflight.** The edge originally
  answered `OPTIONS` with the allow-origin headers but omitted them from the
  actual `POST` and from the `GET /readyz` probe, so every call from a browser
  hosted on a different origin failed at the fetch — including the probe the
  sign-in surface reads its identity mode from, which left the session
  permanently `unavailable`. No integration test could catch it: Node's `fetch`
  does not enforce CORS, only a real browser does. This is exactly the class of
  defect the Playwright passkey project exists to catch, and it is why a
  browser-level proof of the sign-in surface is not redundant with the
  integration suite.
