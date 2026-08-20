# Phase 97 — Local TLS Development Setup

The browser demo cannot reach a locally running authority server. Every record
it holds reports `pending` for ever, and there is no supported way to change
that on a laptop. This phase builds the missing setup — real TLS, locally —
**without weakening a single production security check**.

## Objective

A developer with a fresh clone can, from documented copy-pasteable commands,
stand up PostgreSQL, the authority through its own supported entry point, a
TLS-terminating proxy in front of it, and the browser demo over HTTPS, sign in
with a real credential, and watch the `N pending` sync chip drain.

## Evidence and Dependency

Two independent halves are missing, and only one of them has been addressed.

**The browser half was wired at `524e110`.** That commit added
`npm run dev:authority`, which sets `VITE_ADL_AUTHORITY_URL`. Without it,
`src/ui/main.ts`'s `readBrowserAuthorityConfiguration(import.meta.env ?? {})`
returns `null`, `connectAuthority` returns immediately, no bridge is built, and
`ObjectStore.writtenSyncStatus` correctly reports every queued device write as
`pending` — with nothing anywhere to answer it.

**The server half cannot be reached at all.**

- `src/server/authority-config.ts:110-111` refuses any non-HTTPS
  `ADL_ALLOWED_ORIGINS`, in **every** environment including `development`.
  `524e110` points the browser at `http://localhost:8787`, an origin no
  configuration accepting that authority could ever have been started with.
- The session and CSRF cookies are `__Host-` Secure HttpOnly SameSite=Strict. A
  user agent will not store a `__Host-` cookie delivered over plain HTTP, so
  even a server that accepted the origin would leave the app permanently signed
  out. `learnings/implementation/first-deployment-slice.md` already records
  this: *"A plain-HTTP localhost dev server will not receive the session
  cookie; front the authority with TLS or a same-origin proxy."*
- A WebAuthn ceremony requires a secure context.

The existing local-authority harnesses look like counter-evidence and are not.
`tests/visual/passkey-authority.ts:77` and
`tests/visual/administration-authority.ts` construct `AuthorityConfiguration`
**directly** and build an `https://` Request URL over a plain socket; they never
call `loadAuthorityConfiguration`. That is legitimate test wiring for a
Playwright project. It is not a development path, and reaching for it as one
would mean developing against a configuration no deployment loads.

**Dependency:** none beyond `524e110`. This phase adds tooling, configuration
and documentation; it changes no runtime, compiler or model code.

**Prior art to read first:** `learnings/implementation/first-deployment-slice.md`,
`learnings/implementation/production-authority-operations.md`,
`learnings/implementation/passkey-identity.md`,
`learnings/implementation/usable-sync-slice.md`, `.env.authority.sample` in full,
and `docs/operations/authority-production-runbook.md`.

## Decision

### Real TLS locally, rather than a development mode for any of the three checks

The obvious cheap fix is an `environment === "development"` escape in
`isHttpsOrigin`. It is refused. The repository owner's stated goal is that the
live code matches the dev code, and each of these three controls is load-bearing:
the origin check is what makes a browser origin trustworthy, the `__Host-`
cookie attributes are what make a session unstealable, and the secure-context
requirement is WebAuthn's own. A developer running without them exercises a
configuration no deployment can load, which is how a defect reaches production
having passed every local check.

So: **do not modify `isHttpsOrigin`, `loadAuthorityConfiguration`, or any other
production check to accommodate development.** Wanting to is the signal that a
wrong turn has been taken.

### Proxy-terminated TLS, not a TLS listener in the authority

`src/server/authority-node.ts:1-8` builds a plain `node:http` server and states
the deployment contract in its own doc comment: TLS terminates before the
process, at a trusted HTTPS proxy which forwards `x-forwarded-proto: https`.
That is the production topology.

Reproducing *that* locally is therefore the faithful setup, and it is the one
that keeps the authority process byte-identical between a laptop and a
deployment. Adding a TLS listener to `authority-node.ts` would do the opposite:
it would create a second deployment shape that only development uses, and the
forwarded-header path — which every rate-limit key and every scheme decision
depends on — would then be untested locally.

`caddy` and `nginx` cannot be assumed present, so the proxy is a small
dependency-free Node script committed to the repository, clearly labelled
developer tooling, imported by nothing in `src/`.

### HTTPS in Vite is opt-in

`playwright.config.ts` runs four web servers, and **all four speak plain HTTP**:
desktop/mobile on 5173 and the `vite preview` offline-shell build on 4173 (both
via `npm run dev` / `vite preview`), passkey on 5273 and administration on 5373.
Unconditional HTTPS in `vite.config.ts` breaks every one of them simultaneously.
It would also break a fresh clone outright, because the key material is
gitignored and therefore absent until somebody generates it.

The switch is therefore one environment variable, `ADL_DEV_HTTPS=true`, which
nothing but `npm run dev:authority` sets. With it unset, `vite.config.ts`
resolves to exactly the configuration it had before.

### `passkey`, not `bypass`, is the documented development identity

`ADL_IDENTITY_VERIFICATION` defaults to `bypass`, where the supplied
`x-adl-account-proof` **is** the identity: anyone who can reach the authority
becomes any user by naming them. It is also refused outright in production, so
development against it exercises a surface no deployment has — `/v1/session/issue`
is live there and answers `endpoint_unavailable` under `passkey`, which means
the sign-in surface itself differs.

`passkey` works against a `localhost` relying party id and is what
`.env.authority.sample` already recommends. Its one cost is the out-of-band
first-admin step the runbook documents, which this phase automates for a
development database. The risk of `bypass` is stated in plain terms everywhere
it is mentioned.

### The dev certificate authority is generated, never committed

`mkcert` is not installed and installing it needs root, so it is documented as
an optional convenience rather than assumed. `openssl` is present everywhere and
is what the committed generator uses. `.dev-tls/` is gitignored: a private key
does not belong in a repository even when it is only trusted by one laptop.
Trusting the CA changes a trust store, so it stays the developer's explicit
manual step and is not something a script does quietly.

## Scope

- `scripts/dev/generate-local-tls.sh` — an openssl development CA and a
  `localhost` leaf certificate into gitignored `.dev-tls/`.
- `scripts/dev/tls-proxy.mjs` — HTTPS in, plain HTTP out, `x-forwarded-proto:
  https` set, `Host` preserved.
- `scripts/dev/postgres.sh` — a throwaway PostgreSQL with the real role split
  and the ordered migrations applied out of band.
- `scripts/dev/seed-local-admin.mjs` — the runbook's out-of-band first-admin
  step, for a development database only.
- `vite.config.ts` — opt-in HTTPS for `server` and `preview`.
- `package.json` — `dev:tls`, `dev:proxy`, `dev:seed`; `dev:authority` retargeted
  at the proxy over HTTPS.
- `.gitignore` — `.dev-tls/`.
- `docs/development/local-https-development.md` — the end-to-end sequence.
- Pointers from `.env.authority.sample` and the production runbook.
- `learnings/implementation/local-https-development.md` and an index entry.

## Non-goals

- No change to `isHttpsOrigin`, `loadAuthorityConfiguration`, cookie attributes,
  CSRF, rate limits or any other production control.
- No TLS listener in `authority-node.ts`.
- No change to `playwright.config.ts` or to any Playwright project.
- No first-admin *route*. The gap the runbook documents stays a documented gap;
  a development script is not a product surface.
- No change to runtime, compiler, model or reference-app content, so no
  `modelVersion` moves and no persisted-state upgrade test is implicated.
- Not a deployment guide. `docs/operations/authority-production-runbook.md`
  remains the operational source of truth.

## Constraints

- Never weaken a constraint, loosen a test, or adjust a conformance case to make
  verification pass.
- The generated key material must be gitignored and must never be committed.
- The existing plain-HTTP commands must be unaffected, and that must be
  demonstrated rather than asserted.
- Any documented sequence must actually have been run.

## Acceptance Criteria

1. The authority starts through `npm run start:authority` — that is, through
   `loadAuthorityConfiguration` — with HTTPS `ADL_ALLOWED_ORIGINS`, against real
   PostgreSQL, with no direct-construction bypass.
2. An HTTPS request through the proxy reaches it and is accepted, verified
   against the generated CA (`--cacert`, not `-k`).
3. The browser demo, built with `VITE_ADL_AUTHORITY_URL` pointing at the proxy,
   connects, and a record queued locally stops being `pending`.
4. `npm run dev` still serves plain HTTP; `vite preview` still serves plain
   HTTP; neither sees `VITE_ADL_AUTHORITY_URL`.
5. `npx tsc --noEmit` clean, `npx vitest run` at 61 files / 1,104 tests,
   `npm run format:check` clean.
6. `git status` shows no `.dev-tls/` content staged or committed.

## Testing

This phase adds no product behaviour, so it adds no unit test. What it must
produce instead is a **live run**, with real command output recorded in the
Execution Note: certificates generated, PostgreSQL up and migrated, the
authority started through its own entry point, `/readyz` answered over HTTPS
through the proxy with the CA verified, an identity established through the
documented mode, and a record's sync state observed changing.

The existing suites are the regression proof that nothing else moved:
`npx tsc --noEmit`, `npx vitest run`, `npm run format:check` (`vite.config.ts`
and `package.json` are both inside that glob). `npm run verify:push` is run once
by the integrator after all parallel branches merge.

## Parallel Execution Plan

Do not fan out. Each piece is the input to the next — the certificate must exist
before the proxy can serve, the proxy before the authority is reachable, the
authority before the seed can run, the seed before anything can sign in — and
the whole value of the phase is that one person actually walked the sequence
end to end. Serial.

## Tasks

1. Re-verify the Evidence against current code.
2. Certificate generator, then the proxy, then PostgreSQL tooling.
3. Opt-in HTTPS in `vite.config.ts`; retarget the `dev:*` scripts.
4. The out-of-band development seed.
5. Stand the whole thing up and drive it end to end. Record the real output.
6. Prove the plain-HTTP paths are unaffected, directly.
7. Documentation, learnings, then commit.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**, not merely the next gap in this subsystem.

## Execution Note

Executed serially on branch `phase-97-local-tls`, from `524e110`, exactly as the
Parallel Execution Plan directed. Every command below was run; every output is
real.

Because four agents were working in parallel worktrees, the live run used
alternate ports — Vite 5473, proxy 8888, authority 8887, PostgreSQL 55432 — while
the committed configuration keeps the conventional 5173 / 8443 / 8787 / 5432.
Nothing else differed.

### Re-verification (Task 1)

The Evidence held in full. `authority-config.ts:110-111` still refuses a
non-HTTPS allowed origin unconditionally; `authority-node.ts` is still plain
`node:http` with the trusted-proxy contract in its doc comment; both visual
harnesses still construct `AuthorityConfiguration` directly. Confirmed
empirically as well — see the plain-HTTP refusal below.

### What was built

The topology is the deployment topology:

```
browser -> https://localhost:5173  (Vite, TLS opt-in)
        -> https://localhost:8443  (scripts/dev/tls-proxy.mjs)
        -> http://127.0.0.1:8787   (npm run start:authority, unchanged)
        -> PostgreSQL 127.0.0.1:5432
```

`scripts/dev/tls-proxy.mjs` **deletes** `x-forwarded-*` and `forwarded` from
every incoming request and sets `x-forwarded-proto`/`x-forwarded-for` from what
it observed, because the authority reads the first hop of `x-forwarded-for` as
its rate-limit key and trusts `x-forwarded-proto` as the scheme. A pass-through
proxy would let any caller pick both. `Host` is untouched: the authority builds
its Request URL from it.

`scripts/dev/postgres.sh` reproduces the deployment's role split rather than
running everything as a superuser, and that immediately surfaced a real gap:
`roles.sql` runs `grant … on all tables` before any table exists, and its
default-privilege grant only covers objects created by the role that ran it —
but the migrations are applied as `adl_migrator`. The traffic role therefore
needs a `grant … on all tables … to adl_authority` **after** the migrations. The
script does it; a deployment needs the equivalent after any migration adding a
table. (No migration creates a sequence, so no sequence grant is needed.)

### The live run

Certificates, with no root and no `mkcert`:

```
$ bash scripts/dev/generate-local-tls.sh
subject=CN = localhost
issuer=CN = ADL local development CA, O = ADL local development
notBefore=Aug 20 22:07:09 2026 GMT
notAfter=Sep 21 22:07:09 2027 GMT
X509v3 Subject Alternative Name:
    DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1
```

PostgreSQL and the out-of-band migrations:

```
$ ADL_DEV_PG_PORT=55432 ADL_DEV_PG_CONTAINER=adl-dev-postgres-97 scripts/dev/postgres.sh up
Started adl-dev-postgres-97 (postgres:16-alpine) on 127.0.0.1:55432.
  applying 0001_authority_projection.sql
  ... through ...
  applying 0009_retention_scheduling.sql

ADL_DATABASE_URL=postgresql://adl_authority:adl@127.0.0.1:55432/adl
```

The authority, through the supported entry point and therefore through
`loadAuthorityConfiguration`, with `ADL_ALLOWED_ORIGINS=https://localhost:5473`:

```
$ npm run start:authority
{"event":"identity_verification_configured","outcome":"allowed","mode":"passkey","verifier":"passkey","bypassed":false,...}
{"event":"session_lifetime_configured","outcome":"allowed","sessionTtlMinutes":43200,"capped":false,...}
{"event":"authority_started","outcome":"allowed","host":"127.0.0.1","port":8887,"applicationId":"giggle-band","modelVersion":"1.9.0","identityMode":"passkey","identityVerifier":"passkey","identityBypassed":false,...}
```

The proxy, and `/readyz` over HTTPS with the CA verified — not `-k`:

```
$ node scripts/dev/tls-proxy.mjs        # ADL_DEV_PROXY_PORT=8888, target :8887
[tls-proxy] https://localhost:8888 -> http://127.0.0.1:8887 (x-forwarded-proto: https)

$ curl -i --cacert .dev-tls/dev-ca.pem https://localhost:8888/readyz
HTTP/1.1 200 OK
{"status":"ready","identityVerification":{"mode":"passkey","verifier":"passkey","bypassed":false}}
```

Both negative controls, proving the trust and the TLS requirement are real
rather than skipped:

```
$ curl https://localhost:8888/readyz                       # no --cacert
curl: (60) SSL certificate problem: unable to get local issuer certificate

$ curl -i -X POST http://127.0.0.1:8887/v1/webauthn/authenticate/begin \
       -H 'origin: https://localhost:5473' -H 'content-type: application/json' -d '{}'
HTTP/1.1 400 Bad Request
```

The second is the whole phase in one line: the authority refuses a plain-HTTP
request, and the proxy in front of it is what makes development work.

The first administrator, through the runbook's out-of-band step:

```
$ npm run dev:seed
administrator user id : user-LDy5x-5q9wVY-ip5axQ05obV1IdpnmLz05uvZVgb63g
Band                  : band-2082a0e4-2cf7-4e43-acc5-935ef01d632f (Local Development Band)
invitation role       : BandMember

Paste this invitation code into the app's sign-in panel:

  5zHN-_zUGas68o6jmcYCH034C_qUgqcK_U3kXFw9VyQ
```

Re-running it printed the same user id and band id with a fresh invitation,
confirming idempotency.

### The record-sync proof: how far it got

Vite over HTTPS, and the authority URL reaching the browser bundle:

```
$ ADL_AUTHORITY_URL=https://localhost:8888 npm run dev:authority -- --port 5473
  ➜  Local:   https://localhost:5473/

$ curl --cacert .dev-tls/dev-ca.pem -o /dev/null -w '%{http_code} verify=%{ssl_verify_result}\n' \
       'https://localhost:5473/?demo=giggle-band'
200 verify=0

$ curl --cacert .dev-tls/dev-ca.pem https://localhost:5473/src/ui/main.ts | head -c 160
import.meta.env = {"BASE_URL": "/", "DEV": true, "MODE": "development", "PROD": false,
 "SSR": false, "VITE_ADL_AUTHORITY_URL": "https://localhost:8888"};

$ VITE_ADL_AUTHORITY_URL=https://localhost:8888 npm run build && grep -ro "https://localhost:8888" dist/assets/*.js
dist/assets/index-B6hc2rXN.js:https://localhost:8888
```

So the browser half is wired, in both the dev server and a production build.

**Playwright was unavailable for this phase** (another agent held it), so the
loop was closed one layer below the DOM instead: a throwaway vitest file drove
`connectBrowserAuthority` — the real browser bridge — over the real proxy, with
only the two injection points the module already documents for non-browser
callers (an `InMemoryAuthorityCredentialStore` cookie jar with an explicit
`Origin`, and `tests/integration/webauthn-authenticator.ts`'s
`SoftwareAuthenticator` as the authenticator). Crucially it passed **no**
`forwardedProto`: the TLS proxy supplied it, exactly as a deployment's would,
and Node's `fetch` validated the chain through `NODE_EXTRA_CA_CERTS`.

```
session on connect: {"status":"signedOut","developmentMode":false,"identityMode":"passkey","passkeySupported":true,...}
session after passkey registration: {"status":"signedIn",...,"userId":"user-fzqGD6ohGrkw8MFIsStpSfM8622fMm-LKKn4-nkcJDQ","notice":"This device is registered and the invitation was accepted."}
record sync summary after bootstrap: {"local":0,"pending":0,"synced":5,"conflict":0,"rejected":0}
chip after the local write: 1 pending
chip after synchronize: Synced {"local":0,"pending":0,"synced":6,"conflict":0,"rejected":0}
accepted in PostgreSQL: [{"record_id":"availability-ab3b302a-...","notes":"queued locally over the development TLS proxy","sync_status":"synced"}]
```

That summary is literally what the chip renders: `adl-app/state.ts`'s
`recordSyncState()` reads `runtime.summariseRecordSyncState()` and labels
`summary.pending > 0` as `${summary.pending} pending`. So `1 pending → Synced`,
with the record accepted in PostgreSQL, is the chip draining.

**What this does not prove:** that a real browser renders it. Registration
through a real platform authenticator, the `__Host-` cookie actually being
stored by a user agent, and the chip's pixels remain unproven here, and are
exactly what the Playwright `passkey` project exists for. The scratch file was
deleted before committing; it is not part of the change.

### The plain-HTTP paths are unaffected

Demonstrated directly, since Playwright could not be run:

```
$ npm run dev -- --host 127.0.0.1 --port 5473
  ➜  Local:   http://127.0.0.1:5473/
$ curl -o /dev/null -w '%{http_code} scheme=%{scheme}\n' 'http://127.0.0.1:5473/?demo=giggle-band'
200 scheme=HTTP
$ curl -k https://127.0.0.1:5473/
curl: (35) OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number
$ curl http://127.0.0.1:5473/src/ui/main.ts | head -c 110
import.meta.env = {"BASE_URL": "/", "DEV": true, "MODE": "development", "PROD": false, "SSR": false};

$ npm run build && npx vite preview --host 127.0.0.1 --port 4473
  ➜  Local:   http://127.0.0.1:4473/
$ curl -o /dev/null -w '%{http_code} scheme=%{scheme}\n' 'http://127.0.0.1:4473/?demo=giggle-band'
200 scheme=HTTP
```

Plain HTTP on both, TLS refused on the dev port, and no `VITE_ADL_AUTHORITY_URL`
in the injected env — which is what keeps the desktop/mobile screenshots about
the reference app rather than a network state. A default `npm run build` also
contains no authority URL at all.

### Verification

- `npx tsc --noEmit`: clean (exit 0).
- `npx vitest run`: **61 files / 1,104 tests, all passing** — the baseline,
  unmoved.
- `npm run format:check`: clean, including `vite.config.ts` and `package.json`.
- `npm run test:integration`: **not run.** This phase changes no server, runtime
  or SQL code — the migrations are applied by the same files the integration
  harness applies — and the integration suite provisions its own throwaway
  PostgreSQL. The live run above is the real-backend proof this phase owes.
- `npm run verify:push`: **not run**, by instruction; Playwright was held by
  another agent and the integrator runs it once after merging. Nothing here
  touches browser rendering, shell chrome, reference app screens, presentation
  output or CSS, so no screenshot should move.
- `git status` confirmed `.dev-tls/` untracked and ignored.

### Not proven, and what the user must do themselves

- **Trusting the CA is not automated and was not performed.** It modifies a
  browser or OS trust store, so it stays the developer's explicit step; the
  guide gives the exact line for Chrome/Chromium (no root, via `certutil` into
  `~/.pki/nssdb`), Debian/Ubuntu system-wide (root), macOS (root), Windows (no
  root) and Firefox (manual import). The live run proved trust the honest way
  instead, with `--cacert` and `NODE_EXTRA_CA_CERTS`.
- **No real browser was driven.** See above.
- The guide's default ports were never bound during this run; only the alternate
  ports were exercised. The mapping between them is mechanical (four numbers),
  but it is an untested substitution.

## Planning Handoff

**Next phase candidate: a real-browser proof of the local HTTPS setup, folded
into the existing Playwright `passkey` project rather than added beside it.**

Justification as the highest-value remaining gap repository-wide: this phase
closed the setup gap but left the last inch — the browser — unproven, and that
inch is where this subsystem's defects have historically lived.
`learnings/implementation/passkey-identity.md` records a CORS defect that *no*
integration test could catch because Node's `fetch` does not enforce CORS, only
a real browser does; the same is true of `__Host-` cookie storage, secure-context
gating, and the sync chip's rendering. The `passkey` project already runs a real
Chromium against a configured authority with a virtual authenticator; pointing a
variant of it at a real TLS listener would convert this phase's documented setup
into a continuously verified one, and would cost one web-server entry rather
than a new subsystem.

Ranked above the alternative found while working here — the `roles.sql`
default-privilege gap, which affects real deployments and is currently only
worked around in a development script — because that one is a small, well
understood SQL fix an operator can already make from the runbook, whereas the
browser gap is a class of defect that has already shipped once and cannot be
caught any other way. If the browser proof is deferred, the `roles.sql` fix is
the next best use of a phase, and both are cheap enough to share one.
