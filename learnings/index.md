# ADL Learnings Index

This folder records reusable knowledge discovered while building ADL. Use it to avoid relearning project-specific constraints, decisions, and implementation details.

## How to Use This Index

Before any phase, read:

- `project/repository-boundaries.md`
- `process/phase-execution.md`
- `process/testing-expectations.md`

Before tasks that inspect or compare old MINIL, also read:

- `project/repository-boundaries.md`
- `minil/repository-audit.md`

Before tasks that design the ADL resolved model, parser, validator, lifecycle, policy, or runtime test concepts based on old MINIL prior art, also read:

- `minil/repository-audit.md`

Before tasks that change resolved model defaults, model validation, policy evaluation, object constraints, commands, storage metadata, or runtime record handling, also read:

- `architecture/resolved-model-defaults.md`
- `implementation/model-validator.md`
- `implementation/offline-session-lifetime.md`
- `implementation/policy-engine.md`
- `implementation/runtime-services.md`
- `implementation/expression-language.md`
- `implementation/computed-fields-and-read-model-expressions.md`
- `implementation/conformance-suite.md`

Before tasks that change business context/scope modelling, context-scoped roles, relationship-aware policies, cross-context views, read models, sync dataset design, or backend persistence assumptions, also read:

- `implementation/context-grants-and-relationship-access.md`
- `architecture/business-contexts-and-backends.md`
- `architecture/target-architecture.md`
- `implementation/business-context-model.md`
- `implementation/context-runtime.md`
- `implementation/context-ui-navigation.md`
- `implementation/read-model-runtime.md`
- `implementation/computed-fields-and-read-model-expressions.md`
- `implementation/offline-dataset-runtime.md`

Before tasks that change runtime stack choices, server authority, sync transport, auth provider direction, packaging, or architecture phase sequencing, also read:

- `architecture/target-architecture.md`
- `implementation/authority-server.md`
- `implementation/authority-transaction-integrity.md`
- `implementation/first-deployment-slice.md`
- `implementation/passkey-identity.md`

Before tasks that change the authority entrypoint or its deployment configuration, the identity verification switch, identity keying or identity links, WebAuthn ceremonies, invites, membership grants/revocation or access audit, the browser authority transport, session-derived browser identity, or bootstrap paging, also read:

- `implementation/first-deployment-slice.md`
- `implementation/passkey-identity.md`
- `implementation/offline-session-lifetime.md`
- `implementation/production-authority-operations.md`
- `implementation/identity-invites-and-access-lifecycle.md`
- `implementation/remote-bootstrap-and-sync-state.md`

Before tasks that change the create intent contract, the authority's create path, record id minting or validation, or anything that decides which side of the sync loop names a record, also read:

- `implementation/offline-operation-identity.md`
- `implementation/usable-sync-slice.md`
- `implementation/authority-server.md`

Before tasks that change client conflict/rejection recovery, the browser authority bridge, sign-in, passkey registration or invite-claim UI, the local demo identity constant, or the service worker, web app manifest and offline shell, also read:

- `implementation/usable-sync-slice.md`
- `implementation/passkey-identity.md`
- `implementation/offline-session-lifetime.md`
- `implementation/offline-operation-identity.md`
- `implementation/first-deployment-slice.md`
- `implementation/sync-policy.md`
- `implementation/sync-mode-delivery.md`
- `implementation/remote-bootstrap-and-sync-state.md`
- `implementation/model-versioning-guard.md`

Before tasks that change authority replay persistence, the accepted-record/runtime-audit/outcome commit boundary, access-lifecycle audit atomicity, authority restore/integrity verification, runtime-audit context scoping, or audit/outcome retention, also read:

- `implementation/authority-transaction-integrity.md`
- `implementation/authority-server.md`
- `implementation/membership-projection.md`
- `implementation/retention-scheduling-and-administration-ui.md`

Before tasks that change retention windows, the retention runner, scheduler or
CLI entry point, that add an operator-triggerable administrative action, or that
change the browser administration and reporting surfaces, also read:

- `implementation/retention-scheduling-and-administration-ui.md`
- `implementation/authoritative-reporting-and-administration.md`
- `implementation/authority-transaction-integrity.md`
- `implementation/membership-projection.md`
- `implementation/production-authority-operations.md`
- `process/visual-browser-verification.md`

Before tasks that change how membership records are written, resolved, reviewed
or revoked, that add a scope-indexed read model over accepted records, or that
touch `adl_authority_context_memberships`, `ContextMembershipIndex`, or the
authority's startup advisory lock, also read:

- `implementation/context-grants-and-relationship-access.md`
- `implementation/membership-projection.md`
- `implementation/authority-transaction-integrity.md`
- `implementation/identity-invites-and-access-lifecycle.md`
- `implementation/context-runtime.md`

Before tasks that integrate compile-time validation, runtime model startup checks, or parser-to-model validation, also read:

- `implementation/model-validator.md`

Before tasks that change ADL lexer/parser syntax, AST conversion, `compileAdl`, parser examples, or parsed policy/theme behaviour, also read:

- `implementation/adl-parser.md`
- `implementation/expression-language.md`

Before tasks that change runtime services, model-declared commands, UI runtime integration, lifecycle execution, audit, operation log handling, sync policy enforcement, or runtime tests, also read:

- `implementation/runtime-services.md`
- `implementation/context-runtime.md`
- `implementation/policy-engine.md`
- `implementation/expression-language.md`
- `implementation/sync-policy.md`
- `implementation/sync-mode-delivery.md`
- `implementation/offline-dataset-runtime.md`
- `implementation/conformance-suite.md`

Before tasks that change runtime semantics, resolved-model defaults, policy decision behavior, inspection/explain output, or conformance cases, also read:

- `implementation/conformance-suite.md`

Before tasks that change runtime persistence, object storage backends, browser demo seeding, sync replay storage, or persisted record tests, also read:

- `implementation/storage-backend.md`
- `implementation/model-versioning-guard.md`
- `implementation/sync-policy.md`

Before tasks that change runtime startup compatibility checks, persisted application metadata, object schema version guards, or migration handling, also read:

- `implementation/model-versioning-guard.md`
- `implementation/model-versions-and-migrations.md`

Before tasks that change model version declaration or derivation, the model fingerprint, `MIGRATION` syntax, migration planning or execution, or anything that decides whether persisted data may be read, also read:

- `implementation/model-versions-and-migrations.md`
- `implementation/model-versioning-guard.md`
- `implementation/conformance-suite.md`
- `implementation/offline-session-lifetime.md`

Before tasks that change browser UI runtime components, browser demo fixtures, UI policy or sync presentation, or browser verification, also read:

- `implementation/browser-ui-runtime.md`
- `process/visual-browser-verification.md`
- `implementation/context-ui-navigation.md`
- `implementation/shell-navigation.md`
- `implementation/read-model-runtime.md`
- `implementation/policy-engine.md`
- `implementation/sync-policy.md`

Before tasks that change composed UI presentation declarations, presentation
resolved-model defaults, UI syntax for composed views, presentation validation,
or presentation renderer behavior, also read:

- `implementation/ui-presentation-model.md`
- `implementation/semantic-status-presentation.md`
- `implementation/presentation-matrix-runtime.md`
- `implementation/calendar-presentation-runtime.md`

Before tasks that change shell navigation metadata, drawer rendering, top-bar
controls, or mobile business-context selectors, also read:

- `implementation/shell-navigation.md`

Before tasks that add or change ADL reference applications, model-driven demo fixtures, or follow-up platform gaps discovered by a reference app, also read:

- `implementation/reference-app-models.md`

Before tasks that change resolved theme tokens, theme resolution, UI CSS custom properties, or parser support for `THEME`, also read:

- `implementation/theme-system.md`
- `implementation/semantic-status-presentation.md`

Before tasks that change the phase plan, also read:

- `process/phase-execution.md`

Before tasks that add or modify code, also read:

- `process/testing-expectations.md`

## Where to Add New Learnings

Add new documents under the most relevant subfolder:

- `architecture/` for durable architecture decisions and model/runtime concepts
- `implementation/` for codebase-specific implementation notes
- `minil/` for findings from the old MINIL reference repository
- `process/` for workflow, phase execution, testing, and review practices
- `project/` for repository boundaries, setup, and project-level facts

When adding a new learning document, update this index with when future agents should read it.

## Current Learning Documents

- `project/repository-boundaries.md`: read before any task that touches paths, setup, repository structure, or MINIL.
- `process/phase-execution.md`: read before executing a phase or updating phase documents.
- `process/testing-expectations.md`: read before code implementation or verification work.
- `process/visual-browser-verification.md`: read before changing browser UI rendering, CSS, shell chrome, reference app screens, or browser verification.
- `minil/repository-audit.md`: read before comparing ADL with MINIL, reusing MINIL concepts, or designing parser/model/validator/runtime-test behaviour informed by MINIL.
- `architecture/resolved-model-defaults.md`: read before changing model resolution, model validation, policy evaluation, storage metadata, or runtime record handling.
- `architecture/business-contexts-and-backends.md`: read before changing business context/scope modelling, context-scoped roles, relationship-aware policies, cross-context views, read models, sync dataset design, or backend persistence assumptions.
- `architecture/target-architecture.md`: read before changing runtime stack choices, server authority, sync transport, auth provider direction, packaging, or architecture phase sequencing.
- `implementation/model-validator.md`: read before changing resolved-model validation, validation diagnostics, parser validation integration, object constraints, command declarations, or runtime model startup checks.
- `implementation/adl-parser.md`: read before changing ADL lexer/parser syntax, AST conversion, `compileAdl`, parser examples, or parsed policy/theme behaviour.
- `implementation/runtime-services.md`: read before changing runtime services, model-declared commands, UI runtime integration, lifecycle execution, audit, operation log handling, or runtime tests.
- `implementation/storage-backend.md`: read before changing runtime persistence, object storage backends, browser demo seeding, sync replay storage, or persisted record tests.
- `implementation/model-versioning-guard.md`: read before changing runtime startup compatibility checks, persisted application metadata, object schema version guards, or future migration handling.
- `implementation/business-context-model.md`: read before changing business context, object scope, view context, or read-model resolution and validation.
- `implementation/context-runtime.md`: read before changing runtime context resolution, context-scoped roles, scoped object authorization, context-aware UI calls, or tests that assert context policy behavior.
- `implementation/context-ui-navigation.md`: read before changing context selectors, view navigation, context-aware dashboard rendering, or browser UI calls for context-scoped objects.
- `implementation/read-model-runtime.md`: read before changing read-model execution, read-model-backed dashboards, read-model source scopes, or offline dataset work that depends on read-model inputs.
- `implementation/computed-fields-and-read-model-expressions.md`: read before changing computed fields, read shaping, write validation, read-model projection expressions, or conformance coverage for derived values.
- `implementation/offline-dataset-runtime.md`: read before changing context-aware offline dataset selection, dataset-limited local reads, or future remote sync planning.
- `implementation/browser-ui-runtime.md`: read before changing browser UI runtime components, browser demo fixtures, UI policy presentation, or browser verification.
- `implementation/policy-engine.md`: read before changing policy evaluation, policy conditions, runtime record returns, UI policy presentation, lifecycle action visibility, or tests that assert policy-shaped output.
- `implementation/expression-language.md`: read before changing `ResolvedExpression`, expression evaluation, parser expression syntax, policy conditions, predicate validators, command preconditions, computed fields, decision tables, lifecycle guards, or read-model expressions.
- `implementation/sync-policy.md`: read before changing object sync modes, runtime write gating, sync queue behavior, operation-log replay, or UI sync-state presentation.
- `implementation/sync-mode-delivery.md`: read before changing which sync modes queue, the client's delivery path, the authority's acceptance of a mode, undelivered-write presentation, or anything that decides whether an accepted write reaches the authority.
- `implementation/theme-system.md`: read before changing resolved theme tokens, theme resolution, UI CSS custom properties, or parser support for `THEME`.
- `implementation/reference-app-models.md`: read before adding or changing ADL reference applications, browser demo fixtures, or reference-app-driven platform gap work.
- `implementation/conformance-suite.md`: read before changing runtime semantics, resolved-model defaults, policy decision behavior, inspection/explain output, or conformance cases.
- `implementation/authority-server.md`: read before changing authority replay, server sessions, accepted-state persistence, operation idempotency, or browser/server reconciliation.
- `implementation/remote-bootstrap-and-sync-state.md`: read before changing authenticated remote bootstrap/pull, browser sync-state persistence, reconciliation, conflict recovery, or sync cursors.
- `implementation/identity-invites-and-access-lifecycle.md`: read before changing opaque server sessions, identity provisioning, invites, membership grants/revocation, access audit, or browser behavior after authentication/access loss.
- `implementation/production-authority-operations.md`: read before changing authority HTTP deployment, cookies, upstream identity proof, rate limits, credential logging, PostgreSQL operations, or incident procedures.
- `implementation/authoritative-reporting-and-administration.md`: read before changing server reports, exports, audit review, membership/invite status, recovery status, or operational access/session response actions.
- `implementation/retention-scheduling-and-administration-ui.md`: read before changing retention windows, the retention runner, scheduler or CLI entry point, before adding an operator-triggerable administrative action, or before changing the browser administration and reporting surfaces.
- `implementation/membership-projection.md`: read before changing how membership records are written, resolved, reviewed or revoked, before adding a scope-indexed read model over accepted records, or before touching `adl_authority_context_memberships`, `ContextMembershipIndex`, or the authority's startup advisory lock.
- `implementation/authority-transaction-integrity.md`: read before changing authority replay persistence, the accepted-record/runtime-audit/outcome commit boundary, the authority unit-of-work, access-lifecycle audit atomicity, authority restore/integrity verification, runtime-audit context scoping, or audit/outcome retention.
- `implementation/ui-presentation-model.md`: read before changing composed UI presentation declarations, presentation defaults, UI syntax for composed views, presentation validation, or presentation renderer behavior.
- `implementation/semantic-status-presentation.md`: read before changing status maps, status precedence, legends, status theme tokens, or status-colored browser presentation.
- `implementation/presentation-matrix-runtime.md`: read before changing resource/date matrices, availability presentation, matrix cell cycling, range editing, or future calendar work that reuses matrix status semantics.
- `implementation/calendar-presentation-runtime.md`: read before changing calendar month planning views, calendar cell actions, or event-entry behavior.
- `implementation/shell-navigation.md`: read before changing shell navigation metadata, drawer rendering, top-bar controls, or mobile business-context selectors.
- `implementation/first-deployment-slice.md`: read before changing the authority entrypoint or deployment configuration, the identity verification switch, the browser authority transport, session-derived browser identity, or bootstrap paging.
- `implementation/usable-sync-slice.md`: read before changing client conflict/rejection recovery, the browser authority bridge, sign-in or invite-claim UI, the local demo identity constant, or the service worker, web app manifest and offline shell.
- `implementation/offline-operation-identity.md`: read before changing the create intent contract, the authority's create path, record id minting or validation, `ObjectStore.planCreateForTransaction`, or anything that reasons about which side of the sync loop names a record.
- `implementation/passkey-identity.md`: read before changing WebAuthn ceremonies, identity keying or identity links, the authority's identity-verification mode, the passkey sign-in surface, or invite-based identity recovery.
- `implementation/model-versions-and-migrations.md`: read before changing model version declaration or derivation, the model fingerprint, `MIGRATION` syntax, migration planning or execution, the startup compatibility guard, persisted application metadata, or anything that decides whether persisted data may be read.
- `implementation/context-grants-and-relationship-access.md`: read before changing business-context availability, the object-scope gate, policy principals, read-model joins, command-established contexts, or anything that decides whether one user may see another user's records.
- `implementation/offline-session-lifetime.md`: read before changing the declared offline grace or its resolved shape, the authority's session lifetime or cookie attributes, session rotation, the browser sync gate, the cached browser identity, or the device/session list.
