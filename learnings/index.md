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

Before any task that touches `src/model/resolved-model.ts`, `src/compiler/validate-model.ts`, or `src/compiler/resolve-model.ts` — or that needs to locate a specific type, validator, or resolver by domain (object/field, presentation-matrix, decision-table, sync, etc.) rather than grepping an 8,000-line file — read `implementation/compiler-model-layer-file-map.md` first. Since Phase 81, these are directories of domain files behind a barrel, not single files.

Before any task that touches ADL grammar — or that needs to locate a keyword, clause, or `parseXxx` by grammar area rather than grepping a 5,750-line file — read `implementation/parser-grammar-file-map.md` first. Since Phase 88, `src/parser/parser.ts` is a barrel over `src/parser/grammar/`, a linear chain of grammar-area class files, not a single file.

Before any task that touches the browser shell — or that needs to locate shell state, a render method, an event listener, or a runtime read by area rather than grepping a 2,747-line file — read `implementation/adl-app-file-map.md` first. Since Phase 89, `src/ui/components/adl-app.ts` is a barrel over `src/ui/components/adl-app/`, a linear chain of shell-area class files, not a single file.

Before any task that touches presentation evaluation — or that needs to locate a status, icon, calendar, matrix, row-binding or value-format helper by area rather than grepping a 3,304-line file — read `implementation/presentation-runtime-file-map.md` first. Since Phase 90, `src/runtime/presentation-runtime.ts` is a barrel over `src/runtime/presentation-runtime/`: seven flat modules for its types and pure functions, plus a seven-file linear class chain for `PresentationRuntime`, not a single file.

Before tasks that change resolved model defaults, model validation, policy evaluation, object constraints, commands, storage metadata, or runtime record handling, also read:

- `implementation/compiler-model-layer-file-map.md`
- `architecture/resolved-model-defaults.md`
- `implementation/model-validator.md`
- `implementation/offline-session-lifetime.md`
- `implementation/policy-engine.md`
- `implementation/runtime-services.md`
- `implementation/expression-language.md`
- `implementation/computed-fields-and-read-model-expressions.md`
- `implementation/conformance-suite.md`
- `implementation/protected-role-constraint.md`

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
- `implementation/command-intent-replay.md`
- `implementation/usable-sync-slice.md`
- `implementation/authority-server.md`

Before tasks that change how a record revision is minted, what a revision means,
the `baseRevision` conflict check on either authority path, or anything that adds
a write path minting record metadata outside `ObjectStore`, also read:

- `implementation/authority-server.md`
- `implementation/storage-backend.md`
- `implementation/offline-operation-identity.md`
- `implementation/model-versions-and-migrations.md`
- `implementation/conformance-suite.md`

Before tasks that change how a locally executed command is queued, the `command`
local-operation kind, the command intent's record-id manifest, the authority's
re-execution of a command, or which selected contexts an operation replays
against, also read:

- `implementation/command-intent-replay.md`
- `implementation/offline-operation-identity.md`
- `implementation/runtime-services.md`
- `implementation/sync-mode-delivery.md`
- `implementation/authority-server.md`
- `implementation/command-read-steps.md`

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
- `implementation/record-sync-state.md`

Before tasks that change how a record's `syncStatus` is produced or cleared, that
add a surface reporting what a device is holding, that touch
`ObjectStore.setRecordSyncState`, `listRefusedRecords`,
`summariseRecordSyncState` or `discardRefusedRecord`, or that add any local
removal of a row the authority refused, also read:

- `implementation/record-sync-state.md`
- `implementation/usable-sync-slice.md`
- `implementation/offline-operation-identity.md`
- `implementation/command-intent-replay.md`
- `implementation/sync-mode-delivery.md`

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

- `implementation/parser-grammar-file-map.md`
- `implementation/adl-parser.md`
- `implementation/expression-language.md`
- `process/syntax-uniformity-and-behavioral-guardrails.md`

Before tasks that change a parser keyword alias, modifier-value parenthesization, `AUTO_ID`, `CONTEXT_MEMBER` policy principals, sync scope windows, or `LOOKUP TARGET_FIELD`, also read:

- `process/syntax-uniformity-and-behavioral-guardrails.md`
- `implementation/parser-grammar-file-map.md`
- `implementation/adl-parser.md`
- `implementation/model-validator.md`
- `implementation/policy-engine.md`
- `implementation/offline-dataset-runtime.md`
- `implementation/read-model-runtime.md`

Before tasks that change `AUTO_ID` minting, `ObjectStore.planCreateForTransaction`, or how a create write's field values are finalized before the record is built, also read:

- `implementation/auto-id-minting.md`
- `implementation/model-validator.md`
- `implementation/storage-backend.md`
- `implementation/runtime-services.md`

Before starting any new ADL authoring work — a new reference app, example
fixture, spec example, or conformance case, anything that will produce new
`.adl`/`.adlj` application content rather than review existing content — read
`docs/spec/adlj.md` first (the task-facing "how do I write `.adlj`" guide,
including its "Authoring a `.adlj` document from scratch" section: top-level
shape, per-construct JSON mapping, and a worked example). `.adlj`, not `.adl`
text, is the surface to author; `.adl` text is generated from it via
`print-adl.ts`. For a real, full-scale, comment-carrying `.adlj` application
to read rather than a small fixture, use `src/reference/jointly-care/domain.adlj`
+ `ui.adlj` (contexts, scope, read models with a `JOIN`, commands, and policy
rules) and `src/reference/giggle-band/domain.adlj` + `ui.adlj` (the constructs
Jointly Care doesn't exercise: `UNION` read models, `ORDERED` constraints,
`CHILD_COLLECTION`/`PICKER`, `STATUS_MAP`/`ICON_MAP`, a multi-hop `JOIN`, and
`EDIT_SECTION`) — between the two, every construct in `docs/spec/adlj.md`'s
mapping table has a real, compiling worked example.
Do **not** read `src/reference/giggle-band/domain.adl`/`ui.adl` as evidence
about what that app declares: they are a frozen model-version-1.0.0 snapshot
that diverges from the `.adlj` source in 32 recorded ways, and they cannot be
regenerated from it — see `implementation/reference-app-drift.md`.
`implementation/adlj-json-authoring-surface.md` is the implementation-history
companion — read it too when the task is likely to run into one of its
documented gotchas (the `principal.match` default-inference gap, the
`contexts`/`readModels` cosmetic-shape difference, or anything else
`docs/spec/adlj.md` itself flags as "see the learnings doc for why").

Before tasks that change `.adlj` (`src/model/adlj-source.ts`, `src/compiler/compile-adlj.ts`, `src/compiler/print-adl.ts`, `src/compiler/adl-to-adlj.ts`, `parseExpressionSource`), that change `PartialApplicationModel`-level source merging (`src/compiler/merge-partial-model.ts`, `compileAdlProjectV2` in `src/compiler/compile-adl-project.ts`), or that add a new expression-bearing field to `PartialApplicationModel`, also read:

- `implementation/adlj-json-authoring-surface.md`
- `implementation/adl-parser.md`
- `implementation/model-validator.md`

Before tasks that change an object's declared sync scope, the `SYNC ... WINDOW`
or `SYNC ... WHERE` clauses, what a declared window, limit or predicate selects,
how a bound composes with a scope, or anything that would let a model declare an
offline scope the runtime does not honour, also read:

- `implementation/offline-dataset-runtime.md`
- `implementation/sync-policy.md`
- `implementation/adl-parser.md`
- `implementation/expression-language.md`
- `implementation/read-model-runtime.md`

Before tasks that change runtime services, model-declared commands, UI runtime integration, lifecycle execution, audit, operation log handling, sync policy enforcement, or runtime tests, also read:

- `implementation/runtime-services.md`
- `implementation/context-runtime.md`
- `implementation/policy-engine.md`
- `implementation/expression-language.md`
- `implementation/sync-policy.md`
- `implementation/sync-mode-delivery.md`
- `implementation/offline-dataset-runtime.md`
- `implementation/conformance-suite.md`
- `implementation/command-read-steps.md`

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

Before tasks that change a resolved-model shape reachable from a shipped reference/demo app's model, or that bump a reference/demo app's `modelVersion` for any reason (including a content-only change to shell, presentation or anything else that participates in the model fingerprint), also read:

- `implementation/model-versions-and-migrations.md` (Phase 83 section: the persisted-state upgrade testing requirement, the shared `tests/visual/support/persisted-upgrade.ts` helper, and why every affected app needs its own test, not one representative app)
- AGENTS.md's `## Testing` → "Persisted-state upgrade testing" subsection (the binding rule itself)

Before tasks that change browser UI runtime components, browser demo fixtures, UI policy or sync presentation, or browser verification, also read:

- `implementation/adl-app-file-map.md`
- `implementation/presentation-runtime-file-map.md`
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

- `implementation/presentation-runtime-file-map.md`
- `implementation/ui-presentation-model.md`
- `implementation/semantic-status-presentation.md`
- `implementation/presentation-matrix-runtime.md`
- `implementation/calendar-presentation-runtime.md`

Before tasks that change shell navigation metadata, drawer rendering, top-bar
controls, or mobile business-context selectors, also read:

- `implementation/shell-navigation.md`

Before tasks that change ADL syntax for edit surfaces (`EDIT_CONTAINER`,
`EDIT_SECTION`, `CHILD_COLLECTION`, `PICKER`), the edit-surface runtime, how a
staged batch of child changes is committed or queued, the `batch` local-operation
kind, or anything that adds another ad-hoc multi-record write, also read:

- `implementation/edit-surface-language.md`
- `implementation/ui-presentation-model.md`
- `implementation/command-intent-replay.md`
- `implementation/record-sync-state.md`
- `implementation/adl-parser.md`

Before tasks that add or change ADL reference applications, model-driven demo fixtures, or follow-up platform gaps discovered by a reference app, also read:

- `implementation/reference-app-models.md`
- `implementation/reference-app-drift.md`

Before citing, quoting, or reasoning from `src/reference/giggle-band/domain.adl`
or `ui.adl` — and before keeping any superseded or generated file on disk "for
reference", or adding a line-number citation into a file this repository
maintains — read:

- `implementation/reference-app-drift.md`

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
- `process/testing-expectations.md`: read before code implementation or verification work. Since Phase 96 it also carries the rule that changing a shipped reference app's object constraints, field requiredness or validators invalidates `tests/integration/` fixtures built from that model, which `npm test` never runs.
- `process/visual-browser-verification.md`: read before changing browser UI rendering, CSS, shell chrome, reference app screens, or browser verification.
- `minil/repository-audit.md`: read before comparing ADL with MINIL, reusing MINIL concepts, or designing parser/model/validator/runtime-test behaviour informed by MINIL.
- `architecture/resolved-model-defaults.md`: read before changing model resolution, model validation, policy evaluation, storage metadata, or runtime record handling.
- `architecture/business-contexts-and-backends.md`: read before changing business context/scope modelling, context-scoped roles, relationship-aware policies, cross-context views, read models, sync dataset design, or backend persistence assumptions.
- `architecture/target-architecture.md`: read before changing runtime stack choices, server authority, sync transport, auth provider direction, packaging, or architecture phase sequencing.
- `implementation/model-validator.md`: read before changing resolved-model validation, validation diagnostics, parser validation integration, object constraints, command declarations, or runtime model startup checks.
- `implementation/auto-id-minting.md`: read before changing `AUTO_ID` field declarations, `ObjectStore.planCreateForTransaction`, or anything that decides where a `CREATE` write gets its final field values from — it carries the Phase 74 minting design, why `ValidationEngine`'s required-field check needed a small change too, and the collision-is-accepted (not solved) tradeoff plus the `CONSTRAINT ... UNIQUE` pairing recommendation.
- `implementation/adl-parser.md`: read before changing ADL lexer/parser syntax, AST conversion, `compileAdl`, parser examples, or parsed policy/theme behaviour.
- `implementation/parser-grammar-file-map.md`: read before changing ADL grammar, or to locate a keyword/clause by grammar area — it carries the Phase 88 file map for `src/parser/grammar/`, the linear-class-chain rule that makes a lower file unable to call a higher one (and the two areas, `clauses.ts` and `presentation-scalars.ts`/`presentation-action.ts`, that measured cycles forced into existence), the `private`/`protected` visibility rule, and the differential parser corpus technique — every `.adl` file truncated at every line boundary, which drove 1,250 distinct `ParseError` paths — that is the only real proof a parser relocation changed nothing.
- `implementation/runtime-services.md`: read before changing runtime services, model-declared commands, UI runtime integration, lifecycle execution, audit, operation log handling, or runtime tests.
- `implementation/storage-backend.md`: read before changing runtime persistence, object storage backends, browser demo seeding, sync replay storage, persisted record tests, or anything that mints a value identifying persisted state — it carries the Phase 61 decision that a record revision is durable state and that already-persisted old-format revisions are deliberately not migrated.
- `implementation/model-versioning-guard.md`: read before changing runtime startup compatibility checks, persisted application metadata, object schema version guards, or future migration handling.
- `implementation/business-context-model.md`: read before changing business context, object scope, view context, or read-model resolution and validation.
- `implementation/context-runtime.md`: read before changing runtime context resolution, context-scoped roles, scoped object authorization, context-aware UI calls, or tests that assert context policy behavior.
- `implementation/context-ui-navigation.md`: read before changing context selectors, view navigation, context-aware dashboard rendering, or browser UI calls for context-scoped objects.
- `implementation/read-model-runtime.md`: read before changing read-model execution, read-model-backed dashboards, read-model source scopes, or offline dataset work that depends on read-model inputs — it carries the Phase 63 rule that a source scope widens an object's context but never its declared offline bound, and the Phase 91 projected-`LOOKUP` display contract (a projected field inherits its source field's `lookup` the way it already inherited its `type`; the label lands in a separate `RuntimeReadModelRow.display` channel so `values` keeps the stored id; the target is a record on another object and is policy-read, scope-checked and read-shaped before its label may be used; every refusal degrades to no label; and a derived resolved-model field changes the `modelFingerprint` of *every* app with a read model, not just the one whose screen changed).
- `implementation/computed-fields-and-read-model-expressions.md`: read before changing computed fields, read shaping, write validation, read-model projection expressions, or conformance coverage for derived values.
- `implementation/offline-dataset-runtime.md`: read before changing context-aware offline dataset selection, dataset-limited local reads, the `SYNC ... WINDOW` / `SYNC ... WHERE` clauses, or future remote sync planning — it carries the Phase 62 rule that no offline scope may be declarable in a form the runtime ignores, the Phase 64 rule that a scope selects a context while a window and a predicate are independent bounds that may accompany any scope, enforced by presence rather than by the scope value, and why `recordMatchesCurrentUser`'s `LOOKUP TARGET_FIELD` fix (mirroring `ReadModelService`'s) forced its entire caller chain to `async`/`await`, replacing two `.filter()`/`.flatMap()` chains with sequential loops since neither can await a predicate.
- `implementation/browser-ui-runtime.md`: read before changing browser UI runtime components, browser demo fixtures, UI policy presentation, or browser verification — including why `adl-field-renderer.ts`'s lookup `<select>` needs a `targetField`-aware `lookupOptionValue` helper (mirroring `lookupLabel`'s `displayField` fallback) rather than always writing back a candidate's record id.
- `implementation/adl-app-file-map.md`: read before changing the browser shell, or to locate shell state, a render method, an event listener or a runtime read by area — it carries the Phase 89 file map for `src/ui/components/adl-app/`, the linear-class-chain rule that makes a lower file unable to call a higher one (and the four placements measured cycles forced: `runtime`/`context` down into `state.ts`, the `runCommand`/`deliverPendingWrites`/`refreshFromRuntime` 3-cycle, `events-shell` below `events-record`, `render-chrome` below `render`), the field-initialization-order rule that makes a moved field read `undefined` with no `tsc` error, the accessor-pair rule that silently loses a getter or setter, the `private`/`protected` visibility rule, and the rendered-output differential technique — both reference demos driven to every declared view, with two entropy sources pinned — that is the only real proof a shell relocation changed nothing.
- `implementation/policy-engine.md`: read before changing policy evaluation, policy conditions, runtime record returns, UI policy presentation, lifecycle action visibility, or tests that assert policy-shaped output -- it carries the Jointly Care reference app's discovery that a `WHEN`-conditioned `SEARCH`/`EXPORT` rule can never match (no candidate record exists at the coarse object-level gate) and that a `ROLE` condition on an object with no `SCOPE` can only ever match a role earned through that same object's own context, never a role earned through an unrelated one — plus the Phase 91 finding that documenting that trap did not stop it: Giggle Band shipped the identical dead `ROLE BandMember` rule on `User`, so no band member could read or search any user and every lookup label in the app degraded to a raw id, with nothing in the compiler detecting it.
- `implementation/expression-language.md`: read before changing `ResolvedExpression`, expression evaluation, parser expression syntax, policy conditions, predicate validators, command preconditions, computed fields, decision tables, lifecycle guards, or read-model expressions.
- `implementation/sync-policy.md`: read before changing object sync modes, runtime write gating, sync queue behavior, operation-log replay, or UI sync-state presentation.
- `implementation/sync-mode-delivery.md`: read before changing which sync modes queue, the client's delivery path, the authority's acceptance of a mode, undelivered-write presentation, or anything that decides whether an accepted write reaches the authority.
- `implementation/theme-system.md`: read before changing resolved theme tokens, theme resolution, UI CSS custom properties, or parser support for `THEME`.
- `implementation/reference-app-models.md`: read before adding or changing ADL reference applications, browser demo fixtures, or reference-app-driven platform gap work -- it carries the Jointly Care conversion of `OSV_PRD_Elixir_Canonical_Jointly.md` (`src/reference/jointly-care/`), including why `DISPLAY` can never name a `COMPUTED` field, why a `CONTEXT_GRANT` never extends to the context's own root object (a join across it silently drops rows rather than erroring), and why a row action still needs its own `WHEN` guard even when the command underneath it already refuses the write safely -- and now also both apps' full conversion to `.adlj` as their real compiled source (`domain.adlj`/`ui.adlj`, comments included), with Giggle Band as the construct-richer second precedent (`UNION`, `ORDERED`, `CHILD_COLLECTION`/`PICKER`, `STATUS_MAP`/`ICON_MAP`, a multi-hop `JOIN`, `EDIT_SECTION`) and the dynamic-`import()` lazy-compilation pattern both `jointly-app.ts` and `band-app.ts` now use to keep `.adlj`/`ajv` tooling out of the main browser bundle.
- `implementation/reference-app-drift.md`: read before citing, quoting or reasoning from Giggle Band's kept `src/reference/giggle-band/domain.adl`/`ui.adl`, before keeping any superseded file on disk "for reference", and before adding a line-number citation into any maintained file -- it carries the Phase 94 finding that those two files are a frozen model-version-1.0.0 snapshot rather than a view of `domain.adlj`/`ui.adlj` (32 enumerated divergences, pinned in `tests/reference-adl-snapshot.test.ts`), that they *cannot* be regenerated because the real source uses three constructs with no ADL text syntax at all (`conflictOverlay`, `projectedFields`, `summary`), that they are nonetheless live test corpus for two `.adl`-text pipeline tests despite an earlier note claiming otherwise, the measured lesson that a divergence pin over *paths* is not a pin over *values* (renaming an already-divergent nav label left the path set identical and the test green), the two diff mechanics that made a 1,629-line comparison readable as 32 entries (re-key named arrays by name; report the shallowest differing path and stop), and the evidence that line-number citations survive into a frozen file (20/20) but not into a living one (every spot-checked `language.md:NNN` citation in `docs/phases/*.md` already lands on unrelated text).
- `implementation/conformance-suite.md`: read before changing runtime semantics, resolved-model defaults, policy decision behavior, inspection/explain output, conformance cases, the conformance runner's operations and step options, or the generated-value guard that keeps minted text out of the corpus.
- `implementation/authority-server.md`: read before changing authority replay, server sessions, accepted-state persistence, operation idempotency, browser/server reconciliation, or the `baseRevision` conflict check and the rule that mints a record revision.
- `implementation/remote-bootstrap-and-sync-state.md`: read before changing authenticated remote bootstrap/pull, browser sync-state persistence, reconciliation, conflict recovery, or sync cursors.
- `implementation/identity-invites-and-access-lifecycle.md`: read before changing opaque server sessions, identity provisioning, invites, membership grants/revocation, access audit, or browser behavior after authentication/access loss.
- `implementation/production-authority-operations.md`: read before changing authority HTTP deployment, cookies, upstream identity proof, rate limits, credential logging, PostgreSQL operations, or incident procedures.
- `implementation/authoritative-reporting-and-administration.md`: read before changing server reports, exports, audit review, membership/invite status, recovery status, or operational access/session response actions.
- `implementation/retention-scheduling-and-administration-ui.md`: read before changing retention windows, the retention runner, scheduler or CLI entry point, before adding an operator-triggerable administrative action, or before changing the browser administration and reporting surfaces.
- `implementation/membership-projection.md`: read before changing how membership records are written, resolved, reviewed or revoked, before adding a scope-indexed read model over accepted records, or before touching `adl_authority_context_memberships`, `ContextMembershipIndex`, or the authority's startup advisory lock.
- `implementation/authority-transaction-integrity.md`: read before changing authority replay persistence, the accepted-record/runtime-audit/outcome commit boundary, the authority unit-of-work, access-lifecycle audit atomicity, authority restore/integrity verification, runtime-audit context scoping, or audit/outcome retention.
- `implementation/ui-presentation-model.md`: read before changing composed UI presentation declarations, presentation defaults, UI syntax for composed views, presentation validation, or presentation renderer behavior.
- `implementation/presentation-runtime-file-map.md`: read before changing presentation evaluation, or to locate a status, icon, calendar, matrix, row-binding or value-format helper by area — it carries the Phase 90 file map for `src/runtime/presentation-runtime/`, the hybrid shape (flat modules for the pure type and free-function regions, a linear class chain for `PresentationRuntime`) and why the two differ, the chain-ordering rule that makes a lower file unable to call a higher one, the exported-from-its-area-file-but-not-from-the-module rule that keeps four module-private shapes out of the package API despite `src/index.ts`'s `export *`, the `private`/`protected` visibility rule, and the differential-dump recipe — reference demos plus the conformance presentation models, because the reference apps declare no matrices and a demo-only corpus silently misses every matrix edit path.
- `implementation/semantic-status-presentation.md`: read before changing status maps, status precedence, legends, status theme tokens, or status-colored browser presentation. It also carries the Phase 92 legend-markup contract (a legend's `role="list"` holds only `listitem` children, the title sits outside it, and the 6/12/16 gap hierarchy plus the `.adl-presentation-status` trailing-margin trap that breaks it), why a view whose statuses carry icon and ARIA label as well as colour needs no legend at all, and the `--adl-color-on-primary-*` ramp for status dots on the primary-coloured top bar.
- `implementation/presentation-matrix-runtime.md`: read before changing resource/date matrices, availability presentation, matrix cell cycling, range editing, or future calendar work that reuses matrix status semantics.
- `implementation/calendar-presentation-runtime.md`: read before changing calendar month planning views, calendar cell actions, or event-entry behavior.
- `implementation/shell-navigation.md`: read before changing shell navigation metadata, drawer rendering, top-bar controls, or mobile business-context selectors. Since Phase 92 it also carries the top bar's three visual registers (readout / control / disabled control), the two contrast traps that produced them (a translucent *white* overlay on a coloured bar measures 4.08:1 for white text; `button:disabled`'s blanket opacity measures 2.03:1 on the primary bar), the mobile `align-items: stretch` label-alignment trap, the dead `justify-content: flex-start` mobile rule, and the fact that `ui.adl` and `ui.adlj` have diverged on where `themeSwitch` is placed.
- `implementation/first-deployment-slice.md`: read before changing the authority entrypoint or deployment configuration, the identity verification switch, the browser authority transport, session-derived browser identity, or bootstrap paging.
- `implementation/usable-sync-slice.md`: read before changing client conflict/rejection recovery, the browser authority bridge, sign-in or invite-claim UI, the local demo identity constant, or the service worker, web app manifest and offline shell.
- `implementation/offline-operation-identity.md`: read before changing the create intent contract, the authority's create path, record id minting or validation, `ObjectStore.planCreateForTransaction`, or anything that reasons about which side of the sync loop names a record or names a version of one.
- `implementation/command-intent-replay.md`: read before changing how a locally executed command is queued, the `command` local-operation kind, the command intent's record-id manifest, the authority's re-execution of a command, the sync-queueability rule on command steps, or which selected contexts an operation replays against.
- `implementation/command-read-steps.md`: read before changing command step kinds, the command value-expression vocabulary (`stepField`/`stepMeta`), command step-ordering validation, or anything that lets a command read an existing record rather than only create or update one — it carries the Phase 71 decision to bind a `read` step's record into the same `stepRecords` namespace a `create`/`update` step's own written record already uses, rather than a second expression kind, and the decision to enforce read policy through `ObjectStore.read` rather than the write-path's unauthorized `getRecordForRuntime` lookup.
- `implementation/passkey-identity.md`: read before changing WebAuthn ceremonies, identity keying or identity links, the authority's identity-verification mode, the passkey sign-in surface, or invite-based identity recovery.
- `implementation/model-versions-and-migrations.md`: read before changing model version declaration or derivation, the model fingerprint, `MIGRATION` syntax, migration planning or execution, the startup compatibility guard, persisted application metadata, or anything that decides whether persisted data may be read — it also carries the Phase 83 persisted-state upgrade testing requirement (AGENTS.md's `## Testing` subsection of the same name), the shared `tests/visual/support/persisted-upgrade.ts` helper, and a real recurrence of the failure mode the rule exists to close within the same session that wrote it.
- `implementation/context-grants-and-relationship-access.md`: read before changing business-context availability, the object-scope gate, policy principals, read-model joins, command-established contexts, or anything that decides whether one user may see another user's records.
- `implementation/record-sync-state.md`: read before changing how a record's sync state is produced or cleared, before adding a surface that reports what a device is holding, or before adding any local removal of a row the authority refused.
- `implementation/offline-session-lifetime.md`: read before changing the declared offline grace or its resolved shape, the authority's session lifetime or cookie attributes, session rotation, the browser sync gate, the cached browser identity, or the device/session list.
- `implementation/edit-surface-language.md`: read before changing ADL edit-surface syntax, the edit-surface runtime, how a staged batch of child changes commits or queues, the `batch` local-operation kind, or anything that adds another ad-hoc multi-record write.
- `implementation/protected-role-constraint.md`: read before changing object constraints, `ObjectStore.requireConstraintsForWrites`, or any future guard that must count sibling records rather than validate one record in isolation — it carries the Phase 65 "last admin standing" design: the check fires on the transition, not the state, and is deliberately not retroactive.
- `process/syntax-uniformity-and-behavioral-guardrails.md`: read before changing a parser keyword alias, modifier-value parenthesization, `AUTO_ID`, `CONTEXT_MEMBER` policy principals, sync scope windows, or `LOOKUP TARGET_FIELD` — it carries the Phase 72 catalogue of canonical vs. deprecated spellings, the hard-parse-error-vs-warning distinction between parenthesization and keyword aliases, and the four Class B behavioural-trap decisions (`AUTO_ID` no-default refusal — superseded by Phase 74, see `implementation/auto-id-minting.md` — `CONTEXT_MEMBER`+`SEARCH` refusal, sync window `windowSource` provenance, and the `LOOKUP TARGET_FIELD` current-user-source warning — both `LOOKUP TARGET_FIELD` paths since fixed for real by Phase 75).
- `implementation/adlj-json-authoring-surface.md`: read before starting any new ADL authoring work (see `docs/spec/adlj.md` for the task-facing how-to this doc complements) and before changing `.adlj` (`src/model/adlj-source.ts`, `src/compiler/compile-adlj.ts`, `src/compiler/print-adl.ts`, `src/compiler/adl-to-adlj.ts`, `parseExpressionSource`), `PartialApplicationModel`-level source merging (`src/compiler/merge-partial-model.ts`, `compileAdlProjectV2`), or before adding a new expression-bearing field to `PartialApplicationModel` — it carries the Phase 73 exhaustive expression-field enumeration (18 sites, not the 4 originally named), the `Omit`-then-spread `exactOptionalPropertyTypes` trap, the two `resolveApplicationModel` default-inference gaps a JSON front-end does not inherit for free (`principal.match`, `contexts`/`readModels`), why the schema is loaded via a static JSON import rather than `readFileSync`, the Phase 76 `PartialApplicationModelFragment` merge design (first-wins `app`/`modelVersion`, last-wins `shell`, concatenation for every other array, and the `undefined`-vs-`.length===0` distinction the view-only-object merge check needs at the `Partial*Model` level), the Phase 77 `.adl` → `.adlj` importer that reuses `print-adl.ts`'s expression printers rather than reimplementing them, the Phase 78 printer coverage for composed presentation/edit surfaces plus the named set of constructs with no ADL text syntax at all, a systematic sweep confirming `principal.match` is the *only* `resolveApplicationModel`-default-inference gap in the codebase (three other candidates all turned out schema-required, so no gap), and the post-integration bundle-size regression where two independently-correct phases (76's `compileAdlProjectV2` importing `compile-adlj.ts` directly from `compile-adl-project.ts`, reachable from the real browser bundle without going through the barrel at all; 77's barrel export of `adl-to-adlj.ts`) each reopened the hole Phase 79 closed, fixed by splitting `compileAdlProjectV2` into its own file and excluding it too; and the later addition of a shared optional `comment?: string` field on 24 `Partial*Model` node shapes (not `AdljSourceDocument`-only) so `.adl` text and `.adlj` JSON can both carry the leading-comment-block design rationale real `.adl` files accumulate, captured by the parser via a pure line-number lookup (`AdlParser.takeLeadingComment`) that changes nothing about what the lexer's main token stream contains.
