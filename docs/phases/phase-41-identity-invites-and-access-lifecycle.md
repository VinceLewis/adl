# Phase 41 - Identity, Invites, and Access Lifecycle

## Objective

Replace the Phase 39 development-only `StaticSessionAdapter` with the minimum
production-suitable, server-owned identity and session lifecycle needed by the
existing authority and sync boundary. Add online-only, server-authoritative
invite claim and membership-grant flows, and make expiry, sign-out, revocation,
and cached offline access explicit without conflating authentication identity
with ADL business contexts, memberships, or roles.

## Evidence and Dependency

Phases 39 and 40 establish an `AuthoritySessionAdapter` that supplies only a
`userId` and optional expiry to `AuthorityService`. The service derives context
roles from accepted `BandMember` records and policy-shapes bootstrap and replay
responses. The sole implementation is `StaticSessionAdapter`, documented as
development/test-only; it has no account lifecycle, durable session store,
sign-out, rotation, revocation, or invite support. Phase 40 persists browser
queue and reconciliation state separately from object records and permits
offline use only from previously cached data.

Phase 41 must preserve these boundaries. Authentication proves identity;
server-owned memberships resolve ADL context roles; resolved-model policy still
decides which rows, fields, transitions, commands, bootstrap records, and sync
operations are allowed.

## Scope

- Select and document one concrete, replaceable TypeScript authentication
  adapter for the authority server. It must use server-validated, opaque
  sessions and must not put ADL roles or memberships in a bearer token.
- Implement the minimum account/provisioning path needed to create a stable
  identity for an invite recipient. The adapter may use test/development
  fixtures, but its production contract must support secure server-side session
  creation, validation, expiry, renewal/rotation, sign-out, and revocation.
- Add durable, single-use invite records and a server-authoritative,
  online-only claim operation. Claims must bind the authenticated identity to
  the intended business context and grant the declared membership/role in one
  transaction; they must be idempotent without allowing a token to grant access
  twice or to a different identity.
- Add server-side membership/access change and revocation operations with
  audit events. Existing privileged ADL policy and context-role resolution must
  continue to enforce who may issue the change.
- Define the browser session boundary: authenticated bootstrap/replay when
  online; no invite claim or membership mutation offline; expired, signed-out,
  or revoked sessions stop remote access and queued replay; previously cached
  local data remains subject to the existing local runtime policy until a
  successful authoritative refresh removes access no longer granted.
- Add Giggle Band integration coverage for invite claim, member/admin access,
  duplicate/expired/revoked invite attempts, session expiry/sign-out/revocation,
  and denial of crafted identity/context/role inputs.

## Constraints

- Reuse `AuthoritySessionAdapter`, `AuthorityService`, the shared resolved
  model runtime, PostgreSQL authority projection, operation-intent replay, and
  Phase 40 bootstrap/reconciliation boundaries. Do not introduce ADL syntax
  for accounts, providers, cookies, sessions, invites, or database tables.
- The browser is untrusted. Every identity, invite claim, membership change,
  bootstrap, and replay request must derive identity and context access from
  trusted server state; no request field, cached role, or selected context may
  escalate access.
- Keep tokens and secrets out of audit output, operation outcomes, logs, local
  object storage, and sync queue state. Store invite/session secrets only in a
  verifier-safe form and compare them safely.
- A valid session does not imply any ADL role. Membership and context roles
  remain server-owned records resolved at request time.
- Revocation must take effect on the next authoritative request, invalidate or
  reject affected sessions as appropriate, and never permit a queued operation
  to be accepted merely because it was created before revocation.
- Keep browser UI changes minimal and model-driven. Do not treat hiding a
  control or clearing a browser cache as the enforcement mechanism.

## Deliverables

- A documented production session/account adapter contract and a concrete
  authority implementation replacing production use of `StaticSessionAdapter`.
- PostgreSQL migrations and storage services for identities as needed,
  server-side sessions, invite lifecycle, and transactional memberships/access
  changes, including audit integration.
- Typed authority operations/transports for sign-in/provisioning as required,
  sign-out, invite claim, and safe membership/access changes.
- Browser session/sync handling for anonymous, expired, signed-out, and
  revoked states, including clear status without disclosure of protected data.
- Giggle Band integration tests, authority/security tests, documentation, and
  reusable learning notes.

## Acceptance Criteria

- The authority accepts neither a `StaticSessionAdapter` token nor any
  client-supplied user, role, membership, or context assertion as production
  authentication. Expired, signed-out, rotated, and revoked sessions are
  rejected before bootstrap or replay can disclose or mutate accepted state.
- An authenticated recipient can claim a valid, unexpired invite only while
  online. Claiming creates exactly the intended membership/role and audit
  history atomically; retries are deterministic, while duplicate, expired,
  revoked, altered, or wrong-recipient claims grant nothing.
- A privileged server-authorized actor can change or revoke membership; a
  crafted request by a member cannot grant, alter, or retain administrator
  access. After revocation, bootstrap returns no protected records and replay
  rejects queued work without accepting a business mutation.
- Session identity, ADL memberships/context roles, and ADL policy remain
  separately inspectable in tests and documentation. No role is encoded as an
  authentication claim that bypasses runtime context resolution.
- Cached offline data is never presented as newly authoritative access:
  offline invite/access mutations are denied, and the next successful
  authoritative refresh reconciles data removed by access revocation without
  leaking protected records through errors, cursors, audit, or conflicts.
- `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run build`
  pass. Run and inspect `npm run verify:push` if browser rendering, shell
  controls, reference screens, presentation output, or CSS changes.

## Non-goals

- A general-purpose identity-provider product, including password recovery,
  social login, passkeys, email/SMS delivery, broad account preferences, or
  customer-managed identity administration.
- Rate limiting, production deployment, backups, monitoring, incident
  response, or general operational hardening; Phase 42 plans those from the
  implemented endpoint and session behavior.
- ADL language constructs for identity, invites, authentication providers,
  session storage, cookies, routes, or SQL.
- New sync architectures, CRDT/Automerge replication, reporting, or a broad
  account-management UI.

## Tasks

1. Inventory the Phase 39/40 authority, session, PostgreSQL, bootstrap, sync
   state, and browser shell boundaries; document the exact replacement path for
   `StaticSessionAdapter`.
2. Select and document the concrete authentication/session adapter and its
   identity, session issuance, expiry, rotation, sign-out, revocation, and
   secret-handling contracts.
3. Implement durable server identity/session storage and adapter integration;
   update authority transports so server-side session state, not client claims,
   establishes identity.
4. Implement transactional invite creation/claim and membership/access-change
   services with audit events, idempotency, expiry/revocation, and no secret
   disclosure.
5. Integrate expiry, sign-out, and membership/session revocation with
   bootstrap, replay, sync queue behavior, and any necessary minimal
   model-driven browser status/control surface.
6. Add authority, PostgreSQL, browser, and Giggle Band tests for the acceptance
   criteria, including authorization bypass and protected-data disclosure
   attempts.
7. Update server setup/trust-boundary documentation and `learnings/` with the
   resulting identity, invite, session, and revocation contracts.
8. **Required next-phase planning handoff:** before Phase 41 closes, replace
   the Phase 42 placeholder with a complete, evidence-based executable phase
   document. Use the real identity endpoints, session storage, invite flow,
   revocation behavior, PostgreSQL dependencies, and browser/sync behavior to
   define production security and operations scope, constraints, deliverables,
   acceptance criteria, tests/verification, non-goals, dependencies, and the
   required Phase 43 planning handoff. Then run the required verification,
   commit all Phase 41 changes, and push the current branch.
