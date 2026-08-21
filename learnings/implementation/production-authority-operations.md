# Production Authority Operations

Phase 42 provides a framework-neutral `Request`/`Response` authority edge and
a small Node adapter. Production configuration is deliberately deployment-only:
it is loaded from environment variables, demands HTTPS origins and secure
cookies, and rejects `StaticSessionAdapter`. `OpaqueSessionAdapter` remains the
replaceable identity-only adapter; an injected upstream verifier proves a
subject but never sends ADL roles to the authority.

The HTTP edge accepts session credentials only in `__Host-` Secure HttpOnly
SameSite=Strict cookies. Mutations require an allowed Origin and a
double-submit CSRF token; request JSON is content-type and byte limited. It
does not log bodies, proofs, cookies, tokens, records, or payloads. Use the
structured logger/metrics interfaces rather than adding ad-hoc console output.

Replay outcomes are bound to the authenticated actor. Authenticate before any
outcome lookup; otherwise a guessed operation id can disclose a prior result.
The HTTP edge exempts only an already-stored retry for that same authenticated
actor from replay rate cost, preserving idempotency without turning rate
limiting into an authorization bypass.

Operational source of truth is `docs/operations/authority-production-runbook.md`.
Apply migrations with the migration role and run traffic with the DML-only
authority role. Restore drills must cover every `adl_authority_*` projection,
including verifier and audit tables, and must not print protected JSON.

## The two-role split needs a third file, run by the migration role (Phase 102)

A deployment that followed the runbook literally connected to PostgreSQL and
then failed **every** query with `permission denied for table adl_authority_*`.
This was measured against real PostgreSQL 16.14, not inferred. The two grants
`roles.sql` used to carry covered nothing:

- `grant … on all tables in schema public` ran before any migration, so its
  target set was empty. It could never grant anything.
- `alter default privileges … on tables` had no `for role`, so it defaulted to
  *the role executing the statement* — the database owner. The migrations are
  applied as `adl_migrator`, which is who ends up owning all fourteen tables.

`scripts/dev/postgres.sh` had been compensating with a bespoke superuser grant
after every migration, so every laptop worked; the one script written to make a
missing grant show up locally was the thing hiding it.

**The fix is `src/server/migrations/grants.sql`, applied as `adl_migrator`.** It
carries both halves — `alter default privileges` (the forward fix: every table
`adl_migrator` creates from then on carries the DML grant at creation, including
`adl_authority_context_memberships` when `0008` drops and re-creates it) and
`grant … on all tables` (the repair for a deployment whose tables already
exist). It needs no superuser and no role membership, because a role may always
alter its own default privileges and grant on tables it owns. It is idempotent
and works applied either before or after the ordered migrations.

**Why not `alter default privileges for role adl_migrator` inside `roles.sql`.**
That is the obvious one-line fix and it does not work for the actor the runbook
names. Measured:

| Executor | `ALTER DEFAULT PRIVILEGES FOR ROLE adl_migrator …` |
|---|---|
| superuser | `ALTER DEFAULT PRIVILEGES` (works) |
| non-superuser database owner with `CREATEROLE`, which created both roles | `ERROR: permission denied to change default privileges` |

PostgreSQL 16 auto-grants a `CREATEROLE` creator membership in the roles it
creates, but with `inherit_option = f` and `set_option = f` (visible in
`pg_auth_members`), so that owner neither holds `adl_migrator`'s privileges nor
may `SET ROLE` to it (`permission denied to set role "adl_migrator"`). A fix
that silently requires a superuser where the runbook says "database owner" is
the same class of defect. **Before changing anything about these grants, measure
it as a non-superuser `CREATEROLE` owner, not as `postgres`.**

**The harness could not have caught this, and neither can most of the suite.**
`tests/integration/global-setup.ts` provisions one superuser (`POSTGRES_USER=adl`)
which owns every table, so the two-role split was never exercised anywhere —
163 integration tests passing against a configuration no deployment runs.
`tests/integration/authority-role-grants.test.ts` is the one test that
provisions the real split, in its own throwaway database. It needs
`CREATE DATABASE` and `CREATE ROLE` and **fails naming the missing capability
rather than skipping** if it does not have them: a silent skip is how the gap
survived nine migrations.

Two testing mechanics worth reusing:

- **PostgreSQL checks table privileges at executor start, before any row is
  touched.** So `insert into t select * from t where false`,
  `update t set c = c where false` and `delete from t where false` are complete,
  real privilege proofs for all fourteen tables without needing a legal fixture
  row for each. Real round trips with real values still belong alongside them.
- **`information_schema.columns` hides columns the querying role holds no
  privilege on.** Reading a table's shape over the *traffic* connection turns a
  missing grant into an empty catalogue, so the test fails with "no such column"
  instead of `permission denied for table …`. Read the catalogue over the admin
  connection and let the DML statement be the thing that fails.
