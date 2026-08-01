# Phase 63 - Read Model Sources And Dataset Bounds

> **Phase 62 handoff.** Phase 62 made the offline dataset sayable. `SYNC ...
> WINDOW <field> <n> DAYS LIMIT <n>` and `SYNC ... SCOPE custom WHERE
> <expression>` are now declarable from ADL source, `custom` selects by its
> predicate instead of returning `false`, and a scope the runtime cannot honour —
> `custom` with no predicate, a predicate on any other scope, a window on any
> scope but `recent` — is a validation refusal rather than a silence. The
> reference app declares a real window on `Event` and the invented
> `DevicePreference.OfflineHomeLimit` is gone.
>
> **This phase is the highest-value remaining gap repository-wide,** and Phase 62
> is what made it load-bearing. A model can now declare how much of an object a
> device keeps. A read model can still ignore that declaration entirely, and the
> reference app shipped in Phase 62 is already a live instance of it.

## Objective

Make a declared offline bound mean what it says on every route a record takes to
a device. A read-model source must not be able to silently admit a record the
declaring object's own sync scope, window or predicate excludes.

## Evidence and Dependency

Every point below was checked against the code while writing this document, and
the first was reproduced end to end.

- **A read-model source defeats a declared window, in the shipped reference
  app.** Reproduced against `createBandReferenceRuntime` with the Phase 62 model:
  creating an `Event` dated `2019-01-01` — seven years outside the
  `WINDOW Date 90 DAYS` that `src/reference/giggle-band/domain.adl:105` declares
  — leaves the record in the offline dataset, with the single reason

  ```json
  { "kind": "readModelSource", "readModel": "CalendarPlanningItems",
    "source": "event", "sourceScope": "currentContext", "mode": "localFirst" }
  ```

  The `objectSync` reason is correctly **absent**: the window did its job and
  excluded the record, and the read-model source put it back. The same run over a
  minimal two-object model reproduces it with `SOURCE gig OBJECT Gig SCOPE all`.
- **A source cannot express a bound at all.** `ResolvedReadModelSource`
  (`src/model/resolved-model.ts:1123`) carries `name`, `object`, `scope` and an
  optional `join`. There is no window, no predicate, and no way to say "the same
  bound the object declares". `recordMatchesReadModelSource`
  (`src/runtime/offline-dataset-service.ts:336`) therefore consults only the
  source scope, and `getDatasetReasons` unions its result with the object-sync
  result, so any source reason admits the record whatever the object scope said.
- **Both halves are declared together in the reference app.**
  `src/reference/giggle-band/domain.adl:253` declares
  `SOURCE event OBJECT Event SCOPE allAvailableContexts` and `:295` declares
  `SOURCE event OBJECT Event SCOPE currentContext`, while `:105` declares the
  90-day window. The two are contradictory and nothing reports it.
- **This is a recorded suspicion now confirmed as a defect.**
  `learnings/implementation/offline-dataset-runtime.md` already says "if a gap
  remains in this area it is **over**-inclusion — a `SCOPE all` source pulls
  records into the dataset on the strength of the source scope alone". That was
  written when nothing could declare a bound, so over-inclusion cost nothing.
  Phase 62 changed that: an author now has a reason to declare a window, and
  believing it is what a device holds is exactly the wrong conclusion to draw.
- **Union-of-reasons is deliberate for context and undecided for bounds.** The
  same learning records that a cross-context dashboard input *should* widen the
  dataset beyond an object's own context scope, and the Phase 57 handoff verified
  that behaviour is correct rather than a bug. So the fix is not "make sources
  stop admitting records". It is that a **temporal or predicate bound** is a
  different kind of statement from a **context scope**, and the phase must decide
  which of the two a source inherits.

This phase depends on `ResolvedReadModelSource`, `resolveReadModels`,
`validateReadModel`, `OfflineDatasetService.getDatasetReasons` and
`recordMatchesReadModelSource`, the ADL `SOURCE` syntax, the conformance corpus,
and `docs/spec/runtime-semantics.md#offline-datasets`.

### Candidates weighed and not chosen

Recorded with their evidence, per `learnings/process/phase-execution.md`.

- **`recent` and `custom` replace context scoping rather than narrowing it.**
  Discovered and recorded during Phase 62: the scopes are a flat enumeration, so
  `recent` evaluates as `availableContexts && window` and there is no way to say
  "my records, recent". This is why `Availability` (`SCOPE currentUser`) could
  not take a window in Phase 62 and `Event` had to widen from `currentContext` to
  all available contexts to take one. Real, and a genuine expressiveness gap —
  but it is an **addition**, and it is worth less than fixing a bound that is
  already declared and already ignored. It is the natural phase after this one,
  and this phase's decision about what a source inherits should be made with it
  in mind.
- **`import` is a policy action and a runtime channel with no producer.**
  Re-verified for the third phase running: `grep -ran 'action: "import"' src/` and
  `grep -ran 'channel: "import"' src/` both still return nothing, while
  `PolicyAction` (`src/model/resolved-model.ts:114`) and `RuntimeChannel`
  (`:133`) both include it. Note that Phase 62's document cited `:123` for
  `PolicyAction`; that reference had already drifted, which is why this one was
  re-checked rather than copied. A capability that does not exist rather than one that
  misbehaves, and no reference app asks for it.
- **A lifecycle transition with side effects is still not transactional.**
  Re-verified: a transition's side effects are host-registered TypeScript hooks
  (`ResolvedLifecycleAction.hooks`, `src/runtime/lifecycle-engine.ts:116`), not
  model-declared writes, so **no ADL model can declare a transition with a side
  effect at all**. The atomicity gap is real for a host that registers writing
  hooks and unreachable from the language. It should follow whichever phase gives
  the model a way to declare one; that unreachability is itself the finding.
- **No policy action for administering a context.** Narrower, and the
  administration surfaces are already gated server-side by
  `requireAdministration`.

## Scope

- Decide what a read-model source inherits from the object it sources, and make
  the decision enforceable in the runtime rather than in documentation. The
  decision must distinguish a **context scope** (which a cross-context dashboard
  legitimately widens, per the Phase 57 finding) from a **temporal or predicate
  bound** (which nothing today can widen deliberately, because nothing can
  declare one on a source).
- Whichever way it goes, a model must not be able to declare a bound and a source
  that contradict it without either the runtime honouring the bound or the
  compiler reporting the contradiction. Silence is the one outcome this phase may
  not ship.
- If sources gain their own bound syntax, it must reuse the Phase 62 clauses —
  the same `WINDOW` shape and the same `ResolvedExpression` predicate. A second
  way to say "90 days" is not in scope.
- Reconcile the reference app: `Event` declares a 90-day window and two read
  models source it. After this phase the model must be coherent, whichever
  coherent state is chosen.
- State the rule in `docs/spec/runtime-semantics.md#offline-datasets`, which
  currently ends with the paragraph Phase 62 added acknowledging the
  over-inclusion without specifying what to do about it.
- Conformance cases proving what a source admits and what it does not, including
  the reproduction above.

## Constraints

- Do not simply stop read-model sources from widening the dataset. Phase 57
  verified that a `SCOPE all` source correctly admits a bandmate's `Availability`
  into a joined dashboard, and `learnings/implementation/offline-dataset-runtime.md`
  records that run. Breaking it would turn a working dashboard silently empty
  offline — the exact failure that learning exists to prevent.
- Dataset membership is not authorization and must not become it. Every
  user-facing read still routes through a policy-enforcing runtime service.
- The reasons array is the contract for *why* a record is held. If a source's
  admission becomes conditional, the reason it reports must say so.
- Every semantic change needs conformance cases per the Phase 51/52 contract, and
  a case may not name a value the runtime mints.
- Preserve Phase 42 controls, Phase 44 atomicity, Phase 45 scope and retention,
  Phase 50 session lifetime, Phase 54 membership scoping, Phase 57 command
  replay, Phase 58 record sync state, Phase 59 batch semantics, Phase 60
  edit-surface semantics, Phase 61 revision integrity and Phase 62 offline scope
  declarations.
- Never weaken a constraint, loosen a test, or adjust a conformance case to match
  current behaviour.

## Deliverables

- An enforced rule for what a read-model source admits relative to its object's
  declared bound, in `OfflineDatasetService`, with any resolved-model and
  validation support it needs.
- A compile-time diagnostic for a model whose source and object bound contradict
  each other, if the chosen rule leaves any contradiction expressible.
- The reference app made coherent, with `Event`'s window and the
  `HomeUpcomingEvents` / `CalendarPlanningItems` sources agreeing.
- Conformance cases covering: a record inside the bound admitted by both routes;
  a record outside the bound and the resulting source behaviour; and a
  cross-context source still admitting the record Phase 57 verified.
- Specification updates in `docs/spec/runtime-semantics.md`, and in
  `docs/spec/language.md` if source syntax changes.
- Learnings updates in `implementation/offline-dataset-runtime.md`,
  `implementation/read-model-runtime.md` and `implementation/sync-policy.md`.

## Acceptance Criteria

- The reproduction above no longer holds silently: an `Event` dated 2019 in the
  reference app is either excluded from the offline dataset, or included with a
  reason that says a read model required it, and the model that produces the
  latter is one the compiler accepts deliberately rather than by omission.
- The Phase 57 cross-context case still passes: a bandmate's `Availability`
  remains offline-eligible for the founder through
  `readModelSource/BandMemberAvailability/availability/all`.
- Every existing `.adl` file in the repository compiles, and any that becomes a
  diagnostic is fixed in the same phase rather than exempted.
- Run `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run format:check`, `npm run build`, and `npm run verify:push`, inspecting
  the `desktop`, `mobile`, `administration` and `passkey` screenshots.

## Non-goals

- Composable sync scope (`SCOPE currentUser recent`), which is the recorded
  addition above and the likely next phase.
- Relationship-aware sync scope (`SCOPE relatedTo ...`).
- Bulk ingestion and the `import` policy action.
- Any change to sync modes, conflict strategies or revision semantics.

## Dependencies

- `ResolvedReadModelSource` and `resolveReadModels`.
- `OfflineDatasetService.getDatasetReasons` and `recordMatchesReadModelSource`.
- The Phase 62 `ResolvedSyncWindow` and `ResolvedObjectSyncPolicy.predicate`.
- The conformance corpus and `docs/spec/runtime-semantics.md`.

## Parallel Execution Plan

Serial spine first, in one pass with no consumers:

1. The decision itself, expressed as types: any `ResolvedReadModelSource`
   addition, its resolution, its validation, and the `OfflineDatasetService`
   reason shape. Every other stream's expected output depends on the reason
   contract, so it lands first and alone.

Fan out after the spine, with disjoint file ownership stated explicitly and each
agent verifying only its own test files:

- Runtime tests for what a source admits and what it does not.
- Conformance corpus cases, including the Phase 57 regression.
- Reference app coherence (`domain.adl`, `band-app.ts`).
- Specification and learnings.

Keep serial: `src/model/resolved-model.ts`, `src/compiler/resolve-model.ts`,
`src/compiler/validate-model.ts`, `src/parser/parser.ts`,
`src/compiler/compile-adl.ts`, `src/index.ts`, the conformance runner and case
schema, reference app fixtures, and specification updates.

Barriers: one `npm run test:integration` after the runtime and corpus streams are
in, then one `npm run verify:push` with manual screenshot inspection.

Hazards this repository has confirmed. `src/compiler/validate-model.ts` and
`src/conformance/runner.ts` each contain a NUL byte, so plain `grep` treats them
as binary and returns nothing silently — use `grep -a`, and check `grep -c`
against `grep -ac` on any file just written; write the escape `\0`, never the
byte. And check this document's evidence before executing it, as Phase 62 checked
Phase 61's and found two points wrong. The reproduction here is the cheapest
check available: create a 2019 `Event` in the reference app and evaluate the
dataset.

## Tasks

1. Decide what a read-model source inherits from its object's declared bound, and
   record the reasoning where a later phase will find it.
2. Enforce the decision in `OfflineDatasetService`, with the reason shape saying
   why a record is held.
3. Add whatever resolved-model, syntax or validation support the decision needs,
   reusing the Phase 62 `WINDOW` and predicate shapes rather than inventing new
   ones.
4. Make the reference app coherent and prove it with a test that fails against
   today's behaviour.
5. Add conformance cases, including the Phase 57 cross-context regression.
6. Specify the rule in `docs/spec/runtime-semantics.md`.
7. **Required next-phase planning handoff:** before Phase 63 closes, write
   `docs/phases/phase-64-*.md` as a complete evidence-based executable phase
   document for the highest-value remaining gap repository-wide, with objective,
   evidence, scope, constraints, deliverables, acceptance criteria, non-goals,
   dependencies, parallel execution plan, tasks, and its own handoff. The
   composable-scope, `import`-with-no-producer and lifecycle-side-effect evidence
   above is recorded in full so it does not need re-deriving. If no gap justifies
   a further phase, record that conclusion explicitly instead. Then verify,
   commit, and push Phase 63.
