# Phase 46 - First Deployment Slice

## Objective

Make the authority server a process that actually runs, give it an identity
boundary that can be switched on later without blocking now, and close the
browser-to-server sync loop so a real user's offline work reaches PostgreSQL and
a real remote dataset comes back. This is the first phase whose success is
demonstrable outside `vitest`.

## Evidence and Dependency

Phases 39-45 built a complete authority subsystem that no client can reach and
no operator can start. Three gaps are demonstrated by the code:

- **No identity implementation.** `UpstreamIdentityVerifier`
  (`authority-http.ts:23`) is an interface. `/v1/session/issue`
  (`authority-http.ts:96`) hands the `x-adl-account-proof` header to it, but
  `src/` contains no implementation; the only ones are test doubles
  (`tests/authority-http.test.ts:77`, `tests/authoritative-reporting.test.ts:350`,
  `tests/integration/authority-http.test.ts:78`). Session management after
  issuance (opaque tokens, SHA-256 verifiers, rotation, revocation) is complete;
  the front door is not.
- **No runnable process.** `createAuthorityNodeServer` (`authority-node.ts:10`)
  is referenced only by its own file and one integration test. `package.json`
  has no `start` script, there is no entrypoint that composes configuration, a
  `pg` pool, the identity/session stores, the object storage backend and the
  unit-of-work, and there are no deployment artifacts or configuration sample.
- **No client transport.** `AuthorityTransport` (`sync-client.ts:10`) is an
  interface with no implementation, so nothing connects `AuthoritySyncClient`
  (`sync-client.ts:22`, zero in-repo callers and zero tests) to the live
  `/v1/sync/bootstrap` and `/v1/sync/replay` endpoints. There is no `fetch(`
  anywhere in `src/ui/` or `src/runtime/`, and the browser's identity is the
  hardcoded `userId: "admin-ui"` in `src/ui/demo-fixture.ts:24`.
  `AuthoritySyncClient.bootstrap` (`sync-client.ts:60`) also ignores
  `nextCursor` (`authority-types.ts:77`), so it applies page one and stops.

This phase depends on the Phase 39-45 authority service, the Phase 41 opaque
session adapter, the Phase 42 HTTP controls, and the Phase 44 unit-of-work. It
does not change any of their semantics.

## Scope

- An `UpstreamIdentityVerifier` selection behind a configuration switch. While
  the switch is off, verification is bypassed and the supplied account proof is
  accepted as the identity subject; while it is on, a real verifier is used. The
  switch defaults to off, and the bypass is a documented, temporary development
  state pending a real provider decision.
- The active verifier must be reported on `/readyz` and in the structured
  security log at startup, so a bypassed deployment is visible from outside the
  process without exposing proof values.
- A composed, runnable authority entrypoint: configuration from environment, a
  `pg` pool, PostgreSQL identity/session, outcome, administration and object
  storage stores, the unit-of-work, migrations applied out of band, and an
  `npm run start:authority` script.
- An HTTP `AuthorityTransport` implementation for the browser, carrying the
  session cookie and CSRF token per Phase 42 rules, plus cursor-complete
  bootstrap paging in `AuthoritySyncClient`.
- Client wiring: the browser obtains a session, derives `RuntimeContext.userId`
  from it instead of the demo fixture constant, bootstraps its permitted
  dataset, and reconciles the local-first queue on reconnect.

## Constraints

- The runtime stays the semantic authority. The transport carries intents and
  outcomes; it must not re-derive roles, policy, validation, or lifecycle
  client-side, and must not become an ADL language construct.
- The browser stays untrusted. The client must not send a user id, role, audit
  actor, accepted revision, or timestamp, and the server must keep deriving all
  of those. Bypassed identity verification must not widen anything else: context
  roles still resolve from accepted membership records through the runtime.
- The identity bypass must never be silent. Startup logging and `/readyz` must
  state which verifier is active, the threat model must record the bypass as an
  accepted temporary risk with the real-provider follow-up, and no proof value
  may be logged.
- Preserve Phase 42 controls end to end: HTTPS-only Secure HttpOnly SameSite
  cookies, CSRF on every non-bootstrap route, rate limits, and credential
  redaction. Do not put an ADL role or membership in a token.
- Preserve `localPrivate`, `cacheReadonly`, and `onlineRequired` semantics:
  local-private records and their operation data must never leave the browser.
- Do not weaken Phase 44 atomicity or Phase 45 scope/retention, and do not
  replace operation-intent replay with row replacement, Automerge, or a second
  runtime.
- In-memory stores remain test wiring only; the runnable entrypoint must use
  PostgreSQL.

## Deliverables

- A switchable identity verifier (bypass default, real-verifier seam, startup
  and `/readyz` disclosure of the active mode) and configuration for it.
- A composed authority entrypoint, `start:authority` script, configuration
  sample, and operator startup documentation.
- An HTTP `AuthorityTransport`, cursor-complete `AuthoritySyncClient.bootstrap`,
  and browser session/bootstrap/reconnect wiring replacing the hardcoded
  `admin-ui` identity.
- Real integration coverage of the full loop over a real socket and real
  PostgreSQL, plus runbook, `docs/server-authority.md`, threat-model and
  learnings updates.

## Acceptance Criteria

- `npm run start:authority` starts a server against a real PostgreSQL database
  and serves `/healthz`, `/readyz` and `/metrics`; `/readyz` names the active
  identity verifier.
- With the identity switch off, a session can be issued from an account proof
  and the bypass is stated in the startup log and `/readyz`; with the switch on,
  an unverifiable proof is rejected with `authentication_failed` and no session
  is issued.
- A browser client signs in, bootstraps a dataset containing only records its
  server-resolved identity and context memberships permit, performs offline
  work, and on reconnect has every queued local-first entry replayed exactly
  once, with accepted records reconciled into local storage.
- A bootstrap whose result spans more than one page applies every page: no
  record permitted to the caller is dropped because of `nextCursor`.
- Local-private records never appear in a request body or bootstrap response,
  proven by a test that asserts on the wire payload.
- Crafted client input (user id, role, revision, actor, timestamp, foreign
  context) does not widen the dataset or the accepted outcome.
- Phase 42 controls hold over the real transport: missing or bad CSRF is
  rejected on non-bootstrap routes, rate limits engage, and no token or proof
  appears in any log line.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`. Run `npm run verify:push`,
  including screenshot inspection, because browser session and sync state change
  what the shell renders.

## Non-goals

- Choosing or implementing a real identity provider (OIDC, Better Auth, custom):
  this phase builds the seam and leaves the switch off.
- Conflict and manual-resolution recovery UI, sign-in and invite-claim UI, and
  the PWA offline shell: all Phase 47.
- Membership projection scoping (Phase 48), retention scheduling and
  administration UI (Phase 49), TLS termination, secret management, CI/CD, or a
  hosting provider decision.
- A new sync protocol, database engine, or ADL syntax for routes, sessions,
  cursors, or provider settings.

## Dependencies

- Phase 39-40 authority service, bootstrap and sync state.
- Phase 41 opaque sessions, identity provisioning and access lifecycle.
- Phase 42 HTTP controls, configuration, metrics and structured logging.
- Phase 44 unit-of-work and Phase 45 scope/retention behaviour.

## Parallel Execution Plan

Wall-clock strategy: the three workstreams (identity switch, runnable
entrypoint, client transport) touch mostly disjoint files, but they share
`authority-config.ts`, `authority-http.ts` and `src/index.ts`. Land the shared
types and signatures first, then fan out.

Serial spine (must complete before fan-out):

1. Configuration and verifier types in `authority-config.ts`, the verifier
   selection seam in `authority-http.ts`, and the `AuthorityTransport` signature.
   One agent, skeleton-first: types and signatures only, no consumers.

Fan out after the spine (one agent each, independent files):

- Identity verifier implementations plus startup/`readyz` disclosure.
- Composed entrypoint, `start:authority` script, configuration sample.
- HTTP `AuthorityTransport` plus cursor-complete `bootstrap`.
- Browser session and reconnect wiring in `src/ui/`.
- Documentation bundle: runbook, `docs/server-authority.md` (including its empty
  `## Deferred work` heading at line 51), threat model, learnings.

Keep serial:

- Edits to `src/index.ts`: every server file is exported through it and
  concurrent writes conflict. Assign it to one agent at the end of fan-out.
- Any migration file, if one proves necessary.

Barriers: one integration run after the transport and entrypoint both land, then
`npm run verify:push` once at the end. Do not run `verify:push` per agent; the
Playwright screenshot pass is the slowest step in the repository.

Use worktree isolation for any stage where two agents would write the same
directory.

## Tasks

1. Inventory the identity, startup and transport gaps against the running code,
   confirming the four evidence claims above still hold and pinning every place
   the server currently derives identity, context roles and audit actor.
2. Add the verifier configuration switch and selection seam, defaulting to the
   bypass, with startup log and `/readyz` disclosure of the active mode and no
   proof values in any output.
3. Build the composed authority entrypoint and `start:authority` script over a
   real `pg` pool and the PostgreSQL stores, documenting out-of-band migration
   application and required configuration.
4. Implement the HTTP `AuthorityTransport` with Phase 42 cookie and CSRF
   handling, and make `AuthoritySyncClient.bootstrap` follow `nextCursor` to
   completion.
5. Wire the browser: obtain a session, derive `RuntimeContext.userId` from it,
   bootstrap the permitted dataset, and reconcile the local-first queue on
   reconnect, replacing the `admin-ui` constant.
6. Add real integration tests for the whole loop over a real socket and real
   PostgreSQL: session issue with the switch off and on, multi-page bootstrap,
   offline-then-reconnect exactly-once replay, local-private exclusion asserted
   on the wire, crafted-input rejection, and CSRF/rate-limit enforcement.
7. Update the runbook, `docs/server-authority.md`, the Phase 42 threat model
   (recording the identity bypass as an accepted temporary risk), the target
   architecture sequencing section, and learnings.
8. **Required next-phase planning handoff:** before Phase 46 closes, review
   `docs/phases/phase-47-usable-sync-slice.md` and revise it if this phase's
   results change its scope, constraints, deliverables, or tasks. The handoff
   must justify Phase 47 as the highest-value remaining gap repository-wide, not
   merely the next gap in the subsystem this phase touched. Then verify, commit,
   and push Phase 46.
