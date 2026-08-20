# Model Versions, Fingerprints and Migrations

Read this before changing model version declaration or derivation, the model
fingerprint, `MIGRATION` syntax, migration planning or execution, the startup
compatibility guard, persisted application metadata, or anything that decides
whether persisted data may be read.

## The problem Phase 51 closed

`ADL_MODEL_VERSION` was a platform constant (`"0.1.0"`) with **no ADL syntax
behind it**: the parser had no version directive and `compile-adl.ts` never
populated the field, so every model resolved to the same version.
`startup-compatibility.ts` compared only that string against persisted metadata.

The consequence was not abstract. `app.offlineGraceDays` is the authority's
session lifetime, so editing `OFFLINE_GRACE 30 DAYS` to `7 DAYS` began issuing
7-day sessions while every already-running device still believed it had 30, and
the compatibility guard said nothing, because a model *content* change was not a
model *version* change.

## Two values, two questions

- `modelVersion` is **declared** (`APP … MODEL_VERSION '1.1.0'`, defaulting to
  `0.1.0`). It selects migrations.
- `modelFingerprint` is **derived** during resolution: SHA-256 over a canonical
  JSON form of the resolved model. It decides whether a declared version is
  still telling the truth.

Both were needed. A declared version alone can be forgotten; a derived hash alone
makes every trivial edit demand a migration keyed by an opaque digest.

Determinism is contractual, so both halves are specified in
`docs/spec/resolved-model.md`: keys sorted by UTF-16 code unit, array order
preserved, `undefined` omitted, `-0` written as `0`, `modelFingerprint` and
`generatedAt` excluded, then SHA-256 as lowercase hex prefixed `sha256-`.

SHA-256 is implemented by hand in `src/model/fingerprint.ts` rather than taken
from a platform API. The only digest available in both a browser and Node without
a dependency is `crypto.subtle.digest`, which is **asynchronous**, and model
resolution is synchronous everywhere in this repository. Do not "simplify" this
into an async resolver.

## Migrations are declarative and total

`MIGRATION FROM '1.0.0' TO '1.1.0'` blocks carry per-object steps: `RENAME FIELD`,
`ADD FIELD … DEFAULT`, `DROP FIELD`, and `SCHEMA_VERSION`. That is the whole
vocabulary, deliberately:

- Every step is **total** — it cannot fail on a well-formed record — so a
  migration's only failure mode is infrastructural, which is what makes
  "rolled back and unchanged" an honest promise.
- Every step is expressible against any conforming runtime, which is what makes
  migration part of the cross-runtime contract rather than a TypeScript feature.
- `DEFAULT` on `ADD FIELD` is required, not optional. A record that silently
  gained `null` where the model says the field is required would fail validation
  on its next write.

`src/runtime/model-migration.ts` is **pure**. Planning reads a model and a
persisted version; applying transforms records in memory. That purity is what
lets the server run the transform inside its own PostgreSQL commit boundary and
the browser run it inside an IndexedDB transaction without either reimplementing
the semantics. Do not give it storage access.

Chains are resolved breadth-first, shortest route first. A model may declare more
than one route forward — a long-way-round chain kept for old installs alongside a
direct hop — and applying every declared migration in order would apply the same
field change twice.

## Rules that are easy to get wrong

- **Migrate before checking schema versions.** The per-record schema-version
  check exists to reject records the model cannot read; migration exists to make
  those records readable. Reversing the order makes migration unreachable.
- **Commit records and metadata together.** `ObjectStorageTransactionWrite` gained
  an `applicationMetadata` variant for exactly this. A commit that recorded the
  new version over unmigrated records, or migrated records under the old version,
  is worse than either failure alone. A backend that cannot commit atomically is
  refused rather than migrated write-by-write.
- **Preserve `revision`, actor and timestamps** on a migrated record. A migration
  is not an edit by anyone. Rewriting them would make a schema change look like a
  user's change in every audit surface and would break optimistic concurrency for
  a client holding the pre-migration revision.
- **Leave untouched objects byte-identical.** `migrateStoredRecord` returns
  `undefined` when no hop mentions the object, so an unrelated migration cannot
  reorder a value map or bump a revision as a side effect.
- **Persisted state ahead of the model is refused, not read.** An older process
  silently reading newer records is how a downgrade destroys data it does not
  understand.
- **Never destroy as a fallback.** Every failure path leaves persisted state
  exactly as it was. There is no "clear and re-seed" path and there must not be.

## Two boundaries a migration must not cross

Both are Phase 50 guarantees that a careless migration would undo:

1. **The cached browser identity** (`{ userId, lastVerifiedAt }`) lives in its own
   IndexedDB database (`adl-runtime-session-identity`), separate from records. It
   is not a record, carries no schema, and is never touched by a migration.
   Clearing it would reintroduce the exact defect Phase 50 closed: a signed-in
   user losing their own data on an offline reload.
2. **The operation log and sync queue** are transformed, never fabricated.
   Pending patches name fields, so the same declared steps reach them — otherwise
   the client would send the authority a patch naming a field the model no longer
   has. `addField` is deliberately *not* applied to a patch: a patch is a set of
   changes rather than a whole record, so backfilling a default into one would
   assert a change the user never made. Nothing is created or discarded.

## Where each side is wired

- Browser: `ApplicationRuntime` calls the guard with `{ applyMigrations: true }`.
  A runtime owns its persisted records, so it is the caller entitled to migrate
  them.
- Server: `migrateAcceptedState` in `authority-entrypoint.ts`, before anything
  that could serve state is composed, on a **pinned client** rather than the pool
  — `commitTransaction` issues its own `begin`/`commit`, and on an unpinned pool
  those can land on different connections and lose atomicity entirely. A refusal
  becomes an `AuthorityConfigurationError` and the process does not start.
- The default is `applyMigrations: false`, so a caller that merely asks whether
  state is readable — a conformance case, an inspection tool — never rewrites
  anything as a side effect of asking.

## Two version bugs, one shape

Both were found by conformance cases, independently, by different agents, and
both come from the same mistake: **comparing versions one way and keying on them
another**.

- `planModelMigration` decided "nothing to do" with `===` while validation
  ordered with `compareModelVersions`, which treats `1.1` and `1.1.0` as equal.
  Persisted state at `1.1` opened by a `1.1.0` model was refused, and the remedy
  the refusal named — declare a migration from `1.1` — was itself invalid,
  because the two do not move forward relative to each other. The install was
  unreachable by construction.
- The fingerprint had `modelVersion` inside it, so re-spelling the version was a
  *content* change and the same install failed one step later on a stale
  fingerprint instead.

Anywhere a version is a map key or set member, normalise it first
(`normaliseModelVersion`). Never digest the declared version: the fingerprint is
consulted only when versions already compare equal, so including it adds nothing
and reintroduces the dead end.

## Conformance

Three case types were added in `src/conformance/runner.ts`:
`compareModelFingerprints`, `migratePersistedState`, and the `persistedModel`
input on `startupCompatibility`.

`persistedModel` exists because a case must never hard-code a digest string. A
literal `sha256-…` in the corpus would pin the entire resolved-model shape and
break on any unrelated model addition, teaching a second runtime nothing. A case
instead names the model that *wrote* the state and the runner derives the
metadata from it. `compareModelFingerprints` asserts the *relation* between two
models' fingerprints for the same reason.

## Phase 82: platform changes still need application migrations

- A change to resolver defaults can change existing applications even when no
  application source file changed. Phase 80 added `shell.nav.mode` to the
  resolved model and changed which nav items were derived; that changed the
  model fingerprint for persisted reference demos.
- Fresh Playwright contexts cannot prove upgrade compatibility because they
  carry no old IndexedDB metadata. Any resolved-model change affecting a
  persistent browser app needs a test that seeds the previous declared version
  and fingerprint, then opens the new model against the same database.
- Do not weaken the stale-fingerprint guard for presentation-only changes.
  Fingerprints deliberately cover the whole resolved contract, and deciding
  after the fact that one mismatch is safe from only an opaque digest is a
  guess. Advance the application model version and declare an empty-object
  migration when records need no transformation; this preserves the guard and
  records the compatibility claim explicitly.
