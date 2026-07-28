-- Phase 44: authority projection transactional integrity.
--
-- Phase 39 defined adl_authority_audit_events but nothing wrote to it. The
-- Phase 44 unit-of-work now persists the runtime audit projection inside the
-- same transaction as the accepted record and the actor-bound outcome. This
-- index supports the bounded, most-recent-first runtime-audit review that the
-- administration service performs, without exposing a general query surface.
--
-- Transactional projection set committed together per accepted replay:
--   adl_authority_records            (accepted state)
--   adl_authority_audit_events       (runtime audit)
--   adl_authority_operation_outcomes (actor-bound idempotent outcome)
-- Invite claim/revocation and membership revocation each commit their record or
-- invite change together with their adl_authority_access_audit_events entry.
-- Report/export/administration review reads only these committed projections;
-- adl_authority_administration_audit_events remains a metadata-only sink.

create index if not exists adl_authority_audit_application_idx
  on adl_authority_audit_events(application_id, occurred_at desc);
