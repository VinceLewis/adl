# Phase 68 - MIME_TYPE Validator And LOOKUP TARGET_FIELD Fixes

> **Why this phase exists at all, after Phase 65 closed the rolling handoff.**
> `learnings/process/phase-execution.md` records that the rolling handoff
> stopped at Phase 64 and that Phases 65-67 each answered one concrete gap the
> user named after real-world use, without reopening it. This phase is the
> same shape: a documentation audit of `docs/spec/language.md`'s newly written
> "Field Validators" and `LOOKUP` sections surfaced two genuine, pre-existing
> runtime defects — the audit's own prose said so, in the caveats quoted below
> — and the user named both explicitly and asked for them fixed. It is not a
> gap derived from re-reading a subsystem this repository just touched, and it
> does not license deriving a Phase 69 from the code either — see the Planning
> Handoff below.

## Objective

Fix two latent bugs the documentation audit found and recorded as caveats in
`docs/spec/language.md`, verify each is fixed with a generic (non-Giggle-Band)
test, and update the spec so it describes the fixed behaviour rather than the
defect.

1. Every `MIME_TYPE` field validator declaration failed to compile.
2. `LOOKUP ... TARGET_FIELD` was validated at compile time but had no runtime
   effect: resolution always read the target record by identity.

## Evidence and Dependency

Re-checked against the code while writing this document, per
`learnings/process/phase-execution.md`'s rule to verify a phase's evidence
before executing it. Both bugs reproduced exactly as described.

### Bug 1: `MIME_TYPE` always fails compilation

- `docs/spec/language.md`'s own "Field Validators" section (written just
  before this phase, in `079662e`) already documented the defect as a caveat:
  "The parser only ever accepts a single literal here, but model validation
  requires a non-empty list, so any `MIME_TYPE` declaration currently fails
  `ADL_FIELD_VALIDATOR_VALUE_INVALID` at compile time."
- `src/parser/parser.ts`'s `MIME_TYPE` clause (in `parseFieldType`'s modifier
  loop) called `this.consumeModifierValue("MIME_TYPE value")`, which parses
  one literal (optionally parenthesised) — the same helper `MIN`, `MAX`,
  `MIN_LENGTH`, `MAX_LENGTH`, `MAX_SIZE`, and `DEFAULT` use. `IN` instead calls
  `this.consumeValueList("IN values")`, which requires parentheses and returns
  an array.
- `src/compiler/validate-model.ts`'s `NAMED_VALIDATOR_RULES` declares
  `mimeType: { fieldTypes: ["attachment"], value: "list" }` — the same `"list"`
  shape as `in`. `validateNamedFieldValidator`'s list branch requires
  `Array.isArray(value) && value.length > 0`, which a single literal from
  `consumeModifierValue` never satisfies, so `ADL_FIELD_VALIDATOR_VALUE_INVALID`
  fires on every `MIME_TYPE` declaration, unconditionally.
- Confirmed live: compiling `FIELD Attachment ATTACHMENT MIME_TYPE
  ('image/png', 'image/jpeg')` before this phase's parser change produced an
  `ADL_FIELD_VALIDATOR_VALUE_INVALID` diagnostic (the list syntax was rejected
  as a parse error at the `,` before the fix even got that far, since
  `consumeModifierValue` does not expect a list at all).
- **The validator and the runtime were already correct**, not broken.
  `src/runtime/validation-engine.ts`'s `hasAllowedMimeType` already accepts
  either a bare string or an array for `validator.value`, and
  `conformance/runtime/validation.json`'s `fieldValidators` model already
  declares `mimeType`'s value as `["application/pdf"]` — that model is raw
  JSON, so it bypasses the parser entirely and was never affected by this bug.
  This is why the runtime-level conformance case for `mimeType` already
  passed before this phase: **only the parser was broken.**
- Conclusion: the parser is the bug, not model validation. `IN` is the
  established precedent for a validator whose value is a list, and fixing
  `MIME_TYPE` to match it makes the parser and the validator agree, exactly as
  the audit's caveat framed the question.

### Bug 2: `LOOKUP ... TARGET_FIELD` is validated but never consumed

- `docs/spec/language.md`'s `LOOKUP` section already documented this too: "Every
  `LOOKUP` above, including this one, is resolved at runtime by reading the
  target record by its own identity, regardless of `TARGET_FIELD` — declaring
  it is currently validated but has no other runtime effect."
- `src/parser/parser.ts`'s `parseLookup` accepts `TARGET_FIELD <field>` and
  carries it into `LookupDeclarationAst.targetField`.
  `src/compiler/resolve-model.ts`'s `resolveLookup` and
  `src/compiler/compile-adl.ts` carry it through unchanged into
  `ResolvedLookup.targetField` (`src/model/resolved-model.ts:571-575`).
  `src/compiler/validate-model.ts` checks `targetField` names a real field on
  the target object (`ADL_LOOKUP_TARGET_FIELD_UNKNOWN`) — and does nothing
  else with it.
- Searching every runtime consumer of `.lookup` (`src/runtime/*.ts`) found
  exactly one place that resolves a lookup field's stored value to a target
  *record*, rather than merely naming a target *object*:
  `ReadModelService.resolveJoinedSource`
  (`src/runtime/read-model-service.ts:334`), used for a read-model source that
  declares no explicit `JOIN` — the "implicit lookup join" the parser doc
  (`learnings/implementation/adl-parser.md`) and `read-model-joins.test.ts`
  both call it. Before this phase it called
  `this.findRelatedRecordId(object, sourceRecords)` to get a raw field value,
  then unconditionally `this.storage.read(object.name, recordId)` — an
  identity read — ignoring whether the lookup that produced the value declared
  `targetField` at all.
- Two other places read a `LOOKUP` field's value by identity and predate
  `TARGET_FIELD`: `ReadModelService.recordMatchesCurrentUser` and
  `OfflineDatasetService`'s equivalent (matching a lookup field against
  `context.userId` for a `currentUser` scope/dataset), and the browser UI's
  lookup-label display (`adl-list-view.ts`, `adl-form-view.ts`,
  `this._runtime.read(field.lookup.targetObject, recordId, ...)`). Both are
  pre-existing, narrower assumptions ("a lookup pointed at `User` stores
  `context.userId` directly") that this phase does not touch — see Non-goals.
- **Precedent for handling an ambiguous match already exists in this exact
  file.** `applyDeclaredJoinedSource`'s `cardinality: "one"` branch takes
  `matches[0]` when more than one candidate shares a join key, and its own
  comment explains why: "a declared join matches records by field value, which
  is a search however it is spelled," so it clears the `search` policy action,
  the object-scope search check, the source scope check, and the per-record
  read policy before a candidate can reach a row. `TARGET_FIELD` resolution
  is the same operation under a different name and this phase gives it the
  same treatment.

This phase depends on `src/parser/parser.ts` (`parseFieldType`'s `MIME_TYPE`
clause, `consumeValueList`), `src/compiler/validate-model.ts`
(`NAMED_VALIDATOR_RULES`, unchanged), `src/runtime/read-model-service.ts`
(`resolveJoinedSource`, `findRelatedRecordId`, `searchAuthorisedSourceRecords`,
`applyDeclaredJoinedSource` as precedent), `src/model/resolved-model.ts`
(`ResolvedLookup`, unchanged), and the conformance corpus.

## The Decision

### `MIME_TYPE`

`MIME_TYPE` now parses exactly like `IN`: a required, parenthesised,
comma-separated list of string literals, via `consumeValueList`. No change to
`validate-model.ts` or `validation-engine.ts` — both already treated the value
as a list. `docs/spec/language.md` is updated to drop the caveat and show the
list syntax.

### `LOOKUP ... TARGET_FIELD`

A `LOOKUP` with `TARGET_FIELD` becomes a natural-key lookup for the one
runtime consumer that resolves a lookup field's value to a target record: a
read-model source's implicit lookup join. Resolution:

- With no `targetField`, behaviour is unchanged: read the target object by
  the stored value as its id.
- With `targetField`, match the target object's records where
  `values[targetField] === storedValue`, using the same authorised candidate
  set (`search` policy, object scope, source scope, per-record `read` policy)
  a declared join's candidate set already uses, via
  `searchAuthorisedSourceRecords`.
- If more than one candidate matches, the first one in search order wins —
  the documented expectation is that the target object declares `targetField`
  `UNIQUE`, but nothing enforces that at compile time (matching how a declared
  join's `cardinality: "one"` is not enforced either), so ambiguity degrades
  the same way rather than throwing or being undefined.
- If no candidate matches, the row is dropped — identical to an identity
  lookup whose target record does not exist.

This is deliberately the smallest fix that makes the documented feature real:
it does not add a new compile-time uniqueness requirement (no precedent for
one exists for a declared join's cardinality either), and it does not touch
the two pre-existing identity-only consumers named above
(`recordMatchesCurrentUser` and the UI lookup-label display), which are
recorded as a known limitation rather than silently left undocumented.

## Scope

- Parser: `MIME_TYPE` uses `consumeValueList` instead of
  `consumeModifierValue`.
- Runtime: `ReadModelService.resolveJoinedSource` honours
  `ResolvedLookup.targetField` for a read-model source's implicit lookup join,
  gated by the same `search` policy check a declared join's candidate set
  already clears.
- Reference app: none required. Both fixes are demonstrated on generic,
  non-Giggle-Band fixtures (`tests/mime-type-validator.test.ts`,
  `tests/lookup-target-field.test.ts`), matching the Phase 65 precedent of a
  fixture reusable by any application, not tied to the band domain. Giggle
  Band's `domain.adl`/`ui.adl` are under concurrent edit by another agent this
  session and are not touched by this phase.
- Documentation: `docs/spec/language.md`'s `MIME_TYPE` and `LOOKUP
  ... TARGET_FIELD` prose updated to describe the fixed behaviour and to
  record the two remaining identity-only consumers as a known limitation.
- Conformance: three new cases in `conformance/runtime/read-model-joins.json`
  proving `TARGET_FIELD` resolution, its no-match drop, and its `search`
  policy gate. No conformance case for `MIME_TYPE`, because the conformance
  corpus tests resolved-model JSON directly (see
  `conformance/runtime/validation.json`'s `fieldValidators` model, which
  already declares `mimeType` as a list and already passed before this
  phase) — it never exercises the parser, so it cannot represent this
  specific bug. The parser fix is proven by unit tests instead
  (`tests/mime-type-validator.test.ts`), matching how other parser-only
  behaviour in this repository is tested.

## Constraints

- Do not change `validate-model.ts`'s `NAMED_VALIDATOR_RULES` or any other
  validator's parsing. Every existing validator's compiled shape must be
  unchanged.
- Do not change `resolveJoinedSource`'s behaviour for a lookup with no
  `targetField`. Every existing `read-model-joins.test.ts` and
  `conformance/runtime/read-model-joins.json` case must still pass unchanged.
- Do not add a compile-time requirement that a `TARGET_FIELD` target be
  declared `UNIQUE`. Document the ambiguity behaviour instead, matching the
  declared-join precedent.
- Do not touch `recordMatchesCurrentUser` (in `read-model-service.ts` or
  `offline-dataset-service.ts`) or the UI lookup-label display
  (`adl-list-view.ts`, `adl-form-view.ts`). Record their pre-existing
  identity-only behaviour as a known limitation rather than fixing or hiding
  it.
- Do not touch `src/reference/giggle-band/domain.adl`,
  `src/reference/giggle-band/ui.adl`, `src/reference/band-app.ts`, or
  `tests/band-reference-app.test.ts` — another agent is concurrently editing
  them this session.

## Deliverables

- `src/parser/parser.ts`: `MIME_TYPE` parses a value list.
- `src/runtime/read-model-service.ts`: `TARGET_FIELD`-aware lookup resolution
  for a read model's implicit join source.
- `tests/mime-type-validator.test.ts`: parser AST, compiled-model, and runtime
  create-rejection/acceptance proof.
- `tests/lookup-target-field.test.ts`: compiled-model proof, correct
  resolution, no-match drop, the `search` policy gate, and the first-match
  ambiguity fallback.
- `conformance/runtime/read-model-joins.json`: three new cases plus two new
  models (`readModelJoinsTargetField`,
  `readModelJoinsTargetFieldUnsearchableAuthor`).
- `docs/spec/language.md`: `MIME_TYPE` and `LOOKUP ... TARGET_FIELD` sections
  updated.
- `learnings/implementation/adl-parser.md` and
  `learnings/implementation/read-model-runtime.md` (or a new learnings
  document, per what is discovered while writing it): record what was
  actually wrong and why, per Task 7 below.

## Acceptance Criteria

- `FIELD X ATTACHMENT MIME_TYPE ('a/b', 'c/d')` compiles with zero
  diagnostics, and the resolved validator's value is `["a/b", "c/d"]`.
- `runtime.create` rejects an attachment value whose `mimeType` is outside the
  declared list, and accepts one inside it, proven directly (no UI code).
- A `LOOKUP ... TARGET_FIELD X` field's value resolves an implicit read-model
  join by matching `X` on the target object, not by treating the value as the
  target's id, proven directly against `ApplicationRuntime.executeReadModel`.
- Resolving a `TARGET_FIELD` lookup is refused for a caller without `search`
  on the target object, matching a declared join's `cardinality: "one"`.
- `npm test` passes with the new and existing cases. `npm run typecheck`,
  `npm run format:check` are clean. `npm run test:integration` is not run
  because neither fix touches authority, PostgreSQL, or HTTP edge behaviour
  (both are parser/resolved-model/read-model-service changes with no server
  involvement) — recorded here per the phase's evidence-check obligation
  rather than silently skipped.
- Every existing conformance case and unit test that does not touch either
  fix is unmodified and still passes.

## Non-goals

- Fixing `recordMatchesCurrentUser`'s identity-only assumption for a `LOOKUP`
  pointed at `User` when that lookup declares `TARGET_FIELD`. Recorded as a
  known limitation in `docs/spec/language.md` and `learnings/`; not reachable
  by any shipped ADL application today.
- Fixing the browser UI's lookup-label display
  (`adl-list-view.ts`/`adl-form-view.ts`) to resolve a `TARGET_FIELD` lookup's
  label correctly. It already degrades gracefully (falls back to the raw
  stored value on a failed identity read) rather than crashing or showing
  wrong data, and `AGENTS.md`'s runtime-first boundary means the read-model
  and runtime fix is the one that matters; a UI polish pass is left to a
  future phase if anyone ever declares `TARGET_FIELD` in a form/list view.
- A compile-time `UNIQUE`-required diagnostic for `TARGET_FIELD` targets.
- Any change to Giggle Band's `domain.adl`/`ui.adl` to demonstrate
  `TARGET_FIELD` on the reference app. The generic fixtures are sufficient
  proof and lower-risk given concurrent edits to those files this session.
- A next-phase handoff derived from this subsystem. See below.

## Dependencies

- `src/parser/parser.ts` (`parseFieldType`, `consumeValueList`,
  `consumeModifierValue`).
- `src/compiler/validate-model.ts` (`NAMED_VALIDATOR_RULES`, unchanged;
  cited as evidence only).
- `src/runtime/read-model-service.ts` (`resolveJoinedSource`,
  `findRelatedRecordId`/`findRelatedLookupMatch`,
  `searchAuthorisedSourceRecords`, `applyDeclaredJoinedSource` as precedent).
- `src/model/resolved-model.ts` (`ResolvedLookup`, unchanged).
- The conformance corpus (`conformance/runtime/read-model-joins.json`,
  `conformance/runtime/validation.json`).

## Parallel Execution Plan

Two independent, small, single-file fixes with no shared state between them
and no consumer relationship — a single pass costs less than coordinating a
fan-out, matching Phase 65's own conclusion for a phase this size.

If parallelised anyway: the two bugs are entirely independent files
(`src/parser/parser.ts` for Bug 1, `src/runtime/read-model-service.ts` for Bug
2) and could run as two agents with no shared-file contention. Each fix's own
tests (`tests/mime-type-validator.test.ts`,
`tests/lookup-target-field.test.ts`) and the conformance additions
(`conformance/runtime/read-model-joins.json`, Bug 2 only) belong to the same
agent as the runtime change they prove, since the test is written against the
fix's actual behaviour, not predicted ahead of it. `docs/spec/language.md` is
the one file both streams touch (different sections), so treat it as a
keep-serial barrier: land both code changes first, then one pass updates both
doc sections together.

Barriers: `npm test` once, after both fixes and both test files land.
`npm run test:integration` is not needed (see Acceptance Criteria).
`npm run verify:push` is not needed — neither fix changes rendering, shell
chrome, or CSS, and no UI file was touched.

## Tasks

1. Re-verify both bugs against current code (done above; both reproduced
   exactly as the audit described).
2. Fix `MIME_TYPE` parsing in `src/parser/parser.ts`.
3. Fix `TARGET_FIELD` resolution in `src/runtime/read-model-service.ts`.
4. Add `tests/mime-type-validator.test.ts` and
   `tests/lookup-target-field.test.ts`.
5. Add the `TARGET_FIELD` conformance cases and models to
   `conformance/runtime/read-model-joins.json`.
6. Update `docs/spec/language.md`.
7. Write the `learnings/` update.
8. **Planning handoff.** Per `learnings/process/phase-execution.md`, a phase
   from 65 onward may not derive its successor from the subsystem it just
   touched, and the standing condition for resuming the rolling handoff at
   all — a second reference application in a different domain, or a stated
   capability target — has not been met by this phase either. This phase
   closes exactly the two concrete, evidence-backed defects the user named
   from a documentation audit. No repository-wide gap surfaced by writing it
   rises to the level Phase 46's rule requires, so no Phase 69 is written.
   The next phase, if there is one, again awaits the user naming a concrete
   feature or defect from real-world use or further audit — not a re-reading
   of this subsystem's own code. One candidate is visible and explicitly
   *not* claimed here: the two identity-only `LOOKUP` consumers recorded as a
   known limitation above (current-user matching, UI label display) — real,
   but not yet named by the user as something to fix, and not reachable by
   any shipped application today.
9. Commit and push.

## Closing Note

This phase does not reopen the rolling handoff. It answers two named,
evidence-backed defects and stops. See Task 8.
