# Context-Aware Offline Datasets

Phase 16 adds local offline dataset selection for the runtime. This document records the backend-neutral boundary for what the local runtime can decide now and what a future remote authority must provide.

## Local Runtime Responsibilities

- Evaluate object sync mode and sync scope against local records.
- Resolve `currentUser`, `currentContext`, and `allAvailableContexts` using runtime context, selected business contexts, and membership-derived context roles.
- Include read-model source dependencies in the local dataset when a source declares `currentUser`, `currentContext`, or `allAvailableContexts`.
- Keep dataset membership separate from authorization. Dataset evaluation returns record references and reasons; dataset-limited reads still pass through runtime policy, context scope, and field-shaping checks.
- Exclude `onlineRequired` objects from offline datasets. Include `cacheReadonly`, `localFirst`, and `localPrivate` records only when their declared dataset scope matches.
- Treat `custom` sync scope as deferred until ADL has a backend-neutral custom dataset expression.

## Dataset Windows Versus The Offline Grace

Phase 50 added `app.offlineGraceDays`, and it is a different kind of window from
a dataset scope. Keeping them distinct matters, because both are sync-policy
declarations and both are measured in days:

- A **dataset scope** (`currentUser`, `currentContext`, `allAvailableContexts`,
  and the recent-window default of 30 days on `_updatedAt`) decides **which
  records** a device may hold. It is per object, it is evaluated locally on
  every dataset read, and it is unrelated to identity.
- The **offline grace** decides **how long a device may keep syncing at all**
  since its last successful authentication. It is application-wide, it is
  evaluated once per sync attempt, and it never selects or excludes a record.

They compose in one direction only. Inside the grace a device syncs and its
dataset scopes decide what arrives; outside it, no sync is attempted, so no
dataset is refreshed and the device reads whatever its scopes had already
selected. **The grace never narrows a dataset, and a dataset scope never extends
or shortens the grace.** A grace that has lapsed is not a reason to evict cached
records: local reads and local-first writes stay available indefinitely, and
evicting them would destroy offline work.

The 30-day recent-sync window and the 30-day default grace are the same number
by coincidence of both being sensible defaults, not because one derives from the
other. Do not couple them.

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
