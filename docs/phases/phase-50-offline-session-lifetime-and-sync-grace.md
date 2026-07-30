# Phase 50 - Offline Session Lifetime and Sync Grace

> Inserted by the Phase 48 handoff follow-up, alongside Phase 49. Phase 49 makes
> signing in real; this phase makes *staying* signed in survive being offline. A
> deployment needs both, so neither alone satisfies the standing pre-deployment rule.
> Decisions recorded in `docs/adr/0008-passkey-identity-and-offline-session-grace.md`.
>
> **Phase 49 handoff (confirmed).** Phase 49 landed passkey identity, the
> `(provider, subject)` link table and the browser sign-in surface, and removed the
> production bypass. This remains the highest-value remaining gap **repository-wide**,
> for a reason no other candidate matches: a deployment still cannot hold real user
> data, because a signed-in user who reloads offline falls back to
> `LOCAL_DEMO_IDENTITY` and their own cached data becomes unreadable to them. Every
> other open gap — conformance for the changed contract (Phase 51), membership
> projection (52), retention scheduling (53), reference-app hygiene (54) — is work on
> a system that already functions; this one is the second half of the gate that stops
> the system being deployable at all. Phase 49 also sharpened three things this phase
> depends on: the sign-in surface is now a ceremony with no credential field, the
> cookie is written from three routes rather than one, and cross-origin responses
> need CORS headers a Node-side test cannot check. All three are folded in below.

## Objective

Make the session model match how the application is actually used: a device works
fully offline indefinitely, and may sync for up to a declared grace period since its
last successful authentication before a fresh logon is required.

## Evidence and Dependency

The implemented session model is a conventional short-lived web session. The
required model is an offline-first one. Every gap below was verified against current
code:

- **The session cookie has no `Max-Age`** (`sessionCookie`,
  `authority-http.ts:612`), so it is a non-persistent browser-session cookie.
  Closing the browser signs the user out regardless of the server-side expiry.
  Phase 49 added two further writers of that cookie — `/v1/webauthn/register/finish`
  and `/v1/webauthn/authenticate/finish` — so the lifetime change must be made in
  `sessionCookie` itself and not at any one call site.
- **The TTL is 8 hours** (`opaque-session-adapter.ts:85`, `ADL_SESSION_TTL_MINUTES`
  default 480), not a multi-week grace.
- **There is no sliding expiry.** `verify` checks `expiresAt` and never extends it
  (`opaque-session-adapter.ts:169-177`).
- **`/v1/session/rotate` exists and grants a full fresh TTL, but nothing calls it**
  (`authority-http.ts:274-283`; no caller anywhere in `src/ui/`). That endpoint is
  precisely "the grace restarts after every successful authentication", currently
  unwired.
- **Nothing persists identity client-side.** No `localStorage`, no `sessionStorage`,
  no identity in `sync-state-storage.ts`. So there is nowhere for a cached identity
  or a last-verified timestamp to live, and the browser cannot know who the user is
  until `/v1/session/current` succeeds — which requires being online.
- **Consequently, opening the app offline after a prior sign-in is broken.** With no
  session, `connection.session.userId` is `undefined`, so `applySessionIdentity`
  does nothing (`main.ts:139-143`) and `app.context.userId` keeps its cold-start
  value, `LOCAL_DEMO_IDENTITY = "local-demo-device"` (`demo-fixture.ts:30`). No
  membership record matches that id, so no context roles resolve and policy denies:
  the user's own cached data becomes unreadable to them. This is listed as *allowed*
  offline behaviour in `auth-options.md:62`. It is latent today because it needs
  `VITE_ADL_AUTHORITY_URL` set and nothing sets it. **It has not yet been proven by
  a test — task 1 must confirm it before it is fixed.**

One simplification also verified: **nothing in the runtime consults a session.**
There is no session reference in `object-store.ts` or `policy-engine.ts`, so "works
fully offline forever" is already the behaviour. The grace is therefore a **sync
gate only** — there is no "app refuses to run" state to build.

## Scope

- An app-level offline grace declared in the ADL model, resolved, defaulted and
  validated like any other model property.
- Session lifetime that can span the grace: a persistent cookie with a real
  lifetime, and a configurable TTL consistent with the declared grace.
- Client-side persistence of the server-derived identity and the last successful
  authority authentication, so the app knows who the user is while offline.
- Wiring session rotation so a successful authority contact restarts the grace.
- A grace-expired state that blocks **sync** and prompts for logon, while leaving
  local reads and local-first writes untouched.
- The signed-out identity defect: never silently operate as the local demo identity
  when a real session is expected.
- A per-session device list with individual revoke, as the compensating control for
  the grace window.

## Constraints

- **The authority is the enforcement point.** A client-side grace check is a UX
  affordance; the server must independently refuse a sync whose session is expired
  or revoked. `AGENTS.md` already forbids UI behaviour being the only enforcement
  point.
- **Local operation is never gated on a session**, before or after the grace
  expires. That is the whole point of the requirement, and a phase that
  accidentally gates local reads has failed it.
- **A cached identity is not a credential.** It names who the app believes is using
  it, for local policy evaluation; it must never be presented to the authority as
  proof, and the server-derived identity still wins on every successful contact.
- **The grace declaration is a sync-policy property, not an identity one.** Phase
  46's decision that identity verification is configuration rather than an ADL
  construct stands; this is modelled because ADL already models sync mode, conflict
  policy and offline dataset windows. It must not become a way to declare
  authentication.
- **The grace is a maximum, never a minimum.** Revocation must take effect on the
  next contact regardless of remaining grace. `revokeMembership` already revokes the
  user's sessions first (`access-lifecycle.ts:325`) and that ordering must not
  weaken.
- Changing the declared grace is a model version change and must behave correctly
  under the existing startup compatibility guard.
- Preserve Phase 47 recovery semantics, in particular that a transport failure is
  not a verdict and a verdict keeps its queue entry. A grace-expired sync is a
  refusal to *attempt* sync, which is neither.
- Preserve the Phase 47 rule that persisted client state stays inside the existing
  IndexedDB boundary, and the service-worker cache policy that keeps credentials and
  records out of the cache.
- **A logon prompt in `passkey` mode is a ceremony, not a field.** Phase 49's
  sign-in surface has no credential input, and the grace-expired prompt must reuse
  `AdlSessionState.identityMode` and the existing passkey controls rather than
  reintroducing an account-proof field as a fallback.
- **Any new authority route must carry CORS headers on the response, not only on
  the preflight.** Phase 49 found that a browser refuses to read a cross-origin
  authority response without them, and that no Node-side integration test can catch
  it because Node's `fetch` does not enforce CORS. The device-list endpoint inherits
  the wrapper; a route added outside it would silently fail in a real browser only.

## Deliverables

- The resolved-model change for the app-level grace: `resolved-model.ts`,
  `resolve-model.ts` defaults, `validate-model.ts` diagnostics, and ADL parser
  support, with the Giggle model declaring 30 days.
- Session cookie lifetime and TTL changes, and the configuration to match.
- Persisted browser identity and last-verified timestamp, and the rotation call that
  refreshes both.
- The sync gate, its user-facing prompt, and the fix for the signed-out identity
  defect.
- A device/session list with per-session revoke.
- Tests: model resolution/validation, the grace state machine, the offline-reload
  regression, real-PostgreSQL coverage that an expired session is refused
  server-side, and a visual pass for the new chrome.
- Specification updates: `docs/spec/language.md` for the declaration syntax (the
  `APP` block, which today documents only `START_VIEW`) and
  `docs/spec/resolved-model.md` for the resolved shape.
- Updates to `docs/server-authority.md`, the runbook, the threat model,
  `docs/offline-datasets.md` where the grace interacts with dataset windows, and
  learnings.

## Acceptance Criteria

- A signed-in user reloads the app while offline and continues working with their own
  identity, cached data and correct context roles. This is the defect above, closed.
- Local reads and local-first writes work offline both inside and outside the grace,
  indefinitely.
- Inside the grace, a device that reconnects syncs without a fresh logon, and the
  grace restarts from that contact.
- Outside the grace, sync is refused with a prompt to log on, the app remains fully
  usable offline, and queued work is preserved rather than discarded.
- The authority independently refuses a sync presenting an expired or revoked
  session, proven against real PostgreSQL — a client that skips its own grace check
  gains nothing.
- Revoking membership ends sync immediately on next contact regardless of remaining
  grace.
- The declared grace is validated: a missing, non-positive or malformed value
  produces a diagnostic rather than a silent default surprise.
- A user can list their sessions and revoke one individually.
- Phase 47 recovery, Phase 48 record identity and Phase 49 identity behaviour are
  unchanged, proven by regression tests.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push` — the grace
  prompt and device list are new chrome.

  The Phase 49 gap is **closed, not inherited**: the `desktop`/`mobile` projects
  still screenshot the reference app with no authority configured and still cover
  no session chrome, but Phase 49 added a `passkey` Playwright project with its own
  dev server on port 5273 (`VITE_ADL_AUTHORITY_URL` set) and an in-process
  authority harness (`tests/visual/passkey-authority.ts`). Extend that project for
  the grace prompt and the device list rather than restating the gap.

## Non-goals

- A local biometric gate and remote wipe (ADR 0008 rejects both, with reasons).
- Any change to how a credential is verified — that is Phase 49.
- Conformance cases for the new model property, and migration of persisted state
  across the resulting model version change (Phase 51, which follows for exactly
  this reason).
- Per-object or per-context grace overrides. One app-level value until evidence
  demands more.

## Dependencies

- Phase 49 real identity: a grace that expires must have a real logon to expire
  *into*.
- Phase 46 browser transport and session-derived identity.
- Phase 47 recovery semantics, sync-state persistence and the service-worker cache
  boundary.
- Phase 11 startup compatibility guard, which the model version change passes
  through.
- `docs/adr/0008-passkey-identity-and-offline-session-grace.md`.

## Parallel Execution Plan

Serial spine first, one pass, no consumers:

1. The resolved-model grace property: `resolved-model.ts`, `resolve-model.ts`
   defaults, `validate-model.ts`, parser syntax. Every other stream reads the
   resolved shape, and these four files are the repository's established serial
   spine.
2. The session lifetime contract: cookie lifetime, TTL configuration, and the
   client-side persisted identity record's shape.

Fan out after the spine:

- The client grace state machine and the sync gate, with its unit tests.
- Persisted identity storage and the offline-reload regression test.
- The server-side expired/revoked sync refusal and its real-PostgreSQL test.
- The device/session list, server endpoint and UI.
- The documentation bundle.

Keep serial: `src/index.ts` exports, `src/ui/components/register.ts` and shell
chrome, `bucketFor` and the route table, ordered migration SQL if the device list
needs one, the Giggle model fixture, and the specification updates — which must
reconcile the declaration syntax and the resolved shape at once.

Barriers: one `npm run test:integration` after the server refusal and client streams
land. One `npm run verify:push` at the very end, and inspect the screenshots.

## Tasks

1. Confirm the evidence above against current code, and **prove the offline-reload
   defect with a failing test before fixing it** — it is currently analysis, not a
   demonstrated failure.
2. Add the app-level grace to the resolved model with defaults, validation and
   parser support, and declare 30 days in the Giggle model.
3. Give the session cookie a real lifetime and align the TTL with the declared
   grace. Change it in `sessionCookie`, so all three writers — `/v1/session/issue`,
   `/v1/session/rotate` and the two Phase 49 ceremony finishes — get it.
4. Persist the server-derived identity and last-verified timestamp in the browser,
   and stop the app operating as the local demo identity when a real session is
   expected.
5. Wire session rotation so a successful authority contact restarts the grace.
6. Add the sync gate and its logon prompt, leaving local operation untouched inside
   and outside the grace.
7. Enforce expiry and revocation server-side independently of the client, proven
   against real PostgreSQL.
8. Add the device/session list with per-session revoke.
9. Update `docs/spec/language.md` and `docs/spec/resolved-model.md` for the new
   declaration and resolved shape, then `docs/server-authority.md`, the runbook, the
   threat model, `docs/offline-datasets.md` and learnings. Record in the threat model that a device
   inside its grace retains sync capability, that revocation is the control, that
   cached data is never reclaimed, and that there is no remote wipe.
10. **Required next-phase planning handoff:** before Phase 50 closes, review
    `docs/phases/phase-51-platform-contract-conformance-and-migrations.md` and revise
    it if this phase's results change its scope, constraints, deliverables, or tasks
    — it almost certainly will, because this phase adds a model property and a model
    version change that phase must codify and migrate. The handoff must justify Phase
    51 as the highest-value remaining gap **repository-wide**; if a higher-value gap
    exists elsewhere, say so and re-sequence. Then verify, commit, and push Phase 50.
