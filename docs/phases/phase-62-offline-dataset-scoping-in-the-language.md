# Phase 62 - Offline Dataset Scoping In The Language

> **Phase 61 handoff (proposed).** Phase 61 made a record revision mean what
> every consumer already assumed: `createRecordRevision` derives a sequence from
> the record's own prior revision and makes the value unique by construction, so
> no process restart can reissue one and the authority's equality check can no
> longer fail open. The corpus can now say so — `restartRuntime` ends a runtime
> mid-case and `readRecordRevisions` reports a record's revision history as
> behaviour rather than text.
>
> **This phase is the highest-value remaining gap repository-wide.** It was
> drafted as Phase 61 before the revision defect displaced it, and its evidence
> was re-verified against the code while writing this document — during which
> **two of the recorded evidence points turned out to be wrong**, and are
> corrected below. Correcting them makes the phase smaller and sharper, not less
> valuable: the defect is not that a device holds nothing, it is that **the
> language cannot say what a device should hold**, while the runtime that would
> honour it is already written, already validated and already in the conformance
> corpus.

## Objective

Let an ADL model declare which records a device keeps offline. Every offline
scope the resolved model supports must be reachable from ADL source, and no
scope may be declarable in a form the runtime cannot honour.

## Evidence and Dependency

Every point below was checked against the code while writing this document.

- **`SYNC ... WINDOW` has no syntax.** `Parser.parseSync`
  (`src/parser/parser.ts:3282`) accepts `MODE`, `SCOPE` and `CONFLICT` and
  nothing else — the loop's failure message is literally
  `"SYNC option SCOPE, CONFLICT, or end of line"` (`:3305`). `grep -an window
  src/parser/parser.ts src/compiler/compile-adl.ts` returns nothing. A window is
  therefore reachable **only** from a TypeScript `PartialApplicationModel`, never
  from a `.adl` file.
- **The resolved model, the validator and the runtime all support it fully.**
  `ResolvedSyncWindow` (`src/model/resolved-model.ts:1322`) carries `field`,
  `days` and `limit`; `resolveSyncWindow` (`src/compiler/resolve-model.ts:654`)
  resolves it; `validateSyncWindow` (`src/compiler/validate-model.ts:7496`)
  refuses a field that does not exist, a field that is not a date or datetime,
  and a non-positive `days` or `limit`; `OfflineDatasetService`
  (`src/runtime/offline-dataset-service.ts:482`) applies the day span and the
  newest-first limit. The conformance corpus proves the runtime works —
  `offline.dataset.scope-recent-days.001` and
  `offline.dataset.scope-recent-limit.001` — using JSON models, which can set a
  window that ADL source cannot.
- **Corrected: `SCOPE recent` does *not* select nothing.** The Phase 61 document
  recorded that `recordMatchesRecentWindow` returns `false` when the window is
  undefined and concluded that an ADL model declaring `SCOPE recent` holds zero
  records. The first half is true (`:487`); the conclusion is not.
  `resolveSyncWindow` (`:666`) returns `{ field: "_updatedAt", days: 30 }`
  whenever the scope is `recent`, so the window is never undefined for that
  scope. `sync.defaults.recent-window.001` asserts exactly this. What is real is
  narrower and still worth a phase: **an ADL author gets a hard-coded 30 days
  over `_updatedAt` and has no way to change the span, the limit or the field**,
  even though the validator and runtime honour all three.
- **`SCOPE custom` genuinely selects nothing.** `recordMatchesObjectSyncScope`
  returns `false` unconditionally for `custom`
  (`src/runtime/offline-dataset-service.ts:287`), the parser accepts the word
  (`normaliseSyncScope`, `:5163`), and the resolved model has nowhere to say what
  the scope means. A model that declares it compiles, validates, and holds **zero
  records** on every device, silently. This is the same class of defect Phase 60
  closed for `unlink`: a declaration no model could satisfy, which was made a
  compile-time refusal rather than left to fail quietly at runtime.
- **The language specification already claims the capability.**
  `docs/spec/language.md:68` states that ADL "already models sync mode, conflict
  policy and offline dataset windows". The resolved model does; the language does
  not. `docs/spec/resolved-model.md:65` records the 30-day default, so the
  defaulting is specified — the way to override it is not, because there is none.
- **The reference app invented a field to work around it.**
  `DevicePreference.OfflineHomeLimit` (`src/reference/giggle-band/domain.adl:241`)
  is declared with a default of 30, exposed on a view (`:245`) and seeded
  (`src/reference/band-app.ts:346`). `grep -rn OfflineHomeLimit src/ tests/
  conformance/` returns those three lines and nothing else: nothing reads it. A
  model author reached for a per-device offline limit, could not declare one, and
  left a field behind that does nothing.

This phase depends on the ADL lexer and parser, `compile-adl`'s AST-to-partial
conversion, `resolveSyncWindow`, `validateSyncWindow`, `OfflineDatasetService`,
the conformance corpus, and the language specification.

### Candidates weighed and not chosen

Recorded with their evidence, per `learnings/process/phase-execution.md`. Each was
re-checked against the code while writing this document.

- **`import` is a policy action and a runtime channel with no producer.**
  Re-verified: `grep -ran 'action: "import"' src/` and
  `grep -ran 'channel: "import"' src/` both still return nothing, while
  `PolicyAction` (`src/model/resolved-model.ts:123`) and `RuntimeChannel`
  (`:133`) both include it. A model can write a policy rule about importing that
  nothing will ever evaluate. Real, but it is a capability that does not exist
  rather than one that misbehaves, and no reference app asks for it.
- **A lifecycle transition with side effects is still not transactional.**
  Recorded as open in `learnings/implementation/command-intent-replay.md` after
  Phase 57 (`command`) and Phase 59 (`batch`) closed the other two multi-record
  write classes. Re-checked: a transition's side effects are host-registered
  TypeScript hooks (`ResolvedLifecycleAction.hooks`,
  `src/runtime/lifecycle-engine.ts:116`), not model-declared writes, so **no ADL
  model can currently declare a transition with a side effect at all**. The
  atomicity gap is real for a host that registers writing hooks, and unreachable
  from the language. It should follow whichever phase gives the model a way to
  declare one.
- **No policy action for administering a context.** Narrower, and the
  administration surfaces are already gated server-side by
  `requireAdministration`.
- **Relationship-aware sync scope** remains an addition rather than a defect.

## Scope

- Add `WINDOW` syntax to the `SYNC` declaration so `field`, `days` and `limit`
  are declarable from ADL source, and carry it through `compile-adl` into the
  partial model the resolver already understands.
- Decide what `SCOPE custom` means and make the decision enforceable: either give
  it a declarable predicate the runtime can evaluate per record, or refuse it at
  compile time. It must not remain declarable-and-silent. If a predicate is
  chosen, it must be an ordinary `ResolvedExpression` evaluated against the
  record — a second expression dialect is not in scope.
- State the offline scope contract in `docs/spec/language.md` and reconcile the
  claim at `:68` with what the language actually accepts, and in
  `docs/spec/runtime-semantics.md` for what a scope selects.
- Resolve `DevicePreference.OfflineHomeLimit`: once a model can declare a window,
  either drive the reference app's offline dataset from the declaration and
  remove the invented field, or record why a per-device runtime limit is a
  separate capability from a model-declared one. Do not leave a third state where
  both exist and neither is read.
- Conformance cases proving a window declared **in ADL source** reaches the
  runtime, and proving whatever `custom` becomes.

## Constraints

- The resolved model is a contract. `ResolvedSyncWindow` already has the shape
  this phase needs; extend it only if `custom` genuinely requires it, and keep
  `validateSyncWindow`'s existing diagnostics intact.
- Follow the `OFFLINE_GRACE <days> DAYS` precedent for units: the unit word is
  required so a bare number can never be read as the wrong unit later
  (`docs/spec/language.md:62`).
- A parser addition must be accepted by every existing model unchanged. `SYNC`
  appears throughout `src/reference/giggle-band/domain.adl` without a window and
  must keep resolving exactly as it does now, including the 30-day default for
  `recent`.
- Never leave a declaration the runtime cannot honour. That rule is what makes
  `SCOPE custom` in scope at all, and it is the rule Phase 60 established for
  `unlink`.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  a case may not name a value the runtime mints.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 50 session lifetime, Phase 54 membership scoping, Phase 57 command
  replay, Phase 58 record sync state, Phase 59 batch semantics, Phase 60
  edit-surface semantics and Phase 61 revision integrity.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- `SYNC ... WINDOW` syntax in the parser, carried through `compile-adl`, with
  parse diagnostics for a malformed window that name the option that was wrong.
- A resolved, validated and enforced meaning for `SCOPE custom`, or a compile-time
  refusal of it, with the diagnostic explaining what to declare instead.
- Conformance cases driven from ADL source, not only from JSON partial models,
  proving a declared window selects and limits the offline dataset.
- Specification updates in `docs/spec/language.md` and
  `docs/spec/runtime-semantics.md`, including the corrected claim at
  `language.md:68`.
- The reference app either declaring a real window or recorded as deliberately
  not doing so, with `OfflineHomeLimit` resolved either way.
- Learnings updates in `implementation/offline-dataset-runtime.md`,
  `implementation/adl-parser.md` and `implementation/sync-policy.md`.

## Acceptance Criteria

- An ADL model declaring `SYNC LOCAL_FIRST SCOPE recent WINDOW ...` resolves to a
  `ResolvedSyncWindow` carrying the declared field, days and limit, and the
  offline dataset it produces differs from the 30-day default — proven by a test
  that fails if the parser drops the clause.
- Every existing `.adl` file in the repository compiles unchanged and resolves to
  the same model it does today.
- No model can declare an offline scope the runtime silently ignores: either
  `SCOPE custom` selects records by its declared predicate, or it is a
  compile-time diagnostic.
- `grep -rn OfflineHomeLimit src/ tests/ conformance/` shows the field read, or
  shows it gone.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots.

## Non-goals

- Relationship-aware sync scope (`SCOPE relatedTo ...`), which is an addition
  rather than a defect.
- Bulk ingestion and the `import` policy action.
- A per-device runtime override of a model-declared window, unless the
  `OfflineHomeLimit` decision concludes the reference app genuinely needs one —
  in which case it is the phase after this, with its own evidence.
- Any change to sync modes, conflict strategies or revision semantics.

## Dependencies

- `Parser.parseSync` and the `SyncDeclarationAst` shape.
- `compile-adl`'s conversion of that AST into `PartialApplicationModel`.
- `resolveSyncWindow` and `validateSyncWindow`, both of which already do their
  half of the work.
- `OfflineDatasetService.recordMatchesObjectSyncScope` and
  `recordMatchesRecentWindow`.
- The conformance corpus and `docs/spec/language.md`.

## Parallel Execution Plan

Serial spine first, in one pass with no consumers:

1. The `SyncDeclarationAst` window shape, the parser clause, the `compile-adl`
   conversion, and any resolved-model or validation change `custom` turns out to
   need. Every other stream's expected output depends on the syntax being
   settled, so it lands first and alone.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- Parser and compiler tests for the new clause and its diagnostics.
- The `custom` decision's runtime or compile-time enforcement plus its tests.
- Conformance corpus: ADL-source-driven window cases.
- Reference app (`domain.adl`, `band-app.ts`) and the `OfflineHomeLimit`
  resolution.
- Specification and learnings.

Keep serial: `src/parser/parser.ts`, `src/compiler/compile-adl.ts`,
`src/compiler/resolve-model.ts`, `src/compiler/validate-model.ts`,
`src/model/resolved-model.ts`, `src/index.ts`, the conformance runner and case
schema, reference app fixtures, and specification updates that must reconcile all
streams.

Barriers: one `npm run test:integration` after the runtime and corpus streams are
in, then one `npm run verify:push` with manual screenshot inspection — the
reference app change makes the screenshot pass load-bearing rather than a
formality.

Hazards this repository has confirmed. `src/compiler/validate-model.ts` and
`src/conformance/runner.ts` each contain a NUL byte, so plain `grep` treats them
as binary and returns nothing silently — use `grep -a`, and check `grep -c`
against `grep -ac` on any file just written. Phase 61 confirmed the byte can be
*introduced* as well as inherited: a composite key typed as `` `${a} ${b}` ``
landed with a raw NUL as the separator, in a file that had two already. Write the
escape, never the byte. And treat this phase document's own evidence the way this
document treated Phase 61's: two of the points inherited from that draft were
wrong, and checking them was five minutes.

## Tasks

1. Add the `WINDOW` clause to `SYNC`, through the parser, the AST and
   `compile-adl`, with diagnostics for a malformed clause.
2. Prove a window declared in ADL source reaches `ResolvedSyncWindow` and changes
   the offline dataset.
3. Decide `SCOPE custom` — a declarable predicate or a compile-time refusal — and
   enforce the decision in the runtime or the compiler rather than in the UI.
4. Reconcile `docs/spec/language.md:68` and specify the offline scope contract.
5. Resolve `DevicePreference.OfflineHomeLimit` in the reference app, either way,
   and record the reasoning.
6. Add conformance cases for the declared window and for whatever `custom`
   becomes.
7. **Required next-phase planning handoff:** before Phase 62 closes, write
   `docs/phases/phase-63-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. The
   `import`-with-no-producer and lifecycle-side-effect evidence above is recorded
   in full so it does not need re-deriving; note that the second is currently
   unreachable from the language, which is itself a finding a later phase should
   weigh. If no gap justifies a further phase, record that conclusion explicitly
   instead. Then verify, commit, and push Phase 62.
