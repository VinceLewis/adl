# ADL (Application Definition Language) -- Proposed Architecture and Product Strategy

> Superseded for architecture decisions by
> `docs/architecture/target-architecture.md` and ADRs 0003-0007.
> This document remains useful as product and marketing input, but its
> Dart/Flutter/Wasm/Rust/appliance implementation path is not the current ADL
> target architecture.

## Executive Summary

This document proposes an implementation strategy for ADL that
prioritises rapid delivery while preserving a long-term architecture
capable of supporting dedicated appliances, multiple execution engines
and cross-platform deployment.

The core philosophy is:

> **Business applications should be described declaratively, not
> programmed imperatively.**

ADL is therefore an application definition language rather than another
programming language.

------------------------------------------------------------------------

# Goals

-   Single application definition.
-   Native desktop, mobile and web deployment.
-   Local-first.
-   Offline capable.
-   Deterministic business rules.
-   Strong typing.
-   Platform-independent application packages.
-   High performance.
-   Long-term independence from any single UI technology.

------------------------------------------------------------------------

# High-Level Architecture

``` text
ADL Source
    ↓
Parser
    ↓
Semantic Analysis
    ↓
Canonical IR
    ├── Entity Model
    ├── UI Model
    ├── Workflow Model
    ├── Permissions
    ├── Queries
    └── Business Logic
            ↓
     Wasm Backend (future default)
            ↓
Runtime
    ↓
Flutter UI
SQLite
Platform Services
```

------------------------------------------------------------------------

# Canonical IR

The IR is the single source of truth after compilation.

It contains:

-   entities
-   fields
-   relationships
-   screen definitions
-   workflow graphs
-   permissions
-   integrations
-   migrations
-   compiled expressions
-   dependency graphs

No runtime should execute YAML directly.

------------------------------------------------------------------------

# Runtime

The runtime should initially be implemented in Dart.

Responsibilities:

-   application lifecycle
-   state management
-   loading IR
-   SQLite access
-   synchronisation
-   security
-   Flutter rendering
-   invoking business logic
-   executing effects

The runtime owns platform services.

Business logic does **not**.

------------------------------------------------------------------------

# Business Logic

Business rules should be expressed as deterministic event-to-command
transformations.

``` text
Current State
+
Event
+
Context
        ↓
Business Logic
        ↓
State Changes
+
Requested Effects
```

The language should support:

-   arithmetic
-   decimal money
-   comparisons
-   boolean logic
-   pattern matching
-   decision tables
-   validations
-   workflows
-   state transitions

Avoid arbitrary scripting.

------------------------------------------------------------------------

# Execution Strategy

## Phase 1

Reference execution in Dart.

Purpose:

-   define semantics
-   debugging
-   testing
-   authoring

## Phase 2

Compile business logic to WebAssembly.

The runtime invokes Wasm through a native bridge.

The runtime remains responsible for:

-   SQLite
-   UI
-   networking
-   filesystem
-   permissions

Wasm requests actions rather than performing them directly.

------------------------------------------------------------------------

# Native Bridge

Recommended architecture:

``` text
Dart
    ↓ dart:ffi
Stable C ABI
    ↓
Rust
    ↓
Wasmtime
```

Rust provides:

-   memory safety
-   excellent Wasmtime integration
-   safer ownership
-   cleaner error handling

Expose only a tiny C-compatible ABI.

------------------------------------------------------------------------

# UI

Flutter should be treated as the first renderer.

The IR should describe logical components rather than Flutter widgets.

Example:

-   TextField
-   DateField
-   Lookup
-   Button

The renderer maps logical controls to Flutter widgets.

This keeps ADL independent of Flutter.

------------------------------------------------------------------------

# Storage

SQLite should be the primary local store.

The runtime compiles schema definitions into:

-   tables
-   indexes
-   prepared statements
-   migrations

Applications remain local-first.

------------------------------------------------------------------------

# Packaging

Application package:

``` text
application.adlpkg
├── manifest
├── schema.ir
├── ui.ir
├── workflow.ir
├── permissions.ir
├── logic.wasm
└── assets
```

------------------------------------------------------------------------

# Roadmap

## Stage 1

-   ADL parser
-   semantic analyser
-   canonical IR
-   Dart runtime
-   Flutter renderer
-   SQLite
-   CRUD
-   workflows
-   local deployment

## Stage 2

-   dependency graph
-   optimisation
-   package compiler
-   debugger

## Stage 3

-   Wasm backend
-   Rust bridge
-   shared client/server execution

## Stage 4

-   dedicated appliance runtime
-   Tiny Core Linux image
-   optional hardware product

------------------------------------------------------------------------

# Marketing Strategy

## Do NOT sell

-   "A replacement for HTML."
-   "A replacement for JavaScript."
-   "A replacement for the W3 stack."
-   "A new operating system."

These messages increase perceived risk.

## Sell

"Define applications instead of programming them."

Business outcomes:

-   Faster delivery.
-   Offline by default.
-   Native performance.
-   One application definition.
-   Consistent behaviour.
-   Strong governance.
-   Easier maintenance.
-   Reduced defect rates.

## Primary Competitors

Compete with:

-   Microsoft Power Apps
-   ServiceNow App Engine
-   Mendix
-   OutSystems
-   Retool

Not with browsers.

## Long-Term Vision

Customers adopt ADL because it enables them to build applications
dramatically faster and with greater consistency.

The runtime, Flutter, SQLite, Wasm and even the underlying operating
system become implementation details.

Eventually the same application package should run on:

-   Windows
-   macOS
-   Linux
-   Android
-   iOS
-   Web
-   Dedicated ADL appliances

without modification.

------------------------------------------------------------------------

# Personal Assessment

I believe the strongest long-term differentiator is **not** the runtime
itself.

It is the combination of:

-   declarative application definition
-   deterministic business rules
-   local-first architecture
-   integrated workflows
-   integrated permissions
-   integrated persistence
-   integrated deployment

Together these provide a coherent application platform rather than
another UI framework or low-code tool.

The runtime should therefore be treated as an enabling technology, while
ADL itself is positioned as the product.
