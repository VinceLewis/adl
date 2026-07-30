# Phase 47 - Usable Sync Slice

## Objective

Make the Phase 46 deployment slice usable by a real person: give conflicts and
rejections a recovery surface, let a user sign in and claim an invitation from
the browser instead of a test harness, and make the application actually load and
run offline.

## Evidence and Dependency

Phase 46 closed the sync loop and made the authority runnable, but left the
human-facing half of it missing. Three gaps are demonstrated by the post-Phase-46
code and documentation:

- **No recovery surface.** `AuthoritySyncClient.reconcile` (`sync-client.ts:28`)
  maps every non-accepted outcome to `rejected` or `conflict`, sets the
  operation-log status, and removes the queue entry. The resolved object conflict
  policy (`serverWins`, `clientWins`, `stateTransitionWins`, `manual`) is never
  applied client-side and the user is never asked. `docs/server-authority.md:92`
  has recorded "A complete recovery UI remains follow-up work" since Phase 40,
  and Phase 40 listed a complete conflict-resolution UI as an explicit non-goal.
  After Phase 46 this is user-visible: a conflicted edit disappears silently,
  and `watchAuthorityReconnect` (`src/ui/authority-sync.ts:101`) drains the queue
  on every reconnect, so it happens without anyone pressing anything.
- **No identity or invite UI.** `/v1/invites/create`, `/v1/invites/claim` and
  `/v1/memberships/revoke` (`authority-http.ts:232,244,258`) exist server-side
  with no client. `src/ui/components/` contains no session, sign-in, or invite
  component. Phase 46 derives `RuntimeContext.userId` from the server session,
  but only from a build-time `VITE_ADL_ACCOUNT_PROOF` or a `?account=` query
  parameter, and `browserDemoContext` still hardcodes `userId: "admin-ui"`
  (`src/ui/demo-fixture.ts:24`) as the `adl-app` default. There is still no way
  for a person to sign in or claim an invitation from the browser.
- **No offline shell.** `docs/architecture/target-architecture.md` names the
  product packaging as "the browser/PWA runtime plus model assets", but there is
  no service worker and no web app manifest anywhere in the repository. The
  runtime is offline-capable; the application that hosts it is not, so a reload
  without network loses the app even though the data is in IndexedDB. Phase 46
  made this worse in one specific way: with an authority configured the queue is
  now persisted through `IndexedDbSyncStateStorage`, so a user can accumulate
  real offline work that a failed reload would strand.

This phase depends on the Phase 46 transport (`HttpAuthorityTransport`,
`AuthorityTransportError`), the session wiring and reconnect path in
`src/ui/authority-sync.ts`, `AdlAppElement.refreshFromRuntime`
(`src/ui/components/adl-app.ts:728`), and on Phase 40's model conflict policy and
persisted sync state.

**Why this is the highest-value remaining gap repository-wide.** Phase 46 made
the system reachable by a browser and startable by an operator, so the binding
constraint moved from "nothing connects" to "a person cannot safely use what
connects". Every other queued phase is narrower: Phase 48 scopes the membership
projection and Phase 49 schedules retention — both server-side hardening with no
user-visible effect; Phase 50 is conformance and migration work on a contract no
one is yet consuming end to end; Phase 51 is reference-app and documentation
hygiene. Choosing a real identity provider is the other serious open risk, but
the Phase 46 bypass is a recorded, disclosed, acknowledged temporary state and
costs nothing until real user data exists — whereas silent loss of a conflicted
edit costs data on the very first multi-device use. Phase 47 therefore stays
next, with one hard sequencing rule carried forward: **a real
`UpstreamIdentityVerifier` must be in place before any deployment holds real
user data**, regardless of which phase delivers it.

## Scope

- A recovery surface for rejected, conflicted and manual-resolution outcomes:
  the resolved conflict policy selects the deterministic strategy, `manual`
  presents the user a bounded choice, and the queue entry is only discarded once
  resolved.
- Sign-in and sign-out UI over the Phase 46 session endpoints
  (`/v1/session/issue`, `/v1/session/current`, `/v1/session/sign-out`), and an
  invite-claim surface over `/v1/invites/claim`, including the online-only
  behaviour of invitation claiming. This replaces the Phase 46 development
  account-proof configuration (`VITE_ADL_ACCOUNT_PROOF` and `?account=`) as the
  way a person establishes identity.
- A service worker and web app manifest that make the application shell and
  model assets available offline, with an explicit update/activation path and a
  model-version guard consistent with the existing startup compatibility checks.

## Constraints

- The server stays authoritative for conflict outcomes. The client presents and
  applies the strategy the resolved model and the server outcome dictate; it must
  not invent heuristics, re-run policy to decide a winner, or resurrect a
  rejected write as accepted.
- A transport failure is not a verdict. `AuthorityTransportError` (network fault
  or non-2xx) must keep the queue entry retryable; only a real server outcome may
  resolve or discard it. Do not turn an unreachable authority into a rejection.
- A conflict payload must never carry a protected server record. Recovery UI
  shows only what the caller may already read through a normal runtime read.
- Invite claiming is online-only and server-authoritative. The UI must not
  pre-grant membership, cache a claim for later replay, or show context data
  before the server confirms the grant.
- Offline caching must never cache a session token, an authority response body
  containing records, or any protected data in the service worker cache. Cache
  the shell and model assets only; records stay in IndexedDB under the existing
  runtime persistence boundary.
- A model-version change must not leave a stale service worker serving assets
  incompatible with persisted local state; reuse the existing startup
  compatibility guard rather than adding a second versioning scheme.
- Preserve Phase 42 controls, `localPrivate`/`cacheReadonly`/`onlineRequired`
  semantics, Phase 44 atomicity and Phase 45 scope/retention.

## Deliverables

- Client conflict/rejection recovery: policy-driven strategy application, a
  manual-resolution surface, and durable queue/operation-log state across reload.
- Sign-in, sign-out and invite-claim UI components wired to the Phase 46
  transport, with the demo fixture identity constant fully retired.
- A service worker, web app manifest, and offline application shell with a
  documented update and model-version invalidation path.
- Browser, integration and visual coverage, plus runbook,
  `docs/server-authority.md`, threat-model and learnings updates.

## Acceptance Criteria

- A conflicted operation under each deterministic policy (`serverWins`,
  `clientWins`, `stateTransitionWins`) resolves to the model-dictated state
  without user input, and the resolution survives a browser reload.
- A `manual` conflict presents a bounded choice, discards the queue entry only
  after the user resolves it, and never displays a record the caller could not
  read through a normal runtime read.
- A rejected write is visible to the user with its reason and does not silently
  vanish from the queue.
- A user signs in through the UI, and with the Phase 46 identity switch off the
  bypass is still visibly a development mode in that UI.
- An invited user claims an invitation from the browser, receives the membership
  grant, and sees the newly permitted context only after server confirmation; an
  offline claim attempt is refused rather than queued.
- With the network disabled after a prior sign-in, a full page reload still loads
  the application shell and operates against cached local data; no session token
  or record body is present in any service worker cache, proven by a test.
- A model-version change invalidates the cached shell rather than serving assets
  incompatible with persisted state.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push` with
  screenshot inspection: this phase changes browser rendering and shell chrome.

## Non-goals

- Choosing or implementing a real identity provider; the Phase 46 switch stays
  as it is.
- Membership projection scoping (Phase 48), retention scheduling or
  administration and reporting UI (Phase 49).
- Push notifications, background sync APIs, app-store packaging, native
  wrappers, or CRDT/Automerge replication.
- Model migrations for persisted local data (Phase 50); this phase guards
  compatibility, it does not migrate.

## Dependencies

- Phase 46 transport, session wiring, cursor-complete bootstrap and reconnect.
- Phase 40 model conflict policy and persisted IndexedDB sync state.
- Phase 41 invite and membership lifecycle, Phase 42 HTTP controls.
- Existing runtime startup compatibility guard.

## Parallel Execution Plan

The three workstreams are genuinely independent in file terms: recovery UI,
identity/invite UI, and the offline shell. Their shared surfaces are the
component registry, the shell chrome and `src/index.ts`.

Serial spine first:

1. Recovery and session view-state types plus component registration
   signatures. One agent, skeleton-first, no consumers.

Fan out after the spine (one agent each):

- Conflict/rejection recovery components and the policy-application path.
- Sign-in, sign-out and invite-claim components.
- Service worker, manifest, and build integration in `vite.config.ts`.
- Documentation bundle: runbook, `docs/server-authority.md` recovery follow-up
  note, threat model (service worker cache boundary), learnings.

Keep serial:

- Shell chrome and `src/ui/components/register.ts`: all three UI streams touch
  them. One agent integrates after the components land.
- `src/index.ts` exports.

Barriers: one integration run once recovery and identity land, then a single
`npm run verify:push` at the end. Screenshot inspection is manual and cannot be
parallelised, so budget it as one serial step and do not repeat it per agent.

Use worktree isolation for the three UI streams, since they all write under
`src/ui/`.

## Tasks

1. Inventory the current outcome handling in `sync-client.ts`, the persisted
   operation-log and queue state, and every place the UI still assumes a fixed
   identity, confirming the evidence above against the post-Phase-46 code.
   Note that Phase 46 already provides the reconnect hook
   (`watchAuthorityReconnect`) and a re-render entry point
   (`AdlAppElement.refreshFromRuntime`); extend those rather than adding a
   parallel sync path.
2. Implement policy-driven recovery for rejected, conflicted and manual outcomes,
   keeping the queue entry until resolution and the server authoritative for the
   outcome.
3. Build sign-in, sign-out and invite-claim UI over the Phase 46 transport, and
   retire the demo fixture identity constant.
4. Add the service worker and manifest with an offline application shell, a
   documented update path, and model-version invalidation tied to the existing
   startup compatibility guard.
5. Add browser and real-backend coverage: each conflict policy, manual
   resolution across reload, rejection visibility, invite claim online and
   offline, offline reload, and an assertion that no token or record body is
   cached by the service worker.
6. Update the runbook, `docs/server-authority.md` (resolving the recovery
   follow-up note), the threat model, and learnings.
7. **Required next-phase planning handoff:** before Phase 47 closes, review
   the next phase document and revise it if this phase's results change its
   scope, constraints, deliverables, or tasks. The handoff must justify it as
   the highest-value remaining gap repository-wide, not merely the next gap in
   the subsystem this phase touched. Then verify, commit, and push Phase 47.

## Handoff Outcome

The handoff re-sequenced the plan. Executing this phase's real-PostgreSQL
coverage exposed a higher-value repository-wide gap than the membership
projection that previously held slot 48: a queued create carries no record id,
so the authority mints its own and `reconcileRemoteRecord` writes the accepted
record as a *second* local row, stranding the original forever. A hermetic fake
transport had masked it since Phase 46 by echoing the client's guid back.

`docs/phases/phase-48-offline-operation-identity.md` now holds that work, and the
membership projection, retention scheduling, contract conformance and
reference-app phases each moved down one number to 49, 50, 51 and 52. Phase 47
independently confirmed the membership phase's core evidence:
`adl_authority_context_memberships` was still empty after a real invite claim
wrote its membership into `adl_authority_records`.
