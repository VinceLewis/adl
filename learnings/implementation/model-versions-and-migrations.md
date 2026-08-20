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

## Phase 83: persisted-state upgrade testing is now a structural requirement

Phase 82 fixed one shipped regression (Giggle Band's blank-page-on-reload after
`d020b2d` changed shell content without a `modelVersion` bump) and added a real
IndexedDB regression test for it — but only for Giggle Band, even though the
same commit bumped Jointly Care and the generic persistent browser demo too.
`AGENTS.md`'s `## Testing` section now has a "Persisted-state upgrade testing"
subsection making this mandatory for **every** reference/demo app a change
touches, not one representative app, and a shared helper —
`tests/visual/support/persisted-upgrade.ts` — so a new app's test is a few
lines against real IndexedDB and a real app URL, not another ~80-line
hand-rolled `indexedDB.open`/`transaction` block. See
`tests/visual/giggle-band.visual.spec.ts`, `tests/visual/jointly-care.visual.spec.ts`
and `tests/visual/browser-demo.visual.spec.ts` for the resulting three tests.

**Two seeding patterns, not one.** Giggle Band's original test (kept
behavior-identical through the Phase 83 refactor) deletes and recreates the
database from nothing with hand-supplied stale metadata
(`seedStalePersistedInstallation`) — it seeds no records at all, so it only
proves the metadata transition. Jointly Care's and the generic browser
demo's Phase 83 tests use a different, stronger pattern instead: mount the
real app first and let it seed its own real reference dataset through its
normal `seedIfEmpty` path, snapshot every persisted record
(`readAllPersistedRecords`), roll back *only* the application metadata row
in place (`downgradePersistedApplicationMetadata` — the existing database,
untouched otherwise), reload, and assert the post-migration record snapshot
is deep-equal to the pre-downgrade one. This proves the *entire* real seeded
dataset survives a migration byte-identical, not one hand-picked record, and
needs no hand-authored `StoredObjectRecord` at all. Prefer this pattern for
any new app's persisted-upgrade test; the delete-and-reseed pattern remains
available for a case that genuinely needs to control persisted shape from
nothing (an app with no real seed data, or a migration under test that must
see specific stale field values `seedIfEmpty` would not produce).

**Read the current model version from the mounted app in the page
(`readMountedModelVersion`, via `<adl-app>`'s own `model.modelVersion`), not
by importing a reference app's model factory into the spec file.**
`band-app.ts` and `jointly-app.ts` load their `.adlj`/`.yaml` sources through
Vite's `?raw` import suffix, which only Vite's own dev/build transform
understands. A Playwright spec file that imports either module directly —
even transitively, for something as small as reading `modelVersion` off a
freshly resolved model — fails to even parse: Playwright's own TypeScript
loader tries to parse the `.yaml`/`.adlj` file as JavaScript and throws a
syntax error before any test runs. `demo-fixture.ts` has no such import and
would likely work, but the mounted-app read works for all three apps
uniformly and needed discovering only once.

**This recurred three more times in the same session that wrote the rule**,
concurrently with this phase's own execution, before this phase's commit
landed: `010dfc8` bumped Giggle Band and Jointly Care from `1.1.0` to `1.2.0`
(a dropped duplicate row-icon fragment changed resolved presentation
content); `cf12207` moved a `themeSwitch` control from the top bar into the
nav drawer, judging (in its own commit message) that `010dfc8`'s bump already
covered the resulting fingerprint change; and `517f874` corrected that
judgment — the theme-switch move needed its *own* bump, `1.2.0` to `1.3.0`,
because `010dfc8`'s bump had already been spent on the row-icon fix. All
three were real, reactively-discovered regressions against a real dev
server, not hypothetical — direct evidence that "change resolved content,
forget the version bump" (or misjudge which bump already covers which
change) is a standing failure mode in this codebase, not a one-off from
`d020b2d`, and that procedural text in `AGENTS.md` is worth writing even
though it cannot yet be mechanically enforced (see this phase's Planning
Handoff for that as a candidate). It also means this phase's own tests were
written against a version number that moved three times *while the phase was
being executed* — direct, immediate motivation for the next paragraph.

**Assert against the model's own current `modelVersion`, not a hard-coded
string.** All three Phase 83 tests assert persisted metadata equals the
*live*, already-mounted app's own `modelVersion`, not a literal like
`"1.1.0"`. A reference app's version advances independently of any one
phase — as the paragraph above demonstrates three times over in one
session — and a literal string in a test goes stale for reasons that have
nothing to do with the test itself. Multi-hop chains are already handled:
`planModelMigration` resolves every declared hop from the persisted version
to the current one in a single migration, so seeding the oldest real version
and asserting the current one exercises the full chain, not just the most
recent hop.

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
