# Phase 91 — Read-Model Lookup Display Resolution

A read-model field projected `FROM <source>.<lookupField>` loses the source
field's `LOOKUP … DISPLAY` resolution, so every presentation surface backed by
a read model renders a raw stored record id where a human-readable name
belongs. The same stored value renders correctly in an object-backed view.
This phase closes that gap.

## Objective

Make a read-model field that projects a lookup field carry enough of that
lookup forward that consuming surfaces render the target's display value, not
its record id — without denormalising a value the viewer's policy does not
permit them to read.

## Evidence and Dependency

Observed in the running Giggle Band demo: the `BandMemberAvailabilityBoard`
view's `Who is free` list renders every row as

```
user-c52bac75-ddef-410e-826b-aed089184f12 - BandAdmin - Sat 1 Aug - Unavailable
```

The raw id is not fixture noise. The model declares a display projection for
exactly this field:

- `src/reference/giggle-band/domain.adl:62` —
  `FIELD User TEXT REQUIRED LOOKUP User DISPLAY Name`
- `src/reference/giggle-band/domain.adl:338` —
  `READ_MODEL BandMemberAvailability` projects `FIELD Member FROM member.User`

The projection at line 338 produces a plain text field. Nothing on the
resolved read-model field records that its source declared
`LOOKUP User DISPLAY Name`, so no consumer can know to resolve it.

The asymmetry is what makes this a defect rather than a design limit. The
*same* underlying `BandMember.User` value renders as a name in
`BandMemberList` (an object-backed `LIST` view), because
`src/ui/components/adl-list-view.ts` carries a lookup-label resolver:

- `adl-list-view.ts:305-309` — `formatCellValue` swaps a stored id for a cached
  label when `field.lookup !== undefined`
- `adl-list-view.ts:323-362` — an async prefetch pass reads each lookup target
  through the runtime and caches `record.values[field.lookup.displayField]`,
  **falling back to the raw record id at line 362** when the target cannot be
  read
- `src/ui/components/lookup-resolution.ts` — the shared read helper

The presentation path has no equivalent. `PresentationRuntime`'s field-text
evaluation formats the projected value as-is, and — critically — could not do
better even if it had the resolver, because the resolved read-model field
carries no `lookup` to act on. Both halves have to be addressed.

**Dependency:** this phase touches `src/runtime/presentation-runtime/`, which
Phase 90 restructured. Phase 90 must be merged and its verification green
before this phase begins. Confirm against `git log` rather than assuming.

**Prior art to read before deciding anything:**
`learnings/implementation/read-model-runtime.md`,
`learnings/implementation/browser-ui-runtime.md`,
`learnings/implementation/presentation-runtime-file-map.md` (Phase 90),
`learnings/implementation/reference-app-models.md`.

## Decision

### The resolved model must carry the lookup; the runtime must resolve it

`CLAUDE.md` states the runtime consumes the resolved model, not parser AST
nodes, and that UI behaviour must never be the only enforcement point. A fix
that only teaches one UI component to resolve labels would repeat the mistake
that produced this defect: `adl-list-view.ts` already solved it privately, and
that private solution is exactly why the two surfaces disagree.

So the projection must carry the source field's lookup metadata into the
resolved read-model field, and resolution must happen in a runtime service
that every consuming surface goes through.

### The policy constraint is the hard part — resolve at read time, not projection time

Reading a lookup target's display value is a record read, and record reads are
policy-governed. Denormalising the target's `Name` into the projected row at
read-model projection time would hand the viewer a value they may not be
entitled to read, turning a cosmetic fix into a policy leak.

`adl-list-view.ts:350-362` already models the correct behaviour: attempt the
read through the runtime, and **fall back to the raw record id** when the read
returns nothing. Preserve that shape. A denied or missing target must degrade
to the id, never to a fabricated or cached-from-elsewhere name.

Executing agent: verify this claim against the policy layer before building on
it. If read-model projection is already policy-checked per source record such
that projection-time denormalisation is safe, say so with evidence and take
the simpler route — but do not assume it.

## Scope

- Resolved model: a read-model field projected from a lookup field carries
  that lookup (target object + display field), or an equivalent that lets a
  runtime service resolve it.
- Compiler: `resolve-model/read-model.ts` populates it;
  `validate-model/read-model.ts` gains whatever diagnostic the new metadata
  makes possible (e.g. a projection naming a display field that does not
  exist on the target).
- Runtime: display resolution available to presentation surfaces, with the
  policy-safe fallback above.
- `src/ui/components/adl-list-view.ts`: if the new runtime path subsumes its
  private resolver, converge on the shared one. If it does not, say why in
  the Execution Note rather than leaving two resolvers silently.

## Non-goals

- No change to `.adl`/`.adlj` authoring syntax. This is projection metadata
  the compiler derives, not something an author writes.
- No change to which records a read model returns, or to join semantics.
- Not a general denormalisation feature for read models.
- The Giggle Band text and shell-chrome defects are Phase 92; do not fold
  them in.

## Constraints

- `.adlj` is the authoring surface. If any reference-app source changes, edit
  `.adlj` and regenerate; `src/reference/giggle-band/ui.adl` and `domain.adl`
  are superseded citation references whose line numbers are cited across
  `docs/` — **do not edit them** (see the note at the end of each file).
- Never weaken a constraint, loosen a test, or adjust a conformance case to
  make verification pass.
- Any ADL source drafted must be run through the compiler and its
  `diagnostics` checked before being relied on.

## Acceptance Criteria

1. `BandMemberAvailabilityBoard`'s list renders member names, not
   `user-…` ids.
2. `BandMemberList` still renders names — the object-backed path is
   unregressed.
3. A lookup target the viewer may not read, or that does not exist, renders
   the raw id and does not throw.
4. No `.adl` file under `src/reference/` is modified.
5. `npm test` green with no test loosened; new tests cover the projection
   metadata, the resolution, and the denied/missing fallback.

## Testing

- Unit: compiler tests that the projected field carries the lookup; runtime
  tests for resolution, denial fallback, and missing-target fallback.
- `tests/band-reference-app.test.ts`: assert the rendered row text contains a
  member name and **no** `user-` id prefix.
- Policy: a test proving a viewer denied the lookup target sees the id, not
  the name. This is the criterion that must not be skipped.
- `npm run test:integration` if any authority/projection path changes.
- `npm run verify:push` once, at the end, and inspect the screenshots — the
  Giggle Band snapshots will legitimately change, since a visible string
  changes from an id to a name. Confirm each diff is exactly that.

## Parallel Execution Plan

Do not fan out. The change is a single thread through resolved model →
compiler → runtime → one or two UI consumers, and each stage needs the
previous stage's real output. Serial.

## Tasks

1. Verify the Evidence section still holds against current code.
2. Establish the policy behaviour of read-model projection; record the finding.
3. Resolved-model shape, then compiler population, then validation diagnostic.
4. Runtime resolution with the fallback.
5. Converge `adl-list-view.ts` or justify not doing so.
6. Tests, then `verify:push`, then a `learnings/` update, then commit.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**, not merely the next gap in this subsystem.
Phase 92 is already written and queued; if this phase's findings change its
scope, say so explicitly rather than silently executing a stale document.

## Execution Note

Executed in full against `main` at `02f8fa2`, serially, exactly as the Parallel
Execution Plan directed (no fan-out).

### Re-verification (Task 1): one half of the Evidence was wrong, and it mattered

The projection half held exactly. `READ_MODEL BandMemberAvailability` does
project `FIELD Member FROM member.User`, `BandMember.User` does declare
`LOOKUP User DISPLAY Name`, `ResolvedReadModelField` carried no lookup, and the
board did render `user-c52bac75-… - BandAdmin - Sat 1 Aug - Unavailable`.

**The asymmetry claim did not hold.** This document states that "the *same*
underlying `BandMember.User` value renders as a name in `BandMemberList`",
citing `adl-list-view.ts`'s resolver as proof that the object-backed path
already worked. It did not. `adl-list-view.ts` resolves a label through
`runtime.read("User", …)`, and in Giggle Band that read is **denied to every
band member**:

- `POLICY UserPolicy ON User` granted `SEARCH`/`READ` to `ROLE BandMember`.
- `User` is neither scoped to `Band` nor the `Band` context's bound object, so
  `getPolicyRequestContextTargets` (`src/runtime/context-scope.ts:112-119`) can
  only evaluate a `User`-object check against the `User` context — the caller's
  own identity selection. A `Band`-derived context role can never reach it.
- Confirmed empirically before changing anything: with the real seeded
  `firstBandContext`, `runtime.read("User", musician, ctx)` threw
  `PolicyDeniedError`.

So both rules were inert, no band member could read or search a single `User`
record, and **every** `LOOKUP User DISPLAY Name` label in the app degraded to a
raw id — not just the read-model one. This is precisely the trap
`learnings/implementation/policy-engine.md` already documented from Jointly
Care; Giggle Band shipped it too and nothing detected it. Both lookup-label
resolvers degrade silently by design, which is what made it invisible.

**Scope adjustment taken.** Acceptance criterion 1 ("the board renders member
names") is unreachable without fixing the policy, so the fix is in this phase:
`UserPolicy`'s two rules moved from `ROLE BandMember` to `AUTHENTICATED`,
mirroring Jointly Care's own `UserPolicy` verbatim, including its recorded
rationale (a caller may look a collaborator up to invite or recognise them; that
does not depend on already sharing a context — which is what Giggle Band's
`BandInvitation.Invitee`/`InviteeEmail` pair already assumes). The rationale is
carried as a `comment` on the policy in `domain.adlj`.

Stated plainly because it is a widening: `AUTHENTICATED` grants more than the
dead rules *said*. The narrower alternative — "only people I share a band with"
— is not expressible today: `CONTEXT_MEMBER` reads `record.values[field]`, and a
`User` record has no field holding its own id. Letting `contextMember.field`
accept `id` (the way `RECORD_ID_JOIN_FIELD` already means the record's own id
for a read-model join) is the extension that would express it, and was
deliberately **not** attempted here — it is a language change, not this phase's
subject.

### The open decision: is projection already policy-checked enough to denormalise?

**No.** The document's assumption was right, and the reasoning is sharper than
"reads are policy-governed":

- Read-model projection *is* policy-checked per **source** record.
  `ReadModelService.searchAuthorisedSourceRecords` clears `search`, object
  scope, source scope and per-record `read` before a record can reach a row, and
  `projectRow` runs each source record through `policyEngine.applyReadPolicy`
  for field-level shaping.
- A lookup **target** is not a source record. It is a record on another object,
  reached by a value, and *nothing* in the projection path covered it.
  Denormalising `User.Name` into the row during projection would have handed
  every caller a value no check had authorised.

So the simpler route was not safe, and read-time resolution was built — but
placed in `ReadModelService` rather than in a UI component, because that is the
one runtime service every read-model consumer already goes through, and because
that class already owns policy-checked target reads for its implicit lookup
joins (`readLookupTargetById`, `findLookupTargetByField`).

### What was built

- **Resolved model.** `ResolvedReadModelField.lookup?: ResolvedLookup`
  (`src/model/resolved-model/read-model.ts`). Derived, never authored —
  `resolveReadModelField` copies it from the source object's field, exactly as
  it already copied that field's `type`. Expression fields never inherit one.
- **Validation.** `ADL_READ_MODEL_FIELD_LOOKUP_MISMATCH`
  (`validateProjectedFieldLookups`). The document suggested "a projection naming
  a display field that does not exist on the target"; that is already reported
  once against the object field itself
  (`ADL_LOOKUP_DISPLAY_FIELD_UNKNOWN`/`ADL_LOOKUP_TARGET_OBJECT_UNKNOWN`), and
  repeating it would give one mistake two diagnostics. What the new metadata
  makes newly checkable is *disagreement* between the projected lookup and the
  field it projects — unreachable from `.adl`/`.adlj`, but reachable for a
  resolved model deserialised from JSON or built by another toolchain, which
  `ApplicationRuntime` validates and then acts on.
- **Runtime.** `RuntimeReadModelRow.display?: Record<string, string>`, filled by
  `attachLookupDisplayLabels` **after** limiting (only rows actually returned
  cost a read) and cached per `(targetObject, targetField, displayField,
  value)`. `resolveLookupDisplayLabel` reads the target, checks
  `recordMatchesObjectScope`, and takes the display field from
  `applyReadPolicy`'s output, so a field-level `HIDE`/`MASK` is honoured rather
  than read around. A `targetField` lookup is a match by field value — a search
  however it is spelled (Phase 68) — so it additionally clears the `search`
  action and `requireObjectScopeForSearch`, both caught rather than thrown. Every
  refusal returns `undefined`, and the surface falls back to the stored value.
- **Separate channel, not substitution.** `values` still holds the stored id, so
  `WHERE`, `ORDER BY`, expression fields and row actions are untouched. Only what
  a person reads changes.
- **Consumers.** `BoundPresentationRow.display` carries it through
  `readModelRowToPresentationRow` into `evaluateFieldText` (a label wins over a
  declared `FORMAT`: every format pattern describes the stored id, so applying
  one could only emit an invalid-value diagnostic for a value nobody sees) and
  into a calendar item's title/summary; `adl-dashboard-view.ts`'s `readValue`
  prefers it. `authoritative-reporting.ts`'s `shapeReportRow` and
  `edit-surface-runtime.ts`'s picker filter deliberately still read `values` — a
  report is data, and a filter matches what is stored.
- **Spec.** `docs/spec/resolved-model.md` (the derived field, and that a
  disagreeing model is invalid), `docs/spec/runtime-semantics.md` (a new
  `### Projected lookup display values` section carrying the three contract
  properties), `docs/spec/language.md` (the authoring-side note that there is
  nothing to author).

### `adl-list-view.ts` was not converged — why

Its resolver operates on `StoredObjectRecord`s from an object-backed `search`,
not on read-model rows, so the new path does not subsume it. It already routes
through the shared `lookup-resolution.ts` helper over policy-checked
`runtime.read`/`runtime.search`. `ReadModelService` cannot reuse that helper:
it takes an `ApplicationRuntime`, and `ReadModelService` is one of that
runtime's own collaborators, so the import is a cycle. The two paths converge on
the *rule* — policy-checked read, degrade to the stored value — not on one
function. Recorded here rather than left silent, as the Scope section required.

### Unplanned consequence: two apps, not one

`ResolvedReadModelField.lookup` is resolved-model content, so it changes
`modelFingerprint` for every app whose read models project a lookup field. That
is Giggle Band **and Jointly Care** (`MyPendingCircleInvites.Invitee`,
`CircleRecentMessages.SentBy`, both `LOOKUP User DISPLAY Email`). Per AGENTS.md's
persisted-state rule both were bumped with their own empty-object hop:
Giggle Band `1.7.0 → 1.8.0`, Jointly Care `1.3.0 → 1.4.0`. Jointly Care's
*rendering* does not change — neither field appears in a row template — so its
screenshots are identical; only its fingerprint moved. The browser demo fixture
declares no read models and is unaffected. Both apps' persisted-upgrade
Playwright specs read the live `modelVersion` from the mounted app (the Phase 83
rule), so neither needed editing.

### Tests

New: `tests/read-model-lookup-display.test.ts` (14 cases — resolved-model
derivation including `TARGET_FIELD`, both mismatch diagnostics, resolution,
stored-value preservation, missing target, **denied target**, hidden display
field, denied `search` on a `TARGET_FIELD` target, and two presentation cases
asserting the rendered fragment is the name and, under denial, the raw id).

New: `conformance/runtime/read-model-lookup-display.json` — 4 cases, because
this is a cross-runtime contract, not a TypeScript detail. Adding them required
one runner change: `normaliseResult`'s read-model branch now passes `display`
through and puts `values` through the alias table. The second half is not
cosmetic — a read model that projects a lookup field puts a *generated record
id* in `values`, and the corpus's own no-generated-values check forbids a case
depending on one, so "the stored id survives" was previously unassertable.

Modified (each a string/structure this phase deliberately changed, none a
loosening):

- `tests/band-reference-app.test.ts` — `modelVersion` `1.7.0`→`1.8.0`; the
  golden fingerprint (twice: once for the resolved-model change, once for the
  policy fix); a new `1.7.0 → 1.8.0` migration-hop assertion. Plus two **new**
  tests: the roster renders `Casey Morgan` and contains no `user-` prefix, and
  the object-backed path's own resolver (`resolveLookupTargetRecord`, the exact
  call `adl-list-view.ts` makes) now returns the name, with `search` working too.
- `tests/jointly-reference-app.test.ts` — `modelVersion` `1.3.0`→`1.4.0`, golden
  fingerprint, new hop assertion.
- `tests/browser-model-migration.test.ts` — the same version/hop updates, plus
  the `MIGRATION_APPLIED` diagnostic's `expected` version and the asserted
  persisted metadata.

### Verification

- `npm test`: **61 files / 1,104 tests, all passing** (baseline was 60/1,084).
- `npm run verify:push`: **exit 0**, typecheck + format:check + vitest + build +
  **54 Playwright tests passing**. Run redirected to a file, never piped to
  `tail`. No flake seen from `startup-failure-recovery.visual.spec.ts` this run.
- Screenshots inspected: `giggle-desktop-who-is-free.png` and
  `giggle-mobile-who-is-free.png` now read `Casey Morgan - BandAdmin - Sat 1 Aug
  - Unavailable` (the intended change; mobile wraps cleanly at the longer
  string). Every other Giggle Band and Jointly Care screen was checked for a
  knock-on from the policy widening and none changed: `Bands` lists bands not
  members, `Sent invitations` and Jointly's `Your pending invites` render
  `InviteeEmail` (plain text), the event form carries no user lookup, and
  Jointly's `Recent messages` row template renders only `Body`, never `SentBy`.
- `npm run test:integration`: **157/158 passing.** The one failure,
  `edit-surface-batch.test.ts > lands an inline child edit beside a child create
  as one operation` ("Object constraints failed"), is **pre-existing** — it
  reproduces identically on a stashed working tree at `02f8fa2`. Not caused by
  this phase and not fixed in it.

### Not proven

- The `AUTHENTICATED` widening on `UserPolicy` is a product judgement carried
  over from Jointly Care's precedent, not something a test can settle. If the
  intent really is "only band co-members", the `contextMember.field: "id"`
  extension above is the work to schedule.
- `/impeccable audit` was not run for this phase. The only rendering delta is
  text content (`adl-dashboard-view.ts`'s value selection and one presentation
  fragment); no markup, class or CSS changed. The affected screen is exactly the
  one Phase 92 rebuilds chrome for, so the audit is run there, over both phases'
  surface, rather than twice.

## Planning Handoff

**Next phase: Phase 92**, as queued, unchanged in scope — nothing found here
invalidates it. Its Evidence was spot-checked while working in the same files
and still holds: `ui.adl:324`'s `Who is free` heading, the view-level
`LEGEND MyScheduleLegend`, and all three chrome defects are visible in this
phase's own `giggle-mobile-who-is-free.png`.

Justification as the highest-value remaining gap repository-wide: its five items
are live, user-facing defects in the app that is this repository's showcase, one
of them (`Install`'s contrast on the blue top bar) an outright WCAG AA failure,
and all five were found by a human on a real phone — the exact failure mode
AGENTS.md's design-review rule exists to close and which has now recurred.
They are individually small, share one `verify:push` pass, and carry no
architectural risk.

**The leading candidate for Phase 93, discovered by this phase**, is a
compile-time diagnostic for an unreachable `ROLE` principal: a `specific`
principal naming a role only ever earned through a context's `MEMBERSHIP`, on an
object that is neither scoped to that context nor that context's bound object,
can never match. It is decidable exactly where
`ADL_POLICY_SEARCH_CONDITION_UNREACHABLE` and
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` already are, and **both** shipped
reference apps hit it — Jointly Care found it by hand and worked around it,
Giggle Band shipped it and it stayed live until this phase, silently denying
every `User` read in the app. A documented footgun that recurs is a missing
diagnostic, and this is the second time that has been true in this repository's
policy layer. It is ranked below Phase 92 only because Phase 92's defects are
already diagnosed, already user-visible and cheaper; if Phase 92's own handoff
finds its two named candidates weaker than this, this is what should follow.
