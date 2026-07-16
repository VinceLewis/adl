# ADR 0006 - Dart, Flutter, and Wasm Are Out of Scope

Status: Accepted

Date: 2026-07-16

## Context

The July implementation proposal suggested Dart, Flutter, SQLite, Wasm,
Rust/Wasmtime, and appliance delivery as a long-term implementation strategy.
The project has since chosen a simpler target: TypeScript browser/PWA runtime,
TypeScript authority server, PostgreSQL accepted-state projection, and
operation-intent sync.

## Decision

Dart, Flutter, Wasm, Rust/Wasmtime, and appliance runtimes are not part of the
current ADL target architecture.

They are not deferred roadmap items for the current plan. Reintroducing any of
them requires a future ADR that explains the product need, cost, semantic impact,
and migration path from the TypeScript runtime.

## Consequences

- The near-term stack is coherent and smaller.
- Engineering effort stays on language semantics, conformance, server authority,
  and product validation.
- `.adlpkg` style packaging, if introduced later, must not imply Wasm or native
  runtime delivery.
- SQLite/OPFS remains possible as a browser-local storage upgrade, but not as a
  Dart/Flutter platform decision.

## Rejected alternatives

- Keep Dart/Flutter/Wasm as active deferred target options.
- Build a Wasm expression backend before expression semantics are stable.
- Add a Rust/Wasmtime bridge for declarative rule performance.
- Treat appliance delivery as part of the current ADL roadmap.
