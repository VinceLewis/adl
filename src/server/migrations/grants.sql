-- Grant the traffic role DML over the projection tables.
--
-- Run as adl_migrator, in the authority database, after roles.sql. It needs no
-- superuser and no role membership: a role may always alter its own default
-- privileges and may always grant on tables it owns, and adl_migrator owns
-- every table the ordered migrations create.
--
-- It is idempotent and may be applied either before or after the ordered
-- migrations. Applied before, the default privileges cover every table the
-- migrations then create. Applied after, the catch-up grant covers the tables
-- that already exist and the default privileges cover the next migration hop.
--
-- Do NOT put these statements in roles.sql. That file is run by the database
-- owner, and `alter default privileges` without `for role` covers only the
-- objects the executing role creates -- which is not adl_migrator. Writing
-- `alter default privileges for role adl_migrator` there does not fix it
-- either: a non-superuser database owner with CREATEROLE, which is exactly who
-- the runbook names, is refused with `permission denied to change default
-- privileges` (PostgreSQL 16 auto-grants the creator membership in the roles it
-- creates, but with inherit_option = f and set_option = f).
\set ON_ERROR_STOP on

alter default privileges in schema public
  grant select, insert, update, delete on tables to adl_authority;
grant select, insert, update, delete on all tables in schema public to adl_authority;
