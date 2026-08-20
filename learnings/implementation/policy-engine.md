# Policy Engine Hardening

Read this before changing policy evaluation, runtime record returns, UI policy presentation, lifecycle action visibility, or tests that assert policy-shaped output.

## Key decisions from Phase 7

- `PolicyEngine.evaluate(...)` is the single decision path for row, field, state, lifecycle action, and channel checks. Decisions include an `effect` and structured reasons with the matching policy/rule where one exists.
- Default deny remains a fallback from `defaultEffect: "deny"` and empty default policies. It is not modeled as an explicit deny rule.
- Explicit deny wins over allow for matching rules. Presentation restrictions are ordered as `hidden`, then `mask`, then `readonly`, before `allow`.
- Public runtime record returns are shaped through `PolicyEngine.applyReadPolicy(...)`. Field read decisions with `mask` return `MASKED_POLICY_FIELD_VALUE`; `hidden` and `deny` omit the field value.
- Field-level read policy restricts an allowed row read; it must not expand a missing row-level read grant.
- Runtime enforcement still happens before output shaping. Audit events, operation log entries, storage commits, and lifecycle hooks should continue to operate on full persisted records rather than masked public responses.
- Lifecycle transition responses are policy-shaped after after-hooks run. Tests that expect returned field values after a transition need a read policy for the target state.

## Key decisions from Phase 18

- Policy rules can carry structured runtime conditions. The initial condition model supports `equals`, `all`, `any`, and `not` over field operands, literal values, and the runtime `userId`.
- Field operands evaluate against candidate values: the existing record values overlaid with the requested patch. This lets create/update policies express invariants such as `Availability.User == runtime.userId` and prevents changing the ownership field away from the caller during an update.
- Opaque policy condition strings are not the runtime contract. Fixtures should use structured condition objects so validation and runtime evaluation stay model-first.

## Key decisions from the Jointly Care reference app

- **A `WHEN`-conditioned `SEARCH` rule can never actually grant search.**
  `ruleMatches` evaluates a rule's `condition` against `getCandidateValues(request)`
  regardless of action, but a `search` request carries no `record` and no
  `patch` -- there is no specific row yet, only the coarse "may this
  principal search this object type at all" gate `searchAuthorisedSourceRecords`
  / `ObjectStore.search` check before any row is fetched. A field reference in
  the condition resolves to `null`, so `Invitee == runtime.userId`-shaped
  conditions are always false and the rule never matches, denying search
  outright. `CREATE`/`UPDATE` conditions work as intended because those
  requests do carry candidate values (the patch, optionally overlaid on the
  existing record); `READ`/`UPDATE`/`DELETE` on a specific record work because
  `request.record` is present. The fix is modelling, not a platform change:
  give `SEARCH` (and by the same reasoning `EXPORT`) an unconditioned
  `ALLOW SEARCH AUTHENTICATED` (or `ROLE ...`) rule and let a paired `READ`
  rule's `WHEN` do the actual per-row shaping -- the pattern Giggle Band's own
  `AvailabilityPolicy.allowAuthenticatedSearchAvailability` already uses. See
  [reference-app-models](reference-app-models.md) for how this surfaced.
  **Follow-up (this session): now a compile error, not just a footgun.**
  `ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` already refused this for the
  `CONTEXT_MEMBER` principal specifically (Phase 72); generalized to a sibling
  check, `ADL_POLICY_SEARCH_CONDITION_UNREACHABLE`
  (`validatePolicyRule`, `src/compiler/validate-model.ts`), that refuses *any*
  `WHEN` condition on a `SEARCH` rule regardless of principal -- the exact
  shape (`ALLOW SEARCH AUTHENTICATED WHEN Invitee == runtime.userId`) that
  compiled clean and was silently dead at runtime here. Checked whether
  `EXPORT` shares the defect before generalizing to it too: it does not --
  `AuthorityReportingService.requireExportAllowed`
  (`src/server/authoritative-reporting.ts`) is the only call site that
  constructs an `export` `PolicyRequest`, and it always supplies a `record`
  (one per exported row, after the read model has already run), so a `WHEN`
  condition on `EXPORT` is reachable and does real per-row work, confirmed by
  `AvailabilityPolicy.allowAvailabilityOwnerExport` in Giggle Band, which
  already relies on it. See
  [docs/spec/language.md](../../docs/spec/language.md#policies) for the
  user-facing writeup and `tests/model-validation.test.ts` for compile-check
  coverage of both the refusal and the EXPORT non-refusal.
- **A context-scoped `ROLE` condition can only ever match an object that is
  itself scoped to that context, or that is the context's own bound object.**
  `getPolicyRequestContextTargets` (`context-scope.ts`) derives the contexts a
  `ROLE` check is evaluated against from either the target object's own
  `SCOPE` field, or -- when the object has no scope -- from
  `getBusinessContextsForObject(object.name)`, which only ever returns a
  context whose `OBJECT` declaration names that object (a caller's own
  identity selection, for `User`). A context-derived role earned through a
  *different* context (e.g. `CircleMember`, earned via `CONTEXT Circle
  MEMBERSHIP CircleMember ...`) can never satisfy a `ROLE CircleMember`
  condition on `User`, no matter which circle is selected: nothing in
  `getPolicyRequestContextTargets` ever looks at a business context that
  merely *relates* to the target object. Use `AUTHENTICATED` for a policy on
  an object outside the caller's own context/scope chain that legitimately
  needs any signed-in caller to reach it (see [reference-app-models](reference-app-models.md)'s
  `UserPolicy` note) rather than a `ROLE` condition that can never fire.
- **`CONTEXT_GRANT` puts only the *granted* object in reach of the object-scope
  gate, never the context's own root object.** A grant on `ON Circle OBJECT
  CircleInvite` lets a pending invitee's `CircleInvite` records clear
  `requireObjectScopeForRecord`/`requireObjectScopeForSearch`; it confers
  nothing that would let the same caller read the `Circle` record the invite
  points at, because there is no policy principal for "a grant admits me to
  this context" the way `CONTEXT_MEMBER` expresses relationship access on a
  different object's field. A read model that joins from the granted object to
  the context's own object for a grant-holder will silently drop every row
  (see `applyLookupJoinedSource`'s doc comment: a caller who may not read the
  joined record just loses the row, it does not throw) rather than error --
  easy to miss without a grant-only test case exercising exactly that caller.

## Key decisions from Phase 91: the unreachable-`ROLE` trap recurred, undetected

- **Documenting a trap did not stop it recurring.** The bullet above — a
  context-scoped `ROLE` condition can only match an object that is itself scoped
  to that context or is the context's own bound object — was written from
  Jointly Care. Giggle Band shipped the *identical* defect and nobody noticed:
  `POLICY UserPolicy ON User` granted `SEARCH` and `READ` to `ROLE BandMember`,
  and `User` is neither `SCOPE Band`-scoped nor the `Band` context's bound
  object, so `getPolicyRequestContextTargets` could only ever evaluate it
  against the `User` context. **No band member could read or search a single
  `User` record.** Every `LOOKUP User DISPLAY Name` label in the app — the
  member list, the invitation surfaces, the availability board — silently
  degraded to a raw `user-...` id, because both the browser's lookup-label
  resolver and Phase 91's new read-model resolver treat a denied target as "no
  label" rather than an error. That degradation is the correct behaviour and it
  is exactly what made the defect invisible.
- **The fix mirrors Jointly Care's own `UserPolicy`**: `AUTHENTICATED` for both
  `SEARCH` and `READ`, carrying the same recorded rationale (a caller may look a
  collaborator up to invite or recognise them; that does not depend on already
  sharing a context). It is a small deliberate widening over what the dead rules
  *said*, and the honest alternative — a `CONTEXT_MEMBER` principal keyed on the
  record's own id — does not exist: `recordBelongsToContextMember` reads
  `record.values[field]`, and a `User` record has no field holding its own id.
  If a future phase wants "only people I share a band with", that is the
  extension to make (let `contextMember.field` accept `id`, the way
  `RECORD_ID_JOIN_FIELD` already means the record's own id for a read-model
  join), not a role condition.
- **Nothing in the compiler detects this.** A `ROLE` rule that can never match is
  accepted silently, unlike the two `SEARCH` unreachability cases which are
  compile errors. The check is decidable exactly where those are: at
  `validatePolicyRule`, a `specific` principal naming a role that is only ever
  earned through a context's `MEMBERSHIP`, on an object that is neither scoped
  to that context nor that context's bound object, can never fire. Two shipped
  reference apps hit it; a diagnostic would have caught both at compile time.

## Practical guidance

- Add policy enforcement tests against direct runtime calls, not only UI rendering.
- When adding new public runtime operations that return records, shape the returned record with `applyReadPolicy(...)` after internal persistence/audit work is complete.
- UI components should keep deriving visibility, masking, readonly, and action availability from the shared `PolicyEngine`; masked or readonly field renderers should not submit values back in save patches.
- A `SEARCH` policy rule should never carry a `WHEN` condition -- it cannot
  match, and the compiler now refuses it
  (`ADL_POLICY_SEARCH_CONDITION_UNREACHABLE`). Pair an unconditioned `SEARCH`
  grant with a conditioned `READ` rule for the same principal. `EXPORT` is
  different: its policy check always carries the actual record (see the
  follow-up note above), so a `WHEN` condition on `EXPORT` is reachable and
  legitimate -- do not carry the `SEARCH` rule-of-thumb over to it.
- A `ROLE` condition on an object with no `SCOPE` only works when that object
  is itself a context's own bound object (e.g. `Band`/`Circle`). For anything
  else unscoped (e.g. `User`), reach for `AUTHENTICATED`, `OWNER`, or a
  structured field condition instead. **This has now been got wrong in both
  reference apps.** When a phase's acceptance criterion is "this surface shows a
  name", check the target object's policy against a *real* caller context before
  assuming the rendering layer is the only thing in the way — a dead `ROLE` rule
  looks exactly like a working grant, and every lookup-label path degrades
  quietly rather than throwing.
