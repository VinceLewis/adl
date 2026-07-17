# Computed Fields and Read-Model Expressions

Read this before changing computed fields, read shaping, write validation,
read-model projections, or conformance coverage for derived values.

## Key decisions from Phase 22

- Object computed fields live on `ResolvedObject.computedFields`, separate from
  stored business fields. The resolved model records each field's expression,
  `readTime` strategy, dependencies, deterministic evaluation order, and
  readonly/system-managed status.
- Computed fields are evaluated on runtime read/search/create/update/delete
  responses before policy read shaping. Storage, audit, constraints, and
  operation-log writes continue to use stored values only.
- Direct create/update writes to computed fields are rejected by
  `ValidationEngine` with `ADL_RUNTIME_COMPUTED_FIELD_WRITE`. This also protects
  command transactions because they use the same write preparation path.
- Computed field expressions may reference stored fields and other computed
  fields on the same object. Model validation rejects dependency cycles with a
  stable diagnostic that includes the cycle path.
- Read-model expression fields live on `ResolvedReadModelField.expression`.
  They evaluate in declaration order over already-projected row values, not raw
  source records. A read-model expression field cannot also project a source
  field.
- Read-model source projections can reference object computed fields because
  source records are computed before read policy shaping and projection.
- Parser syntax added by Phase 22:
  `COMPUTED FIELD Name TYPE = expression` inside `OBJECT`, and top-level
  `READ_MODEL` blocks with `SOURCE`, `FIELD ... FROM source.field`,
  expression fields, and `SORT`.

## Practical guidance

- Keep computed fields backend-neutral unless a later phase introduces an
  explicitly modelled materialisation strategy. The only current strategy is
  `readTime`.
- Do not let computed-field values enter persisted records unless a future
  migration/materialisation mechanism explicitly owns that write.
- Read-model expression fields should keep using shaped row values as their
  evaluation context; this preserves field-policy masking and avoids exposing
  raw source records to UI callers.
