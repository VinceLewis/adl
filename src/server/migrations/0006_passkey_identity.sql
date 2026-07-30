-- Phase 49: passkey identity and provider-independent identity keying.
--
-- Two changes, both persistence-only. The TypeScript runtime remains the
-- semantic authority and ADL model syntax never refers to these tables.
--
-- 1. Identity keying. adl_authority_identities carried a single `subject` with
--    `unique (application_id, subject)`, so the identity was keyed 1:1 on one
--    provider's subject string. Changing provider changed the subject, missed
--    the lookup, minted a new user id, and orphaned every membership record.
--    The subject moves into adl_authority_identity_links as
--    `(provider, subject) -> user_id`, so one identity may hold several
--    external identifiers and gain new ones without re-keying anything. Phase
--    48 established that no deployment holds data, which is what makes this
--    change free; any pre-existing row is still backfilled under the 'legacy'
--    provider rather than dropped.
--
-- 2. WebAuthn credential and challenge storage. Public keys and credential ids
--    are not secrets and are stored here. No private key, raw assertion, or
--    attestation object is ever persisted. The challenge value must be stored
--    to be verified against the assertion that answers it, so it lives in its
--    own single-use, short-lived table and never enters accepted records,
--    audit events, operation outcomes, sync payloads, or logs.

create table if not exists adl_authority_identity_links (
  application_id text not null,
  provider text not null,
  subject text not null,
  user_id text not null,
  linked_at timestamptz not null,
  primary key (application_id, provider, subject),
  foreign key (application_id, user_id) references adl_authority_identities(application_id, user_id)
);

create index if not exists adl_authority_identity_links_user_idx
  on adl_authority_identity_links(application_id, user_id);

-- Backfill and retire the single-subject column. Guarded on the column still
-- existing so re-applying the migration is a no-op rather than an error.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_name = 'adl_authority_identities'
       and column_name = 'subject'
  ) then
    insert into adl_authority_identity_links (application_id, provider, subject, user_id, linked_at)
    select application_id, 'legacy', subject, user_id, created_at
      from adl_authority_identities
    on conflict (application_id, provider, subject) do nothing;

    alter table adl_authority_identities
      drop constraint if exists adl_authority_identities_application_id_subject_key;
    alter table adl_authority_identities drop column subject;
  end if;
end $$;

-- Registered authenticators. `public_key` is a base64url COSE public key and is
-- not a secret; `signature_counter` is the authenticator's own counter and is
-- checked on every assertion so a cloned authenticator is detectable.
create table if not exists adl_authority_webauthn_credentials (
  application_id text not null,
  credential_id text not null,
  user_id text not null,
  public_key text not null,
  signature_counter bigint not null default 0,
  transports text,
  backed_up boolean not null default false,
  created_at timestamptz not null,
  last_used_at timestamptz,
  primary key (application_id, credential_id),
  foreign key (application_id, user_id) references adl_authority_identities(application_id, user_id)
);

create index if not exists adl_authority_webauthn_credentials_user_idx
  on adl_authority_webauthn_credentials(application_id, user_id);

-- Server-issued ceremony challenges. Single-use (`consumed_at` is set under a
-- row lock), short-lived (`expires_at`), and bound to the ceremony they were
-- issued for. A client-chosen or replayed challenge therefore cannot be used.
create table if not exists adl_authority_webauthn_challenges (
  challenge_id text primary key,
  application_id text not null references adl_authority_models(application_id),
  ceremony text not null,
  challenge text not null,
  user_id text,
  user_handle text,
  invite_token_hash text,
  invite_recipient_user_id text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists adl_authority_webauthn_challenges_expiry_idx
  on adl_authority_webauthn_challenges(expires_at);
