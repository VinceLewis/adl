-- Phase 54: context membership projection.
--
-- adl_authority_context_memberships has existed since Phase 39 but has never had
-- a writer, so every membership resolution, access check and membership review
-- instead loaded the whole accepted-record set into memory and filtered it
-- there. Phase 54 gives it a writer and makes those four reads scope-indexed.
--
-- Its original shape cannot support that, so it is re-created here rather than
-- altered. Three problems, all consequences of never having been written:
--
-- 1. The primary key was (application_id, context_name, context_id, user_id,
--    role). Two accepted membership records with the same user/context/role
--    would collide on one row, so "every accepted membership record has exactly
--    one projection row" could not be verified in either direction. The key is
--    now the membership record id, which is what a projection row actually
--    stands for.
-- 2. There was no index for a context-scoped read, only a user-scoped one, so
--    the bounded membership review page this phase adds had nothing to use.
-- 3. There was no object_name, so a projection row could not be joined back to
--    adl_authority_records (keyed on (application_id, object_name, record_id))
--    without assuming record ids are unique across objects.
--
-- Dropping it is safe and loses nothing: it has never held a row in any
-- deployment (Phase 47 confirmed it stayed empty after a real invite claim, and
-- Phase 48 confirmed no deployment exists), and the authority backfills the
-- projection from accepted records at startup regardless.
--
-- This stays a derived read model. The accepted membership record remains
-- authoritative, the projection only narrows candidates, and the per-row runtime
-- read and policy remain the disclosure boundary — the same division Phase 45
-- established for runtime-audit context scope.

drop table if exists adl_authority_context_memberships;

create table adl_authority_context_memberships (
  application_id text not null references adl_authority_models(application_id),
  -- One row per accepted membership record, live or tombstoned.
  membership_record_id text not null,
  -- The declared membership object, so a row joins exactly to its record.
  object_name text not null,
  context_name text not null,
  context_id text not null,
  user_id text not null,
  role text not null,
  -- Mirrors the record's tombstone. Revoked rows are retained because
  -- membership review reports revoked memberships as well as active ones;
  -- resolution and access checks read only rows where this is null.
  revoked_at timestamptz,
  primary key (application_id, membership_record_id)
);

-- Membership resolution and access checks: one user within one business context.
create index if not exists adl_authority_membership_user_idx
  on adl_authority_context_memberships(application_id, context_name, user_id);

-- Bounded membership review: one context instance.
create index if not exists adl_authority_membership_context_idx
  on adl_authority_context_memberships(application_id, context_name, context_id);
