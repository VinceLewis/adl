# Target Architecture

Read this before changing runtime stack choices, server authority, sync
transport, auth provider direction, packaging, or phase sequencing.

## Key decisions from Phase 19

- The ADL product is the language, resolved model, runtime semantics, TypeScript
  runtime, future conformance suite, and inspectable defaults/policy decisions.
- The current implementation stack is TypeScript end to end: browser/PWA
  runtime now, TypeScript authority server later.
- Dart, Flutter, Wasm, Rust/Wasmtime, appliance runtimes, Go server, and
  Automerge-first sync are out of scope for the current target architecture.
- Browser/PWA remains the near-term client target, with Web Components and
  IndexedDB local persistence.
- PostgreSQL is the intended authoritative server projection for accepted shared
  state, audit, recovery/admin state, transactions, and reporting.
- Sync starts with ADL operation-intent replay: create, update, delete,
  transition, and command. The server replays intent through ADL runtime
  semantics and returns accepted/rejected/conflict/manual-resolution outcomes.
- Auth remains infrastructure, not an ADL language primitive. Phase 46 built the
  switchable seam and left the provider decision open; ADR 0008 then closed it:
  passkeys verified by the authority itself, identity keyed on a stable internal
  user id with linkable external identifiers so the provider or method stays
  changeable, and invite-based recovery instead of email. The offline sync grace is
  a model-declared sync-policy property, not an identity one — identity
  verification stays configuration per Phase 46. Phases 49 and 50 implement this
  and are together the deployment gate. See
  `implementation/first-deployment-slice.md`.
- The July proposal/auth/sync notes remain useful background but are superseded
  for architecture decisions by `docs/architecture/target-architecture.md` and
  ADRs 0003-0008. `auth-options.md` in particular is background only: its provider
  shortlist was priced and decided in ADR 0008.

## Practical guidance

- Do not introduce Dart, Flutter, Wasm, Rust/Wasmtime, appliance work, Go server,
  or Automerge-first sync without a new ADR that supersedes Phase 19 decisions.
- Keep server authority separate from browser-local checks. Local validation is
  for UX and offline operation; shared data must be accepted only after
  server-side re-checks.
- Keep SQL and PostgreSQL details out of ADL authoring syntax. PostgreSQL is an
  implementation projection of accepted state, not a language dependency.
- If IndexedDB becomes limiting, SQLite/OPFS can be reconsidered behind the
  existing storage abstraction.
- If operation-intent sync becomes insufficient, Automerge can be reconsidered
  below the ADL semantic layer, while preserving server authority.
