-- Phase 43: server-only administration audit. Report and operational-review
-- payloads are deliberately metadata-only; accepted records and credentials
-- remain in their existing projections and are never copied here.
create table if not exists adl_authority_administration_audit_events (
  event_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  event jsonb not null,
  occurred_at timestamptz not null
);

create index if not exists adl_authority_administration_audit_application_idx
  on adl_authority_administration_audit_events(application_id, occurred_at desc);

-- These expression indexes support context-bounded review without exposing a
-- general JSON/SQL query surface to callers.
create index if not exists adl_authority_access_audit_context_idx
  on adl_authority_access_audit_events(
    application_id,
    (event->>'contextName'),
    (event->>'contextId'),
    occurred_at desc
  );
