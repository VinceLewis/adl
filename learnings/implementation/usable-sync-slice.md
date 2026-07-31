# Usable Sync Slice

Read this before changing client conflict/rejection recovery, the browser
authority bridge, sign-in or invite-claim UI, the demo identity constant, or the
service worker and its cache boundary.

## Decisions from Phase 47

- **A verdict keeps the queue entry; it never discards it.**
  `AuthoritySyncClient.reconcile` used to map every non-accepted outcome to a
  status and then `remove` the entry, so a conflicted or rejected edit vanished
  without anyone seeing it. The verdict is now stored on the entry as
  `SyncQueueEntryRecovery` (`status`, `code`, `message`, optional `strategy`,
  `recordedAt`). Because the queue is already persisted through
  `IndexedDbSyncStateStorage`, holding the verdict there is also what makes it
  survive a reload — no new persistence was added.
- **`getReplayable()` and `getAwaitingRecovery()` are the split that makes this
  safe.** An entry with no verdict is replayable; an entry with one is awaiting
  recovery and is never resent by `reconcile`. Without that split a second
  reconcile would resend an operation the authority had already settled and get
  the stored outcome replayed back as the same conflict forever.
- **Resolution collapses to two primitives, neither of which invents a winner.**
  `keepServer` abandons the local operation so the authority's state stands.
  `resubmitMine` sends the same operation again under a fresh operation id
  (`<opId>-r<n>`, from `attempts`), rebased on the revision the bootstrap wrote,
  for the authority to judge afresh. There is no third option, and no
  client-side merge.
- **The model's declared conflict policy picks between them, not a heuristic.**
  `serverWins` → `keepServer`; `clientWins` → `resubmitMine`;
  `stateTransitionWins` → `resubmitMine` only when the queued operation is a
  `transition`, `keepServer` otherwise (a lifecycle transition outranks a
  concurrent field write); `manual` → ask the user with exactly those two
  choices.
- **A rejection is terminal.** It carries no strategy, and `keepServer` — worded
  as "Dismiss", not "Keep the server version" — is its only permitted
  resolution. `resolveRecovery` falls back to abandoning the local operation when
  asked for a choice the verdict does not permit, so a refused write can never be
  resurrected as accepted.
- **A transport failure is still not a verdict.** `AuthorityTransportError`
  propagates out of `reconcile` and the entry stays replayable with no
  `recovery` set. This rule predates the phase and the recovery path must not
  weaken it.
- **`synchronize` is reconcile → bootstrap → applyAutomaticRecovery, in that
  order.** `keepServer` relies on the bootstrap having already replaced the local
  record, and `resubmitMine` rebases on the revision the bootstrap wrote. Any
  other order either resolves against stale local state or resubmits against a
  base revision the authority has already moved past. A user's `keepServer`
  resolution is likewise followed by a bootstrap, so "keep the server version" is
  true locally rather than merely a dropped queue entry.
- **The recovery surface carries no record values.** `SyncRecoveryItem` is queue
  and verdict metadata only — object name, record id, operation kind, status,
  code, message, strategy, permitted choices. A conflict must never disclose a
  server record the caller could not read through a normal runtime read, so no
  record ever reaches `adl-sync-recovery`.
- **Identity comes from signing in, not from configuration.** Phase 46's
  `VITE_ADL_ACCOUNT_PROOF` and `?account=` are gone: a build-time or URL-borne
  account proof was a second, weaker way in. `readBrowserAuthorityConfiguration`
  now reads `VITE_ADL_AUTHORITY_URL` alone.
- **A bypassed verifier is labelled in the UI, and an unreachable authority is
  treated as bypassed.** The browser reads `/readyz` (a GET outside the CSRF and
  session surface, so a signed-out browser can reach it) and shows a
  development-mode warning in both the signed-out and signed-in states.
  `HttpAuthorityTransport.readiness` computes `bypassed: verification.bypassed
  !== false`, and a failed readiness call leaves the session `unavailable` with
  `developmentMode: true`. A missing or unreadable flag is never read as a
  verified deployment.
- **`admin-ui` is retired.** `LOCAL_DEMO_IDENTITY = "local-demo-device"` names
  what it is: a local demo device identity, not an account. With an authority
  configured the server-derived session identity replaces it before any record is
  read or written. The old constant read like a signed-in administrator while
  being nothing of the sort.
- **Session, invite and recovery chrome renders only when an authority is
  configured.** With `VITE_ADL_AUTHORITY_URL` unset there is no bridge and no
  chrome at all, so `npm run dev` and the Playwright visual suite are unchanged
  by this phase.
- **Invite claiming is online-only and refused in the bridge, before the
  request.** `claimInvite` checks connectivity first and sets
  `invite = { status: "offline" }` without touching the transport; the component
  also disables the control and returns early. The granted context's records
  appear only on the bootstrap that follows the server's confirmation — nothing
  pre-grants membership or caches a claim for later replay.
- **The service worker reuses the model version rather than inventing a second
  versioning scheme.** The page registers `/sw.js?v=<modelVersion>` via
  `registerAdlServiceWorker(model.modelVersion)`; the worker parses that version
  back out of its own URL and caches under `adl-shell-<modelVersion>`. A model
  version change is therefore a different worker URL *and* a different cache
  name, and `activate` deletes every other `adl-shell-*` cache before
  `clients.claim()`. This is the same notion of version the startup
  compatibility guard applies to persisted local data.
- **The cache boundary is a security boundary, not an optimisation.** A service
  worker cache is readable by any script in the origin and survives sign-out.
  `shouldCacheResponse` refuses non-GET, cross-origin, any `/v1/` path,
  non-ok/opaque/error responses, responses carrying `set-cookie`, responses
  marked `no-store` or `private`, and JSON bodies. Records stay in IndexedDB
  under the existing runtime persistence boundary.
- **The one exception is the web app manifest, and it is structural.** The
  manifest is legitimately JSON (`application/manifest+json`), so it is allowed
  by destination `manifest` or a `.webmanifest` path. It cannot be used to smuggle
  an authority body through, because `/v1/` is refused before the exception is
  consulted; `tests/service-worker.test.ts` asserts exactly that.
- **Registration is production-only and a non-production build actively cleans
  up.** Outside production `registerAdlServiceWorker` unregisters any previously
  installed ADL worker instead of registering, so a developer is never served a
  stale production shell and the visual suite never runs against one. A failed
  registration is swallowed: the app stays online-only for that session rather
  than failing to start.
- **`BrowserAuthorityConfiguration.transport` is test wiring, not a second
  transport.** It lets a caller with no user agent (integration tests, tooling)
  inject a cookie jar, `fetch` and origin so the real bridge can be driven over a
  real socket. Do not use it to add browser behaviour.

## The defect this phase created and then found

Automatic recovery originally skipped only entries that needed a user choice:

```ts
if (item.requiresUserChoice) continue; // wrong
```

A rejection needs no choice, so the pass that existed to keep a refused write
visible silently discarded it — reintroducing the exact bug the phase was written
to fix. It was caught by the real-PostgreSQL integration test, not by the
hermetic one, because the hermetic fixture was written around conflicts.

The rule: **an automatic pass must key off the presence of a declared strategy,
not off the absence of a required user choice.** The guard is now
`if (item.strategy === undefined || item.requiresUserChoice) continue;`, and
`tests/authority-sync-recovery.test.ts` holds a named regression case for it.

## Known defect: an offline create duplicates — fixed in Phase 48

A create intent carried values but no record id, because the authority assigned
the id. An offline-created record therefore came back from the authority under a
*new* id: the accepted server record was reconciled locally under the server's id
while the original local row remained, so the user saw two.

This predated Phase 47 and was masked by a hermetic fake that echoed the client's
id back; real PostgreSQL exposed it. Phase 48 fixed it by the first of the two
routes considered here — the client proposes the id and the authority accepts it
under validation. See [[offline-operation-identity]] for the contract, the
collision rules, and why a collision is a rejection rather than a conflict.

Still true: acknowledging a *rejected* create leaves the local row in place, and a
later bootstrap cannot remove a record the server never had.

## Known defect: three declared record sync states have no producer

Found while planning Phase 58, and stated here because it is easy to assume the
opposite from the type alone.

`SyncStatus` is `"local" | "pending" | "synced" | "conflict" | "rejected"`, and
across the whole of `src/` the only writers are `"local"` when a record is built
(`ObjectStore`) and `"synced"` when a remote record is reconciled
(`ObjectStore.reconcileRemoteRecord`, `access-lifecycle.ts`). Nothing ever writes
`"pending"`, `"conflict"` or `"rejected"`. So a record that was refused, one in
conflict, one queued and waiting, and one that was never going anywhere are all
`"local"` and all look identical.

Two consequences that make it reachable rather than theoretical:

- `_syncStatus` is a **required** platform metadata field
  (`src/model/defaults.ts`) and an offline-dataset expression input
  (`OfflineDatasetService`), so a model filtering or displaying on it is reading a
  vocabulary the runtime does not honour.
- The `syncStatus` shell control — which the Giggle Band app ships in its top bar
  — renders `context.online ? "Online" : "Offline"`
  (`AdlAppElement.renderShellControl`). It never reads a record. The platform's
  only shipped sync-state surface answers a different question from the one it is
  named after.

This is the same class of defect Phase 56 named for `import`: a declared
capability with no call site. Audit both directions when adding one.

## Practical guidance

- When adding an automatic pass over settled work, ask what it does with a
  verdict that has no strategy. That is where the discarding bug lives.
- Prove recovery against real PostgreSQL. The hermetic suite proves the state
  machine; only the real authority produces real conflict codes, real revisions
  and real refusals, and it is what caught the automatic-discard defect.
- Anything added to `SyncRecoveryItem` is disclosed to the user without a runtime
  read policy check. Keep it metadata.
- `__Host-` cookies need HTTPS and the browser app served same-site as the
  authority. Without that the browser never receives the session at all and every
  sign-in appears to fail for reasons that have nothing to do with identity.
- Do not import `service-worker-policy.ts` from `register-service-worker.ts`:
  that would make the policy a chunk shared between the page bundle and the
  worker bundle. `tests/service-worker.test.ts` asserts the two agree on the URL
  shape instead.
- The worker is a second rollup entry in `vite.config.ts` emitted unhashed as
  `dist/sw.js`. A service worker may only control the scope it is served from, so
  its file name must stay stable at the build root while every other chunk keeps
  Vite's hashed names.
