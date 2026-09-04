# Phase 109 — Weight Without Behaviour Change

`src/ui` is 13,824 lines for 17 components, and 605 of them are demo fixture data
that **ships in the production bundle**: `demo-fixture.ts` is imported by
`src/ui/components/adl-app/data.ts:5` and `src/ui/components/adl-app/state.ts:23`,
both statically reachable from `src/ui/main.ts`. A further 978 lines
(`authority-sync.ts`) contain two DOM references in total and are not UI at all.
`object-store.ts` is 2,187 lines carrying four separable concerns;
`edit-surface-runtime.ts` is 1,506 carrying two. Every claim in that paragraph was
measured statically (see Evidence).

This phase moves code. It changes no behaviour, adds no feature, fixes no defect,
and must not alter a single test assertion. It exists so that the phase that
follows it — replacing the `innerHTML` render path, which *does* change behaviour
— starts from files small enough to reason about.

Bundle-size figures below are **inferred** from the Phase 73 note in
`src/index.ts`, not measured in this session. Measure before and after.

## Objective

Four extractions and one relocation, all pure moves:

1. `demo-fixture.ts` leaves the statically-reachable bundle.
2. `authority-sync.ts` moves out of `src/ui`.
3. `object-store.ts` sheds ordered collections, write constraints, record
   construction, and sync reconciliation.
4. `edit-surface-runtime.ts` sheds the relationship picker and child collections.

Afterwards `npm test`, `npm run test:integration`, and `npm run test:visual` pass
with **no assertion edited** — only import paths. That invariant is the phase.

## Evidence and Dependency

All measurements below are static (`grep`/`wc` over the working tree at
`d5cec9c`). None were produced by executing the application. Where a claim
depends on runtime or build behaviour it is marked **inferred** and must be
measured during execution before it is relied on.

### 1. `demo-fixture.ts` is statically reachable from the browser entry point

`src/ui/demo-fixture.ts` is 605 lines. It is imported by:

- `src/ui/components/adl-app/data.ts:5` — `seedBrowserDemoRuntimeIfEmpty`
- `src/ui/components/adl-app/state.ts:23`

Both live in the `adl-app` component tree, which `src/ui/main.ts:1` reaches via
`./components/register.js`. The import is static, so Rollup cannot drop it.

**Inferred:** that this measurably increases the production bundle. `src/index.ts`
records the Phase 73 measurement — 684 KB → 852 KB raw, 158 KB → 203 KB gzip —
for a comparable accidental inclusion, and its stated rule is that barrel
exclusion alone is not proof: build and inspect `dist/assets/index-*.js`. Do that
first, record the number, and if the delta is negligible **say so and drop this
item** rather than doing the work for its own sake.

### 2. `authority-sync.ts` is not a UI module

978 lines in `src/ui/`, containing 2 matches for
`document.|HTMLElement|customElements` in the whole file. It is a sync client
filed under the UI directory. `src/ui/main.ts:6` imports
`readBrowserAuthorityConfiguration` from it and `main.ts:9` imports its
`BrowserAuthorityConfiguration` type, so it is genuinely used at startup — this
is misplacement, not dead code.

Moving it does not shrink the bundle. It shrinks the number that "the UI layer is
13.8k lines" reports, which is the point: 7% of that figure is not UI.

### 3. `object-store.ts` — four separable concerns, with seams

The plan/commit factoring is **already clean** and is not a target: `create:176`
delegates to `planCreateForTransaction:203` then `commitPlannedTransaction:598`,
and `update`/`delete` follow the same shape. There is no duplication to remove
here. The file is large because it holds four concerns, not because it repeats
itself.

- **Ordered collections** — `expandOrderedCollectionWrites:1380`,
  `planOrderedCollectionMoves:1711`, `compactOrderedScope:1824`,
  `shiftOrderedScopeForAnchor:1857`, `recordOrderedCause:1909`,
  `findOrderedOccupant:1928`. ~400 lines. `tests/ordered-collections.test.ts`
  already names this concern; only the source does not.
- **Write constraints** — `requireConstraintsForWrites:1441`,
  `getFinalConstraintRecords:1548`, `requireProtectedRoleConstraint:1955`.
  ~250 lines. `tests/protected-role-constraint.test.ts` covers it.
- **Record construction** — `mintAutoIdFields:1151`, `mintAutoIdValue:1170`,
  `buildNewRecord:1207`, `updatedRecord:1239`, `deletedRecord:1271`,
  `writtenSyncStatus:1312`. ~170 lines.
- **Sync reconciliation** — `reconcileRemoteRecord:362`, `setRecordSyncState:903`,
  `listRefusedRecords:954`, `summariseRecordSyncState:982`,
  `discardRefusedRecord:1012`, `getRecordForSync:1067`. ~250 lines. This is a
  second, different caller of the store — the authority sync path, not the
  application CRUD path — and it is interleaved with CRUD by line number.

Residual `ObjectStore`: ~1,100 lines of CRUD plus `commitPlannedTransaction`.

**Unverified and load-bearing:** the private methods above close over `this.index`,
`this.policyEngine`, `this.validationEngine`, `this.logger`. Extraction therefore
means free functions taking those as parameters, not a naive cut-and-paste.
Confirm each extracted unit's actual dependency set before moving it; if a unit
needs four or more collaborators passed in, leaving it in place is the better
answer and should be recorded as such.

### 4. `edit-surface-runtime.ts` — two clusters

- **Relationship picker** — `evaluateRelationshipPicker:404` and its helpers
  `summarizePicker:1354`, `pickerSearchFields:1369`, `pickerDisplayFields:1388`,
  `pickerCandidateLabel:1401`, `filterReadModelPickerRows:1420`,
  `sortPickerCandidates:1438`, `compareJsonValues:1455`, `primitiveText:1466`.
  ~350 lines.
- **Child collections** — `computeChildCollectionSummary:1250`,
  `getChildSectionFields:1312`, `removeStagedAction:1338`,
  `cloneStagedOperation:1347`, `appliedOperation:1476`,
  `unsupportedOperation:1488`, `duplicateLinkOperation:1498`. ~250 lines.

Residual: ~900 lines, with `evaluate:268` and `applyStagedChanges:322` as the
core. `compareJsonValues` and `primitiveText` are generic and may belong beside
existing JSON helpers rather than in a picker module — check
`src/runtime/model-helpers.ts` before creating a new home.

### 5. What must not be touched

`src/ui` carries 278 `data-*` attribute hooks. **142 distinct `data-*` selectors
are used by `tests/`, 57 of them by `tests/visual/` and `.qa-kit/`.** These are
the test contract. No extraction, relocation, or tidy-up in this phase may remove,
rename, or restructure a `data-*` attribute. If a move appears to require one,
the move is wrong.

### Dependency

`docs/phases/phase-108-an-invitee-actually-joins.md` is specified but, on the
evidence of `git log`, not executed. Per `AGENTS.md`, the next phase is the
lowest-numbered document whose work is not implemented, so **108 precedes this**.
This phase does not depend on 108 and 108 does not depend on this; if 108 is
executed first, re-verify §3 and §4 line numbers before starting, since they will
have moved if 108 touches the runtime.

This phase is justified repository-wide not as the highest-value *feature* gap —
it delivers no user-visible value at all — but as the precondition for Phase 110,
which does. See Planning Handoff.

## Decision

**Pure moves only, verified by an unchanged test suite.**

The discipline that makes this phase safe is also what makes it worth doing
separately: if any test assertion needs editing, something other than a move
happened, and the diff is wrong. Import-path churn in test files is expected and
fine. Assertion churn is a stop signal.

Each of the five moves is independently committable and independently revertable.
Do them in the order listed in Tasks — cheapest and most reversible first — and
run `npm test` between each. Do not batch them into one commit.

## Scope

- Relocate `src/ui/demo-fixture.ts` behind a dynamic import, or out of the
  reachable set, whichever the build measurement in Evidence §1 justifies.
- Move `src/ui/authority-sync.ts` to a non-UI location. `src/runtime/` is wrong
  (it is a transport, and `src/runtime` has no authority dependency today);
  prefer a sibling directory. Decide during execution and record the reason.
- Extract four modules from `src/runtime/object-store.ts`.
- Extract two modules from `src/runtime/edit-surface-runtime.ts`.
- Update import paths across `src/` and `tests/`.

## Non-goals

- The `innerHTML` render path. That is Phase 110 and it changes behaviour.
- Any `data-*` attribute change (Evidence §5).
- Reducing the 403 `escapeHtml()` call sites. They go away structurally in 110;
  removing them by hand now is both wasted work and an XSS risk.
- Splitting `commitPlannedTransaction:598`. It is long but it is one coherent
  transaction; splitting it is a judgement call that deserves its own evidence.
- Any change to `src/compiler`, `src/parser`, `src/model`, or `src/server`.
- Renaming anything. Moves preserve names.

## Constraints

- No test assertion may be edited. Import paths only.
- No public export removed from `src/index.ts` (Evidence: it is the browser
  barrel and has a documented tree-shaking hazard).
- Each extracted module keeps the original's comments. Several encode
  non-obvious reasoning — `planCreateForTransaction:216` explains why id shape is
  checked before anything else — and losing them in a move is a silent
  regression in the only form of documentation that survives refactoring.
- `npm run format:check` must pass; extracted files are Prettier-formatted like
  their source.

## Acceptance Criteria

1. `npm test` passes. `git diff` on `tests/` shows import-path changes only —
   verify with `git diff tests/ | grep '^[+-]' | grep -v '^[+-]import' | grep -v '^[+-][+-]'`
   returning empty.
2. `npm run test:integration` passes (needs PostgreSQL).
3. `npm run verify:push` passes, including `test:visual`.
4. `src/runtime/object-store.ts` is under 1,300 lines.
5. `src/runtime/edit-surface-runtime.ts` is under 1,000 lines.
6. `src/ui` total is under 12,300 lines (13,824 minus `authority-sync.ts`,
   minus whatever §1 justifies).
7. Production bundle gzip size is recorded before and after in the Execution
   Note, whether or not it moved.
8. `grep -roh 'data-[a-z-]*' src/ui` yields the same set as before the phase.

Criterion 8 is the one that catches an over-eager tidy-up. Run it first and save
the output.

## Testing

No new tests. This phase's correctness claim is that the existing suite is
unchanged, which a new test cannot express.

Run between each of the five moves, not only at the end:

```
npm test
```

Full gate once, at the end: `npm run verify:push`. Capture its exit status on the
line immediately after, per `AGENTS.md` — do not pipe it to `tail` and read
`tail`'s status.

## Tasks

Ordered cheapest-and-most-reversible first. Commit each separately.

1. Save the `data-*` baseline (Acceptance 8). Build and record the current
   bundle gzip size.
2. Move `authority-sync.ts` out of `src/ui`. Pure path change, no bundle effect.
3. Measure whether `demo-fixture.ts` actually costs bundle bytes. If yes, take it
   out of the static reachable set. If no, record the measurement and skip.
4. Extract `object-store.ts` → ordered collections.
5. Extract `object-store.ts` → write constraints.
6. Extract `object-store.ts` → record construction.
7. Extract `object-store.ts` → sync reconciliation.
8. Extract `edit-surface-runtime.ts` → relationship picker.
9. Extract `edit-surface-runtime.ts` → child collections.
10. `npm run verify:push`. Write the Execution Note.

Steps 4–9 are independent of each other. If one turns out to need four or more
collaborators injected (Evidence §3), skip it, record why, and continue.

## Documentation

Per `learnings/process/instruction-placement.md`: this phase produces no rule with
a visible trigger, so it warrants no `AGENTS.md` change and no new learning
document. If a specific extraction reveals a non-obvious coupling worth recording,
that goes in the Execution Note, not in `learnings/`.

## Planning Handoff

**Phase 110 — the render path.** This is the phase that carries the value; 109
only makes it tractable.

Measured, statically, across `src/ui`:

- 35 `innerHTML` assignments
- 403 `escapeHtml()` call sites
- 3 `createElement`, 0 `appendChild`, 0 `attachShadow`
- 75 `addEventListener` against 38 `querySelector`

Every component builds HTML by string concatenation, hand-escapes each
interpolation, assigns `innerHTML`, then re-finds elements by `data-*` attribute
and re-attaches handlers. Three consequences, of which only the first is about
size:

1. **Verbosity.** 403 escape sites, many spanning two or three lines under
   Prettier.
2. **XSS surface.** Correctness rests on 403 hand-written calls with no
   compiler check. One omission is an injection.
3. **State destruction.** `innerHTML =` discards focus, scroll position, text
   selection, and IME composition on every re-render. In a forms-heavy
   application that is a real defect, and the usual remedy — save and restore
   focus around each render — makes the file larger, not smaller.

The fix is a tagged-template renderer with keyed patching: `lit` (~5 KB gzip) or
roughly 150 lines hand-rolled. Escaping becomes structural, so all 403 sites
disappear; patching preserves focus, so listeners bind once and event delegation
replaces most of the `querySelector` re-binding.

**Three things Phase 110 must settle before it starts, and cannot settle now:**

- **Dependency or hand-roll.** The browser bundle currently has *zero* runtime
  dependencies (`package.json` lists only `pg` and `@simplewebauthn/server`, both
  server-side). Adding `lit` breaks that property for ~5 KB. That is a
  deliberate architectural choice this document does not get to make.
- **Whether item 3 is real.** The focus-loss claim above is **inferred from the
  render pattern, not observed**. `AGENTS.md` requires runtime behaviour to be
  executed before it is asserted in a phase document. Reproduce it in the browser
  first — type in a form field, trigger a re-render, see whether focus survives —
  and if it does not reproduce, item 3 is deleted and the phase is smaller.
- **Whether it is one phase or several.** 17 components is plausibly too much for
  one document. `adl-form-view.ts` (1,604) and `adl-composed-view.ts` (954) carry
  91 and 121 template-literal blocks respectively and are the natural pilot; the
  remaining 15 can follow once the renderer has proven itself on those two.

Phase 110 must not be written until 109 has landed. Its Evidence section would
reference line numbers this phase moves.
