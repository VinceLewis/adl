# Offline Session Lifetime and Sync Grace

Read this before changing the declared offline grace or its resolved shape, the
authority's session lifetime or cookie attributes, session rotation, the browser
sync gate, the cached browser identity, or the device/session list. The decision
behind it is `docs/adr/0008-passkey-identity-and-offline-session-grace.md`.

## Decisions from Phase 50

- **The grace is declared in the model and gates sync only.**
  `APP … OFFLINE_GRACE 30 DAYS` resolves to `app.offlineGraceDays`, a whole
  number of days between 1 and 365 defaulting to 30. It is a sync-policy
  property in the same family as sync mode, conflict policy and offline dataset
  windows; it never declares how a credential is verified, which stays
  configuration. **Local reads and local-first writes are never gated on it, or
  on a session at all** — nothing in the runtime consults one, and
  `tests/ui-offline-session.test.ts` asserts a create and a read succeeding 90
  days past the grace rather than leaving that as an assumption.
- **The unit word is required.** `OFFLINE_GRACE 14` is a parse error, not 14 of
  something. A bare number would silently mean the wrong thing the moment a
  second unit is added.
- **The declared grace *is* the session lifetime, and the environment may only
  shorten it.** `resolveSessionLifetime(configuration, model)` runs in the
  entrypoint before anything that issues or verifies a session is composed.
  `ADL_SESSION_TTL_MINUTES` became `sessionTtlMinutesCap`; `sessionTtlMinutes`
  is the effective value. `loadAuthorityConfiguration` cannot see the model, so
  it seeds the effective value with the language default and the entrypoint
  replaces it — if you add a second composition root, it must call
  `resolveSessionLifetime` too or it will hand out 30-day sessions regardless of
  what the model declares.
- **A missing declaration is a default; a malformed one is a diagnostic.**
  Validation runs on the resolved model, where the default is already applied,
  so it can only catch a *declared* value that is non-positive, fractional, out
  of range or not a number — which is exactly the case worth catching.
  `ADL_APP_OFFLINE_GRACE_INVALID` exists because this value is also a session
  lifetime, so a silent fallback would be a security surprise rather than a
  cosmetic one.
- **Both cookies needed `Max-Age`, not just the session cookie.** Without it
  these were browser-session cookies, so closing the browser signed a user out
  no matter what the server-side expiry said — which makes a grace measured in
  weeks meaningless. The CSRF cookie needs the *same* lifetime: it is the
  double-submit half of every authenticated mutation, so a session that survived
  a restart without it would read (`/v1/sync/bootstrap` is CSRF-exempt) but fail
  every write with `csrf_denied`. That failure mode is quiet and confusing, so
  the two lifetimes must move together. The change belongs in `sessionCookie`
  and `csrfCookie` themselves, because there are now four writers.
- **Rotation is what actually restarts the grace, and it was already built.**
  `/v1/session/rotate` had existed since Phase 41 and nothing called it. The
  browser now rotates on connect when a session exists, and after a successful
  sync once more than half the grace has elapsed. Rotating on every contact —
  the literal reading of ADR 0008 — writes a session row and re-issues two
  cookies per sync for no added safety; past the halfway point there is still a
  full half-grace of slack. `shouldRotateSession` states that rule in one place.
- **A cached identity is not a credential, and the distinction is structural.**
  `PersistedSessionIdentity` is `{ userId, lastVerifiedAt }` in IndexedDB. It is
  never sent to the authority, the server-derived identity overwrites it on
  every successful contact, and `recordAuthenticated` — the only writer — only
  ever writes an id the authority just reported. When the authority is reachable
  and reports **no** session, the cached identity is *dropped*: keeping it would
  be a shadow account the server has already disowned.
- **`SIGNED_OUT_IDENTITY` replaced the demo-identity fallback.** With an
  authority configured and no identity, the context runs as `adl-signed-out`,
  which matches no membership, so roles resolve to nothing and policy denies.
  Before this the app kept `LOCAL_DEMO_IDENTITY` — which names a local demo
  device, not an account — and looked signed in as something that is not a
  person. `applySessionIdentity` now applies that fallback rather than ignoring
  `undefined`.
- **A grace-expired sync is a refusal to *attempt*, which is neither a transport
  failure nor a verdict.** `synchronize` returns before touching the transport,
  so every queued entry keeps its place and nothing is marked rejected. This is
  the Phase 47 rule restated for a third state; the test asserts that *no
  request was made at all*, not merely that none succeeded.
- **The device list is scoped by the caller's own token, never by a request
  field.** `listSessions(sessionToken)` verifies the token, derives the user id
  from it, and returns only sessions that are neither revoked nor expired,
  capped at 100. It carries no token hash: the verifier for a live session must
  never leave the server, not even to its own holder. Revoked and expired rows
  are excluded because rotation writes a row per restart of the grace, and that
  history would otherwise read as a list of phantom devices.
- **An unknown session id and someone else's session are the same answer.** Both
  are `session_not_found` (404), so the endpoint cannot be used to probe which
  ids exist. `revokeSessionForCaller` returns a plain boolean for the same
  reason — there is deliberately no "exists but not yours" branch to leak.
- **The grace-expired prompt is a ceremony, not a field.** It reuses
  `identityMode` and the Phase 49 passkey controls. Reintroducing an
  account-proof field as a fallback would be the second, weaker way in that
  Phase 49 removed.

## Found here, owned by Phase 51: a content change is not a version change

The phase document asserted that "changing the declared grace is a model version
change and must behave correctly under the existing startup compatibility
guard". The first half is not true as implemented.
`resolveApplicationModel` sets `modelVersion: input.modelVersion ??
ADL_MODEL_VERSION`, `ADL_MODEL_VERSION` is the constant `"0.1.0"`, and there is
no ADL syntax to set it — the parser has no version directive and
`compile-adl.ts` never populates the field. `startup-compatibility.ts` compares
only that string. So editing `OFFLINE_GRACE 30 DAYS` to `7 DAYS` leaves the
version identical and the guard silent, and the authority begins issuing 7-day
sessions while every already-running device still believes it has 30.

This is a pre-existing property of every model property since Phase 11, not
something the grace introduced, and Phase 50's non-goals assign migration across
a model version change to Phase 51 — so it was recorded and handed off rather
than fixed by widening this phase. It is now evidence in
`docs/phases/phase-51-platform-contract-conformance-and-migrations.md`. **Do not
assume the guard protects a model edit** until that phase decides how a version
is derived or declared.

## What the grace is not

The grace is a **maximum, never a minimum**. Revoking a session — or a
membership, which revokes the user's sessions first, deliberately
(`access-lifecycle.ts`) — takes effect on the next contact regardless of how much
grace remains. If a future change makes revocation lazy or deferred, that
ordering is what breaks, and the compensating control for the whole widened
window goes with it.

It is also **not a dataset window**. A dataset scope decides which records a
device holds; the grace decides whether it may sync at all. A lapsed grace never
evicts cached records — that would destroy offline work — and a dataset scope
never extends the grace. `docs/offline-datasets.md` states the composition rule.

## Practical guidance

- **Prove a defect before fixing it.** The offline-reload failure was analysis in
  the phase document, not a demonstrated failure. Extracting `connectAuthority`
  and `applySessionIdentity` out of `main.ts` into `session-startup.ts`
  unchanged, then writing the two-run test, produced a real red
  (`expected 'local-demo-device' to be 'user-casey'`) that named the constant the
  phase document had predicted. `main.ts` runs `void mountDemo()` on import, so
  nothing in it was testable until that extraction.
- **The identity store gets its own IndexedDB database.** Adding a second object
  store to the sync-state database would mean two classes opening one database
  at different versions, and the first one open at the old version blocks the
  other's upgrade indefinitely. `${databaseName}-session-identity` follows the
  same suffix pattern `-sync-state` already established.
- **Inject the clock.** The grace is measured in weeks, so
  `BrowserAuthorityOptions.now` is the only way to test it. Every grace
  evaluation reads it rather than `new Date()`.
- **A corrupt `lastVerifiedAt` must narrow, never widen.** An unparseable
  timestamp evaluates to `expired` and forces a rotation, because the opposite
  choice turns a corrupt record into an unlimited grace.
- **`npm run verify:push` does not cover any of this.** The `desktop`/`mobile`
  projects screenshot the reference app with `VITE_ADL_AUTHORITY_URL` unset, so
  no session chrome, grace prompt or device list is ever on screen. The Phase 49
  `passkey` Playwright project is where a browser-level proof belongs.
- **Two halves of "revocation ends sync" live in two suites, on purpose.**
  `tests/access-lifecycle.test.ts` proves `revokeMembership` revokes the user's
  sessions and that bootstrap and replay then refuse;
  `tests/integration/authority-session-lifetime.test.ts` proves a revoked session
  is refused over real PostgreSQL *with weeks of grace remaining*. Neither alone
  is the acceptance criterion.
