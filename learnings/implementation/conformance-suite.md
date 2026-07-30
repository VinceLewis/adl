# Conformance Suite and Inspection Tooling

Read this before changing runtime semantics, resolved-model defaults, policy
decision behavior, or the executable conformance corpus.

## Key decisions from Phase 23

- The conformance corpus is versioned JSON under `conformance/`. It carries
  stable case ids, spec references, operation input, runtime context, and
  expected output.
- Shared models may live in a suite-level `models` map and be referenced by
  `modelRef`. This keeps data-driven cases readable while preserving a
  runtime-agnostic corpus.
- `src/conformance/runner.ts` is the TypeScript semantic harness. It executes
  corpus cases through public compiler/runtime surfaces and returns normalized
  pass/fail results. It is not a second runtime.
- The harness supports expression, model resolution, model validation,
  inspection, policy decision explanation, CRUD/search, lifecycle transition,
  command execution, decision tables, read models, offline dataset evaluation,
  sync-mode write denial, and startup compatibility cases.
- Dynamic record ids are normalized to setup aliases in conformance results, so
  cases can assert behavior without depending on generated GUID text.
- `explainResolvedModel` returns the resolved model plus origin entries for
  platform defaults, derived defaults, and source-supplied values. Supplying the
  partial source model gives the most precise origin classification.
- `explainPolicyDecision` and `explainPolicyRequest` expose the winning decision,
  reasons, request, context summary, and precedence category without changing
  authorization behavior.
- The three written spec layers live under `docs/spec/`: language syntax,
  resolved-model contract, and runtime semantics.

## Key decisions from Phase 29

- Presentation conformance cases live under `conformance/presentation/` and run
  through the same `tests/conformance-suite.test.ts` loader as the expression
  and runtime suites.
- The conformance runner supports `evaluatePresentationView` as a runtime
  operation. Cases seed records through public runtime create steps, then call
  `ApplicationRuntime.evaluatePresentationView` and assert renderer-neutral
  sections, controls, lists, rows, fragments, icons, state, diagnostics, and
  empty states.
- Presentation conformance remains DOM-free. Browser component tests can cover
  rendering, but the cross-runtime corpus pins model resolution, validation,
  inspection, and evaluator semantics.
- Inspection conformance can select presentation origin paths. `explainResolvedModel`
  now includes presentation defaults and reference-bearing declarations such as
  local state, icon-map fields, control state references, list sources, row
  fields, and fragment style defaults.

## Key decisions from Phase 51

- **Corpus files are discovered, not listed.** `tests/conformance-suite.test.ts`
  globs `conformance/*/*.json`. A corpus file that exists but is not run is
  indistinguishable from one that passes, and the suite is the cross-runtime
  contract — adding a case must not also require remembering to register it.
- Four operations were added: `compareModelFingerprints`, `migratePersistedState`,
  `authorityReplay`, and a `persistedModel` input on `startupCompatibility`.
- **A case must never hard-code a derived digest.** A literal `sha256-…` in the
  corpus would pin the entire resolved-model shape and break on any unrelated
  model addition, teaching a second runtime nothing. `compareModelFingerprints`
  asserts the *relation* between two models' fingerprints; `persistedModel` names
  the model that wrote persisted state and lets the runner derive the metadata.
  Reach for one of those instead of a literal, always.
- `migratePersistedState` reports the resulting records **read back from storage**
  rather than as returned by the migration, so a case proves what was persisted
  rather than what was intended. A refusal reports the same shape as a success,
  because the state a refusal left behind *is* the fail-closed guarantee.
- `authorityReplay` normalises an outcome to its classification plus record ids
  and values. Revisions, timestamps and actor ids are generated, so asserting the
  whole record would make every case a snapshot.
- Authority cases seed their setup **through the same replay path**, so nothing
  in a case bypasses the authority to arrange its preconditions.
- An expected value of `"$absent"` asserts the key is **not present**. Reach for
  it whenever the guarantee under test is that something was withheld: partial
  matching proves what a result contains, never what it omits.

## Defects the Phase 51 expansion revealed

Growing the corpus from 28 cases to ~470 found eleven real defects. Every one was
fixed in the runtime and pinned by a case; none was absorbed by weakening a case.
Recorded because the *shape* of these repeats:

1. **A digest that included its own selector.** `modelVersion` was inside the
   model fingerprint, so re-spelling `1.1` as `1.1.0` — the same version —
   changed the digest, the guard refused, and the only remedy it could name was
   itself a validation error. Excluded the version from the digest.
2. **String equality where the codebase compared component-wise.**
   `planModelMigration` tested `===` on versions while validation used
   `compareModelVersions`. Same class of bug as (1), found independently by two
   agents. Anything used as a map key or set member is now normalised first.
3. **Classification by prose.** `explainPolicyPrecedence` decided "was this a
   default deny?" by substring-matching the human-readable reason message, so a
   rule *named* "the default deny probe" made an explicit refusal report itself
   as `defaultDeny`. Now keyed on structure (the synthesised reason is the only
   one with no `ruleName`).
4. **A transaction that threw without aborting.** `IndexedDbObjectStorageBackend.commitTransaction`
   raised its own refusals without `abort()`, so IndexedDB auto-committed the
   writes already issued. Request errors abort on their own — a refusal you raise
   yourself has to say so. This one made a migration's own "persisted data is
   unchanged" diagnostic capable of lying.
5. **Validators that could never fail.** A named field validator whose kind did
   not suit the field type, or which omitted its bound, was silently inert with
   nothing reported at any layer — `MIN 5` on a text field did nothing. Now a
   compile-time error. A second runtime could have implemented it any way at all.
6. **A hard-coded policy flag.** The authority's missing-record conflict passed
   `manual: false` literally, so an object declaring manual conflict resolution
   had the update-versus-delete race resolved automatically, while the
   stale-revision path on the same object escalated.
7. **A grammar with no way to satisfy it.** `SCHEMA_VERSION` inside a `MIGRATION`
   block parsed, and was the worked example in the spec and in the parser's own
   doc comment, but `OBJECT` had no `SCHEMA_VERSION` directive — so the only
   legal value was the one that changes nothing, and the documented example was
   uncompilable.
8. **A number formatted for parsing.** `decimalFromNumber` used `toString()`,
   which switches to exponential below `1e-6`, so `0.0000001` failed the decimal
   grammar and reported `DECIMAL_OVERFLOW` — for a value inside the range, and
   for a reason that was an artifact of one language's formatting rather than of
   ADL.
9. **One temporal kind compared by spelling.** `time` was compared as raw text
   while `datetime` normalised through `Date.parse`, so `09:00 < 09:00:00`.
10. **A dead-ending migration chain that validated clean.** Bumping
    `MODEL_VERSION` and forgetting the `MIGRATION` block was discovered at
    startup on the one install still holding old data, though it is entirely
    statically decidable.
11. **A repository phase number in a cross-runtime error message** ("reserved for
    Phase 21 expansion"). A second runtime has no phases.

Two further inconsistencies were found, recorded in the spec, and deliberately
*not* changed, because altering equality semantics repo-wide is beyond a
conformance phase: ordering coerces text↔temporal while equality does not (and
field references never carry a temporal kind, so `SomeDateField == DATE '…'` is
always false while `>=` works), and datetime equality is textual while ordering
is instant-based. Both are now stated in `runtime-semantics#expression-errors`
as known sharp edges rather than left for a second implementer to discover.

## Gaps the corpus still cannot express

Recorded so a later phase does not have to rediscover them.

**Closed in Phase 51 because it was too serious to defer:** absence could not be
asserted at all. `partialDeepMatch` walks only the expected object's keys, so no
case could prove that a hidden or policy-denied field is *omitted* from returned
values — the actual disclosure guarantee — and a runtime returning every hidden
field verbatim would have passed the whole suite. An expected value of
`"$absent"` now asserts that the key is not present.

Still open:

- **`baseRevision` cannot be named**, so the few authority cases needing a
  successful update hard-code `"rev-1"`, pinning a revision *format* that no spec
  defines. Wants a setup alias, or a `$current` sentinel the runner resolves.
- **Setup outcomes are discarded** in `authorityReplay`, so a seed that was
  itself rejected leaves a case passing for the wrong reason.
- **`localPrivate` is indistinguishable from `localFirst`** to the corpus:
  `queueable` is observable only inside a refusal payload, so "allows local
  writes but never queues them" — the defining half of the mode — cannot be
  pinned.
- **`ADL_MIGRATION_FAILED` and atomic rollback have no corpus coverage**, because
  the in-memory backend always supports transactions and never throws. Covered by
  unit and real-PostgreSQL tests instead. Wants an `input.storage` selector.
- Setup steps offer only `create`/`update`/`transition`: no `delete`, so nothing
  involving a tombstone is reachable. No runtime case can seed storage directly,
  so "computed values are not persisted" cannot be proven.
- Arrays must match by exact length, which makes 42-cell calendar cases mostly
  placeholders and invites off-by-one authoring errors.
- Eight declared presentation diagnostic codes are unreachable through
  `evaluatePresentationView`, because model validation rejects those models
  first. A second runtime is unconstrained on them.

## Practical guidance

- Add or update conformance cases whenever a semantic behavior changes. Each
  case must have a stable id and a `specRef` pointing at the relevant spec
  section.
- Keep expected outputs focused on the semantic surface being pinned. The
  harness uses partial matching for expected objects but exact ordering for
  arrays.
- Do not make conformance JSON import TypeScript modules or runtime internals.
  Use resolved expressions, partial models, runtime context data, and operation
  inputs as plain JSON.
- If implementation and intended semantics disagree, fix the implementation only
  when it is a defect in already-implemented behavior; otherwise update the spec
  and corpus to match current behavior.
