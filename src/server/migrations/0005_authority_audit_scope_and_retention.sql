-- Phase 45: authority audit scope and retention.
--
-- Phase 44 turned adl_authority_audit_events into a populated transactional
-- projection. Two follow-on gaps are addressed here, both as persistence
-- concerns only; the TypeScript runtime remains the semantic authority and the
-- per-row runtime read stays the final disclosure boundary for review.
--
-- 1. Context scope for runtime-audit review. A record's business context is its
--    declared scope-field value (ResolvedObject.scope). The unit-of-work now
--    stamps that (context_name, context_id) onto each audit row so a context
--    administrator's review is filtered and bounded in SQL for exactly one
--    authorised context, instead of reading the whole application and relying
--    only on a post-filter. Unscoped (global) objects leave both columns null
--    and therefore never appear in any per-context review.
--
-- 2. Application scope + retention for outcomes. Operation outcomes were keyed
--    only by (operation_id, actor_id) and were not application-scoped, so they
--    could not be counted, verified, or pruned per application. They now carry
--    application_id. Retention/pruning (adl_authority_audit_events and
--    adl_authority_operation_outcomes) is documented in
--    docs/operations/authority-production-runbook.md: it deletes only rows older
--    than the minimum retention window, never accepted records, and never runs
--    under legal hold.

alter table adl_authority_audit_events
  add column if not exists context_name text;
alter table adl_authority_audit_events
  add column if not exists context_id text;

-- Context-bounded, most-recent-first runtime-audit review for one context.
create index if not exists adl_authority_audit_context_idx
  on adl_authority_audit_events(application_id, context_name, context_id, occurred_at desc);

-- Bind outcomes to their application so they can be scoped, integrity-checked,
-- and pruned. Legacy pre-Phase-45 rows keep a null application_id and are
-- treated as unscoped legacy state by integrity verification.
alter table adl_authority_operation_outcomes
  add column if not exists application_id text;

-- Supports application-scoped retention/pruning by age.
create index if not exists adl_authority_operation_outcomes_app_idx
  on adl_authority_operation_outcomes(application_id, accepted_at);

-- Supports application-scoped runtime-audit retention/pruning by age.
create index if not exists adl_authority_audit_retention_idx
  on adl_authority_audit_events(application_id, occurred_at);
