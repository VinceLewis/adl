-- Run as the database owner, with psql variables supplied by the deployment.
-- Example: psql -v authority_db=adl -v migrator_password=... -v authority_password=... -f roles.sql
-- Never run this file using the authority traffic account.
--
-- This file carries only what the database owner can do: create the two roles,
-- and grant connect/usage. The traffic role's DML over the projection tables
-- is granted by grants.sql, which must be run as adl_migrator -- the role that
-- owns every table the ordered migrations create. See grants.sql for why it
-- cannot live here.
\set ON_ERROR_STOP on

do $$ begin
  create role adl_migrator login noinherit;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role adl_authority login noinherit;
exception when duplicate_object then null;
end $$;

grant connect on database :"authority_db" to adl_migrator, adl_authority;
grant usage, create on schema public to adl_migrator;
grant usage on schema public to adl_authority;
revoke create on schema public from adl_authority;
revoke create on database :"authority_db" from adl_authority;

-- Apply generated passwords through the deployment secret manager, not source control:
-- alter role adl_migrator password :'migrator_password';
-- alter role adl_authority password :'authority_password';
