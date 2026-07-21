-- Run as the database owner, with psql variables supplied by the deployment.
-- Example: psql -v authority_db=adl -v migrator_password=... -v authority_password=... -f roles.sql
-- Never run this file using the authority traffic account.
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
grant select, insert, update, delete on all tables in schema public to adl_authority;
alter default privileges in schema public grant select, insert, update, delete on tables to adl_authority;
revoke create on schema public from adl_authority;
revoke create on database :"authority_db" from adl_authority;

-- Apply generated passwords through the deployment secret manager, not source control:
-- alter role adl_migrator password :'migrator_password';
-- alter role adl_authority password :'authority_password';
