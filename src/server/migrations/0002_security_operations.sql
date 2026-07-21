-- Phase 42: bind durable replay outcomes to their authenticated actor. Existing
-- pre-Phase-42 rows are deliberately not replayable by a browser session.
alter table adl_authority_operation_outcomes
  add column if not exists actor_id text not null default 'legacy-unscoped';

alter table adl_authority_operation_outcomes
  drop constraint if exists adl_authority_operation_outcomes_pkey;
alter table adl_authority_operation_outcomes
  add primary key (operation_id, actor_id);

create index if not exists adl_authority_operation_outcomes_actor_idx
  on adl_authority_operation_outcomes(actor_id, accepted_at);

-- Retention jobs may remove expired/revoked session and invite verifiers after
-- the retention interval documented in docs/operations/authority-production-runbook.md.
create index if not exists adl_authority_sessions_retention_idx
  on adl_authority_sessions(application_id, expires_at, revoked_at);
create index if not exists adl_authority_invites_retention_idx
  on adl_authority_invites(application_id, expires_at, revoked_at, claimed_at);
