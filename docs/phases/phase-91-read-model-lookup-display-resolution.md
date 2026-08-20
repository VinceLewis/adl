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
