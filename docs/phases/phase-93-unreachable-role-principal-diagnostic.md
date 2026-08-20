# Phase 93 — Compile-Time Refusal of an Unreachable `ROLE` Principal

A policy rule whose principal is a membership-earned `ROLE` can only match when
the target object is itself scoped to that context or is that context's own
bound object. Where neither holds, the rule can never fire — and reads exactly
like a working grant. This shipped twice. Phase 91 fixed the second instance;
this phase prevents the class.

## Objective

Add a validation diagnostic that refuses a policy rule whose only way to match
is a role the rule's object can never be checked against, sited beside the two
`SEARCH` unreachability checks that already answer closely related questions,
and precise enough that firing is a proof rather than a guess.

## Evidence and Dependency

**1. The runtime property this rests on.**
`getPolicyRequestContextTargets` (`src/runtime/context-scope.ts:84-127`) derives
the business contexts a `ROLE` check is evaluated against from exactly two
places: the target object's own `SCOPE` context, or — for an unscoped object —
`getBusinessContextsForObject(object.name)`, which returns only contexts whose
`OBJECT` declaration names that object. Nothing there ever looks at a context
that merely *relates* to the object. `PolicyEngine.requestHasContextRole`
(`src/runtime/policy-engine.ts:285-293`) consults nothing else.

**2. It shipped twice, and documenting it did not stop the second time.**
`learnings/implementation/policy-engine.md` recorded the trap from Jointly Care.
Giggle Band then shipped the identical defect: `POLICY UserPolicy ON User`
granted `SEARCH` and `READ` to `ROLE BandMember`, and `User` is neither
`Band`-scoped nor the `Band` context's bound object. No band member could read
or search a single `User` record, so every `LOOKUP User DISPLAY Name` label in
the app degraded to a raw `user-…` id. Both lookup-label resolvers treat a
denied target as "no label" rather than an error, which is correct behaviour and
is exactly what made an access-control defect present as a cosmetic one. See
`docs/phases/phase-91-read-model-lookup-display-resolution.md`'s Execution Note.

**3. The siblings this sits beside already exist.**
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` (Phase 72) and
`ADL_POLICY_SEARCH_CONDITION_UNREACHABLE` refuse two other rules that compile
clean and match nothing, both in `validatePolicyRule`
(`src/compiler/validate-model/policy.ts`). Both are **errors**. Their message
shape ("… which can never match: … <do this instead>") and their `path`-based
range reporting are the conventions to follow.

**4. The model does distinguish membership-earned roles from global ones.**
A context's `MEMBERSHIP … ROLES` list enumerates the roles that context confers,
and `listMembershipContexts` (`src/runtime/context-service.ts:307`, and again at `:157`) drops a
membership record whose role is not on that list. A role no membership lists —
`SystemAdmin` in both reference apps — is only ever held globally, via
host-supplied `RuntimeContext.roles` read by `contextHasGlobalRole`. That is a
convention the model expresses, not a guarantee it enforces; see the Decision.

**5. `ModelIndexes` carries no role index today.** `contextsByName` exists;
`rolesByName` does not (`src/compiler/validate-model/shared.ts:68-77`). Role
inheritance closure needs one.

## Decision

**Error, not warning.** The check was prototyped and run over every model in the
repository before the severity was chosen: 180 models (both reference apps, the
retained `.adl` text view, `examples/`, and every conformance model and inline
case model), carrying 352 `specific` principals that name roles. It fires on
**zero** of them. No existing model becomes invalid, so the weaker severity buys
nothing and would leave the class as easy to ship as before.

**Precision over reach.** A false positive on a valid policy is far worse than
missing an exotic dead rule, so the check fires only when every one of these
holds:

1. the principal is `specific` and its roles are its *only* disjunct — no
   `users`, no `groupRoles`, no `owner`, because a principal is a disjunction
   and any of those keeps the rule live;
2. **every** role it names is unreachable, for the same reason;
3. each named role is conferred by some context's `MEMBERSHIP … ROLES` list and
   is not reachable by `INHERITS` from any role that no membership confers;
4. no context the object's `ROLE` check resolves against declares a `MEMBERSHIP`
   with no `ROLES` list — such a membership accepts whatever string its records
   carry, so nothing about role reach is decidable there;
5. the object's `SCOPE` context, if it has one, actually exists — an unknown one
   is already reported by `ADL_OBJECT_SCOPE_CONTEXT_UNKNOWN` against the
   declaration at fault.

**The one assumption, stated plainly.** The model never declares who holds a
role globally; `RuntimeContext.roles` is supplied by the host. Point 3 above
therefore treats "no context membership confers this role" as "the host assigns
it globally". This is the conservative direction — it only ever *suppresses* the
diagnostic — and it is what makes an error severity defensible. A host that
handed out `BandMember` globally would make a refused rule live; that host would
also be contradicting its own model, and no compiler can see it.

**Shapes deliberately not caught**, recorded so nobody reads a clean compile as
proof of role reach:

- a rule naming one dead role *alongside* a live one (`ROLE BandMember,
  SystemAdmin` on `User`): the rule still matches, and the dead half stays
  invisible;
- a role dead only because the host never assigns it;
- anything involving a membership with no declared `ROLES` list;
- reachability of `CONTEXT_MEMBER`, `groupRoles`, or `users` principals.

## Scope

- `src/compiler/validate-model/codes.ts` — add
  `POLICY_ROLE_PRINCIPAL_UNREACHABLE`.
- `src/compiler/validate-model/shared.ts` + `index.ts` — add `rolesByName` to
  `ModelIndexes`.
- `src/compiler/validate-model/policy.ts` — `buildRoleReach`,
  `expandDeclaredRoles`, `getRoleCheckContexts`, `validatePolicyRoleReach`.
- `tests/model-validation.test.ts` — two positive and seven negative cases.
- `conformance/model/policy-role-reach.json` — three cases.
- `docs/spec/language.md` — extend "Role reach" with the refusal and its limits.
- `learnings/implementation/policy-engine.md`, `learnings/index.md`.
- Whatever existing model the diagnostic legitimately catches.

## Non-goals

- Widening what a `ROLE` check can see at runtime. The narrowness of
  `getPolicyRequestContextTargets` is the documented contract, not a defect.
- Letting `contextMember.field` name a record's own id (Phase 91's recorded
  extension for "only people I share a band with"). Still a language change.
- Any diagnostic for a partially-dead principal.
- Touching the runtime, the browser, or any UI surface.

## Constraints

- Never weaken a constraint or loosen a test to make verification pass. If the
  new check catches an existing model, fix the model.
- `validateApplicationModel`'s call order is behaviour: diagnostics are ordered
  and some tests assert `diagnostics[0]`.
- No Playwright, `verify:push`, `build`, or `test:visual` in this phase's
  worktree; a parallel agent holds those ports.

## Acceptance Criteria

1. `ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE` refuses the pre-Phase-91 Giggle Band
   shape (`ALLOW READ ROLE BandMember` on `User`) with severity `error` and path
   `policies[N].rules[M].principal.roles`.
2. It does not fire for: an object scoped to the role's context; a context's own
   bound object; an inherited role held inside the right context; a role no
   membership confers; a role a non-membership role inherits; a principal with
   another live disjunct; `authenticated` / `owner` / `everyone` / `users` /
   `contextMember` principals; or a membership with no `ROLES` list.
3. Both reference apps and every conformance model compile with zero occurrences
   of the new code.
4. `npx tsc --noEmit` clean; `npx vitest run` green; `format:check` clean.

## Testing

- `tests/model-validation.test.ts` for the diagnostic's own boundaries.
- `conformance/model/policy-role-reach.json` for the cross-runtime contract,
  following `learnings/implementation/conformance-suite.md` (discovered by glob;
  no registration needed).
- A throwaway sweep compiling every reference app, example and conformance model
  through the real validator, reporting every occurrence of the new code. This
  is the real false-positive test; delete before committing.

## Parallel Execution Plan

Serial. The whole change is four files in one compiler domain plus its tests;
fan-out would cost more coordination than it saves, and `codes.ts`,
`shared.ts` and `validate-model/index.ts` are exactly the shared spine that must
not be written concurrently.

## Tasks

1. Re-verify the Evidence against current code.
2. Prototype the predicate in a throwaway sweep over every model in the
   repository; let the count of would-be failures decide the severity.
3. Add `rolesByName` to `ModelIndexes`; add the diagnostic code.
4. Implement `buildRoleReach` / `getRoleCheckContexts` /
   `validatePolicyRoleReach`.
5. Tests: positives for the shipped defect shape and its inherited-role variant,
   negatives for every guard. Mutation-check each guard.
6. Add the conformance cases.
7. Fix whatever the diagnostic legitimately catches.
8. Spec and learnings updates.
9. `tsc`, `vitest run`, `format:check`; commit.

## Planning Handoff

**Next phase candidate: reconcile or retire `src/reference/giggle-band/domain.adl`
and `ui.adl`.**

This phase's diagnostic immediately found a third live instance of the very
defect it exists to prevent, inside that file — see the Execution Note. The
underlying condition is repository-wide and not specific to policies:
`domain.adl` has not been touched since `55c4bb2` ("Convert Giggle Band
reference app from .adl text to .adlj JSON"), while `domain.adlj` has moved
through Phases 87, 91 and 92. They now differ by **12 vs 11 objects, 24 vs 22
policies, 9 vs 8 read models, and `MODEL_VERSION 1.9.0` vs `1.0.0`**.

Two tests compile that snapshot as if it were the app
(`tests/compile-adlj.test.ts`'s round-trip proof, `tests/compile-adl-project-v2.test.ts`'s
regression proof), so it is load-bearing — but it is load-bearing as a *parser
fixture*, while sitting in the reference app's directory under the app's own
name, where every reader and every agent will take it for the app's source.
That is how a defect Phase 91 fixed survived six phases in a checked-in file.

This ranks above the other visible gaps because it is a correctness-of-source
problem with a demonstrated failure, not a feature: whichever direction is
chosen — regenerate from `.adlj` via `print-adl.ts` and pin the regeneration
with a test, or move it to `tests/fixtures/` and name it for what it is — the
phase must decide deliberately rather than let the divergence keep growing. It
should also check whether Jointly Care and the other demos have an equivalent
stale artifact (Jointly Care does not: it is `.adlj`-only).

Note for the integrator: three other phase branches were in flight alongside
this one. If any of them queued a higher-value phase, this handoff is a
candidate to sequence against, not a claim to displace it unread.

## Execution Note

Executed serially in a worktree on `phase-93-unreachable-role-principal-diagnostic`,
from `524e110`, exactly as the Parallel Execution Plan directed.

### The Evidence held in full

All five points re-verified against current code before anything was written.
Point 4 was the one that needed establishing rather than confirming, and the
resolved model does distinguish the two kinds of role: `ResolvedContextMembership.roles`
enumerates what a context confers, `SystemAdmin` appears in neither reference
app's membership list, and `bandReferenceSystemContext` (`src/reference/band-app.ts:13-18`)
hands it out as a *global* `roles: ["SystemAdmin"]`. That is the convention the
check reads, and its limits are stated in the Decision rather than assumed away.

### Severity: chosen from evidence, not from preference

The prototype sweep validated **180 models** — Giggle Band and Jointly Care via
`compileAdlProjectV2`, the retained `.adl` text view via `compileAdl`, all four
`examples/` files, and every `models` entry and inline case model in
`conformance/*/*.json` (including the 27 that are `{"adl": [...]}` source
arrays, which the first pass silently skipped and the second pass compiled). Of
352 `specific` principals naming roles, **the check fired on one** — the
deliberately dead fixture this phase added. Nothing legitimate is caught, so
`error` costs nothing and matches both siblings.

### It found a third live instance immediately

`src/reference/giggle-band/domain.adl` still carried the exact pre-Phase-91
rules:

```adl
POLICY UserPolicy ON User
  RULE allowBandMemberSearchUsers ALLOW SEARCH ROLE BandMember
  RULE allowBandMemberReadUsers ALLOW READ ROLE BandMember
END.POLICY
```

Phase 91 corrected `domain.adlj`; the printed `.adl` view was never regenerated,
and two tests that compile it went red the moment the diagnostic existed. Fixed
here to match the `.adlj` (`ALLOW SEARCH/READ AUTHENTICATED`, with the rationale
carried as a `#` comment block), which is the only honest option — the
alternative was weakening the check to accommodate a known defect. The wider
divergence this exposed is the Planning Handoff above.

### Each guard is mutation-tested

Removing the global-role guard, the other-disjuncts guard, or the
undeclared-`ROLES`-list guard each turns exactly one negative test red. Guards
that no test can distinguish from their absence are guards nobody can maintain,
so this was checked rather than assumed.

### Results

- `npx tsc --noEmit` clean.
- `npx vitest run`: 61 files / **1,117** tests, all passing (baseline 61 /
  1,104; +9 unit tests, +4 from the new conformance file — 3 cases plus its
  per-file corpus checks).
- `npm run format:check` clean.
- Full-corpus sweep after implementation: 180 models validated, both reference
  apps returning **zero** diagnostics of any code, and one occurrence of
  `ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE` — the intended fixture.

### Not done, and why

`npm run verify:push`, `npm run build` and any Playwright command were out of
bounds for this worktree (a parallel agent holds the fixed ports). Nothing in
this phase touches browser rendering, shell chrome, presentation output or CSS,
so no screenshot pass is owed by it; the integrator runs one once, over all
branches. `npm run test:integration` was not run: nothing here reaches the
authority server, PostgreSQL, migrations, the unit of work, or the HTTP edge.
