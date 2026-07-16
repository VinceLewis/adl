# ADR 0007 - Server Authority and Sync Stack

Status: Accepted

Date: 2026-07-16

## Context

ADL is local-first, but the browser is not trusted for shared business data.
The server must re-check identity, membership, policy, validation, lifecycle,
commands, constraints, and conflict state before accepting synced work.

The July sync note proposed Automerge, Go, and PostgreSQL. The auth note
proposed a TypeScript-friendly auth boundary. The project now needs one
coherent server/sync/auth direction.

## Decision

The target server architecture is:

- TypeScript authority server
- PostgreSQL accepted-state projection
- operation-intent sync from browser to server
- small TypeScript auth boundary, using either a custom service or Better Auth
  once provider choice is needed

The client syncs business intent:

- `create`
- `update`
- `delete`
- `transition`
- `command`

The server replays the intent through ADL runtime semantics and returns accepted,
rejected, conflict, or manual-resolution outcomes.

Auth remains infrastructure. ADL authorization remains based on context
membership, context roles, policy, validation, lifecycle, and command semantics.
Invite claiming is online-only and server-authoritative.

## Consequences

- Client and server can share TypeScript model and runtime semantics.
- PostgreSQL provides authoritative accepted state, transactions, audit,
  recovery, reporting, and integrity enforcement.
- Sync stays business-operation-oriented rather than blind row replacement.
- Automerge is not part of the first sync architecture.
- The auth provider decision is deferred until the runtime identity/session
  boundary and invite flow are ready to implement.

## Rejected alternatives

- Use Go as the first authority server.
- Use Automerge as the first sync transport.
- Treat Automerge documents as authoritative business state.
- Embed business roles directly in auth tokens as the only authorization source.
- Accept client-side local validation as sufficient for shared data.
