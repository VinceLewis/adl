# Phase 19 - Target Architecture Reconciliation

## Objective

Reconcile the currently divergent implementation proposals into one coherent
target architecture, and record the standing constraints as Architecture
Decision Records so future work does not drift.

Three design notes added in July 2026 currently point at three different
technology centres:

- `docs/ADL_Implementation_and_Marketing_Proposal.md` proposes a **Dart** runtime
  with a **Flutter** renderer, **SQLite**, a **Wasm** business-logic backend, and
  a **Rust/Wasmtime** bridge.
- `automerge-sync-architecture.md` proposes **Automerge + Go + PostgreSQL** for
  sync and server authority.
- `auth-options.md` recommends a **TypeScript-first** auth boundary (e.g. Better
  Auth) with an online-only invite/claim flow.

Each note is individually reasonable, but together they imply too many
technology centres before the first customer. This phase produces a single
target architecture that keeps the language and resolved model as the product,
keeps TypeScript as the product implementation stack, and reconciles server,
sync, and auth around a TypeScript authority server and PostgreSQL accepted-state
projection.
It deliberately runs before the expression implementation work so the next
engineering phases have ADR backing for the agreed sequencing and runtime
constraints.

Combined-recommendation coverage: point 5 (reconcile the runtime/server/auth/
sync stack docs into one architecture), and points 1, 2 and 6 recorded as ADRs
(keep TypeScript as reference; drop Dart/Flutter/Wasm from the target
architecture; keep server authority separate from local-first behaviour). This is a low-cost desk phase
that can be executed before the next code phase.

## Scope

This is a documentation and decision phase. It changes no runtime code.

Produce:

- A single **target architecture document** that reconciles runtime, renderer,
  local store, server authority, sync, auth, and packaging into one layered
  picture, with an explicit boundary between "the product" (language + resolved
  model + runtime semantics + conformance suite) and "implementation options"
  (IndexedDB vs later SQLite/OPFS, operation-intent sync vs later Automerge,
  auth provider, packaging).
- **ADRs** capturing the standing constraints and the reconciled decisions.
- A **sequencing/gating** section stating what must be true before any optional
  storage, sync, auth-provider, or packaging expansion begins.

No new runtime, server, renderer, sync engine, or auth provider is built in this
phase.

## Design Constraints

- The product is the language, the resolved model, the runtime semantics, and
  the conformance suite - not a native renderer, Wasm backend, database, sync
  library, auth provider, or appliance.
- The TypeScript runtime is both the current product runtime and the semantic
  reference.
- Dart, Flutter, Wasm, and appliance work are not target architecture options.
  Reintroducing them requires a future ADR that supersedes this phase.
- Server authority (auth, membership, policy re-check, conflict decisions,
  invite workflows, audit, recovery) remains a distinct concern from local-first
  behaviour; the browser/client stays untrusted.
- Sync begins with ADL operation intent replay. Automerge is not part of the
  current target; it can be reconsidered later only if operation-intent sync
  proves insufficient.

## Expected Deliverables

- `docs/architecture/target-architecture.md` reconciling all layers with a clear
  product-vs-implementation boundary and a sequencing/gating section.
- New ADRs under `docs/adr/`:
  - `0003-expression-language-is-pure-and-declarative.md`
  - `0004-conformance-suite-is-the-cross-runtime-contract.md`
  - `0005-typescript-runtime-is-the-semantic-reference.md`
  - `0006-dart-flutter-wasm-are-out-of-scope.md`
  - `0007-server-authority-and-sync-stack.md`
- Cross-references so the three July design notes are marked as inputs that this
  document supersedes for architectural decisions.

## Acceptance Criteria

- One target architecture document exists and names, for each layer, the current
  choice and the deferred option(s) with gating criteria.
- The product-vs-implementation boundary is stated explicitly.
- ADRs record: expression language is pure/declarative; the conformance suite is
  the cross-runtime contract; the TypeScript runtime is the semantic reference;
  Dart/Flutter/Wasm are out of scope; and the reconciled server/sync/auth story
  is TypeScript authority server, PostgreSQL accepted-state projection, and
  operation-intent sync.
- The three July design notes are referenced as inputs and marked superseded for
  architectural decisions.
- No runtime, server, renderer, or sync code is changed in this phase.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/ADL_Implementation_and_Marketing_Proposal.md, automerge-sync-architecture.md, auth-options.md, and docs/phases/phase-19-target-architecture-reconciliation.md as the source of truth. Treat docs/claude-review.md and docs/gpt-review.md as background review inputs, not source-of-truth documents.

Execute Phase 19 only. This is a documentation and decision phase; change no runtime code. Write docs/architecture/target-architecture.md reconciling runtime, renderer, local store, server authority, sync, auth, and packaging into one layered picture with an explicit product-vs-implementation boundary and gating criteria. Add ADRs 0003-0007 recording: pure declarative expression language, conformance suite as cross-runtime contract, TypeScript runtime as semantic reference, Dart/Flutter/Wasm out of scope, and TypeScript server/PostgreSQL/operation-intent sync as the reconciled server story. Mark the three July design notes as superseded inputs for architectural decisions. Before final review, update learnings/ and learnings/index.md if required, and update docs/phases/phase-20-expression-language-foundation.md if actual decisions change its scope. Commit and push.
```

## Tasks

1. Re-read the three July design notes and the Codex brief's stack/boundary
   sections.
2. Draft the layered target architecture, naming for each layer the current
   choice and the deferred option(s) with gating criteria.
3. State the product-vs-implementation boundary explicitly.
4. Reconcile the server/sync/auth story into TypeScript authority server,
   PostgreSQL accepted-state projection, operation-intent sync, and a small
   TypeScript auth boundary.
5. Write ADRs 0003-0007 in the existing ADR format (Context, Decision,
   Consequences, Rejected alternatives).
6. Cross-reference the three July notes as superseded inputs for architecture
   decisions.
7. Verify no runtime code changed; confirm docs are internally consistent with
   the repository boundaries and non-goals.
8. Update `learnings/` and `learnings/index.md`.
9. Review what happened and update
   `docs/phases/phase-20-expression-language-foundation.md` if actual decisions
   change its scope.
10. Commit all repository changes for this phase and push the current branch.
