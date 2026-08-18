# Protected Role Constraint ("Last Admin Standing")

Read this before changing object constraints, `ObjectStore.requireConstraintsForWrites`,
or any future guard that must count *sibling* records rather than validate one
record in isolation.

## Key decisions from Phase 65

- **A cross-record, scope-aware invariant is an object constraint, not a
  policy rule.** `PolicyEngine.evaluate` decides one record against one
  principal and has no way to count how many other records in a scope hold a
  value — which is exactly what "the last one" means. `ObjectConstraintKind`
  gained a third member, `"protectedRole"`, alongside `"unique"` and
  `"ordered"`, all enforced in the one place that already computes a
  transaction's final record set: `ObjectStore.requireConstraintsForWrites`.
- **The existing per-write loop skips deletes, and that had to change.**
  `unique`/`ordered` never need to check a delete — a deleted record leaves the
  collection and has nothing left to satisfy — so the loop short-circuits
  `write.operation === "delete"` before checking any constraint. A
  `protectedRole` guard's whole purpose is to fire on a delete, so it is
  checked in a separate pass *before* that short-circuit, using the write's
  `existing` values (present on every update and delete) rather than its
  possibly-absent final ones. Do not fold a delete-sensitive constraint into
  the existing loop without moving it ahead of that line.
- **The check fires on the transition, not the state.** It compares whether
  the write's *existing* record held a guarded value against whether the
  *final* state (post-transaction, in the same scope key) still does. A create
  is always skipped — it can only add a record, never remove one. An update
  that keeps a guarded value, including moving *between* two declared guarded
  values (`Admin` to `Owner` when both are declared), is not checked at all,
  because the scope's guarded count does not change. Only when a write would
  cause a scope to lose a guarded holder is the remaining count in that scope
  checked against `minCount`.
- **It is deliberately not retroactive.** A scope already below `minCount`
  before this transaction — data older than the constraint's own declaration,
  say — is not repaired and does not cause unrelated writes to that scope to
  be refused. This mirrors how `unique`/`ordered` only ever check the write in
  front of them, never audit the whole collection, and it is what keeps
  adopting the constraint on an existing model safe: nothing already
  persisted is retroactively blocked from being touched.
- **`orderedScopeKey` is a generic scope-key helper despite its name.** It only
  ever used `scopeFields`, so `protectedRole` reuses it unchanged rather than
  duplicating scope-key derivation a third time. If it is ever renamed for
  Phase 62/64-style clarity, `requireProtectedRoleConstraint` uses it too.
- **Command steps have no delete step**, so `ObjectStore.delete` (direct CRUD)
  is the only path that removes a record; `requireConstraintsForWrites` still
  covers command-authority writes because both direct and command-planned
  writes flow through the same `PlannedObjectWrite` list before commit.
- **Lifecycle transitions bypass object constraints entirely, today, for all
  three kinds.** `ObjectStore.commitTransition` never calls
  `requireConstraintsForWrites`. This was true before Phase 65 for
  `unique`/`ordered` and remains true for `protectedRole`; it is not reachable
  in the Giggle Band reference app because `BandMember` has no lifecycle, and
  was recorded rather than fixed, since fixing it is unrelated to the gap this
  phase closes and touches transition semantics no evidence here justified
  changing.
- **`VALUES` takes more than one literal on purpose.** A model may guard a set
  of privileged roles at once (`VALUES ('Admin', 'Owner')`), and that is what
  lets a demotion *between* two guarded values be told apart at the runtime
  level from a demotion *out of* the guarded set — the former satisfies the
  guard, the latter is checked against the remaining count.

## Practical guidance

- When a new constraint kind needs to see a write's pre-image, check whether
  the existing per-write loop already discards it (as the delete
  short-circuit does) before assuming the loop's existing structure is
  reusable unchanged.
- Prove a new constraint kind against both a generic, app-neutral fixture and
  the real reference application using its actual policy rules — the Giggle
  Band proof caught nothing the generic one didn't, but it is what makes
  "this closes a production defect in a real ADL-adjacent app" a checked claim
  rather than an assertion.
- A retroactive interpretation of an aggregate guard is an easy default to
  reach for and the wrong one: it turns adopting a new constraint on an
  existing model into a breaking change for every scope that already violates
  it, rather than a guarantee that holds from here forward.
