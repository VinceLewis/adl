# First Deployment Slice

Read this before changing the authority entrypoint, the identity verification
switch, the browser authority transport, session-derived browser identity, or
bootstrap paging.

## Decisions from Phase 46

- **Identity verification is a configuration switch, not an ADL construct.**
  `ADL_IDENTITY_VERIFICATION` selects the verifier and defaults to `bypass`,
  which accepts the supplied account proof as the identity subject without
  contacting a provider. Choosing a real provider is deliberately deferred; the
  seam exists so that decision does not block deployment.
- **The bypass is never silent and never widens anything else.** The active mode
  is written to the `identity_verification_configured` startup security event
  and returned by `/readyz` as `{ mode, verifier, bypassed }`; production
  additionally requires `ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true`. Sessions remain
  opaque SHA-256-verified tokens, and context roles still resolve from accepted
  membership records through the runtime.
- **Turning verification on fails closed.** With the switch on and no provider
  supplied, `UnconfiguredUpstreamIdentityVerifier` rejects every proof. Never
  add a fallback from `upstream` to `bypass`: a mis-set switch must deny, not
  authenticate.
- **The bypass still shape-checks the proof.** An empty, over-long, or
  control-character-bearing subject is rejected, because a NUL byte in a text
  key is a real PostgreSQL failure (the Phase 44 `audit_id` defect).
- **The server tells the browser its own identity; the browser never asserts
  one.** `/v1/session/issue` and `/v1/session/current` return the server-derived
  `userId` and nothing else, so `RuntimeContext.userId` can be derived from the
  session while the request contract still carries no user id, role, audit
  actor, accepted revision, or timestamp.
- **The raw session token is unreadable to client code.** It lives in the
  `__Host-` Secure HttpOnly SameSite=Strict cookie the user agent attaches, so
  `HttpAuthorityTransport` ignores the `AuthorityTransport` `sessionToken`
  parameter and reads only the double-submit CSRF cookie. Non-browser callers
  (integration tests, tooling) inject `InMemoryAuthorityCredentialStore` as a
  cookie jar; that is test wiring, not a second transport.
- **A transport failure is not a verdict.** A network error or non-2xx response
  raises `AuthorityTransportError` instead of returning a synthetic outcome, so
  `AuthoritySyncClient.reconcile` leaves the queue entry in place and the retry
  stays idempotent. Returning a fabricated `rejected` outcome here would discard
  the user's offline work.
- **Queue replay must read through tombstones.** `reconcile` looked the record
  up with `getRecordForRuntime`, which hides deleted rows, and skipped the entry
  when it was null. Every queued delete was therefore never sent, never removed
  from the queue and left `pending` forever, so the authority never learned about
  the deletion — found only once a test replayed a queued delete. Sync replay now
  uses `ObjectStore.getRecordForSync`, a trusted tombstone-inclusive lookup that
  applies no read policy. When adding a queue consumer, ask what the local row
  looks like *after* the operation it is replaying.
- **Bootstrap must follow `nextCursor` to exhaustion.** Applying page one and
  stopping silently dropped every permitted record beyond the first page. The
  walk also stops on an empty page or a repeated cursor rather than trusting the
  server to terminate it.
- **Browser authority sync is opt-in via `VITE_ADL_AUTHORITY_URL`.** With it
  unset the demo stays entirely local, so `npm run verify:push` screenshots keep
  testing the reference app rather than a network state. Sync-state persistence
  (`IndexedDbSyncStateStorage`) is wired only on the authority path, where an
  offline queue surviving a reload actually matters.
- **The entrypoint is the only place that composes PostgreSQL.** In-memory
  stores stay test wiring. Migrations are applied out of band with the migration
  role; the process registers only the application model metadata row, which
  accepted records reference by foreign key.

## Practical guidance

- `__Host-` cookies require HTTPS, and SameSite=Strict requires the browser app
  to be same-site as the authority. A plain-HTTP localhost dev server will not
  receive the session cookie; front the authority with TLS or a same-origin
  proxy.
- `/v1/session/issue` still enforces the Phase 42 minimum proof length. A
  development subject shorter than that is rejected as `authentication_failed`;
  that is the credential-shape control working, not an identity bug.
- Keep deployment configuration (host, port, application id, model path) in the
  entrypoint's own configuration, not in `AuthorityConfiguration`. The latter is
  the HTTP edge contract and is constructed directly by tests.
- When adding an authority route, decide its rate bucket in `bucketFor` and
  remember that everything except `/v1/sync/bootstrap` requires CSRF.
