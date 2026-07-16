# ADR 0004 - Conformance Suite Is the Cross-Runtime Contract

Status: Accepted

Date: 2026-07-16

## Context

ADL promises consistent behaviour from one application definition. The resolved
model is the stable runtime contract, but written interfaces alone are not
enough to prove another runtime behaves the same way.

The project may later add server-side replay or other implementation surfaces
that must match browser runtime behaviour.

## Decision

ADL will maintain a data-driven conformance suite as the executable
cross-runtime contract.

Conformance cases describe models, inputs, runtime contexts, operations, and
expected outcomes without depending on TypeScript runtime internals. The
TypeScript runtime must pass the suite. Any future runtime, server replay engine,
or alternate implementation must pass the same suite before it can claim ADL
semantic compatibility.

## Consequences

- Cross-runtime consistency becomes verifiable.
- Specification and tests must stay linked through stable case ids and spec
  references.
- Phase 20 seeds expression conformance cases; Phase 23 expands the corpus.
- Behaviour changes require conformance updates or defect fixes, not informal
  reinterpretation.

## Rejected alternatives

- Treat TypeScript implementation details as the only specification.
- Rely only on prose documentation.
- Allow each runtime or server implementation to interpret the model
  independently.
- Build a second runtime before conformance exists.
