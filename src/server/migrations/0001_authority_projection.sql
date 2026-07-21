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
