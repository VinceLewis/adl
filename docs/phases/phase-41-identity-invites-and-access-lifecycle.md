# Phase 41 - Identity, Invites, and Access Lifecycle

## Status

Placeholder. Phase 40 must replace this file with a complete executable phase
document before Phase 40 closes. Do not begin this phase from the placeholder.

## Intended Objective

Complete the first online identity and access lifecycle around the established
authority boundary: account/session management appropriate to the selected auth
adapter, server-authoritative invite claim, and safe membership/access changes.

## Intended Scope

- The minimum account and session lifecycle required by the provider/adapter
  selected in Phase 39.
- Online-only invite claim/provisioning and transactional membership grants.
- Session expiry, sign-out, cached-session/offline behavior, and access
  revocation implications for local datasets.
- Clear separation between authentication identity and ADL business contexts,
  memberships, and roles.

## Explicit Deferrals

Do not turn ADL into an identity-provider product or assume password recovery,
passkeys, social login, email delivery, operations hardening, or reporting are
in scope unless preceding evidence makes one indispensable.

## Mandatory Planning Handoff

Before closing Phase 41, replace the Phase 42 placeholder with a complete,
evidence-based executable phase document. Use the implemented identity,
invitation, session, and revocation behavior to identify concrete production
security and operational requirements, acceptance criteria, tests,
verification, and non-goals. Update Phase 43 if dependencies change.
