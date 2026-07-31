# ADL Target Architecture

Status: Accepted by Phase 19

Date: 2026-07-16

## Purpose

This document reconciles the July 2026 architecture notes into one target
architecture for ADL.

It supersedes the following notes for architectural decisions:

- `docs/ADL_Implementation_and_Marketing_Proposal.md`
- `auth-options.md`
- `automerge-sync-architecture.md`

Those documents remain useful background and product input, but this document is
the decision record for implementation direction.

## Product Boundary

The ADL product is:

- the authored ADL language
- the canonical resolved model
- runtime semantics
- the TypeScript reference/product runtime
- the future conformance suite
- inspectable defaults and policy decisions

The product is not a native renderer, a Wasm backend, a database engine, an auth
provider, a sync library, or an appliance.

## Current Target Stack

```text
ADL source
  -> parser / compiler
  -> resolved application model
  -> TypeScript runtime semantics

Browser / PWA client
  -> Web Components UI
  -> IndexedDB local persistence
  -> local policy / validation / lifecycle / command checks
  -> operation log / sync queue

TypeScript authority server
  -> auth/session boundary
  -> ADL runtime re-checks
  -> authoritative command and sync replay
  -> PostgreSQL accepted-state projection
```

## Layer Decisions

### Language and Model

ADL remains runtime-model-first. All authoring inputs compile to the same
resolved model. Runtime services consume the resolved model, not parser AST
nodes or source strings.

The resolved model is the stable contract for:

- objects and fields
- contexts and membership
- policy
- lifecycle
- validation
- commands
- read models
- sync classification
- themes
- audit and operation log behaviour

### Client Runtime

The TypeScript runtime is both the current product runtime and the semantic
reference.

The near-term client target is browser/PWA:

- TypeScript runtime
- Web Components UI
- IndexedDB local persistence
- local-first operation log and sync queue

SQLite/OPFS may be reconsidered later as a browser-local storage upgrade if
IndexedDB becomes a limiting factor for query performance, migration handling,
or data volume. SQLite is not part of the language contract.

### Server Authority

The production server direction is TypeScript, not Go.

The authority server owns:

- session validation and runtime identity
- invite claim flows
- context membership authority
- context-role resolution
- policy re-checks
- validation re-checks
- lifecycle transition re-checks
- command precondition and transaction checks
- conflict decisions
- authoritative audit emission
- recovery/admin state

The browser remains untrusted. Local runtime checks exist for UX and offline
operation, but shared data is accepted only after the server re-checks the
operation.

### Database

PostgreSQL is the authoritative server projection.

It stores accepted business state, audit, recovery/admin data, and reporting
projections. It can enforce relational integrity, scoped uniqueness, and
transactional command acceptance as implementation details.

ADL does not expose SQL as the normal authoring surface.

### Sync

The target sync model is operation-intent replay.

The client syncs ADL operations, not blind row replacement:

- `create`
- `update`
- `delete`
- `transition`
- `command`

The server replays each intent through ADL runtime semantics and returns an
outcome:

- accepted
- rejected
- conflict
- requires manual resolution

Lifecycle transitions remain business operations, such as "approve record from
revision 8", not simple field patches.

Automerge is not part of the current target architecture. It may be reconsidered
later if the operation-intent sync path proves insufficient for collaboration,
deduplication, or conflict-preserving change movement.

### Auth

Auth is infrastructure, not an ADL language primitive.

The target is a small TypeScript auth boundary that supplies runtime identity.
The method is now decided: **passkeys (server-side WebAuthn) verified by the
authority itself**, with identity keyed on a stable internal user id holding
**linkable external identifiers** so the provider, the method, or the decision to
use one at all stays changeable without re-keying user data. Recovery uses the
existing invite system rather than email. `UpstreamIdentityVerifier` remains the
seam for a bearer-proof provider, so "Sign in with Google" (free, no per-user
charge) stays a drop-in alternative.

Offline operation is governed by a **sync grace declared in the ADL model** — 30
days for the Giggle app — which bounds how long a device may sync without a fresh
logon. Local reads and local-first writes are never gated on a session.

See [ADR 0008](../adr/0008-passkey-identity-and-offline-session-grace.md) for the
decision, the rejected alternatives (Supabase Auth, Better Auth, Auth.js,
passwords, magic links, a local biometric gate) and the consequences.

ADL authorization remains separate:

- auth proves who the user is
- ADL context membership proves which business contexts they can access
- ADL policy proves which operations they may perform
- sync replay re-checks all of the above server-side

Invite claiming is online-only and server-authoritative. Offline use depends on
a cached session and cached local data after a prior sign-in.

### Packaging

The near-term product packaging is the browser/PWA runtime plus model assets.

An `.adlpkg` style package can remain a future packaging format for resolved
model, assets, migrations, and metadata, but it must not imply Wasm, native UI,
or appliance delivery.

## Explicitly Out of Scope

The current target architecture drops:

- Dart runtime
- Flutter renderer
- Wasm business-logic backend
- Rust/Wasmtime bridge
- Tiny Core Linux / appliance runtime
- Go server as the primary authority layer
- Automerge as the first sync implementation

Reintroducing any of these requires a new ADR that supersedes this document and
explains why the TypeScript/PWA + TypeScript server direction no longer fits.

## Sequencing

Phases 20-23 delivered the expression language, declarative validation, computed
fields, and the conformance suite and spec. Phases 24-38 delivered the UI
presentation model, its runtime and renderer, and the Giggle Band reference
screens. Phases 39-45 delivered the authority service, remote bootstrap, opaque
sessions and access lifecycle, the production HTTP edge, reporting and
administration, transactional projection integrity, and audit scope and
retention.

Phase 46 is the first phase whose result is demonstrable outside `vitest`: a
runnable authority process, a switchable identity boundary (bypass by default,
disclosed at startup and on `/readyz`), an HTTP client transport, and browser
session/bootstrap/reconnect wiring.

Phases 47 (the usable sync slice — sign-in and invite-claim UI, conflict and
manual-resolution recovery, the PWA offline shell) and 48 (offline operation
identity, so an offline-created record converges to one accepted record) are
complete. The remaining sequence is:

1. Phase 49: passkey identity and provider-independent identity keying.
2. Phase 50: offline session lifetime and sync grace.
3. Phase 51: platform contract conformance and model migrations.
4. Phase 52: conformance expressiveness and contract completion.
5. Phase 53: authority membership projection and scoped access.
6. Phase 54: retention scheduling and its administration UI.
7. Phase 55: reference-app gaps and documentation hygiene.

**Phases 49 and 50 together are the deployment gate.** Until both are complete the
identity bypass is the only way in, and the rule stated by Phases 46, 47 and 48
stands: no deployment may hold real user data. Neither phase alone is sufficient —
Phase 49 makes signing in real, Phase 50 makes staying signed in survive being
offline. See the accepted temporary risk in
[the threat model](../security/phase-42-threat-model.md).

## Gating Criteria

Before building the TypeScript authority server:

- operation-intent semantics are documented
- command and lifecycle semantics are covered by tests
- context membership and policy re-check semantics are clear
- the server can consume the same resolved model as the browser runtime

Before replacing IndexedDB with SQLite/OPFS:

- there is a demonstrated IndexedDB limitation
- storage remains behind the existing backend abstraction
- schema version and migration checks remain runtime-level concerns

Before introducing Automerge:

- operation-intent sync has a concrete limitation
- Automerge remains below the ADL semantic layer
- the server still validates before accepted state changes

Before choosing an auth provider — **all met, and the decision is recorded in ADR
0008**:

- the runtime identity/session boundary is defined
- invite claiming and offline cached-session requirements are clear
- provider concepts do not replace ADL business contexts
