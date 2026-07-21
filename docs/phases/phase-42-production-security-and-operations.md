# Phase 42 - Production Security and Operations

## Objective

Make the implemented TypeScript authority path operable and defensible in a
production deployment. Harden the real opaque-session, invite, PostgreSQL,
bootstrap, replay, and browser-sync boundaries without adding a new identity
product, sync architecture, or ADL language surface.

## Evidence and Dependency

Phases 39–41 provide a resolved-model authority service, PostgreSQL projections,
opaque server sessions stored as token verifiers, online-only transactional
invite claim, membership revocation that invalidates sessions, and
policy-shaped bootstrap/replay. The code intentionally does not yet provide an
HTTP server, upstream account-proof endpoint, cookie handling, rate limiting,
secret/configuration management, database backup/recovery, monitoring, or an
operational runbook. Those omissions are now concrete production risks rather
than abstract future concerns.

## Scope

- Define and implement the deployable TypeScript authority process/HTTP edge
  around the existing typed services, including HTTPS-only Secure, HttpOnly,
  SameSite session cookies, CSRF posture, request-size/content-type limits, and
  redaction of session/invite credentials from errors and logs.
- Add environment/configuration validation and secret-management boundaries for
  PostgreSQL, cookie/session settings, trusted upstream identity proof, CORS,
  and deployment-specific origins. Development fixtures must fail closed or be
  unavailable in production configuration.
- Add endpoint-appropriate rate limiting and abuse controls for account proof,
  session issuance/rotation/sign-out, invite create/claim/revoke, bootstrap,
  and replay. Preserve server-side idempotency for operation intent.
- Define PostgreSQL migration, least-privilege roles, backup, restore, retention,
  and recovery procedures for accepted records, memberships, session/invite
  verifiers, outcomes, and audit/access-audit projections.
- Add health/readiness checks, structured redacted security/audit logging,
  metrics, alerting inputs, and concise incident/revocation/recovery runbooks.
- Produce a threat-model review and integration tests of the actual HTTP,
  cookie, database, replay, bootstrap, invitation, and revocation boundaries.

## Constraints

- Keep ADL runtime semantics and the resolved model as the authority for
  business policy, validation, lifecycle, scopes, and commands. HTTP middleware
  must not become a second policy engine.
- Retain `OpaqueSessionAdapter` as a replaceable infrastructure adapter:
  authentication identity never carries ADL role or membership authority.
- Do not log raw session tokens, invite tokens, authorization headers, cookies,
  password-equivalent upstream proofs, personally sensitive payloads, or raw
  protected records. Security logs must be useful without becoming a disclosure
  path.
- Treat all browsers and network clients as untrusted; enforce origin, cookie,
  session, request-shape, rate, and model/version checks server-side.
- Use PostgreSQL transactions and least-privilege accounts for migrations and
  authority traffic. Do not expose database access, SQL, routes, or provider
  settings as ADL language constructs.

## Deliverables

- A documented and tested authority HTTP deployment boundary with secure cookie
  and request-handling policy.
- Validated runtime configuration, production-safe session/identity wiring,
  rate limiting, credential redaction, and security-event logging.
- PostgreSQL migration/role/backup/restore/retention instructions and tested
  recovery procedures for all authority projections.
- Health/readiness/metrics/logging integrations and operational runbooks for
  session compromise, access revocation, invite misuse, database recovery, and
  sync/replay incidents.
- Threat model, integration/security tests, documentation, and learning notes.

## Acceptance Criteria

- Production configuration cannot start with `StaticSessionAdapter`, insecure
  cookies, missing required secrets/origins, or unsafe development fixtures.
- Session and invite credentials are accepted only over the documented secure
  transport and never appear in logs, errors, outcomes, audit, browser storage,
  or metrics. CSRF/origin and request-size protections cover every stateful
  endpoint.
- Endpoint rate/abuse controls reject excessive authentication, invite, and
  replay traffic without permitting an authorization bypass or breaking
  idempotent replay semantics.
- A least-privilege PostgreSQL authority role can serve traffic but cannot run
  arbitrary migrations; backup/restore testing proves accepted state,
  membership, session/invite verifier, outcome, and audit recovery.
- Health/readiness and redacted structured logs make failed migrations,
  database loss, session/invite compromise, replay rejection spikes, and access
  revocation diagnosable through the documented runbooks.
- HTTP integration tests prove unauthenticated, cross-origin, CSRF, malformed,
  oversized, rate-limited, expired, signed-out, revoked, and crafted
  role/context requests cannot disclose or mutate protected data.
- Run `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run
  build`; run and inspect `npm run verify:push` if browser rendering, shell
  controls, reference screens, presentation output, or CSS changes.

## Non-goals

- Password recovery, social login, passkeys, email/SMS delivery, or broad
  account-management UX.
- A new sync protocol, CRDT/Automerge, native client, database engine, or ADL
  syntax for security/deployment configuration.
- Reporting, data export, customer-specific administration, or bespoke browser
  UI beyond operationally necessary session/access status.

## Tasks

1. Inventory the implemented authority services and identify every concrete
   HTTP endpoint, credential, database privilege, operational state, and trust
   boundary that Phase 42 must protect.
2. Implement the deployment HTTP/configuration boundary and production-safe
   opaque-session/upstream-identity integration.
3. Add transport, request validation, CSRF/origin, credential-redaction, and
   rate/abuse controls around the real endpoints.
4. Define and test PostgreSQL role separation, migration workflow, backups,
   restores, retention, and recovery for all authority projections.
5. Add health/readiness, redacted structured logs, metrics/alerting inputs, and
   incident/revocation/recovery runbooks.
6. Add threat-model, HTTP integration, security, and recovery tests for the
   acceptance criteria; update documentation and learnings.
7. **Required next-phase planning handoff:** before Phase 42 closes, replace
   the Phase 43 placeholder with a complete, evidence-based executable phase
   document. Use actual authority data, access audit, recovery controls, and
   operational constraints to define authoritative reporting/administration
   scope, constraints, deliverables, acceptance criteria, tests/verification,
   non-goals, dependencies, and its required Phase 44 planning handoff. Then
   run the required verification, commit all Phase 42 changes, and push the
   current branch.
