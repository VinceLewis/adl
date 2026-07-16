# Automerge Sync Architecture for a Giggle-Style ADL App

> Superseded for architecture decisions by
> `docs/architecture/target-architecture.md` and ADR 0007.
> This document remains useful background on local-first tradeoffs. The current
> target architecture uses ADL operation-intent sync first, a TypeScript
> authority server, and PostgreSQL accepted-state projection. Automerge is not
> part of the first sync implementation.

## Decision

Use Automerge to replace the hand-rolled offline outbox and sync transport, but keep Go and Postgres as the authoritative server-side validation and policy layer for production.

Recommended production shape:

```text
Browser app
  ADL runtime/model
  Dexie/IndexedDB local query database
  Automerge document/change sync

Server
  Go auth, policy, validation, command ingestion, invite workflows
  Postgres authoritative projection, constraints, audit, recovery
  Automerge sync/storage layer for local-first change movement
```

Automerge should not blindly drive Postgres. Automerge changes should be treated as synced local intent or synced document state that still passes through Go validation before becoming authoritative.

## Why This Shape

Giggle's data model is relational by intent:

- users
- bands
- band members
- invitations
- gigs and rehearsals
- availability
- songs
- set lists
- ordered set-list items
- streaming links
- gig set lists

Those workflows depend on:

- membership and role checks
- scoped uniqueness, such as song title per band
- foreign-key-like relationships
- ordered item constraints
- invite acceptance transactions
- auditability
- recovery and new-device bootstrap

Automerge is good at local-first change capture, incremental sync, deduplication, and conflict-preserving merge. It is not a replacement for SQL constraints, authorization, joins, reporting, or transactional server authority.

## Layer Responsibilities

### ADL Runtime

Owns the application semantics:

- object definitions
- validation
- lifecycle rules
- policy checks
- commands
- scoped constraints
- read-model definitions
- sync classification

The ADL model should stay backend-neutral. It should not expose Automerge document internals as the application model.

### Local Database

Use Dexie/IndexedDB initially.

Owns the browser query surface:

- list screens
- search
- sorting
- local joins/projections
- dashboard read models
- offline UI state
- pending/conflict flags

The UI should normally read from the local database, not scan Automerge documents directly.

SQLite/OPFS remains a later option if query complexity, migration needs, or data volume justify the extra complexity.

### Automerge

Owns local-first change movement:

- offline writes
- change history
- incremental sync
- deduplication
- reconnect/resume behavior
- merge of concurrent edits
- peer/server transport payloads

Automerge can replace a custom HTTP outbox for many workflows because it already provides the durable local change stream and sync protocol.

Useful references:

- Automerge documents: https://automerge.org/docs/reference/documents/
- Automerge Repo: https://automerge.org/docs/reference/repositories/
- Automerge storage: https://automerge.org/docs/reference/repositories/storage/
- Automerge conflicts: https://automerge.org/docs/reference/documents/conflicts/

### Go Server

Owns the trusted boundary:

- auth/session validation
- invite claiming
- membership authority
- role and policy checks
- command validation
- conflict decisions that require authority
- rate limiting and abuse controls
- audit emission
- new-device bootstrap

The browser remains untrusted, even when it has local ADL validation. Local validation is for fast feedback and offline usability. The server must re-check writes that become shared or authoritative.

### Postgres

Owns the authoritative server projection:

- canonical accepted state
- unique indexes
- foreign keys
- transactions
- audit tables
- reporting queries
- admin recovery
- backups

Postgres does not have to be the direct online write path for every client interaction. Automerge can carry offline edits to the server. But once the server accepts a change, Postgres should reflect the accepted canonical state.

## Recommended Write Flow

For an ordinary edit, such as changing a song title:

```text
1. User edits song offline.
2. ADL runtime validates locally.
3. Browser updates Dexie/IndexedDB projection with pending status.
4. Browser records/syncs the Automerge change or command intent.
5. When online, the server receives the change/intent.
6. Go validates identity, membership, policy, object constraints, and schema version.
7. Go writes accepted state to Postgres in a transaction.
8. Server publishes accepted state/change outcome.
9. Browser updates local projection from pending to accepted, or marks conflict/rejected.
```

For an invite acceptance:

```text
1. User must be online.
2. Go validates invite token/code and user identity.
3. Go updates invitation and creates membership transactionally in Postgres.
4. Accepted membership becomes available to sync/bootstrap.
5. Client caches the resulting band access locally.
```

Invite claiming should stay online-only because it grants access to protected data.

## Avoid Blind Canonical Sync

The risky design is:

```text
client edits canonical Automerge band doc
  -> sync server stores it
  -> all peers receive it
  -> Go later discovers it was invalid
```

That creates cleanup problems. Invalid data may already have been seen, rendered, or used by other clients.

Safer patterns:

### Pattern A: Server-Mediated Canonical Docs

Clients sync proposed changes to the server. The server validates them before publishing accepted canonical state.

This gives the strongest authority boundary but is less pure P2P.

### Pattern B: Proposal/Command Docs

Clients append intent to syncable Automerge documents, such as:

```text
bandCommandLog:<bandId>:<clientId>
```

The server consumes those command records, validates them, writes Postgres, and publishes accepted projection changes.

This is conceptually still an outbox, but Automerge handles the durable local storage, retry, dedupe, and sync mechanics. The app no longer has to roll its own operation queue protocol.

### Pattern C: Direct Docs for Low-Risk Data

Some data can sync directly because conflicts are tolerable:

- local notes
- drafts
- device preferences
- non-authoritative cached display data

Authoritative band membership, invites, deletes, and uniqueness-sensitive records should not rely only on direct client-side document edits.

## Local Projection Strategy

The local database should store query-friendly rows such as:

```text
bands
band_members
songs
set_lists
set_list_items
events
availability
invitations
sync_status
conflicts
```

Automerge document URLs and business ids should be stored as references:

```text
songRefs
  bandId
  songId
  automergeDocUrl
  title
  updatedAt
  syncStatus
```

Given a band id, the app should query the local database or a band root/index document, not search all Automerge documents.

## Server Storage

The server may have two different storage concerns:

```text
Postgres
  trusted application projection
  auth/catalog/invites/audit/reporting

Automerge storage
  document/change chunks
  sync state
  persistent relay/backup peer
```

For a prototype, Automerge storage can be filesystem-backed.

For production, choose storage based on operational needs:

- filesystem or object storage for Automerge chunks
- Postgres for app authority and catalog
- separate object/KV storage if Automerge data grows large

The key point is that Postgres stores the accepted business state. Automerge storage stores sync material.

## P2P Position

Pure P2P with only a signalling server is attractive, but it has real limits:

- no always-online replica
- harder new-device bootstrap
- harder access revocation
- harder backup/recovery
- harder authoritative invite acceptance
- harder abuse controls

The pragmatic route is:

```text
Prototype:
  Automerge sync server with filesystem storage
  Dexie local projection
  local/auth placeholders

Beta:
  Go server validates auth, invites, memberships, and command ingestion
  Postgres stores accepted projection
  Automerge handles offline sync/change movement

Production:
  Go/Postgres are authoritative
  Automerge remains the local-first sync mechanism
  optional P2P can be added only where policy and privacy boundaries are clear
```

## Practical Recommendation

For ADL/Giggle, use this as the working target:

```text
ADL model
  -> local runtime validation and policies
  -> Dexie projection for UI/query
  -> Automerge for offline change sync
  -> Go validation/policy ingest
  -> Postgres authoritative projection
```

This keeps the useful part of Automerge: no bespoke outbox, better offline behavior, conflict-preserving sync.

It also keeps the useful part of Go/Postgres: clear authority, constraints, transactions, audit, recovery, and production-grade operational behavior.
