# Authoritative Reporting and Administration

Phase 43 adds server-only reporting and administration without extending ADL
syntax or creating a second policy engine.

- `AuthorityReportingService` executes a named resolved read model through
  `ApplicationRuntime`. It accepts no SQL, object name, requested field list,
  arbitrary filter, or raw projection. Runtime context scope, read policy, and
  field masking shape rows before pagination.
- Reporting is deliberately bounded: 100 rows per page, 500 report rows, 100
  CSV export rows. Cursors are short-lived opaque in-process state bound to the
  authenticated actor and report name. A forged, expired, or other-actor cursor
  produces an empty report rather than an oracle.
- CSV export requires normal `export` policy for every actual source record,
  because a context role cannot safely be evaluated without a scoped record.
  Export fields come solely from the read-model declaration and retain runtime
  read masking.
- `AuthorityAdministrationService` requires the existing ADL `update` policy
  on the selected context membership object. This is deployment/runtime wiring,
  not a new operational role or ADL construct. It exposes bounded status DTOs
  for audit/access-audit, memberships, invites, and recovery only. Review
  lists use the same bounded actor-bound cursor posture as reports; raw audit
  payloads, record values, session/invite verifiers, and replay outcomes never
  leave the server.
- Context managers may revoke a user's sessions only if that user currently
  has active membership in the same managed context. The action uses the
  existing opaque-session revocation capability and emits access audit.
- `0003_reporting_administration.sql` adds a metadata-only administration
  audit projection and context indexes. It must be included in backup, restore,
  and legal-retention procedures.

Practical guidance: add new reporting behavior through resolved read models and
runtime policy shaping first. Do not add a generic query language, customer SQL,
or browser-stored operational credentials. Keep any administrative response
small, context-bound, server-authorised, rate-limited, and audit-recorded.
