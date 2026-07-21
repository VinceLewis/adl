# Phase 39 - Authority Server, PostgreSQL Accepted State, and Sync Replay

## Objective

Connect the local-first ADL runtime to a trusted TypeScript authority server and
PostgreSQL accepted-state projection. This establishes durable shared data and
server-side enforcement for multiple users without making PostgreSQL, HTTP, or
authentication-provider concepts part of the ADL language.

The first server slice must be end to end: an authenticated browser operation
intent reaches the server, the server derives identity and context access from
trusted state, replays the operation through the same resolved-model runtime
semantics, commits accepted state and audit data transactionally, and returns a
deterministic outcome to the client.

## Scope

Implement the first authoritative shared-data path:

- A TypeScript authority-server boundary that consumes `ResolvedApplicationModel`
  and shares ADL runtime semantics with the browser; it must not consume parser
  AST nodes or introduce generated application code.
- PostgreSQL persistence for accepted object records, application/model metadata,
  context memberships and roles, accepted operation outcomes, and audit data.
- A small server authentication/session boundary. Select and document the
  provider/adapter used for this phase; it must establish server-verified
  identity, and clients must not be able to select an arbitrary `userId`, role,
  or context membership in a request.
- Server-owned context membership and context-role resolution. Authentication
  proves identity; ADL membership and policy semantics determine access.
- Operation-intent replay for `create`, `update`, `delete`, `transition`, and
  `command`, including base revision where applicable. The server must return
  `accepted`, `rejected`, `conflict`, or `manualResolution` outcomes.
- Transactional accepted-state writes, including multi-record commands, with
  authoritative audit emission and idempotency/deduplication of retried
  operation intents.
- Browser sync-client attachment that submits queued local-first operations when
  online and reconciles accepted, rejected, and conflict outcomes into the
  existing local storage/sync-status model.
- A Giggle Band reference path that proves two authenticated users can share a
  band while a member cannot perform an administrator-only operation.

This phase creates the authority path for shared data. It does not replace
local-first browser storage or require every object to be remotely available.
Object sync declarations remain the source of truth for what is eligible to
queue, transmit, cache, and reconcile.

## Design Constraints

- Follow `docs/architecture/target-architecture.md` and ADR 0007: TypeScript
  authority server, PostgreSQL accepted-state projection, and operation-intent
  replay. Do not introduce Go or Automerge as the first server/sync path.
- The browser is untrusted. The server must re-check session identity, selected
  context availability, context roles, row and field policy, validation,
  lifecycle legality, command preconditions, object constraints, model/schema
  compatibility, and base revision/conflict state before it accepts an intent.
- Do not accept client-supplied roles, membership assertions, audit actor IDs,
  timestamps, or accepted revisions as authoritative input.
- Reuse the resolved model and the TypeScript runtime as the semantic reference.
  Server replay must not reimplement policy, validation, lifecycle, command, or
  expression rules in SQL or route handlers.
- PostgreSQL is an implementation projection. SQL table names, routes, provider
  identifiers, and storage details must not become ADL syntax or resolved-model
  business concepts.
- Preserve local-first behavior: local checks provide responsive/offline UX;
  accepted shared state changes only after server replay. `onlineRequired`,
  `cacheReadonly`, and `localPrivate` behavior must remain enforced.
- Treat accepted operation identity as idempotent. Retrying a timed-out request
  must return the prior authoritative outcome rather than applying a second
  mutation.
- Keep provider-specific authentication concepts behind a small TypeScript
  adapter. Auth tokens must not be the sole source of business roles.
- Do not expose protected records in bootstrap, pull, error, audit, or conflict
  responses. All server reads and outcome payloads must be policy/context shaped.

## Expected Deliverables

- Server package/module, configuration, and documented local development setup
  for the TypeScript authority process and PostgreSQL.
- PostgreSQL storage adapter/migrations for accepted state, schema metadata,
  membership/roles, operation outcomes/idempotency, and audit records.
- Authentication/session adapter with server-verified identity and a documented
  provider decision appropriate to the first deployable slice.
- Server replay service and transport contract for the five ADL operation
  intents and four outcome classes.
- Browser sync transport/reconciliation integration using the existing operation
  log and sync queue, with policy-safe status reporting.
- Integration fixtures for at least two Giggle Band users, one shared band, and
  distinct Admin/Member capabilities.
- Tests and operational documentation covering persistence, authorization,
  replay, conflict, idempotency, audit, and local-client reconciliation.
- Learning documentation describing the server boundary, PostgreSQL projection,
  session/identity boundary, and safe extension points for later server work.

## Acceptance Criteria

- A restart of the authority server does not lose accepted PostgreSQL state,
  membership, operation outcomes, or audit history.
- Two authenticated users can read and synchronise records in a shared Band
  context according to their server-resolved memberships.
- An unauthenticated request, an invalid session, a spoofed `userId`, a spoofed
  role, and a request outside the caller's context are rejected before any
  accepted-state mutation.
- A Band member cannot use a crafted transport request to execute an
  administrator-only operation; the server returns a structured rejection and
  records no accepted business mutation.
- The server re-checks validation, field/row policy, lifecycle transitions,
  command preconditions, constraints, and model/schema compatibility through
  ADL runtime semantics before committing accepted state.
- Each supported operation intent returns exactly one deterministic outcome:
  `accepted`, `rejected`, `conflict`, or `manualResolution`; a retry with the
  same operation identity is idempotent.
- Accepted multi-record commands persist atomically, including their audit
  records; a rejected command leaves no partial accepted-state change.
- A client reconnect can submit queued local-first intents and marks each local
  operation accepted, rejected, conflicted, or awaiting manual resolution from
  the server response. Local-private records are never transmitted.
- The Giggle Band reference demonstrates a shared record written by an admin
  becoming available to a permitted member after reconciliation, while the
  member's forbidden write remains rejected.
- The implementation has no new ADL language syntax for SQL, routes, sessions,
  or provider configuration.
- `npm run typecheck`, the complete automated test suite (including PostgreSQL
  integration coverage), `npm run format:check`, and `npm run build` pass. Run
  `npm run verify:push` and inspect its screenshots if this phase changes any
  browser UI rendering, shell chrome, reference-app screens, presentation
  output, or CSS.

## Out of Scope

- A general-purpose identity product: password recovery, email delivery,
  passkeys, social login, account recovery, and a complete account-management UI.
- Invite claiming and account provisioning workflows beyond the minimum fixtures
  required to prove server-owned memberships; invite claiming remains a later,
  online-only authority workflow.
- Replacing IndexedDB with SQLite/OPFS, adding Automerge, peer-to-peer sync, or
  a separate Go/Rust/Wasm server implementation.
- Full offline bootstrap/dataset pull, background sync scheduling, advanced
  conflict-resolution UI, reporting projections, rate limiting, deployment,
  backup automation, monitoring, or production operations hardening.
- New Giggle-specific route handlers, policy shortcuts, or data-fetching paths.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/architecture/target-architecture.md,
docs/adr/0004-conformance-suite-is-the-cross-runtime-contract.md,
docs/adr/0005-typescript-runtime-is-the-semantic-reference.md,
docs/adr/0007-server-authority-and-sync-stack.md,
auth-options.md, docs/phases/phase-38-calendar-planning-renderer-and-event-entry-points.md,
docs/phases/phase-39-authority-server-postgresql-and-sync-replay.md,
learnings/architecture/target-architecture.md,
learnings/architecture/business-contexts-and-backends.md,
learnings/implementation/runtime-services.md,
learnings/implementation/storage-backend.md,
learnings/implementation/context-runtime.md,
learnings/implementation/policy-engine.md,
learnings/implementation/sync-policy.md,
learnings/implementation/model-versioning-guard.md, and
learnings/implementation/conformance-suite.md as the source of truth.

Execute Phase 39 only. Build the first end-to-end TypeScript authority-server
slice: PostgreSQL accepted state, server-verified identity/session boundary,
server-owned memberships and context roles, operation-intent replay through the
existing resolved-model runtime, authoritative audit, idempotent outcomes, and
browser queue reconciliation. Prove the path with two Giggle Band users and a
server-rejected crafted administrator action. Do not add ADL syntax for SQL,
routes, or auth; do not add Automerge, Go, a runtime rewrite, or broad account/
invite/operations features. Add integration tests and documentation, update
learnings and the next phase only if actual results require it, run the required
verification, then commit and push the phase.
```

## Tasks

1. Inventory the current runtime storage abstraction, operation log, sync queue,
   audit output, revision handling, model-version guard, context resolution, and
   policy/command enforcement paths.
2. Define the server transport and persistence boundaries for authenticated
   operation intents and authoritative outcomes without leaking transport or SQL
   details into ADL models.
3. Select and document the first authentication/session adapter, then implement
   server-side identity verification and test fixtures. Keep it replaceable and
   separate from ADL membership/role semantics.
4. Implement PostgreSQL schema/migrations and storage adapters for accepted
   records, model metadata, memberships/roles, operation deduplication/outcomes,
   and audit history.
5. Implement the authority replay service using the existing resolved-model
   runtime, including transaction boundaries, model/schema checks, idempotency,
   and outcome mapping.
6. Add authenticated server endpoints/transport handlers for `create`, `update`,
   `delete`, `transition`, and `command`; reject spoofed identity, role, context,
   revision, and actor data.
7. Attach the browser sync client to the transport and reconcile outcomes into
   local records, operation-log/sync-queue state, and existing sync presentation
   without transmitting local-private data.
8. Add PostgreSQL integration tests for restart persistence, shared-context
   reads/writes, authorization bypass attempts, policy/validation/lifecycle/
   command re-checks, atomic commands, conflicts, audit, and idempotent retries.
9. Add a two-user Giggle Band scenario that proves permitted shared-data flow
   and server-side denial of a member's crafted administrator request.
10. Document local setup, test database lifecycle, migration workflow, trust
    boundaries, and explicitly deferred operational/auth/sync work. Update
    `learnings/` and `learnings/index.md` with reusable findings.
11. Before closing the phase, replace the Phase 40 placeholder with a complete,
    executable phase document. Use actual server transport, PostgreSQL, session,
    replay, and client-reconciliation results to set its scope, constraints,
    deliverables, acceptance criteria, verification, and explicit non-goals.
    Revise the later placeholders too if this work changes their order or
    dependencies.
12. Run `npm run typecheck`, the complete test suite, `npm run format:check`,
    and `npm run build`; run and inspect `npm run verify:push` whenever browser
    rendering or CSS changes. Commit all Phase 39 changes and push the current
    branch.
