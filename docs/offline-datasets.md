# Context-Aware Offline Datasets

Phase 16 adds local offline dataset selection for the runtime. This document records the backend-neutral boundary for what the local runtime can decide now and what a future remote authority must provide.

## Local Runtime Responsibilities

- Evaluate object sync mode and sync scope against local records.
- Resolve `currentUser`, `currentContext`, and `allAvailableContexts` using runtime context, selected business contexts, and membership-derived context roles.
- Include read-model source dependencies in the local dataset when a source declares `currentUser`, `currentContext`, or `allAvailableContexts`.
- Keep dataset membership separate from authorization. Dataset evaluation returns record references and reasons; dataset-limited reads still pass through runtime policy, context scope, and field-shaping checks.
- Exclude `onlineRequired` objects from offline datasets. Include `cacheReadonly`, `localFirst`, and `localPrivate` records only when their declared dataset scope matches.
- Treat `custom` sync scope as deferred until ADL has a backend-neutral custom dataset expression.

## Deferred Remote Authority Responsibilities

A future remote sync service must provide these capabilities without requiring a specific database engine or transport:

- Authenticate the user and identify the runtime principal for each sync request.
- Resolve available business context instances and context-scoped roles authoritatively.
- Return object records matching the resolved dataset declaration, including read-model source needs.
- Enforce row, field, state, lifecycle, validation, and context-scope policy on every record sent to or accepted from a device.
- Respect sync modes: never accept local writes for `cacheReadonly`, require online authority for `onlineRequired`, and avoid uploading `localPrivate` records.
- Provide stable record metadata, schema versions, revisions, tombstones, and conflict information for local startup and replay checks.
- Accept or reject queued local-first operations with backend-neutral conflict outcomes.
- Avoid assuming PostgreSQL, SQL materialized views, HTTP-specific routes, or any other transport/storage mechanism as part of the ADL language contract.
