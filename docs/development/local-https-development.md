# Local HTTPS Development

How to run the browser demo against a real, locally running authority server.

Everything here is copy-pasteable from a fresh clone. It needs `openssl`,
`docker`, `psql` and Node — no root, except for the one optional step that
installs the development CA into a system trust store.

## Why this is more than `npm run dev`

The browser demo reports every record as `pending` for ever unless
`VITE_ADL_AUTHORITY_URL` is set: with it unset `src/ui/main.ts` builds no
authority bridge at all, so the queue has nowhere to go. Pointing it at a local
authority takes more than a URL, because three separate production controls all
require HTTPS and none of them has a development mode:

- `loadAuthorityConfiguration` refuses any non-HTTPS `ADL_ALLOWED_ORIGINS`, in
  **every** environment (`src/server/authority-config.ts`, `isHttpsOrigin`).
- The session and CSRF cookies are `__Host-` Secure HttpOnly SameSite=Strict. A
  user agent will not store a `__Host-` cookie sent over plain HTTP, so a
  plain-HTTP app never holds a session no matter what the server does.
- A WebAuthn ceremony only runs in a secure context.

**None of those is relaxed for development, deliberately.** Development that
skips a check is development that does not exercise the code you deploy, and
each of these three has already been the cause of a real defect. So local
development runs real TLS instead.

## The topology

It is the deployment topology, reproduced on a laptop:

```
   browser
      |  https://localhost:5173            (Vite dev server, TLS opt-in)
      |
      |  https://localhost:8443            VITE_ADL_AUTHORITY_URL
      v
  TLS proxy  scripts/dev/tls-proxy.mjs     terminates TLS, forwards
      |                                    x-forwarded-proto: https,
      |  http://127.0.0.1:8787             preserves Host
      v
  authority  npm run start:authority       plain node:http, unchanged
      |
      v
  PostgreSQL 127.0.0.1:5432                migrations applied out of band
```

The authority is a plain `node:http` server on purpose: its own doc comment
(`src/server/authority-node.ts`) says TLS terminates ahead of the process at a
trusted proxy that forwards `x-forwarded-proto: https`. Adding a TLS listener to
the process to make development easier would invent a second deployment shape
that no production runs. The proxy is ~90 lines of dependency-free Node,
committed at `scripts/dev/tls-proxy.mjs`, and it is developer tooling: nothing
in `src/` imports it.

Both `localhost:5173` and `localhost:8443` are the same *site*, which is what
lets a `SameSite=Strict` cookie be sent from one to the other. Keep both on
`localhost`; `127.0.0.1` is not a valid WebAuthn relying party id, and mixing
the two makes the app and the authority different sites.

## One-time setup

### 1. Generate the development certificates

```bash
npm run dev:tls
```

This writes a local certificate authority and a `localhost` leaf certificate to
`.dev-tls/`. That directory is **gitignored and must stay that way** — the
private keys are yours, not the repository's. Re-run with `--force` to replace
them.

If you have `mkcert` and the root access it needs, it does the same job and
installs the CA for you; the script's header shows the equivalent command. It is
optional, not assumed: `mkcert` is not a project dependency and installing it
needs root.

### 2. Trust the CA — the one manual step

Pick the line for what you are running. Everything else in this guide is
automated; this bit is not, because it changes a trust store.

```bash
# Chrome / Chromium / Edge on Linux (no root; needs libnss3-tools)
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "ADL local development CA" -i .dev-tls/dev-ca.pem

# System-wide on Debian/Ubuntu (needs root; covers curl, most CLI tools)
sudo cp .dev-tls/dev-ca.pem /usr/local/share/ca-certificates/adl-dev-ca.crt
sudo update-ca-certificates

# macOS (needs root)
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .dev-tls/dev-ca.pem

# Windows, current user (no root)
certutil -addstore -user Root .dev-tls\dev-ca.pem

# Firefox does not use any of the above: Settings -> Privacy & Security ->
# Certificates -> View Certificates -> Authorities -> Import, and tick
# "Trust this CA to identify websites".
```

For Node-based tooling (scripts, one-off `fetch` checks) you do not need to
trust anything globally:

```bash
export NODE_EXTRA_CA_CERTS="$PWD/.dev-tls/dev-ca.pem"
```

and for `curl`, `--cacert .dev-tls/dev-ca.pem`. Prefer either of those over
`-k` / `--insecure`: they prove the certificate chain, which is the thing being
set up.

### 3. Write the authority environment

The authority reads its whole configuration from the environment
(`.env.authority.sample` is the authoritative list). Put the development values
in a file — `.env.authority.local` is already gitignored:

```bash
cat > .env.authority.local <<'EOF'
ADL_ENV=development
ADL_DATABASE_URL=postgresql://adl_authority:adl@127.0.0.1:5432/adl
ADL_ALLOWED_ORIGINS=https://localhost:5173
ADL_HOST=127.0.0.1
ADL_PORT=8787
ADL_APPLICATION_ID=giggle-band
ADL_MODEL_PATH=src/reference/giggle-band
ADL_IDENTITY_VERIFICATION=passkey
ADL_UPSTREAM_IDENTITY_ISSUER=https://identity.localhost
ADL_UPSTREAM_IDENTITY_AUDIENCE=adl-authority
ADL_WEBAUTHN_RP_ID=localhost
ADL_WEBAUTHN_RP_NAME=Giggle Band (local development)
ADL_WEBAUTHN_ORIGINS=https://localhost:5173
ADL_COOKIE_SECURE=true
EOF
```

Three things have to agree, or startup refuses:

- `ADL_ALLOWED_ORIGINS` is the **browser's** origin (`https://localhost:5173`),
  not the authority's. It must be HTTPS.
- Every `ADL_WEBAUTHN_ORIGINS` entry must sit under `ADL_WEBAUTHN_RP_ID`. With
  the relying party id `localhost`, `https://localhost:5173` qualifies and
  `https://127.0.0.1:5173` does not.
- `VITE_ADL_AUTHORITY_URL` (set for you by `npm run dev:authority`) points at
  the **proxy**, `https://localhost:8443` — never at the authority's own port.

Load it into a shell with:

```bash
set -a; . ./.env.authority.local; set +a
```

## Running it

Four terminals. Steps 1–3 all need the environment from above loaded.

### 1. PostgreSQL, with the migrations applied out of band

```bash
scripts/dev/postgres.sh up
```

Starts `postgres:16-alpine` on 127.0.0.1:5432, creates the `adl_migrator` and
`adl_authority` roles from `src/server/migrations/roles.sql`, applies
`0001…0009` in order as `adl_migrator`, and grants the traffic role DML over
what they created. The server never applies a migration itself — that is the
production rule, and it holds here too, which is why a missing grant shows up on
a laptop rather than in production. `scripts/dev/postgres.sh down` removes the
container and its data.

### 2. The authority

```bash
npm run start:authority
```

The supported entry point, unchanged, going through the real
`loadAuthorityConfiguration`. It should log:

```json
{"event":"authority_started","outcome":"allowed","host":"127.0.0.1","port":8787,
 "applicationId":"giggle-band","identityMode":"passkey","identityBypassed":false}
```

### 3. The TLS proxy

```bash
npm run dev:proxy
```

Serves `https://localhost:8443` and forwards to `http://127.0.0.1:8787`. Check
it end to end before going further — and check it *with* the CA, so a failure
here is a real failure and not a skipped check:

```bash
curl --cacert .dev-tls/dev-ca.pem https://localhost:8443/readyz
# {"status":"ready","identityVerification":{"mode":"passkey","verifier":"passkey","bypassed":false}}
```

### 4. The app

```bash
npm run dev:authority
```

Vite over HTTPS on <https://localhost:5173/?demo=giggle-band>, with
`VITE_ADL_AUTHORITY_URL=https://localhost:8443`. Override the authority URL with
`ADL_AUTHORITY_URL=…` if you moved the proxy.

`npm run dev` is untouched and still serves plain HTTP — development HTTPS is
opt-in through the `ADL_DEV_HTTPS=true` that `dev:authority` sets, precisely so
the Playwright web servers in `playwright.config.ts` keep working.

## Signing in

A brand-new database has no identities, and **registration is never anonymous**:
a passkey ceremony needs either a live session or a valid invitation. So the
first identity is created out of band, exactly as
`docs/operations/authority-production-runbook.md` describes for a real
deployment. With the authority already started once (the application model row
has to exist):

```bash
set -a; . ./.env.authority.local; set +a
npm run dev:seed
```

It creates one administrator identity, a `Band` to be a member of, that
administrator's `BandAdmin` membership, and a 24-hour invitation, then prints
the invitation code. It is idempotent: re-running reuses the same identity and
band and just mints a fresh invitation.

Open the app, and in the sign-in panel choose to register a device with an
invitation, pasting that code. Your browser will prompt for a platform
authenticator (Touch ID, Windows Hello, a security key, or Chrome's built-in
software authenticator). After that, the sync-state chip in the top bar goes
from `N pending` to `Synced` as the queue drains, and `Register a device` is not
needed again on that machine.

The credential is bound to the relying party id `localhost`. A passkey
registered here can never sign in to a real deployment, and vice versa — that
separation is by design, not a limitation to work around.

### Identity mode: use `passkey`, and know what `bypass` costs

`ADL_IDENTITY_VERIFICATION` defaults to `bypass`. **Do not leave it there.**

In `bypass` mode no provider is contacted at all: the `x-adl-account-proof`
header *is* the identity, so anybody who can reach the authority becomes any
user by naming them — including a colleague on your network if you have bound
the dev server beyond loopback. It also cannot exist in production
(`loadAuthorityConfiguration` refuses to start), which means every hour spent
developing against it is an hour spent on a code path no deployment runs:
`/v1/session/issue` exists there and is gone under `passkey`, so the sign-in
surface itself is a different surface.

`passkey` is the real credential, it works against a `localhost` relying party
id, and it is what `.env.authority.sample` recommends. The only thing it costs
is the one-off `npm run dev:seed` above. Use it.

`bypass` remains legitimate for a throwaway probe of a route that has nothing to
do with identity — and if you use it, put the authority on loopback and expect
nothing about the sign-in surface to match what you will deploy.

## Ports

| What | Where | Set by |
| --- | --- | --- |
| Vite (app) | `https://localhost:5173` | `vite.config.ts`, `npm run dev:authority` |
| TLS proxy | `https://localhost:8443` | `ADL_DEV_PROXY_PORT` |
| Authority | `http://127.0.0.1:8787` | `ADL_PORT`, `ADL_HOST` |
| PostgreSQL | `127.0.0.1:5432` | `ADL_DEV_PG_PORT` |

Running two of these setups side by side means moving every one of them
together, plus `ADL_ALLOWED_ORIGINS`, `ADL_WEBAUTHN_ORIGINS` and
`ADL_AUTHORITY_URL`.

## When it does not work

**`ADL_ALLOWED_ORIGINS must contain only HTTPS origins.`** — the check doing its
job. Give it the browser's `https://` origin.

**`Every ADL_WEBAUTHN_ORIGINS entry must be under ADL_WEBAUTHN_RP_ID.`** — most
often `127.0.0.1` somewhere. Use `localhost` throughout.

**The browser shows a certificate warning.** Step 2 has not taken effect for
*that* browser. Firefox and Chrome keep separate stores, and Chrome must be
fully restarted after `certutil`.

**Signed out immediately after signing in.** The session cookie was not stored:
something in the chain is not HTTPS, or the app and the authority are not the
same site (`localhost` vs `127.0.0.1`).

**`400` from the authority with nothing else wrong.** Something reached it over
plain HTTP. The edge refuses a request whose URL is not `https://`, which is the
proxy's `x-forwarded-proto: https` header doing the work — check the proxy is in
front and that `VITE_ADL_AUTHORITY_URL` names it and not `:8787`.

**`Could not record the application model row in PostgreSQL`** — the migrations
have not been applied, or the traffic role lacks DML. Re-run
`scripts/dev/postgres.sh migrate`.

**`No application model row yet` from `npm run dev:seed`** — start the authority
once first; it registers the row at startup.
