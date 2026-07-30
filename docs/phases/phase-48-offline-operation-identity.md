# Phase 48 - Offline Operation Identity and Accepted-State Convergence

> Inserted by the Phase 47 handoff. The membership projection, retention
> scheduling, contract conformance and reference-app phases each moved down one
> number; their evidence and scope are unchanged, only their position moved.

## Objective

Make an offline-created record converge to a single accepted record. Today the
authority mints its own identity for a replayed create, so the accepted record
comes back under a different id from the one the browser already holds, and the
originating local row is stranded forever.

## Evidence and Dependency

A queued create carries values and no record id. `toIntent` (`sync-client.ts`)
builds `{ kind: "create", objectName, values }` because `AuthorityOperationIntent`
has no `recordId` on its create variant, and `AuthorityService.apply`
(`authority-service.ts:265`) answers it with `runtime.create(...)`, which mints a
fresh guid. The accepted record therefore carries a server id.

`ObjectStore.reconcileRemoteRecord` (`object-store.ts:190`) keys on
`record.meta.guid`. Since that id matches nothing locally, it takes the
`existing === null` branch and **creates a second local row**. The original row
keeps its local guid and `syncStatus: "local"` and is never reconciled, deleted,
or resent — the queue entry was already discarded as accepted. Every subsequent
bootstrap rewrites the server row and leaves the orphan untouched.

This was demonstrated during Phase 47 against real PostgreSQL: a note created in
the browser was accepted as `note-2cefd75e-…` while the browser held
`note-b70ac4bc-…`, and a follow-up update against the local id failed because the
authority had never heard of it. The hermetic fake transport had masked it for
two phases by echoing back the client's own guid — the same class of blind spot
as the Phase 44 NUL-byte `audit_id` defect and the Phase 46 tombstone-replay
defect.

The defect predates Phase 47 (it shipped with the Phase 46 transport), but no
person could reach it until Phase 47 gave one a way to sign in and work offline.

**Why this is the highest-value remaining gap repository-wide.** Phase 47 made
the sync loop safe for conflicts, rejections and identity, so the binding
constraint moved to what the loop does when it *succeeds*. A user's first
offline create — the most ordinary action in an offline-first application —
silently duplicates their data, and no recovery surface reports it because the
outcome was `accepted`. Every other queued phase is narrower: the membership
projection (now Phase 49) is an unpopulated-projection optimisation with no
user-visible effect; retention scheduling and administration UI (Phase 50) are
operational; contract conformance and migrations (Phase 51) codify a contract
that this phase is about to change, so it should follow rather than precede it;
reference-app and documentation hygiene (Phase 52) is cleanup. The Phase 47
sequencing rule still stands unchanged: **a real `UpstreamIdentityVerifier` must
be in place before any deployment holds real user data**, regardless of which
phase delivers it.

## Scope

- A record identity that survives the round trip: the create intent carries the
  originating record id, and the authority accepts that record under that id.
- Server-side defence for a client-supplied id: it is an identifier, never an
  authorisation. A create whose id already exists must not overwrite, merge with,
  or silently adopt the existing record.
- Convergence for state already stranded by the current behaviour, or an explicit
  decision, recorded with evidence, that no such state can exist yet.
- The same treatment for command-produced records if a replayed command can mint
  records the client already holds locally.

## Constraints

- A client-supplied record id is untrusted input. Shape-check it exactly as
  Phase 46 shape-checks an account proof — an empty, over-long, or
  control-character-bearing id is a real PostgreSQL failure, not a curiosity.
- The client may name a record; it may never assert its revision, actor,
  timestamps, accepted state, or scope. Those stay server-derived.
- An id that collides with an existing accepted record is a rejection or a
  conflict with a declared recovery, decided by the authority and surfaced
  through the Phase 47 recovery path. It must never become a silent overwrite of
  another caller's record.
- Idempotency stays keyed on the operation id, not the record id: a retried
  create must still return the stored outcome rather than applying twice.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope/retention, and
  Phase 47 recovery semantics — in particular that a verdict keeps its queue
  entry until it is resolved.

## Deliverables

- A create intent that carries the record id, an authority path that honours it
  under validation, and the wire-contract update that follows.
- Collision and malformed-id handling that resolves through the existing
  recovery surface rather than a new one.
- A convergence path for stranded local rows, or a recorded finding that none
  exist.
- Real-PostgreSQL integration coverage proving a browser-created record keeps one
  identity end to end, plus regression coverage for idempotent retries.
- Updates to `docs/server-authority.md`, the runbook, the threat model and
  learnings.

## Acceptance Criteria

- A record created offline and replayed to the authority exists exactly once
  locally and once on the authority, under the same id, proven against real
  PostgreSQL rather than a fake transport.
- An update, delete or transition issued against that record immediately after
  sync succeeds, with no id translation step.
- A create whose id collides with an existing accepted record produces a server
  verdict the user can see and resolve; it never overwrites the existing record.
- A malformed or over-long client-supplied id is rejected before it reaches
  PostgreSQL.
- A retried create still returns the stored outcome and applies once.
- Phase 47 recovery, Phase 44 atomicity and Phase 45 scope behaviour are
  unchanged, proven by regression tests.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, and `npm run build`; run `npm run verify:push` only if
  browser rendering, shell chrome, reference screens, presentation output, or CSS
  change.

## Non-goals

- Choosing or implementing a real identity provider; the Phase 46 switch stays.
- The membership projection (Phase 49), retention scheduling or administration UI
  (Phase 50).
- Conformance-case and migration work on the changed contract (Phase 51) — this
  phase changes the contract, that phase codifies it.
- CRDT or merge-based replication.

## Dependencies

- Phase 46 transport, replay path and idempotent outcomes.
- Phase 47 recovery semantics, which is where a collision verdict must surface.
- Phase 44 unit-of-work atomicity and Phase 45 audit scope.

## Parallel Execution Plan

Serial spine first:

1. The intent contract and the authority's create path: `authority-types.ts`,
   `sync-client.ts`'s `toIntent`, and `AuthorityService.apply`, in one pass with
   no consumers. Every later stream depends on the accepted shape.

Fan out after the spine:

- Client-side id validation and its unit tests.
- Real-PostgreSQL integration coverage for round-trip identity, collision, and
  idempotent retry.
- The stranded-state investigation and, if warranted, its convergence path.
- The documentation bundle.

Keep serial: `src/index.ts` exports, any migration SQL, and conformance case
updates that must reconcile every stream at once.

Barriers: one `npm run test:integration` run after the spine and the integration
stream land. `npm run verify:push` only if this phase ends up touching the
browser surface.

## Tasks

1. Confirm the evidence above against the current code, and establish whether any
   deployment holds stranded local rows today.
2. Extend the create intent with the record id and honour it in the authority's
   create path, with the id validated as untrusted input.
3. Decide and implement collision behaviour, routing it through the Phase 47
   recovery surface rather than adding a parallel one.
4. Add the convergence path for stranded rows, or record why none is needed.
5. Add real-PostgreSQL integration coverage and idempotency regression tests.
6. Update `docs/server-authority.md`, the runbook, the threat model and
   learnings.
7. **Required next-phase planning handoff:** before Phase 48 closes, review
   the next phase document and revise it if this phase's results change its
   scope, constraints, deliverables, or tasks. The handoff must justify the next
   phase as the highest-value remaining gap **repository-wide**, not merely the
   next gap in the subsystem this phase touched; if a higher-value gap exists
   elsewhere, say so and re-sequence. Then verify, commit, and push Phase 48.
   **Executed — see the handoff below.**

## Planning Handoff (completed)

**The true highest-value gap repository-wide is not a queued phase.** A real
`UpstreamIdentityVerifier` remains absent: the switch exists, `bypass` is the
default, and the standing rule from Phases 46, 47 and 48 is unchanged — **one must
be in place before any deployment holds real user data.** It is not sequenced as a
phase because choosing a provider is a product decision, not an implementation
gap, and every phase since 46 has deliberately deferred it on that basis. It
should be raised for decision rather than silently deferred again.

**Among the executable phases, the platform contract phase was re-sequenced to be
next.** Phase 48's own rationale for putting it after this phase was that "this
phase changes the contract, that phase codifies it" — which argues for codifying it
next, while the change is fresh, rather than after two phases that optimise and
operate a subsystem with no users. Weighed repository-wide:

- **Conformance depth and model migrations** (was Phase 51, now **Phase 49**). The
  conformance suite is ADR 0004's cross-runtime contract and holds 28 cases, while
  phases 24-48 added presentation, matrix, calendar, status, authority replay,
  scoping and now record-identity semantics. That gap is repository-wide and
  independent of any deployment. Its migration half is a fail-closed prerequisite
  for a deployment ever holding data, and Phase 48's finding that no deployment
  exists makes now the cheapest possible moment to build it — there is no live
  migration to perform.
- **Membership projection** (was Phase 49, now **Phase 50**). Its own document
  calls it "an optimisation and integrity refactor of a subsystem with no
  production users", and Phase 48 confirmed there are no users at all. The
  `listRecords()` scans are slow in principle, not slow in production.
- **Retention scheduling and administration UI** (was Phase 50, now **Phase 51**).
  Operational value that needs a deployment to exist. It stays behind the
  membership projection because its administration surface consumes those scoped
  membership reads.
- **Reference app gaps and documentation hygiene** (**Phase 52**, unchanged).
  Cleanup, and it depends on the conformance suite the new Phase 49 delivers.

Phase numbers equal execution order, so the three affected documents were renamed
and their cross-references, dependencies and handoff pointers updated. One factual
correction was pushed into the platform contract phase: its evidence claimed "after
Phase 46 and 47 there is a real deployment with real PostgreSQL accepted records and
real browser IndexedDB state", which this phase disproved.

### Handoff follow-up: the identity decision arrived, and re-sequenced it again

The paragraph above said the true highest-value gap was a real identity verifier but
that it could not be sequenced, because choosing a method was a product decision. That
decision was then made and recorded in
`docs/adr/0008-passkey-identity-and-offline-session-grace.md`: **passkeys**
(server-side WebAuthn) as the credential, identity keyed on a stable internal id with
**linkable external identifiers** so the provider or method stays changeable, invite-based
recovery instead of email, a **30-day sync grace** declared in the ADL model with local
operation never gated on a session, and **no local biometric gate**. Cost did not decide
it — every shortlisted option was £0 at this scale.

That removed the only thing blocking the gap this handoff had already identified as
highest-value, so it was sequenced where it belongs:

- **Phase 49** — passkey identity and provider-independent identity keying.
- **Phase 50** — offline session lifetime and sync grace. A deployment needs both;
  neither alone satisfies the pre-deployment rule, because Phase 49 makes signing in
  real while Phase 50 makes staying signed in survive being offline.
- **Phase 51** — platform contract (was 49). It now codifies three contract changes
  rather than one: Phase 48's create intent, Phase 49's identity shape, and Phase 50's
  new app-level model property. The "codify after the change" argument that moved it up
  is what now places it after these two.
- **Phases 52, 53, 54** — membership projection, retention scheduling, reference-app
  gaps, each down two.

Two impacts found while re-sequencing, both recorded in the new phase documents rather
than fixed here: `npm run verify:push` screenshots the reference app with **no authority
configured**, so the visual suite will not cover the new sign-in surface and a green run
must not be read as coverage of it; and `ADL_IDENTITY_VERIFICATION`'s `bypass | upstream`
no longer describes the space, because a passkey is verified by the authority itself
rather than by an upstream provider.
