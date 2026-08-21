# Phase 102 — Close the Authority Role Grant Gap

A deployment that follows `docs/operations/authority-production-runbook.md`
literally produces an authority server that **connects to PostgreSQL
successfully and then fails on every single query**. This was measured, not
inferred (see Evidence). It is the only live production defect among the three
phases planned here, which is why it goes first.

> **Phase numbers are no longer execution order in this repository.** The owner
> reprioritised mid-flight: Phases 100 and 101 were executed before Phase 99.
> This document is executed **after Phase 99 lands**, and is the first of the
> ordered run 102 → 103 → 104.

## Objective

A deployment that follows the runbook end to end reaches a working authority.
The traffic role `adl_authority` holds DML over every projection table the
migrations create — the ones that exist today, the ones a future migration adds,
and the ones an existing migration drops and re-creates — while still holding no
DDL, no `TRUNCATE` and no ownership. Existing deployments get a documented
repair. And an integration test that provisions the real two-role split proves
all of it, so the gap cannot silently reopen.

## Evidence and Dependency

Everything in this section was reproduced by the author against real PostgreSQL
16.14 (`postgres:16-alpine`) in a throwaway container, following the runbook's
own procedure. It is not taken from a prior document.

### 1. The two grants in `roles.sql` cover nothing

`src/server/migrations/roles.sql:18-19`:

```sql
grant select, insert, update, delete on all tables in schema public to adl_authority;
alter default privileges in schema public grant select, insert, update, delete on tables to adl_authority;
```

- Line 18 runs before any migration, so `all tables in schema public` is the
  empty set. It grants nothing and can never grant anything.
- Line 19 has no `FOR ROLE`. `ALTER DEFAULT PRIVILEGES` without `FOR ROLE`
  defaults to *the role executing the statement*, and `roles.sql`'s own header
  (`roles.sql:1-3`) says to run it as the database owner. So it covers objects
  the **owner** creates.

### 2. But the migrations are applied as `adl_migrator`

`docs/operations/authority-production-runbook.md:489-499`: "Use a database owner
only to create roles. Run `roles.sql` once, then apply ordered
`0001…0009` … as `adl_migrator`. Run the process as `adl_authority`."
`.env.authority.sample:6-11` says the same ("Migrations are applied OUT OF BAND
… using the migration role in `src/server/migrations/roles.sql`"), and
`docs/operations/authority-production-runbook.md:966` repeats it in the restore
drill ("Apply migrations with `adl_migrator`; connect only with
`adl_authority`").

No migration file grants anything. `grep -n "grant" src/server/migrations/00*.sql`
returns nothing.

### 3. Measured: a runbook-following deployment is broken

Reproduction, exactly as the runbook prescribes:

```
$ psql "$SUPERUSER" -v authority_db=adl -f src/server/migrations/roles.sql
$ for f in 0001…0009; do psql "$MIGRATOR" -f "src/server/migrations/$f.sql"; done
$ psql "$SUPERUSER" -Atc "select tablename, tableowner from pg_tables where schemaname='public'"
adl_authority_access_audit_events|adl_migrator
…                                 (all 14 tables)
adl_authority_models|adl_migrator
$ psql "$AUTHORITY" -Atc "select 1 from adl_authority_models limit 1"
ERROR:  permission denied for table adl_authority_models
$ psql "$AUTHORITY" -Atc "insert into adl_authority_models …"
ERROR:  permission denied for table adl_authority_models
```

The role connects (line 15's `grant connect` and line 17's `grant usage on
schema public` both work). It is the *table* privileges that are absent. There
is no other mechanism anywhere in the repository that would supply them: this is
the whole of it.

### 4. Local development hides it, by design and by accident

`scripts/dev/postgres.sh:72-79` runs, after migrating, as a **superuser**:

```sql
grant select, insert, update, delete on all tables in schema public to adl_authority
```

with a comment that states the defect precisely. So every laptop works. That
script's own doc comment (`scripts/dev/postgres.sh:5-11`) says it exists so "a
missing grant shows up on a laptop instead of in production" — it found this one
and then compensated for it, which is the opposite of what it was built for.

### 5. Phase 97 found it, recorded it, and did not fix it

`docs/phases/phase-97-local-tls-development.md:258-265` and
`learnings/implementation/local-https-development.md:77-84` both state the
defect and both prescribe the *manual* fix: "a deployment needs the equivalent
after any migration that adds a table." That instruction never reached the
runbook, and it is the weaker of the two available fixes (see Decision).

### 6. The integration harness cannot catch it, and says so

`tests/integration/pg-harness.ts:6` — *"`roles.sql` is deployment-only and
intentionally skipped."* `tests/integration/global-setup.ts:44` provisions the
container with `POSTGRES_USER=adl`, and line 75 builds
`postgres://adl:adl@127.0.0.1:<port>/adl`; line 94 applies the migrations over
that same superuser connection. There is one role, it is a superuser, and it
owns every table. **The two-role split is never exercised anywhere in the
repository's test suites.** That is why 159 integration tests pass against a
configuration no deployment runs.

### 7. Facts that bound the fix

- **No migration creates a sequence.** `grep -riE "serial|generated always as
  identity|create sequence" src/server/migrations/00*.sql` returns nothing, so
  no `usage on sequences` grant is needed today. (Phase 97 recorded the same.)
- **No server code emits DDL or `TRUNCATE`.** `grep -rniE "truncate|create
  table|alter table|drop table" src/server/*.ts` finds only the
  `x-adl-report-truncated` header and report-pagination flags. `TRUNCATE`
  appears only in `pg-harness.ts:resetProjections`, which is test wiring.
- **`0008_membership_projection.sql` drops and re-creates
  `adl_authority_context_memberships`** (runbook lines 517-524). A one-shot
  catch-up grant applied before that migration therefore lapses on that table.
  This is the concrete case that makes a forward-looking fix necessary rather
  than merely tidier.

**Dependency:** Phase 99. Nothing in this phase depends on Phase 99's content,
but Phase 99 is the active work and this executes after it lands.

## Decision

### Split the grants out of `roles.sql` into a `grants.sql` applied *as `adl_migrator`*

`src/server/migrations/roles.sql` keeps what only an owner can do — create the
two roles, `grant connect`, `grant usage[, create] on schema public`, and the two
`revoke`s. Lines 18 and 19 are **deleted**: neither does anything useful where it
stands, and line 19 in particular reads like a working forward grant while
covering a role no table is ever created by.

A new `src/server/migrations/grants.sql`, applied **as `adl_migrator`**, carries
both halves:

```sql
-- Run as adl_migrator, in the authority database, after roles.sql. Idempotent
-- and re-appliable; run it again after any migration hop.
\set ON_ERROR_STOP on
alter default privileges in schema public
  grant select, insert, update, delete on tables to adl_authority;
grant select, insert, update, delete on all tables in schema public to adl_authority;
```

The first statement is the forward fix: every table `adl_migrator` creates from
that point on — including one a future migration adds, and including
`adl_authority_context_memberships` when `0008` re-creates it — carries the DML
grant at creation. The second statement is the repair for a deployment whose
tables already exist.

**Why `adl_migrator` executes it rather than the owner.** A role may always
alter its own default privileges and may always grant on tables it owns, so
`grants.sql` needs no superuser and no role membership. The obvious alternative
— leave the statement in `roles.sql` and write `ALTER DEFAULT PRIVILEGES FOR
ROLE adl_migrator …` — was tested and is **not** reliably available to the
runbook's own actor:

| Executor | `ALTER DEFAULT PRIVILEGES FOR ROLE adl_migrator …` |
|---|---|
| superuser | `ALTER DEFAULT PRIVILEGES` (works) |
| non-superuser database owner with `CREATEROLE`, which created both roles | `ERROR: permission denied to change default privileges` |

The second row was measured. PostgreSQL 16 auto-grants a `CREATEROLE` creator
membership in the roles it creates, but with `inherit_option = f` and
`set_option = f` (confirmed in `pg_auth_members`), so the executor neither has
the privileges of `adl_migrator` nor may `SET ROLE` to it — `SET ROLE
adl_migrator` fails with `permission denied to set role "adl_migrator"`. A fix
that silently requires a superuser where the runbook says "database owner" is
the same class of defect this phase is closing.

**Both application orders work, and that is deliberate.** Running `grants.sql`
before the migrations means the default privileges cover everything; running it
after means the catch-up grant covers everything and the default privileges
cover the next hop. The runbook prescribes one order; the test proves both, so
an operator who runs it in the other order is not silently broken.

**Verified end to end.** The whole procedure — unmodified `roles.sql` as owner,
`grants.sql` as `adl_migrator`, then `0001…0009` as `adl_migrator` — was run
against real PostgreSQL. `adl_authority` then read and wrote every projection
table, read a table `adl_migrator` created *afterwards*, and was still refused
`create table` (`permission denied for schema public`) and `truncate`
(`permission denied for table adl_authority_records`). Re-running `grants.sql`
was a clean no-op.

### The runbook gains the step, and the dev script stops improvising

`docs/operations/authority-production-runbook.md`'s "Database roles and
migrations" section (line 487 onward) gets `grants.sql` as an explicit,
role-attributed step, plus a short "repairing an existing deployment" paragraph
naming the symptom (`permission denied for table adl_authority_*` from a process
that started and passed `connect`) and the one command that fixes it. The
restore-drill step at line 966 gains it too.

`scripts/dev/postgres.sh` replaces its bespoke superuser grant
(`scripts/dev/postgres.sh:72-79`) with a `psql "${migrator_url}" -f
.../grants.sql` invocation. The script's stated purpose is to run the
deployment's own procedure; after this phase it actually does, and the next
divergence between laptop and deployment shows up on the laptop.

### Rejected alternatives

**`ALTER DEFAULT PRIVILEGES FOR ROLE adl_migrator` inside `roles.sql`.** The
obvious candidate named in the brief. It works for a superuser and fails for a
non-superuser database owner (measured, table above), and it does nothing for
deployments whose tables already exist — they would still need a separate repair
command that the runbook would have to carry anyway. Splitting the file gets both
halves, run by a role that can always execute them.

**Keep Phase 97's prescription: a manual `grant … on all tables` after every
migration.** This is what `learnings/implementation/local-https-development.md:77-84`
recommends today. It is a standing operational obligation attached to a step
nobody performs often, with a failure mode (a new table added by migration
`0010`) that appears only in production and only under load. A default-privilege
grant makes the obligation disappear. Keeping a runbook step that must be
remembered forever, when a one-line database-level rule removes the need, is a
choice to keep the defect and document it.

**Grant statements at the end of each migration file.** Nine files to edit, plus
a rule every future migration author must remember — the same "remember it
forever" failure with more surface. It also hard-codes the traffic role's name
into ADL's own ordered DDL, where today the role names live only in the two
deployment-only files.

**Give `adl_authority` membership in `adl_migrator`, or make it the table
owner.** Either would work and both destroy the least-privilege split the two
roles exist to create: the traffic role would gain DDL and `TRUNCATE` over the
projection. The revokes at `roles.sql:20-21` say what the design intends; this
would contradict them.

**Have the authority process grant itself at startup.** It cannot: it holds no
grant option, and giving it one is the previous rejected alternative. A *check*
at startup is a different and defensible idea, and is deferred (see Non-goals).

### How this is tested, which is the part that has never existed

A new `tests/integration/authority-role-grants.test.ts` provisions the **real
two-role split** and drives real traffic through it. It is the first test in the
repository to do so.

Shape:

1. Connect to `inject("pgUrl")` as the provisioned superuser. Create a
   **dedicated throwaway database** (`create database adl_role_grants_<pid>_<ts>`)
   — not the shared `adl` database, whose tables are already owned by the
   superuser and truncated between tests, and where the `if not exists`
   migrations would leave ownership unchanged and prove nothing.
2. Apply `roles.sql` as the owner, with `authority_db` set to the new database,
   then set both role passwords (roles are cluster-global, so a pre-existing
   `adl_migrator` takes the `duplicate_object` branch and keeps whatever password
   it had; the test must not rely on `roles.sql` setting one — `scripts/dev/postgres.sh:59-65`
   already handles this the same way).
3. Apply `grants.sql` as `adl_migrator`, then every file in
   `MIGRATION_FILES` as `adl_migrator`.
4. Assert, over a pool connected **as `adl_authority`**:
   - `select`, `insert`, `update`, `delete` succeed on every table in
     `AUTHORITY_TABLES` (all 14, enumerated from the exported constant, so a
     table added later without a grant fails here rather than in production);
   - a table `adl_migrator` creates *after* `grants.sql` ran is readable and
     writable — this is the assertion that makes the default-privileges half
     load-bearing, and the catch-up grant alone cannot satisfy it;
   - `adl_authority_context_memberships` — the table `0008` drops and
     re-creates — is readable and writable, proving the re-created table
     inherited the grant;
   - `create table`, `truncate` and `alter table` are all **refused**, so a
     future "fix" that widens the role fails here.
5. Assert a **real authority write** over the `adl_authority` connection, not
   raw SQL: a `PostgresObjectStorageBackend` + `PostgresAuthorityUnitOfWork` +
   `AuthorityService` accepting one operation, following the wiring in
   `tests/integration/authority-postgres.test.ts:1-16`. Hand-written SQL proves
   the grant; only the real server path proves the grant is *sufficient for what
   the server does*.
6. A second case applies `grants.sql` **after** the migrations instead of before,
   and repeats (4). This is the existing-deployment repair path.
7. Drop the throwaway database in `afterAll`.

**Prove it fails first.** Before any fix lands, the implementer runs this test
against today's `roles.sql` with `grants.sql` absent, and records the exact
failure — expected: `permission denied for table adl_authority_models`. A test
that has never been seen red is not evidence.

**CI without Docker.** If `ADL_TEST_DATABASE_URL` points at a database whose role
cannot `CREATE DATABASE` or `CREATE ROLE`, this test cannot run. It must then
**fail with a message naming the missing capability**, not skip. A silent skip is
how the gap survived; and `AGENTS.md` does not accept weakening a check to make
verification pass. The requirement is recorded in the runbook's testing notes
and in `learnings/process/testing-expectations.md`.

## Scope

- `src/server/migrations/roles.sql`: delete lines 18-19; header points at
  `grants.sql`.
- `src/server/migrations/grants.sql`: **new**, applied as `adl_migrator`.
- `docs/operations/authority-production-runbook.md`: the migration procedure
  (line 487 onward), a repair paragraph for existing deployments, and the
  restore drill (line 966).
- `.env.authority.sample`: the out-of-band migration header (lines 6-11) names
  `grants.sql`.
- `scripts/dev/postgres.sh`: replace the bespoke superuser grant with
  `grants.sql` run as `adl_migrator`.
- `docs/development/local-https-development.md:168-170`: the same.
- `tests/integration/authority-role-grants.test.ts`: **new**.
- `tests/integration/pg-harness.ts`: a comment correcting "deployment-only and
  intentionally skipped" to say which test *does* exercise it. `MIGRATION_FILES`
  is unchanged — `grants.sql` must not join it, because the shared harness
  database has no `adl_authority` role.
- `learnings/implementation/production-authority-operations.md` and
  `learnings/implementation/local-https-development.md:77-84`: the standing
  "grant after every migration" instruction becomes "run `grants.sql` once;
  default privileges carry it forward", with the measured non-superuser finding.

## Non-goals

- **No change to any numbered migration.** `0001…0009` are unchanged; several are
  already applied in real deployments.
- **No sequence, function or schema-level grant.** No migration creates a
  sequence today. Adding a speculative `on sequences` default privilege would be
  an unverified grant, and the first migration that needs one is the right place
  to add it — with a test.
- **No startup privilege preflight.** Making the authority check its own grants
  at startup and refuse with a named reason is attractive and is deliberately
  deferred: it is server behaviour, not a deployment fix, and this phase should
  not grow a second subject. Named in the Planning Handoff.
- **No role rename or parameterisation.** `adl_migrator` and `adl_authority`
  stay hard-coded in the two deployment-only files, as today.
- **No model, runtime, compiler, parser or UI change.** No `modelVersion` and no
  `modelFingerprint` moves, so no migration hop and no persisted-state upgrade
  test is implicated.

## Constraints

- `adl_authority` must end the phase with **strictly** `select, insert, update,
  delete` on the projection tables — no ownership, no `create`, no `truncate`,
  no `alter`. The refusal assertions are part of the acceptance criteria, not
  optional extras.
- `grants.sql` must be idempotent and safe to re-run in either order relative to
  the migrations.
- `grants.sql` must run without a superuser and without role membership.
- The new test must be shown failing against the unfixed `roles.sql` before it
  passes.
- No existing test may be weakened, and `pg-harness.ts`'s shared-database
  provisioning must not change: the new test brings its own database precisely
  so the other 159 tests are untouched.
- The integration test suite must be run against real PostgreSQL, never a fake
  (`AGENTS.md`, Testing).

## Acceptance Criteria

1. Following the runbook literally against a fresh PostgreSQL yields an
   `adl_authority` role that can `select`/`insert`/`update`/`delete` on every
   table in `AUTHORITY_TABLES`.
2. A table created by `adl_migrator` **after** `grants.sql` ran is readable and
   writable by `adl_authority` with no further action.
3. `adl_authority_context_memberships` — dropped and re-created by `0008` — is
   readable and writable.
4. `adl_authority` is refused `create table`, `truncate` and `alter table`.
5. A real `AuthorityService` write over a `PostgresAuthorityUnitOfWork` bound to
   the `adl_authority` connection succeeds.
6. Applying `grants.sql` *after* the migrations produces the same result as
   applying it before.
7. The new test was observed failing against the pre-change `roles.sql`, and the
   failure message is recorded in the execution note.
8. The runbook, `.env.authority.sample`, `scripts/dev/postgres.sh` and
   `docs/development/local-https-development.md` all describe the same procedure,
   and the dev script no longer carries a grant the deployment does not.
9. `npx tsc --noEmit`, `prettier --check`, `npx vitest run` and
   `npx vitest run --config vitest.integration.config.ts` all clean, with the
   integration count at baseline **plus** the new file's cases and no test
   weakened.

## Testing

- **Integration** (`npx vitest run --config vitest.integration.config.ts`, real
  PostgreSQL; baseline 163 after Phase 101). `tests/integration/authority-role-grants.test.ts`
  as specified in the Decision. Docker required, or an `ADL_TEST_DATABASE_URL`
  whose role can create a database and roles — otherwise the test fails with a
  message naming the missing capability rather than skipping.
- **Unit** (`npx vitest run`; baseline 1,128). Unchanged — there is nothing here
  a hermetic test can prove. Run to confirm no regression.
- **Manual reproduction, recorded in the execution note.** The exact `psql`
  transcript for: the broken pre-change procedure, the fixed procedure, and the
  non-superuser `ALTER DEFAULT PRIVILEGES FOR ROLE` refusal. These are the three
  facts the whole phase rests on and they belong in the record, not only in a
  test.
- **Mutation check.** Deleting either statement from `grants.sql` must turn a
  *specific, different* assertion red: without the default-privilege line, the
  "table created afterwards" and `0008` cases fail; without the catch-up line,
  the "grants after migrations" case fails. A grant no test can distinguish from
  its absence is not a grant.
- **Not run:** `npm run verify:push`, `npm run build`, Playwright. Nothing here
  touches browser rendering, shell chrome, reference-app screens, presentation
  output or CSS.

## Parallel Execution Plan

Serial. The phase is small, and its two halves are not independent: the runbook
wording, the dev script and the learnings updates all describe whatever
`grants.sql` ends up saying, and `grants.sql`'s content is decided by the test.

If fanned out at all, the only defensible split is:

1. **Serial spine.** `grants.sql` and the `roles.sql` edit, with the new
   integration test written against them and observed failing first.
2. **Then parallel** (disjoint files, minutes of work each): runbook +
   `.env.authority.sample`; `scripts/dev/postgres.sh` + the local-HTTPS doc;
   the two learnings updates.
3. **Barrier.** `npx vitest run --config vitest.integration.config.ts` once, at
   the end — concurrent runs are safe but each provisions its own throwaway
   PostgreSQL, so once is enough and cheaper.

No shared-spine file is touched: `src/index.ts`, `src/ui/components/register.ts`,
shell chrome, the ordered migration SQL, the conformance runner and the reference
app fixtures are all untouched.

## Tasks

1. Reproduce the defect against real PostgreSQL and record the transcript.
2. Write `tests/integration/authority-role-grants.test.ts` and observe it fail
   with `permission denied for table adl_authority_models`.
3. Add `src/server/migrations/grants.sql`; delete `roles.sql:18-19` and point its
   header at the new file.
4. Make the test pass; add the refusal, after-the-fact-table, `0008` re-create
   and reversed-order cases; run the mutation check.
5. Add the real-`AuthorityService`-over-`adl_authority` case.
6. Update the runbook (procedure, repair paragraph, restore drill),
   `.env.authority.sample`, `scripts/dev/postgres.sh` and
   `docs/development/local-https-development.md`.
7. Correct `learnings/implementation/local-https-development.md:77-84` and
   `learnings/implementation/production-authority-operations.md`; record the
   non-superuser `FOR ROLE` finding and the "the harness never exercised the
   split" finding.
8. Run `tsc`, `prettier --check`, unit and integration suites; commit; push.

## Planning Handoff

**Next phase: Phase 103 — a policy operand for "this record is mine".** Then
Phase 104. That ordering is deliberate and is recommended unchanged:

- **102 first** because it is the only one of the three that is broken in
  production right now. A deployment that follows the documented procedure does
  not work. Nothing else competes with that.
- **103 second** because it is an *enabling* gap, not a defect: it removes a
  stated platform limitation that Phase 91, Phase 99 and Phase 101 have each run
  into and each deferred. Three phases hitting the same wall is the signal that
  the wall is the next thing to remove. Nothing ships worse for its absence
  today, and the document says so plainly.
- **104 third** because it is language completeness for a printed view of a
  source format nobody hand-authors. Real, and the least urgent of the three.

One argument for a different order was considered and rejected. Phase 104 is the
only one of the three with no dependency on anything and the lowest risk of
discovering something mid-execution, which makes it tempting to take first as a
warm-up. That is scheduling by convenience, and it would leave a broken
production deployment standing for two more phases.

Two candidates surfaced here and were not taken:

- **A startup privilege preflight in the authority.** Have the process, under
  the advisory lock it already takes, probe its own DML privileges and refuse
  with a named `/readyz` reason instead of failing on its first real query. It
  would turn a runtime error into a deployment-time one. It is server behaviour
  rather than a deployment fix, and folding it in here would give this phase two
  subjects. Worth its own small phase after 104.
- **`ADL_TEST_DATABASE_URL` capability requirements.** The new test needs
  `CREATE DATABASE` and `CREATE ROLE`, which the Docker path has and an external
  CI Postgres service may not. This phase makes the test fail loudly rather than
  skip. If a real CI ever hits it, the answer is to grant the capability, not to
  soften the test.

---

# Execution Note (2026-08-21)

## Evidence points that had drifted

Two, both cosmetic, neither changing the phase's scope:

- **Every runbook line number in this document is stale.** Phase 99 inserted
  content above the section: "Database roles and migrations" is at line 580, not
  487, and the restore drill's `adl_migrator` step is at 1059, not 966. Both
  sections were found by content and both said what the document quoted.
- **The integration baseline is 169, not 163.** Phases 99–101 landed between the
  document being written and executed. The suite is now 180 (18 files) with this
  phase's 11 new cases.

Everything else held exactly. `roles.sql:18-19` were verbatim as quoted, no
migration file contains a `grant`, no migration creates a sequence, no server
module emits DDL or `TRUNCATE`, `0008` still drops and re-creates
`adl_authority_context_memberships`, and `pg-harness.ts:6` still said
"deployment-only and intentionally skipped".

## The three measured facts, reproduced independently

Against `postgres:16-alpine` (PostgreSQL 16.14 on x86_64-pc-linux-musl), in a
throwaway container, with a **non-superuser `CREATEROLE` database owner** —
which is who the runbook names, and the distinction that decides the fix.

### 1. The pre-change procedure produces a broken deployment

```
$ psql "$OWNER" -v authority_db=adl_repro -f src/server/migrations/roles.sql
DO / DO / GRANT / GRANT / GRANT / GRANT / ALTER DEFAULT PRIVILEGES / REVOKE / REVOKE
$ for f in src/server/migrations/000*.sql; do psql "$MIGRATOR" -f "$f"; done
$ psql "$SU" -d adl_repro -Atc "select tablename, tableowner from pg_tables where schemaname='public'"
adl_authority_access_audit_events|adl_migrator
…                                   (all 14 tables)
adl_authority_models|adl_migrator
$ psql "$AUTHORITY" -Atc "select 1 from adl_authority_models limit 1"
ERROR:  permission denied for table adl_authority_models
$ psql "$AUTHORITY" -Atc "insert into adl_authority_models …"
ERROR:  permission denied for table adl_authority_models
```

Both of `roles.sql`'s grants *succeeded*. They simply covered nothing.

### 2. `ALTER DEFAULT PRIVILEGES FOR ROLE` is not available to that owner

```
$ psql "$OWNER" -Atc "alter default privileges for role adl_migrator in schema public grant select, insert, update, delete on tables to adl_authority"
ERROR:  permission denied to change default privileges
$ psql "$OWNER" -Atc "set role adl_migrator"
ERROR:  permission denied to set role "adl_migrator"
$ psql "$SU" -Atc "select r.rolname as member_of, m.rolname as member, a.admin_option, a.inherit_option, a.set_option from pg_auth_members a …"
adl_migrator|adl_owner|t|f|f
adl_authority|adl_owner|t|f|f
$ psql "$SU" -d adl_repro -Atc "alter default privileges for role adl_migrator …"
ALTER DEFAULT PRIVILEGES
```

The rejected alternative works only for a superuser. `inherit_option = f` and
`set_option = f` are why, and they are PostgreSQL 16's default for a
`CREATEROLE` creator's auto-granted membership.

### 3. The fixed procedure works and stays least-privilege

`roles.sql` as owner → `grants.sql` as `adl_migrator` → `0001…0009` as
`adl_migrator`:

```
insert/select/update/delete on adl_authority_models   INSERT 0 1 / 1 / UPDATE 1 / DELETE 1
select on adl_authority_context_memberships (0008)    0
table created by adl_migrator AFTER grants.sql        INSERT 0 1 / 1
create table  as adl_authority   ERROR:  permission denied for schema public
truncate      as adl_authority   ERROR:  permission denied for table adl_authority_records
alter table   as adl_authority   ERROR:  must be owner of table adl_authority_records
re-running grants.sql            ALTER DEFAULT PRIVILEGES / GRANT   (clean no-op)
```

## The test was seen red first

`tests/integration/authority-role-grants.test.ts` was written and run against
the pre-change `roles.sql` (restored from `HEAD`) with `grants.sql` reduced to a
comment. **7 failed | 4 passed (11).** The recorded messages:

```
× round-trips real rows, including the table 0008 drops and re-creates
  error: permission denied for table adl_authority_models
× covers a table adl_migrator creates after grants.sql ran
  error: permission denied for table adl_role_grants_later
× accepts a real AuthorityService write over the adl_authority connection
  error: permission denied for table adl_authority_models
```

The four that passed are the two ownership assertions and the two refusal
assertions — correctly, since an ungranted role is refused DDL too. That is the
right shape: the refusals must not be the thing that turns red.

**One defect in the test itself was found by the red run and fixed.** The
"every projection table" case first failed with
`adl_authority_retention_runs should exist with at least one column: expected
undefined to be type of 'string'` rather than `permission denied`, because
`information_schema.columns` hides columns the *querying* role holds no
privilege on. Reading the table shapes over the admin connection instead makes
the DML statement the thing that fails, with the message an operator would
actually see. A test whose red message misnames the defect is a worse test.

## Mutation check: the two statements are distinguishable

| `grants.sql` with | Result |
|---|---|
| both statements | 11 passed |
| `alter default privileges` removed | **5 failed**: the whole "before" block, plus the "after" block's created-afterwards case |
| `grant … on all tables` removed | **2 failed**: only the "after" block's whole-table DML and real round trip |

Different, specific, non-overlapping failure sets. Neither statement is
redundant with the other.

## Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run format:check` | clean |
| `npx vitest run` | **64 files / 1,213 tests passed** (1,212 baseline + 1 hermetic guard) |
| `npm run test:integration` | **18 files / 180 tests passed** (169 baseline + 11 new) |
| `scripts/dev/postgres.sh up` / `migrate`, isolated container | both clean; `adl_authority` wrote immediately after `up`, and `migrate` re-ran `grants.sql` as a no-op |

`npm run verify:push` was not run and is not implicated: nothing in this phase
touches browser rendering, shell chrome, reference-app screens, presentation
output or CSS.

## One addition beyond the stated scope

`tests/production-operations.test.ts` gained a second case: `roles.sql` carries
no `grant select` and no `alter default privileges`, and `grants.sql` carries
both. It is a three-second hermetic guard that the two files do not drift back
together, sitting beside the existing least-privilege assertions in the same
file. It was seen red against the pre-change `roles.sql`
(`expected '-- Run as the database owner, with ps…' not to match
/^\s*grant select/mu`). This is the only file touched that the phase document's
Scope section does not name.

## Deliberately not done

- **No startup privilege preflight.** Named as a non-goal and left there.
- **No `on sequences` default privilege.** No migration creates a sequence;
  adding one speculatively would be an unverified grant.
- **`grants.sql` was not added to `MIGRATION_FILES`.** The shared harness
  database has no `adl_authority` role, so it would fail there. `pg-harness.ts`
  now says which test does exercise the split instead.
- **The `roles.sql` password lines stay commented out.** Out of scope, and the
  new test sets both passwords explicitly, exactly as `scripts/dev/postgres.sh`
  does.

---

# Planning Handoff (written after execution)

**Next phase: Phase 103 — a policy operand for "this record is mine".** The
ordering in the Planning Handoff above is recommended unchanged: 103, then 104.
Executing 102 produced no evidence against it. 102 was the only live production
defect of the three, and it is now closed.

Repository-wide, one unplanned gap outranks Phase 104 and possibly Phase 103,
and is recorded here rather than acted on:

- **An authority-minted identity has no `User` object record.** Registration
  creates an identity and an identity link, but nothing writes the `User` row
  the model's own lookups read, so `LOOKUP User DISPLAY Name` degrades to a raw
  `user-…` id for every registered person. This is user-visible on every screen
  that names a person, in both reference apps, and it is the same *class* of
  defect Phase 93 and Phase 101 each attacked from the policy side — those
  phases made the label *permitted*; nothing makes the label *exist*. It is a
  stronger candidate than Phase 104 (printer completeness for a format nobody
  hand-authors) and arguably than Phase 103, which is enabling rather than
  broken. It needs its own document; it is not a variation of 103 or 104.

Two candidates surfaced by this execution, neither taken:

- **A startup privilege preflight in the authority.** Unchanged from the
  document's own handoff: under the advisory lock it already takes, probe the
  DML privileges and refuse with a named `/readyz` reason rather than failing on
  the first real query. This phase makes the *deployment* correct; the preflight
  would make a *mis*-deployment diagnose itself. Small, self-contained, and
  worth a phase after 104. It is now cheaper than when the document was written,
  because `authority-role-grants.test.ts` can provision an ungranted database in
  four lines to test the refusal against.
- **Nothing pins `MIGRATION_FILES` to `scripts/dev/postgres.sh`'s own list.**
  The script's comment says "keep in step with `tests/integration/pg-harness.ts`",
  and that is the whole enforcement. A tenth migration added to one and not the
  other is silent, and the failure surfaces only on a laptop that happens to run
  `migrate`. A three-line hermetic test comparing the two lists would close it.
  Too small for a phase; fold it into whichever phase next touches either file.
