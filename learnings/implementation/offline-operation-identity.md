# Offline Operation Identity

Read this before changing the create intent contract, the authority's create path,
record id minting or validation, `ObjectStore.planCreateForTransaction`, or
anything that reasons about which side of the sync loop names a record.

## Decisions from Phase 48

- **The client names the record; the authority accepts that name.** The create
  intent carries a required `recordId`, `AuthorityService.apply` passes it to
  `runtime.create(..., { recordId })`, and the accepted record comes back under it.
  Before this the authority minted its own id, `reconcileRemoteRecord` keyed on
  `record.meta.guid`, found nothing, took its `existing === null` branch and
  created a **second** local row — while the originating row kept its local guid
  and `syncStatus: "local"` forever, its queue entry already discarded as
  accepted. Nothing would ever resend or reconcile it.
- **`recordId` is required, not optional.** An optional field would have let a
  caller silently fall back to the duplicating behaviour, and every real create
  already has a local id. The wire contract broke deliberately; a create without
  one is `malformed_request` (400).
- **A record id is an identifier, never an authorisation.** Naming a record grants
  nothing. Revision, actor, timestamps, accepted state and scope stay
  server-derived, which is what keeps the Phase 46 rule ("the server tells the
  browser its own identity; the browser never asserts one") intact even though the
  browser now supplies part of the record's identity.
- **Shape rules mirror the identity subject, and the id is never trimmed.**
  `isValidRecordId` — non-empty, ≤320 characters, no surrounding whitespace, no
  control characters — is the same rule `BypassIdentityVerifier` applies, for the
  same reason (a NUL in a text key is a real PostgreSQL failure; the Phase 44
  `audit_id` defect). It differs in one way that matters: an identity subject is
  trimmed, a record id is *refused* when padded. Trimming would return the record
  under a different id from the one the client holds, which is the very defect
  being fixed.
- **Validation lives at both layers and neither assumes the other ran.** The HTTP
  edge classifies it as `malformed_request`; the runtime raises
  `ADL_RUNTIME_RECORD_ID_INVALID`. `AuthorityService` is constructed directly by
  tests and tooling, so an edge-only check would be no check at all on that path.

  Corrected in Phase 57: `malformed_request` is the *classification*, not the
  response body. `operationIntent(body)` is called inside the replay route's main
  `try`, whose `catch` maps everything to `failure("request_rejected", 400)`, so
  the wire body is `{"error":"request_rejected"}`. Only a `readJsonObject`
  failure surfaces `malformed_request` to the caller. The status is 400 either
  way. Assert the observed contract, not the internal code name.
- **A collision is a rejection, and terminal.** `ADL_RUNTIME_RECORD_ID_TAKEN`,
  surfaced through the Phase 47 recovery path as an ordinary rejection: no
  strategy, so `applyAutomaticRecovery` skips it; `keepServer` ("Dismiss") is its
  only permitted resolution; `resubmitMine` falls back to abandoning it.
- **A collision is deliberately not a conflict.** `resubmitMine` resends the same
  operation, so a conflict verdict would resend the same colliding id forever.
  Making it work would need a third recovery primitive that re-mints a local id,
  which would break Phase 47's rule that no primitive invents a winner. Rejection
  needs no new machinery at all.
- **The collision check must live in the runtime, before storage.**
  `PostgresObjectStorage.write` issues a plain `insert` for a create, so an
  undetected collision raises a unique violation — *not* a `RuntimeError`, so
  `classifyFailure` returns null, `replay` throws, the client sees a transport
  error, and the entry stays replayable and retries forever. A durable rejection
  is only reachable by detecting the collision first.
- **The collision lookup reads through tombstones.** A deleted id is still taken,
  so a create can never resurrect a deleted record. This is the same reasoning as
  Phase 46's `getRecordForSync` fix: when a lookup exists to answer "does this id
  exist", `getRecordForRuntime` is the wrong tool because it hides deleted rows.
- **Order inside `planCreateForTransaction` is a security decision.** The shape
  check runs first — pure input validation, discloses nothing. The collision check
  runs *after* scope, policy and field policy, so an unauthorised caller is denied
  rather than told whether an id exists. Moving it earlier would turn the create
  path into an existence oracle.
- **Idempotency stays keyed on the operation id.** A retried create returns the
  stored outcome; a *different* operation reusing an accepted record's id is a new
  operation and is refused as a collision. The record id never becomes a second
  idempotency key.
- **Command-produced records needed no separate treatment, and this was checked
  rather than assumed.** The sync client never emits a `command` intent: a locally
  executed command enqueues one ordinary create/update operation per step through
  `recordOperation`, each carrying its own local record id, so each replays through
  the fixed create path. The `command` variant is reachable only by a caller
  invoking `AuthorityService` directly. If a future phase makes commands replayable
  *as commands*, each step needs a client-supplied id — and note that replaying
  steps individually already loses the multi-step atomicity the command had
  locally, which is separate pre-existing work.

  **Superseded by Phase 57**, which is the future phase this paragraph
  anticipated. A locally executed command now queues one `command` entry and
  replays as one intent carrying a client-supplied id per step *and per
  iteration item*, and the lost atomicity — which Phase 56 turned from a
  recorded cost into a demonstrated failure — is closed. The create path
  described above is unchanged and is exactly what the command path reuses:
  `CommandService.planStepWrite` hands each supplied id to
  `ObjectStore.planCreateForTransaction`, so the shape check, the
  after-authorisation collision check, the tombstone-inclusive lookup and the
  terminal `ADL_RUNTIME_RECORD_ID_TAKEN` rejection all apply per step, once for
  every record a command creates. See [[command-intent-replay]] for the manifest
  contract, why matching is positional *and* named, and what a refused command
  leaves behind.

## No stranded rows existed, and that is evidence

The phase's Task 4 asked for a convergence path for already-stranded local rows or
a recorded finding that none exist. The finding, with its evidence:

- The duplication only happens on a replay, and a replay only happens when the
  browser bundle was built with `VITE_ADL_AUTHORITY_URL` set. Unset, there is no
  bridge, no `AuthoritySyncClient`, and no create ever leaves the browser.
- Nothing could have set it: no deployment artifact, container image, CI pipeline
  or hosting configuration exists in the repository; the only committed environment
  file is `.env.authority.sample` with `CHANGE_ME` placeholders; `start-local.sh`
  and the Playwright visual suite both run with the variable unset; and
  `src/server/authority-main.ts` first landed in Phase 46, two phases before this
  one.
- The single observed instance came from a Phase 47 integration test against a
  throwaway PostgreSQL container destroyed with the run.

So a convergence sweep would delete user rows on inference with no population to
fix. None was added. The general rule: **before writing code that deletes local
rows to repair a defect, establish that the defective state exists somewhere that
survives.** A developer's own browser profile can be cleared per origin.

## Practical guidance

- The hermetic fake in `tests/authority-sync-client.test.ts` echoed the client's
  guid back and so masked this defect for two phases. The fake is now *honest*
  rather than lucky, because the contract requires the accepted record to carry the
  supplied id — but the lesson stands: a fake that answers with the input it was
  given proves nothing about a server that mints its own.
- When a phase changes an intent variant, `npx tsc --noEmit` finds the typed call
  sites but **not** raw JSON bodies in integration tests. Grep for
  `kind: "create"` as well. `tests/integration/authority-http.test.ts` failed only
  at runtime for exactly this reason.
- A raw body sent to an endpoint that fails *before* intent parsing (no CSRF, no
  session, rate-limited) legitimately needs no `recordId`. Adding one there would
  mask the ordering the test proves.
- Mutation-check a convergence test before trusting it: reverting
  `buildNewRecord` to ignore the supplied id must make it fail. Both Phase 48
  integration cases were verified that way.
- A rejected create still leaves its local row behind, and when the rejection is a
  collision the following bootstrap overwrites that row with the authority's record
  under the same id. The user's local values for it are then gone while only verdict
  metadata remains in the recovery panel. Consistent with every `keepServer`
  resolution, but a real loss of local work. Phase 57 multiplied this rather than
  fixing it: a refused *command* strands every row all of its steps wrote, not
  one. The decision was deliberate — a local rollback would be a third recovery
  primitive that invents a winner — and it stands.

  **Phase 58 made the residue visible rather than automatic.** The row still
  stays, but it now reports `syncStatus: "rejected"`, carries
  `syncRejectedCreate` when the refused write was its own create, survives both
  the dismissal of the verdict and a reload, and can be thrown away by the user
  through `ApplicationRuntime.discardRefusedRecord` — a local action, not a third
  recovery primitive. A refused *update* is deliberately not discardable: the
  authority still holds that record, so the next bootstrap restores it, and
  removing it locally would be a no-op dressed up as a repair. See
  [[record-sync-state]].
