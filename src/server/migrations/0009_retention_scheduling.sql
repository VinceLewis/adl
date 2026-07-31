-- Phase 55: retention run log.
--
-- Metadata only, by construction. There is no column here that could hold an
-- accepted record, an audit payload, a session token or verifier, an invite
-- token, or an outcome body: every column is a count, an instant, a boolean, or
-- a short reduced fault name. It is safe to return from an operator status
-- surface and safe to include in a support bundle.
--
-- It is also self-limiting. `PostgresAuthorityRetentionRunStore.record` trims
-- each application's history to the most recent AUTHORITY_RETENTION_RUN_HISTORY
-- rows in the same transaction as the run it writes, so the table that exists to
-- prove retention happened does not itself become something needing retention.
--
-- Include it in backup, restore and legal-retention procedures alongside the
-- other authority projections.

create table if not exists adl_authority_retention_runs (
  run_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  -- 'completed' | 'dryRun' | 'held' | 'failed'
  outcome text not null,
  dry_run boolean not null default false,
  held boolean not null default false,
  effective_cutoff timestamptz,
  pruned_runtime_audit integer not null default 0,
  pruned_outcomes integer not null default 0,
  pruned_sessions integer not null default 0,
  pruned_challenges integer not null default 0,
  -- A reduced fault name such as 'Error 42P01'. Never a driver message: those
  -- can name hosts, roles and statement text.
  failure_code text
);

create index if not exists adl_authority_retention_runs_recent_idx
  on adl_authority_retention_runs(application_id, finished_at desc, run_id desc);

-- The session prune reads a terminated-session predicate rather than expires_at
-- alone, so it needs its own index; the Phase 42 retention index on
-- (application_id, expires_at, revoked_at) covers the columns but not the
-- expression. A partial index over already-revoked rows keeps the common case
-- (rotation debris) cheap without indexing every live session twice.
create index if not exists adl_authority_sessions_revoked_idx
  on adl_authority_sessions(application_id, revoked_at)
  where revoked_at is not null;

create index if not exists adl_authority_webauthn_challenges_consumed_idx
  on adl_authority_webauthn_challenges(application_id, expires_at);
