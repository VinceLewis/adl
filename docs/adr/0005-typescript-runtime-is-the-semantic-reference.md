# ADR 0005 - TypeScript Runtime Is the Semantic Reference

Status: Accepted

Date: 2026-07-16

## Context

The repository already contains a working TypeScript runtime with model
resolution, validation, policy, lifecycle, storage abstraction, browser UI,
context roles, read models, offline dataset evaluation, commands, audit, and
operation logging.

The July architecture proposal considered a Dart runtime and Flutter renderer.
That would replace a working implementation with a second stack before ADL's
semantics and product fit are settled.

## Decision

The TypeScript runtime is the semantic reference and the current product
runtime.

Near-term ADL execution targets browser/PWA with the existing TypeScript runtime
and Web Components UI. Server-side authority will also use TypeScript so server
replay can share model and runtime semantics as directly as possible.

## Consequences

- Product work continues from the implementation that already exists.
- Client and server work can share language, tests, model types, and runtime
  semantics.
- Future work focuses on expression semantics, conformance, specs, and server
  authority rather than a runtime rewrite.
- TypeScript is still an implementation technology, not the ADL language
  contract.

## Rejected alternatives

- Rewrite the runtime in Dart now.
- Treat Flutter as the primary renderer.
- Use different languages for browser runtime, auth/server authority, and sync
  before product semantics are stable.
- Delay product proof behind a second runtime.
