# Resolved Model Defaults

Read this before changing model resolution, model validation, policy evaluation, storage metadata, or runtime record handling.

## Key decisions from Phase 1

- `ResolvedApplicationModel` is JSON-compatible and deterministic by default. Resolution does not populate `generatedAt`, because wall-clock values would make equal inputs produce different outputs.
- Platform metadata is represented separately from author-defined business fields. `_guid` is explicit through `ResolvedObject.systemIdField` and `ResolvedObject.metadataFields`, not mixed into the normal `ResolvedObject.fields` array.
- Every resolved object receives the same metadata field definitions: `_guid`, `_object`, `_schemaVersion`, `_revision`, `_state`, `_createdAt`, `_createdBy`, `_updatedAt`, `_updatedBy`, `_deletedAt`, `_deletedBy`, and `_syncStatus`.
- Lifecycle state defaults to metadata-backed `_state` when a lifecycle is present and no author field is named as the state field.
- Default sync is explicit on every object and in the top-level `sync` list: `localFirst`, `all`, `manual`.
- Default deny is encoded as a policy with `defaultEffect: "deny"` and no deny-all rule. A deny-all rule would become an explicit deny and later override every allow rule when the policy engine implements "explicit deny wins".
- Table and field storage names use deterministic snake-case normalisation reimplemented in TypeScript. ADL does not import MINIL naming helpers.

## Practical guidance

- Phase 2 validation should validate references against both business fields and metadata fields where the runtime is allowed to use metadata-backed fields, especially lifecycle `_state`.
- Runtime field rendering should default to business fields from `ResolvedObject.fields`; storage, audit, lifecycle, sync, and schema-version checks should also use `metadataFields`.
- Policy engine work should treat `defaultEffect: "deny"` as the fallback when no rule applies, not as an explicit deny reason.
