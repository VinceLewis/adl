-- PostgreSQL accepted-state projection for Phase 39.  ADL model syntax never refers to these tables.
create table if not exists adl_authority_models (
  application_id text primary key,
  model_version text not null,
  resolved_model jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists adl_authority_records (
  application_id text not null references adl_authority_models(application_id),
  object_name text not null,
  record_id text not null,
  revision text not null,
  deleted_at timestamptz,
  record jsonb not null,
  primary key (application_id, object_name, record_id)
);

create table if not exists adl_authority_context_memberships (
  application_id text not null,
  context_name text not null,
  context_id text not null,
  user_id text not null,
  role text not null,
  membership_record_id text not null,
  primary key (application_id, context_name, context_id, user_id, role),
  foreign key (application_id) references adl_authority_models(application_id)
);

create table if not exists adl_authority_operation_outcomes (
  operation_id text primary key,
  outcome jsonb not null,
  accepted_at timestamptz not null default now()
);

create table if not exists adl_authority_audit_events (
  audit_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  event jsonb not null,
  occurred_at timestamptz not null
);

create index if not exists adl_authority_records_object_idx on adl_authority_records(application_id, object_name);
create index if not exists adl_authority_membership_user_idx on adl_authority_context_memberships(application_id, user_id, context_name);

-- Phase 41 identity and access lifecycle. Tokens are stored only as SHA-256
-- verifiers; raw session and invite tokens must never enter this projection.
create table if not exists adl_authority_identities (
  application_id text not null references adl_authority_models(application_id),
  user_id text not null,
  subject text not null,
  created_at timestamptz not null,
  disabled_at timestamptz,
  primary key (application_id, user_id),
  unique (application_id, subject)
);

create table if not exists adl_authority_sessions (
  session_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  user_id text not null,
  token_hash text not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_to_session_id text,
  foreign key (application_id, user_id) references adl_authority_identities(application_id, user_id)
);

create table if not exists adl_authority_invites (
  invite_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  token_hash text not null unique,
  context_name text not null,
  context_id text not null,
  role text not null,
  recipient_user_id text,
  created_by text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_by text,
  claimed_at timestamptz,
  membership_record_id text,
  revoked_at timestamptz
);

create table if not exists adl_authority_access_audit_events (
  access_audit_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  event jsonb not null,
  occurred_at timestamptz not null
);

create index if not exists adl_authority_sessions_user_idx on adl_authority_sessions(application_id, user_id);
create index if not exists adl_authority_invites_context_idx on adl_authority_invites(application_id, context_name, context_id);
