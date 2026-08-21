# Local HTTPS Development

Read this before changing `vite.config.ts`'s server/preview configuration,
anything under `scripts/dev/`, `playwright.config.ts`'s web servers, the
`dev:*` npm scripts, or before proposing a development mode for a check in
`src/server/authority-config.ts`.

The task-facing how-to is `docs/development/local-https-development.md`. This
document is why it is shaped the way it is.

## Decisions from Phase 97

- **Development gets real TLS; no production check gets a development mode.**
  `loadAuthorityConfiguration` refuses a non-HTTPS `ADL_ALLOWED_ORIGINS` in
  every environment, the session cookie is `__Host-` Secure, and a WebAuthn
  ceremony needs a secure context. Three separate controls, one shared cause,
  and the alternative — an `environment === "development"` escape in
  `isHttpsOrigin` — would mean the configuration a developer exercises is not
  the configuration a deployment loads. The repository owner chose local TLS
  explicitly for that reason. **Do not relax any of the three.**
- **TLS terminates in a proxy, not in the authority.**
  `src/server/authority-node.ts` builds a plain `node:http` server and its own
  doc comment states the deployment contract: a trusted HTTPS proxy ahead of the
  process, forwarding `x-forwarded-proto: https`. Reproducing that locally
  (`scripts/dev/tls-proxy.mjs`, ~90 lines, no dependencies, nothing in `src/`
  imports it) exercises the deployed shape. Adding a TLS listener to
  `authority-node.ts` would invent a second deployment topology that only
  development uses — the exact divergence this phase exists to avoid.
- **A trusted proxy sets the forwarded headers; it never passes them through.**
  The authority reads the first hop of `x-forwarded-for` as its rate-limit key
  (`clientKey`) and treats `x-forwarded-proto` as the truth about the scheme. The
  dev proxy therefore deletes `x-forwarded-*`/`forwarded` from the incoming
  request and sets both from what it observed. Appending instead would let any
  caller choose its own rate bucket and claim HTTPS. `Host` **is** passed
  through unchanged, because the authority builds its Request URL from it.
- **Vite HTTPS is opt-in through one variable nothing else sets
  (`ADL_DEV_HTTPS=true`).** Four Playwright web servers — desktop/mobile on
  5173, the `vite preview` offline-shell build on 4173, passkey on 5273,
  administration on 5373 — all speak plain HTTP through `npm run dev` and
  `vite preview`. Unconditional HTTPS in `vite.config.ts` breaks all four at
  once, and also breaks a fresh clone, since the key material is gitignored and
  therefore absent until someone generates it. With the variable unset the
  config resolves to exactly what it was before. `npm run dev:authority` is the
  only thing that sets it.
- **Key material is generated, never committed.** `.dev-tls/` is gitignored and
  `scripts/dev/generate-local-tls.sh` reproduces it with `openssl` alone —
  `mkcert` is documented as an optional convenience because installing it needs
  root, and a script that assumes it is a script most people cannot run.
  Trusting the CA is the one manual step; it changes a trust store, so it is
  the developer's to run, not a script's to do silently.
- **Everything stays on `localhost`, app and authority alike.** An IP address is
  not a valid WebAuthn relying party id, `SameSite=Strict` needs the app and the
  authority to be the same site (ports do not make sites differ, hosts do), and
  a browser treats `localhost` as a secure context. Mixing in `127.0.0.1`
  breaks the relying-party check at startup or the cookie at runtime.
- **`passkey` is the documented development identity mode, not `bypass`.**
  `bypass` accepts `x-adl-account-proof` as the identity, so anyone who can
  reach the authority becomes any user by naming them; it also cannot exist in
  production, so developing against it exercises a surface no deployment has
  (`/v1/session/issue` is available there and answers 503 under `passkey`).
  The cost of `passkey` is one out-of-band seeding step, which is now
  `npm run dev:seed`.
- **The first-admin gap is real, and the dev seed is the runbook step, not a new
  route.** Registration is never anonymous, so a fresh database admits nobody.
  `scripts/dev/seed-local-admin.mjs` performs the runbook's out-of-band step
  through the repository's own server modules rather than hand-written INSERTs,
  so the records it writes are the shape the model validates. It is idempotent
  (the identity link table returns the existing identity for a known
  `(provider, subject)` pair, and an existing membership is reused). Nothing
  about it is reachable over HTTP.
- **A record written straight to storage is invisible to the membership
  projection until something rebuilds it.** The projection is written by the
  authority's unit of work; the seed bypasses that, so it calls
  `ContextMembershipProjectionWriter.rebuild` itself, exactly as
  `createAuthorityProcess` does at startup. Any future out-of-band writer of a
  membership record has the same obligation.
- **`roles.sql`'s grants did not cover tables a *different* role then creates.**
  It ran `grant … on all tables` before any table existed and set default
  privileges for the role that ran it, but the migrations are applied as
  `adl_migrator`. Phase 97 found this and prescribed a manual
  `grant select, insert, update, delete on all tables in schema public to
  adl_authority` after every migration. **Phase 102 replaced that with
  `src/server/migrations/grants.sql`, run once as `adl_migrator`** — see
  `learnings/implementation/production-authority-operations.md`. There is no
  standing per-migration obligation any more, and `scripts/dev/postgres.sh` now
  runs the deployment's own file instead of a superuser grant of its own. The
  migrations create no sequences, so no sequence grant is needed today.

## Practical guidance

- **Prove trust, do not skip it.** `curl --cacert .dev-tls/dev-ca.pem` and
  `NODE_EXTRA_CA_CERTS=.../dev-ca.pem` both validate the chain; `-k` proves
  nothing and will hide exactly the misconfiguration you are looking for. Node
  20's `fetch` honours `NODE_EXTRA_CA_CERTS`, so a Node-side end-to-end check
  needs no other wiring.
- **The authority answering `400` to an otherwise correct request usually means
  something reached it over plain HTTP.** The edge refuses a request whose URL
  is not `https://`; that URL is built from `x-forwarded-proto`, so the answer
  is "the proxy is not in front", not "the request is malformed".
- **`tests/visual/passkey-authority.ts` and `administration-authority.ts` are
  not a development path and never were.** They construct
  `AuthorityConfiguration` directly and build an `https://` Request URL over a
  plain socket, so they never touch `loadAuthorityConfiguration`. That bypass is
  legitimate test wiring; do not reach for it to "run the authority locally".
- **The browser bridge can be driven headlessly for a proof.**
  `connectBrowserAuthority` takes `transport` (a cookie jar plus an explicit
  `Origin`) and `webauthn` (an authenticator) as injection points, and
  `tests/integration/webauthn-authenticator.ts`'s `SoftwareAuthenticator`
  satisfies the second. Pointed at a real proxy with **no** `forwardedProto`
  option, that exercises the real client, real TLS, real cookies and the real
  ceremony without a browser. What it does not prove is rendering: for that,
  only Playwright will do.
- **`runtime.summariseRecordSyncState()` is the `N pending` chip.**
  `adl-app/state.ts`'s `recordSyncState()` reads exactly that summary, so a
  headless check of `summary.pending` going to zero is a check of the chip
  draining, one layer below the DOM.
