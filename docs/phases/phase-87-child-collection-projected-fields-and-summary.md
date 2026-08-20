# Phase 87 — Child-Collection Projected Fields and Summary

> Commissioned directly by the user, from a real, concrete need: showing a
> set list's total duration on `SetListForm`'s `Songs` child collection
> (the page where songs are actually added/removed/reordered), not on a
> separate browse screen. Preceded by real research into how other
> 4GL/DSL/report-writer systems handle totals (Crystal Reports'
> Summary-vs-Running-Total split, SQL window functions, Airtable
> Rollup-vs-Script, Salesforce Roll-Up Summary field limits — see this
> phase's chat history for citations) and two rounds of architecture
> tracing that corrected an initial, wrong design (a generic `LIST`
> `SUMMARY` construct, which does not reach a child collection's actual
> rendering pipeline at all). Per `learnings/process/phase-execution.md`'s
> standing rule for user-commissioned phases, this does not need to
> justify itself as the next item in a rolling handoff.
>
> **This document is written to be executed carefully, not quickly.**
> Unlike this session's other phases, this one adds genuinely new
> compiler/runtime capability (parser/schema, resolved model, resolver,
> validator, runtime, conformance) rather than relocating or wiring up
> existing pieces. Re-verify every piece of evidence below against current
> code before relying on it — this repo has had many concurrent sessions
> landing work on `main` in short succession; line numbers and exact
> shapes may have moved.

## Objective

Two new, small, tightly-scoped capabilities on a `CHILD_COLLECTION` edit
section, both required together to land a set list's total duration on
`SetListForm`'s `Songs` collection:

1. **Projected lookup fields** — let a child-collection row expose a field
   from a *related* object reached through one of the child object's own
   lookup fields (`SetListItem.Song` → `Song.DurationSeconds`), not just
   the child object's own fields.
2. **A summary** — a single aggregated value (`sum`/`avg`/`min`/`max`/
   `count`) over the collection's current rows (persisted *and* staged,
   so it updates live as songs are added/removed/reordered before save),
   shown once above or below the row list.

Plus one small, honestly-needed supporting piece: a `duration` format kind
(seconds → `m:ss`), without which the total renders as a bare integer.

## Evidence and Dependency

Re-verify against current code before executing.

- **Why this doesn't reach through the generic presentation `LIST` path**:
  a `CHILD_COLLECTION` edit section is evaluated entirely by
  `src/runtime/edit-surface-runtime.ts`'s `evaluateChildCollectionSection`
  (~line 462), producing `RuntimeEditChildCollectionSection` /
  `RuntimeEditChildRow` (~lines 109–151) — a completely separate type
  and code path from `src/runtime/presentation-runtime.ts`'s
  `PresentationRuntime.evaluateList` / `RuntimePresentationList`. A
  construct built against the presentation-`LIST` path (as this phase's
  own first design draft was) never reaches `SetListForm`'s `Songs`
  section. Everything in this document targets
  `ResolvedEditChildCollectionSection` / `evaluateChildCollectionSection`
  specifically.
- **A child collection's fields today come only from the child object's
  own declared fields**: `getChildSectionFields`
  (`edit-surface-runtime.ts` ~line 1105) resolves the child view's
  `fields` list (or, absent a child view, every non-hidden field on the
  child object) purely against `childObject.fields` — `ResolvedField[]`.
  There is no path today for a row's `values` to contain anything not
  directly stored on that record.
- **Row `values` come straight from the stored record**:
  `toPersistedChildRow` (~line 518) and the staged-row equivalent
  (`evaluateStagedChildRows`) both populate `RuntimeEditChildRow.values`
  from the record's own `values`, with no related-object fetch anywhere
  in that path today.
- **Computed fields cannot do this instead — confirmed, not assumed**:
  `src/runtime/computed-fields.ts`'s `applyComputedFieldsToRecord` is
  **synchronous** and evaluates each `ResolvedComputedField.expression`
  via `evaluateExpression(field.expression, { values, context })` — pure,
  over the record's own already-loaded `values` only, no object-store
  access, no `await` anywhere in the call chain. Extending computed
  fields to reach a related object would mean making this evaluation
  async — a broad, invasive change (many call sites) for a need that is
  really scoped to one rendering path. Do **not** go this route; it was
  considered and rejected in favor of the smaller, contained option
  below.
- **The reusable, policy-safe "read one related record" pattern already
  exists, built for exactly this shape of problem**: Phase 71's command
  `READ` step (`src/runtime/command-service.ts`'s `planStepRead`, ~line
  307) reads via `this.objectStore.read(step.object, recordId,
  stepContext)` — object scope, row policy, and field-level read shaping
  (mask/hidden) all apply, a denial throws `PolicyDeniedError`, a missing
  record is a `StorageError`. This is documented there as deliberate:
  "a command step gets no more of the record than the caller could see by
  reading it directly." `edit-surface-runtime.ts` already has the same
  method available on its own `this.dataSource` (confirmed:
  `this.dataSource.read`, `.search`, `.canWrite`, `.evaluatePolicy`,
  `.planCreate/.planUpdate/.planDelete`, `.commitBatch`,
  `.executeReadModel`, `.searchWithQuery` are all already called
  somewhere in this file) — reuse `this.dataSource.read`, do not build a
  second, weaker fetch path, and do not use `ObjectStore.getRecordForRuntime`
  (confirmed elsewhere, Phase 71's own evidence: it "applies **no** read
  policy at all," correct for its own narrow job, wrong here).
- **`ResolvedField`** (`src/model/resolved-model/object-field.ts` ~line
  51): `{ name, storageName, type, required, defaultValue?, validators,
  readonly, hidden, lookup?: ResolvedLookup, autoId?, systemManaged }`.
  `ResolvedLookup` names `targetObject`/`displayField` only — confirm
  its exact shape at execution time.
- **`ResolvedEditChildCollectionSection`**
  (`src/model/resolved-model/view.ts` ~line 64): `{ name, kind:
  "childCollection", childObject, parentField, childView?, operations,
  staged, orderField?, emptyState, picker? }`. This phase adds
  `projectedFields?` and `summary?` here.
- **`PresentationFormatKind`** (`src/model/resolved-model/presentation-row-format.ts`
  ~line 8): currently `"text" | "number" | "date" | "datetime" | "time"`.
  This phase adds `"duration"`. Formatting itself lives in
  `presentation-runtime.ts`'s `formatPresentationValue` (~line 2841
  onward) alongside `formatDate`/`formatTime`/`formatNumber`/
  `formatDateTime` — follow those functions' existing small-closed-
  token-vocabulary style (see `applyDatePattern`/`applyTimePattern`) for
  whatever `duration` pattern tokens are supported; at minimum `m:ss`
  (giggle-new's own real display, "47:20") must work.
- **Precedent for JSON/`.adlj`-only constructs with no `.adl` text
  syntax**: `ResolvedPresentationCalendar.conflictOverlay` (added this
  session, `fac1a70`) is exactly this shape — a new capability declared
  only in `.adlj`, with `print-adl.ts`'s `printView` throwing a named
  error if asked to print a view using it (matching the existing
  treatment of `MATRIX` and composed edit surfaces). `docs/spec/adlj.md`
  already carries a running list of JSON-only constructs; this phase adds
  to it rather than inventing a new pattern. Follow this same treatment
  for both `projectedFields` and `summary` — no `.adl` text grammar for
  either in this phase.
- **The concrete target**: `src/reference/giggle-band/ui.adlj`'s
  `SetListForm` view, `Songs` child-collection section (`childObject:
  "SetListItem"`, `childView: "SetListItemList"`, `parentField: "SetList"`).
  `SetListItem.Song` is a `lookup` field targeting `Song`, which has a
  `DurationSeconds` (`number`) field — confirm exact field name/type at
  execution time; re-verify against `src/reference/giggle-band/domain.adlj`.
- **This is a resolved-model content change**: adding `projectedFields`/
  `summary` to Giggle Band's `SetListForm` changes its resolved model and
  therefore its fingerprint. Requires the same discipline this session
  established the hard way: a `modelVersion` bump (check current version
  in `domain.adlj` at execution time — do not assume a number), an
  empty-object migration (no object's *stored* fields change, only
  presentation/edit-section content), and updating the golden-fingerprint
  tripwire in `tests/band-reference-app.test.ts`. See `AGENTS.md`'s
  "Persisted-state upgrade testing" section for the additional real-browser
  test this also requires.

## Decision

### Projected fields: declared per section, resolved per row, policy-respecting, degrade to `null` on denial or absence

New `.adlj`-only key on a `CHILD_COLLECTION` edit section:

```json
{
  "kind": "childCollection",
  "childObject": "SetListItem",
  "parentField": "SetList",
  "childView": "SetListItemList",
  "projectedFields": [
    { "name": "DurationSeconds", "through": "Song", "field": "DurationSeconds" }
  ],
  "summary": { "...": "see below" }
}
```

`through` must name a field on `childObject` carrying a `lookup`; `field`
must exist on that lookup's `targetObject` and not be `hidden`; `name`
must not collide with any existing field name (own or projected) on the
section. All three are validator-checked (`validate-model/`'s edit-section
validation — locate the current file for
`ResolvedEditChildCollectionSection` validation, likely alongside
`validateViewEditSections`/`validateEditContainerMode` in the `view.ts`
domain file per this repo's Phase 81 split).

Runtime resolution happens in `toPersistedChildRow` and the staged-row
equivalent: for each `projectedField`, read the row's own
`values[projectedField.through]` (the lookup's stored record id) and
fetch via `this.dataSource.read(lookup.targetObject, id, context)`. Three
outcomes, all must degrade gracefully — a denied or missing related
record must not crash the whole collection, matching this project's
general diagnostics-not-crashes posture (`ADL_PRESENTATION_FIELD_MISSING`
is the model to follow, not a thrown exception reaching the UI):
- Found and readable: `values[projectedField.name] = record.values[projectedField.field] ?? null`.
- `PolicyDeniedError`: catch it, set `values[projectedField.name] = null`,
  and record a diagnostic (new code, e.g.
  `ADL_EDIT_CHILD_PROJECTED_FIELD_DENIED`) rather than letting the error
  propagate and fail the entire section.
- Missing/`null` lookup value (row has no `Song` set yet — should not
  happen given `Song` is required on `SetListItem`, but do not assume):
  `values[projectedField.name] = null`, no fetch attempted.

Whether to cache fetched related records within one `evaluateChildCollectionSection`
call (keyed by `` `${through}:${id}` ``) to avoid refetching the same
related record for multiple rows is a real implementation-quality
question, not a correctness requirement — decide based on how the actual
code reads once written, not preemptively.

### Summary: computed once, over the *final* row set, live against staged edits

New `.adlj`-only key, sibling to `projectedFields`:

```json
{
  "summary": {
    "field": "DurationSeconds",
    "aggregate": "sum",
    "label": "Total",
    "format": { "kind": "duration", "pattern": "m:ss" },
    "placement": "footer"
  }
}
```

`aggregate` is a closed set: `sum | avg | min | max | count` — deliberately
not an open expression grammar. Every real system checked in this
phase's research (SQL, Excel, Airtable, Salesforce, Crystal Reports)
converges on exactly this small vocabulary for the declarative case; this
project already prefers closed vocabularies over open expressiveness
where it can (`DECISION_TABLE`'s fixed shape is the same instinct).
`field` must resolve to a field on `childObject` **or** to one of the
section's own `projectedFields` names — validated after `projectedFields`
resolution, in that order — and must be `type: "number"` for
`sum`/`avg`/`min`/`max` (`count` doesn't care about type; it counts rows
with a non-null value, or all rows if `field` is omitted for `count`
specifically — decide the exact `count`-with-no-field shape at
implementation time and document it in the doc's Execution Note).

Evaluated in `evaluateChildCollectionSection`, **after**
`rows: [...persistedRows, ...stagedRows]` is fully assembled — this is
the deliberate reason it lives here rather than in the generic
presentation `LIST` path: this collection already recomputes its full
row set (persisted + staged) on every add/remove/reorder before save, so
a summary computed from that same already-assembled row set updates live
as a person edits, with no additional wiring. Reduce over
`rows.map(r => r.values[summary.field])`, skipping `null`/`undefined`
per-row (same convention `formatPresentationValue` already uses
elsewhere), format the result through `formatPresentationValue`, attach
as a new `summary?: RuntimeEditChildCollectionSummary` on
`RuntimeEditChildCollectionSection`:

```ts
export interface RuntimeEditChildCollectionSummary {
  label?: string;
  text: string;
  placement: "header" | "footer";
}
```

### `duration` format kind

Add `"duration"` to `PresentationFormatKind`. Add a `formatDuration`
function in `presentation-runtime.ts` alongside the existing date/time
formatters, converting a `number` (seconds) into pattern-driven text.
Support at minimum an `m:ss` pattern token (minutes, then seconds
zero-padded to two digits — giggle-new's own real display is exactly
`47:20`). Follow `applyTimePattern`'s existing small-token-vocabulary
style rather than inventing a different convention.

### No `.adl` text syntax for either new construct, this phase

Matching `conflictOverlay`'s precedent exactly: `printView`
(`print-adl.ts`) must throw a named error if asked to print a view whose
`CHILD_COLLECTION` section declares `projectedFields` or `summary` —
do not silently drop them or attempt to invent text syntax under time
pressure. Add both to `docs/spec/adlj.md`'s existing "no ADL text syntax"
list.

## Scope

- **Parser/schema**: `AdljSourceDocument`'s `PartialEditChildCollectionSectionModel`
  (or wherever it's named post-Phase-81 split — confirm current location)
  gains `projectedFields?`/`summary?`. Regenerate the checked-in JSON
  Schema (`npm run generate:adlj-schema`).
- **Resolved model**: `ResolvedEditChildCollectionSection` gains
  `projectedFields?: ResolvedProjectedField[]` and
  `summary?: ResolvedEditChildCollectionSummary`; new
  `ResolvedProjectedField` interface; `PresentationFormatKind` gains
  `"duration"`.
- **Resolver**: `resolve-model/view.ts` (post-Phase-81 split; confirm
  location) — resolve the two new optional section fields.
- **Validator**: `validate-model/view.ts` — validate `through`/`field`/
  `name` for each projected field; validate `summary.field` resolves
  (against own fields ∪ projected field names) and is numeric where the
  aggregate requires it.
- **Runtime**: `edit-surface-runtime.ts` — projected-field resolution in
  row-building; summary computation in `evaluateChildCollectionSection`;
  new diagnostic code(s). `presentation-runtime.ts` — `duration` format.
- **Printer**: `print-adl.ts` — named "no ADL text syntax" errors for
  both new constructs on a `CHILD_COLLECTION` section.
- **UI**: wherever a child collection actually renders today (locate the
  component — likely inside `adl-composed-view.ts` or a dedicated child-
  collection renderer under `src/ui/components/`; do not assume the name,
  confirm by tracing from `RuntimeEditChildCollectionSection`'s consumer)
  — render the projected field's value in each row where the child
  view's row template references it, and render the summary line at
  `header`/`footer` placement.
- **Giggle Band content**: `SetListForm`'s `Songs` section gains
  `projectedFields: [{ name: "DurationSeconds", through: "Song", field:
  "DurationSeconds" }]` and `summary: { field: "DurationSeconds",
  aggregate: "sum", label: "Total", format: { kind: "duration", pattern:
  "m:ss" }, placement: "footer" }`. `modelVersion` bump, empty-object
  migration, golden-fingerprint update, real-browser persisted-upgrade
  test update (per `AGENTS.md`'s standing rule).
- **Tests**: unit coverage for projected-field resolution (found,
  missing-lookup-value, policy-denied cases), summary computation (each
  aggregate kind, staged-row inclusion, empty-collection behavior), the
  `duration` formatter, and a conformance case or two
  (`conformance/presentation/` or wherever child-collection cases live —
  confirm location) proving the shape cross-runtime-testably. A real-
  browser Playwright test/screenshot showing the total rendering on
  `SetListForm` and updating when a song is added or removed before save.
- **Docs**: `docs/spec/adlj.md`'s no-text-syntax list;
  `learnings/implementation/edit-surface-language.md` or
  `ui-presentation-model.md` (whichever more naturally covers child
  collections — confirm by reading both first) gets a new section
  recording this design and, importantly, the two rejected alternatives
  (async computed fields; a generic `LIST`-level `SUMMARY`) and why.

## Constraints

- Do not make computed-field evaluation async to solve the projected-
  field need — considered and rejected, see Evidence.
- Do not use `ObjectStore.getRecordForRuntime` (or any other policy-
  bypassing read) for the projected-field fetch — must be
  `this.dataSource.read`, which applies real policy.
- A denied or missing projected-field fetch must degrade to `null` with
  a diagnostic, not throw and fail the whole section's rendering.
- `aggregate` stays a closed five-value set. Do not build an open
  expression grammar for this phase.
- No `.adl` text syntax for either construct this phase (see Decision).
- No change to the generic presentation `LIST`/`evaluateList` path — this
  phase is scoped entirely to `CHILD_COLLECTION` sections. (A later phase
  may want the same `SUMMARY` idea on a plain `LIST`; not this one — keep
  scope tight.)
- No change to `docs/spec/language.md`'s `.adl` text grammar.

## Deliverables

Listed under Scope; repeated here as the completion checklist.

- `ResolvedProjectedField`, `projectedFields?`/`summary?` on
  `ResolvedEditChildCollectionSection`, `"duration"` on
  `PresentationFormatKind`.
- Parser/schema, resolver, validator, runtime, printer, UI changes above.
- Giggle Band's `SetListForm` updated, version bumped, migrated,
  fingerprint updated, real-browser test updated.
- New unit tests, at least one conformance case, one real-browser
  Playwright proof.
- `docs/spec/adlj.md` and `learnings/` updates.

## Acceptance Criteria

- Loading `SetListForm` for a real set list (e.g. Giggle Band's "August
  headline") shows each song's row and a "Total" line reading `7:18`-
  shaped text (or whatever the actual seeded songs sum to — compute and
  state the real expected value once seeded data is confirmed at
  execution time, do not guess it here) at the section's footer.
- Adding a song via the picker updates the total immediately, before
  Save. Removing a song updates it immediately too. Both proven in the
  real-browser test, not only asserted at the unit level.
- A `SetListItem` whose `Song` lookup cannot be read under the current
  context (construct this case deliberately in a test — a role that
  cannot read `Song`) renders that row without its duration (not a
  crash), and the summary excludes it from the sum, with a diagnostic
  recorded.
- `compileAdlProjectV2`/`compileAdlj` against Giggle Band's real
  `app.yaml`: zero diagnostics.
- `npm run typecheck`, `npm test`, `npm run format:check` pass.
- `npm run verify:push` passes; the `SetListForm` screenshot (desktop and
  mobile) is inspected and shows the total rendering correctly.
- `/impeccable audit` run on whatever UI files changed, per this
  session's own newly-added `AGENTS.md` rule; findings fixed or recorded
  as false positives with reasoning.
- Attempting to print `SetListForm` via `printPartialApplicationModelAsAdl`
  throws the expected named "no ADL text syntax" error rather than
  silently omitting the new content.
- Every pre-existing test still passes unmodified except where this
  phase's own content changes require an assertion update (version,
  fingerprint, migration list) — same discipline as every other phase
  this session.

## Testing

- `npm test` — new unit coverage per Scope, full suite green.
- `npm run typecheck`, `npm run format:check`.
- `npm run verify:push` — full Playwright pass, `SetListForm` screenshots
  inspected on both desktop and mobile.
- `/impeccable audit` on changed UI files.
- `npm run test:integration` — not expected to be required; nothing here
  touches the authority server or PostgreSQL. Confirm this holds once the
  diff is final rather than assumed.

## Non-goals

- **A `SUMMARY` construct on the generic presentation `LIST`** (the
  original, wrong-pipeline design this phase corrects away from). Real,
  separable future work if ever wanted for a non-child-collection list —
  not attempted here.
- **A per-row *running* total** (Crystal Reports' Running Total field
  shape — a cumulative value that changes down the list, distinct from
  one summary value). Genuinely bigger (ordered per-row state); not what
  the concrete need calls for. Named here so it isn't confused with what
  this phase builds.
- **`.adl` text syntax** for either new construct.
- **Multi-hop projected fields** (`Song.Composer.SomeField`-style chains)
  — `through` reaches exactly one lookup hop. If a real need for deeper
  chaining shows up later, that's new scope.
- **Async computed fields** — considered, rejected; see Evidence and
  Constraints.
- **Caching projected-field fetches across multiple `evaluateChildCollectionSection`
  calls** (only within one call is in scope, if done at all) — no
  cross-request cache.

## Dependencies

- `src/runtime/edit-surface-runtime.ts` (the whole feature's real home).
- `src/runtime/command-service.ts` (`planStepRead`, the pattern being
  reused — read-only reference, not modified).
- `src/model/resolved-model/view.ts`, `presentation-row-format.ts`
  (confirm exact current file names/locations post-Phase-81 split).
- `src/compiler/validate-model/`, `src/compiler/resolve-model/`
  (whichever domain files own view/edit-section handling).
- `src/compiler/print-adl.ts`.
- `src/model/adlj-source.ts`, `src/model/adlj-schema.json` (generated).
- `src/runtime/presentation-runtime.ts` (`formatPresentationValue` and
  neighboring formatters).
- `src/reference/giggle-band/domain.adlj`, `ui.adlj`,
  `src/reference/band-app.ts` (seed data, if the total's expected value
  needs a specific seeded duration to be meaningful — check current
  `Song.DurationSeconds` seed values before assuming they already sum to
  something worth showing).
- `tests/band-reference-app.test.ts` (golden fingerprint, version,
  migrations), `tests/browser-model-migration.test.ts`,
  `tests/visual/giggle-band.visual.spec.ts`.
- `docs/spec/adlj.md`.

## Parallel Execution Plan

1. **Serial spine**: resolved-model types
   (`ResolvedProjectedField`, `projectedFields?`/`summary?`,
   `"duration"` format kind) — everything else depends on these being
   settled first.
2. **Fan out, three streams once the spine lands**:
   - Agent A: resolver + validator for both new section fields.
   - Agent B: runtime — projected-field resolution and summary
     computation in `edit-surface-runtime.ts`, plus the `duration`
     formatter in `presentation-runtime.ts`.
   - Agent C: printer (the two "no ADL text syntax" throws) + parser/
     schema (`AdljSourceDocument` additions, regenerated JSON Schema).
   These three genuinely don't depend on each other's implementations,
   only on the shared spine types.
3. **Barrier**: UI rendering (needs B's runtime shape finalized) +
   Giggle Band content authoring (needs A/B/C all landed, since it must
   compile-check against the real validator/resolver/printer) + the
   version bump/migration/fingerprint/persisted-upgrade-test update.
4. **Barrier**: full verification — `npm test`, `typecheck`,
   `format:check`, `verify:push`, `impeccable audit` — once, at the end.

## Tasks

1. Re-verify all evidence above against current code.
2. Resolved-model types (the serial spine).
3. Resolver + validator.
4. Runtime: projected fields, summary, `duration` format.
5. Printer: named errors for both new constructs.
6. Parser/schema: `AdljSourceDocument` additions, regenerate JSON Schema.
7. UI rendering for the projected field and the summary line.
8. Giggle Band content: `SetListForm`'s `Songs` section gains both new
   keys; version bump; migration; seed-data check (does `Song.DurationSeconds`
   already have meaningful seeded values? if not, consider whether to
   seed some — check first).
9. Update `tests/band-reference-app.test.ts` (fingerprint, version,
   migrations, a new assertion proving the summary/projected fields),
   `tests/browser-model-migration.test.ts`,
   `tests/visual/giggle-band.visual.spec.ts` (or a new dedicated visual
   spec) per `AGENTS.md`'s persisted-state-upgrade rule.
10. New unit tests, conformance case(s).
11. Real-browser Playwright proof: total renders, updates live on
    add/remove before save.
12. `npm run verify:push`; inspect screenshots.
13. `/impeccable audit`; address or record findings.
14. `docs/spec/adlj.md`, `learnings/` updates.
15. Fill in this document's Execution Note.
16. Commit and push.

## Planning Handoff

- **`SUMMARY` on the generic presentation `LIST`** — named Non-goal
  above, real candidate if a future need wants a total outside a child
  collection.
- **A true per-row running total** — named Non-goal above, a genuinely
  bigger feature (Crystal Reports' Running Total shape) if ever needed.
- **Multi-hop projected fields** — named Non-goal above.

## Closing Note

Executed in full against `main`, starting from `7b8497f` ("Remove redundant
'Set list editor' nav item") as instructed.

**Re-verification findings (Task 1).** Every piece of Evidence held. The
Phase-81 directory split was confirmed exactly as flagged:
`resolve-model/view.ts`, `validate-model/view.ts`,
`resolved-model/view.ts`/`presentation-row-format.ts` are domain files inside
their respective directories, not single files. `ResolvedEditChildCollectionSection`
matched the doc's sketch field-for-field. `PresentationFormatKind` was
exactly `"text" | "number" | "date" | "datetime" | "time"`. `ResolvedLookup`
carried a `targetField?` the doc's Evidence hadn't mentioned, immaterial
here. `edit-surface-runtime.ts`'s `this.dataSource.read` was confirmed
already used at five other call sites in the file, exactly as claimed.
`fac1a70`'s `conflictOverlay` precedent (both the resolved-model/resolver
shape and `print-adl.ts`'s named-error treatment) matched the doc's
description precisely and was used as the template for both new
constructs' printer guards. Nothing required deviating from the Decision.

**Judgment calls, and how they were resolved.**

- **`summary.placement` default**: `"footer"` — every declarative-total
  system this phase's research surveyed (SQL, Excel, Airtable, Salesforce,
  Crystal Reports) defaults a total below its rows, and Giggle Band's own
  real content wants a footer too.
- **`summary.format` default**: `{ kind: "number" }` when omitted, so an
  author who supplies `aggregate` without `format` still gets a rendered
  value.
- **`count` with no `field`**: counts every row. `count` naming a `field`
  counts only rows with a non-null value for it — both documented on
  `ResolvedEditChildCollectionSummary` itself.
- **Projected-field cache**: implemented, scoped to one
  `evaluateChildCollectionSection` call (keyed by `` `${targetObject}:${lookupValue}` ``),
  cleared at the end of the call — the doc left this as an
  implementation-quality question, not a requirement; it read naturally
  once `toPersistedChildRow` needed to become `async` regardless (to
  `await this.dataSource.read`), so the map is one extra parameter threaded
  through the existing row-building calls.
- **A related record that no longer exists** (the lookup value is a real,
  non-null id, but `this.dataSource.read` returns `null` rather than
  throwing `PolicyDeniedError`): treated the same as a missing lookup value
  — `null`, no diagnostic. The doc's three named outcomes (found; denied;
  absent lookup value) didn't enumerate this fourth case explicitly; a
  dangling reference to a deleted record is not a policy question, so it
  gets the same silent-degrade treatment as "nothing to fetch" rather than
  the warning a denial gets.
- **UI component**: `src/ui/components/adl-form-view.ts`, confirmed by
  tracing forward from `RuntimeEditChildCollectionSection`'s only consumer
  (`renderChildCollection`/`renderChildRow`) — not `adl-composed-view.ts`,
  which the Scope section's own phrasing ("likely inside
  `adl-composed-view.ts` or a dedicated child-collection renderer") had
  flagged as unconfirmed. Child collection rows carry no field *labels* at
  all today (confirmed by reading the existing render path), so the
  projected field's per-row value renders as one more unlabeled cell in
  field order, appended after the child object's own fields — consistent
  with the existing convention, not a new one invented for this phase.
  `/impeccable audit` (below) flagged this as visually ambiguous once
  DurationSeconds was a bare "214" beside prose fields; the real fix
  (muting the projected-field span so it reads as related/computed data
  rather than a stored field) is recorded there, not skipped.

**The real numbers.** Seeded total for Giggle Band's "August headline" set
list: Neon Map (214s) + Late Signal (188s) + Harbour Lights (236s) = 638s =
`10:38`. Adding the picker's one remaining candidate, Slow Tide (245s),
live before Save: 883s = `14:43` — both rendered and asserted in the
real-browser test, and both visible in the inspected screenshots. Seed data
needed no changes; the existing `Song.DurationSeconds` values already summed
to something real. `modelVersion` `1.6.0` → `1.7.0`, one empty-object
migration hop (no object's stored fields change — `Songs`'s
`projectedFields`/`summary` are edit-section content, not a stored field on
any object), golden fingerprint `sha256-c6a3d94c6ee3fa4cad92683fc960fc8be47e24c37bd50181596e759f0eaff970`
→ `sha256-665e32890ac2d5adf090ddc5a7084103cb7ef4a6cbf42043e9f58061aa448377`.

**Deviation: an existing round-trip comment-preservation test needed a
second unprintable-construct strip.** `tests/adl-to-adlj.test.ts`'s Giggle
Band comment-preservation test already special-cased stripping
`conflictOverlay` before printing (the printer's job is to throw for it, not
this test's job to prove that again). `SetListForm`'s `Songs` section now
throws for the same reason, so the helper
(`withoutCalendarConflictOverlays`) was generalized to
`withoutUnprintableJsonOnlyConstructs` and taught to also strip
`projectedFields`/`summary`. Not anticipated by the doc's own Evidence
(which named `tests/band-reference-app.test.ts`, `browser-model-migration.test.ts`,
and the visual spec as needing updates, but not this round-trip test) —
found by actually running `npm test` rather than assuming the listed set was
complete.

**Conformance.** Two new cases in `conformance/model/edit-surfaces.json`:
a `resolveModel` case proving `projectedFields`/`summary` resolve with their
defaults applied (`edit-surface.language.projected-fields-and-summary.001`,
`specRef: adlj#the-printer-one-direction-only`, matching this document's own
"no ADL text syntax" precedent rather than inventing a new specRef pattern),
and a `validateModel` case proving an unknown `through` field and a
non-numeric summary field are both refused
(`edit-surface.validation.projected-field-and-summary.001`, `specRef:
resolved-model#validation`, matching the existing relationship-picker
validation cases in the same file).

**Testing.** New unit suite `tests/child-collection-projected-fields.test.ts`
(13 cases: resolution found/absent-lookup/policy-denied, every aggregate
kind, staged-row live inclusion, empty-collection, the `duration`
formatter) against a dedicated Playlist/Track/Album fixture rather than
Giggle Band's real model — it needed a policy-denied read on the
*projected-field target* specifically (a `Viewer` role that cannot read a
`Private` `Album`), which Giggle Band's real policies have no reason to
model. `tests/band-reference-app.test.ts`'s exact-equality `editSections`
assertion for `SetListForm` was extended with the new keys rather than
loosened. `npm test` (1084 tests), `npm run typecheck`, `npm run
format:check` all pass. `npm run verify:push` passed in full (60 unit test
files / 1084 tests, build, 54 Playwright specs across desktop/mobile/
offline-shell/passkey/administration projects); the `set-list-song-picker`
and `set-list-edit` screenshots (desktop and mobile) were inspected directly
and show `Total 10:38` / `Total 14:43` rendering correctly at the section
footer, right-aligned beside the row list.

**`/impeccable audit`** on `src/ui/components/adl-form-view.ts` and
`src/ui/styles.css` (no `PRODUCT.md` in this repository; proceeded scoped to
the changed files per the skill's own routing for that case). One real
finding, fixed: a projected field's per-row value (e.g. a bare `214`) was
visually indistinguishable from the child object's own stored field values,
reading as a stray number rather than related/computed data. Fixed with
`.adl-child-row-values > [data-child-projected-field] { color:
var(--adl-color-text-muted); }` — token-based, so it carries through dark
mode with no new hardcoded color. Verified: `--adl-color-text-muted`
(`#667085`) against the surface background computes to ≈5.3:1, above the
4.5:1 AA threshold used for both the muted label and the newly-muted
per-row value. Recorded, not fixed (false positive / out of scope): no
`aria-live` region on the summary total when it changes — consistent with
every other dynamic child-collection value in this same component (row
count, row positions), none of which announce their changes today; a
platform-wide live-region pass is a different, separable piece of work, not
specific to this phase's two new fields.

**One unrelated flake observed, not a regression.**
`startup-failure-recovery.visual.spec.ts` (Jointly Care, untouched by this
phase) failed once on `net::ERR_ABORTED` navigating the dev server during a
full `verify:push` run, on a different project (desktop, then mobile) each
time it happened; re-run in isolation it passed cleanly, including with
`--retries=0` on a second attempt. A webServer-startup timing race, not
content this phase changed.

**Non-goals held.** No `.adl` text syntax was added for either construct
(`printPartialApplicationModelAsAdl` throws the named error, proven by a
scratch test during development and by the round-trip test's strip-and-print
above). No change to `evaluateList`/the presentation `LIST` path. No running
total, no multi-hop projected fields, no cross-request cache — all named in
the doc's Non-goals and left alone.
