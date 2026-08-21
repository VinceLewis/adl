# Phase 103 — A Policy Principal for "This Record Is Me"

A user cannot be granted read access to their **own** `User` record. Not by a
narrower policy, not by a condition, not by any construct the language has.
Phase 91 hit this, Phase 99 hit it, and Phase 101 hit it and wrote it down.

**This is an enabling phase, not a defect fix.** Nothing is broken today,
because neither reference app has a profile screen and so nothing asks for the
capability. What this phase removes is a wall that three consecutive phases have
each walked into and each deferred. It is worth saying plainly rather than
dressing a gap up as an outage.

> **Phase numbers are no longer execution order in this repository.** The owner
> reprioritised mid-flight: Phases 100 and 101 were executed before Phase 99.
> This document is executed **after Phase 99 lands**, and **after Phase 102**, in
> the ordered run 102 → 103 → 104.

## Objective

Give ADL a way to say "the caller may read the record that *is* them", as a
row-level grant, without reopening the user directory that Phase 101 just
closed. Ship the capability with grammar, `.adlj` mapping, printer support,
validation, conformance coverage and specification — and change no reference
app's content.

## Evidence and Dependency

Re-verified against the worktree at `3b9f7e0`. Line numbers were resolved by the
author; the prior-document claims they confirm are attributed where they apply.

### 1. `OWNER` cannot match a `User` record about itself

`src/runtime/policy-engine.ts:364-375`:

```ts
function isOwner(record: StoredObjectRecord | undefined, userId: string): boolean {
  if (record === undefined || userId.length === 0) return false;
  return (
    record.meta.createdBy === userId ||
    record.values.OwnerId === userId ||
    record.values.ownerId === userId ||
    record.values.CreatedBy === userId
  );
}
```

Reached from `principalMatches`' `case "owner"` at
`src/runtime/policy-engine.ts:288-289`. A `User` record carries no `OwnerId`,
`ownerId` or `CreatedBy` field in either reference app — Giggle Band's `User` has
`Name`, `Email`, `ProfilePicture`; Jointly Care's has `Email`, `DisplayName`,
`Timezone` — and its `meta.createdBy` is whoever seeded or invited it, not the
person it describes. (Phase 101 recorded three of these four disjuncts; the
fourth, `values.CreatedBy`, is present in the code today and changes nothing
about the conclusion.)

### 2. No condition operand reaches a record's own id

`ResolvedPolicyConditionOperand` (`src/model/resolved-model/policy.ts:64-67`) is
exactly `field` / `runtime` / `literal`, and `PolicyConditionRuntimeProperty`
(line 24) is exactly `"userId"`. A rule's `condition` resolves to a
`ResolvedExpression` (`src/compiler/resolve-model/policy.ts:43`), evaluated by
`evaluateRuntimeCondition` against `getCandidateValues(request)` —
`record.values` overlaid with `patch`
(`src/runtime/policy-engine.ts:260-268`, `:377-382`). `evaluateField`
(`src/runtime/expression-evaluator.ts:112-131`) reads `input.values[field]` and
nothing else; a missing key yields `null`. There is no record id, no
`record.meta`, anywhere in that channel. So `WHEN id == RUNTIME.userId` is not
merely unsupported — it silently evaluates `null == "user-…"` and is false.

### 3. Phase 101's field-scoped `ALLOW` deliberately cannot help

`policy.field.allow-does-not-grant-row.001` in
`conformance/runtime/context-policy.json:2540` pins the semantics: a rule naming
`fields` **cannot** match a whole-record request. That is exactly why Phase 101
could close the directory — and exactly why it cannot open a profile screen,
which wants the whole record. The two requirements are opposites and both are
correct.

### 4. The rest of the runtime *already asserts* the invariant a `SELF` principal needs

This is the finding that decides the phase, and it was not in any prior document.

`src/runtime/offline-dataset-service.ts:641-652`, resolving a
`SYNC … SCOPE CURRENT_USER`:

```ts
if (record.meta.guid === context.userId || record.meta.createdBy === context.userId) {
  return true;
}
```

The first disjunct is precisely "this record **is** the caller". The second is
`OWNER`. Both reference apps declare `User.sync = { mode: "localFirst", scope:
"currentUser" }`, so **a user's own `User` record is already selected into their
offline dataset — and then the policy engine refuses to let them read it.** Two
runtime services disagree about the same invariant, and the policy engine is the
one that cannot express it.

`src/runtime/read-model-service.ts:423-437` says the same thing a second way:
for a `currentUser`-scoped read-model source over the user-context object, the
record id it looks up **is** `context.userId`.

The reference apps hold up their end: `src/reference/band-app.ts:483` builds the
musician's context as `userId: existing[0].meta.guid` — the `User` record's own
guid — and `src/reference/jointly-app.ts:348` does the same.

### 5. Both apps declare the model-level notion of "the user object"

`CONTEXT User ON User` in both `src/reference/giggle-band/domain.adlj` and
`src/reference/jointly-care/domain.adlj`. That is the same declaration
`read-model-service.ts:430-437` and `offline-dataset-service.ts:654-657` already
key on, so "which object is the user object" is a question the model answers, not
one this phase has to invent.

### 6. Where the search gate sits, which is what keeps the directory shut

`src/runtime/object-store.ts:563` — `search` is checked once, at object level,
with **no record**: `requireAllowed({ objectName, action: "search" }, context)`.
`UserPolicy` in both apps grants no `search` at all after Phase 101. So a
row-level `SELF` grant on `read` cannot leak a directory: there is no request
shape in which it enumerates anything. `src/runtime/object-store.ts:285-310`
shows the `read` path does supply `record`, so a record-matching principal has
something to match against.

### 7. There is a precedent for refusing a principal on `search`

`src/compiler/validate-model/policy.ts:109-123` emits
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` for exactly the shape above: a
record-matching principal on a recordless gate. Its comment states the reason —
*"That is worse than a parse error: it looks like a working grant."* A `SELF`
principal has the identical property and needs the identical diagnostic.

**Dependency:** Phases 99, 101 and 102. Phase 101 established the field-scoped
grant this phase does *not* replace; Phase 102 precedes it in the ordered run.
Nothing here depends on Phase 102's content.

## Decision

### Add a `SELF` policy principal: `PrincipalMatch` gains `"self"`

```adl
POLICY UserSelfPolicy ON User
  ALLOW READ SELF
  ALLOW UPDATE SELF
END.POLICY
```

That example **has not been compiled**, and could not be: `SELF` is the keyword
this phase creates. It is a specification, not verified source. `AGENTS.md`'s
compile-check rule binds from Task 3 onward — every example that reaches
`docs/spec/*` must go through `compileAdl` / `compileAdlj` with
`diagnostics: []` before it is committed.

Semantics, one line, mirroring `isOwner`'s shape:

```ts
function isSelf(record: StoredObjectRecord | undefined, userId: string): boolean {
  return record !== undefined && userId.length > 0 && record.meta.guid === userId;
}
```

Five properties make this the right construction:

**It is a principal, not a condition.** `OWNER`, `CONTEXT_MEMBER` and `SELF` all
answer "what is the caller's relationship to this record?". A `WHEN` condition
answers "what does this record contain?". Putting record-identity matching in the
condition channel would put it in the wrong half of the language and drag the
expression evaluator — shared with computed fields, validators, guards, read
models and decision tables — into a question none of those ask.

**It grants the row, which is what a profile screen needs.** Phase 101's
field-scoped rule cannot, by design and by conformance case. `SELF` is a
whole-record grant to exactly one caller.

**It cannot reopen the directory.** `search` is gated once with no record
(Evidence 6), so a `SELF` rule can never widen enumeration. This is guaranteed by
the request shape rather than by careful policy authoring, which is the property
Phase 101 was looking for and could not get from `CONTEXT_MEMBER`.

**It introduces no new invariant.** `record.meta.guid === context.userId` is
already the platform's own rule in two runtime services (Evidence 4). This phase
makes the policy engine agree with them instead of adding a third opinion.

**It costs one line of runtime.** Everything else is surface: a union member, a
keyword, a printer branch, a JSON-schema enum entry, a validator rule and
conformance cases. `PolicyEngine.principalMatches` is a `switch` over
`PrincipalMatch`, so `tsc` names every site that must handle the new member.

### `SELF` on `SEARCH` is a compile error

`ADL_POLICY_SELF_SEARCH_UNREACHABLE`, modelled line-for-line on
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE`
(`src/compiler/validate-model/policy.ts:109-123`), with a message that names the
reason and the alternative. Shipping a principal whose most natural misuse
compiles clean and is silently dead would repeat the exact defect Phase 93 turned
into `ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE` and Phase 101's execution note calls
out again. The diagnostic ships **with** the principal, in the same phase, not
after somebody trips over it.

### Naming: `SELF`, not `CURRENT_USER`

`CURRENT_USER` is the established spelling for a **scope** — `SYNC … SCOPE
CURRENT_USER`, a read-model source `SCOPE CURRENT_USER` (`src/parser/grammar/read-model.ts:247-250`,
`src/parser/grammar/sync.ts:161`) — where it means "records belonging to the
current user". Reusing it for a principal would read as "the principal is the
current user", which is what `AUTHENTICATED` already says. `SELF` says the thing
that is actually distinctive: the record is the caller. One word, no collision
with an existing keyword, and it parallels `OWNER` in both length and grammar
position.

### Rejected alternatives

**Extend `OWNER` to also match `record.meta.guid === userId`.** The cheapest
possible change — one disjunct in `isOwner`, no language surface, no fingerprint
risk — and it was seriously considered. Rejected on three grounds. It silently
changes the meaning of a shipped construct in every policy of every application
and every conformance case at once, with nothing in any model declaring the new
behaviour. It conflates two genuinely different claims — "I created this" and
"this is me" — so an application that wants one and not the other loses the
ability to say so, permanently. And it is invisible: a reviewer reading `ALLOW
READ OWNER` on `User` would have no way to know the rule now grants self-read
unless they read the runtime. The one-line-of-runtime saving is not worth an
undeclared semantic change; that trade is how the dead `ROLE BandMember` rule
survived two reference apps.

**A policy-condition operand for the record's own id** (`{ kind: "recordId" }`,
or a `RECORD.id` expression). The brief's first candidate, and the most tempting
because it reads naturally: `ALLOW READ AUTHENTICATED WHEN RECORD.id ==
RUNTIME.userId`. Rejected because a policy condition is not a private channel.
`ResolvedPolicyRule.condition` is a `ResolvedExpression`
(`src/model/resolved-model/policy.ts:39`), the *same* type consumed by computed
fields, predicate validators, lifecycle guards, command preconditions, decision
tables and read-model projections. A new expression kind must therefore be
either given a meaning in all of them — where "the record's own id" ranges from
meaningless to actively wrong — or explicitly refused in each, which is six new
diagnostics to buy one grant. It is also strictly worse where it overlaps:
`src/compiler/validate-model/policy.ts:137-138` already refuses **any**
`WHEN`-conditioned `search` rule as unreachable, so the condition form would need
the same diagnostic the principal form needs, plus all the rest.

**`contextMember.field: "id"`,** the extension Phase 91 proposed, Phase 99
nominated and Phase 101 declined. It is a real and worthwhile extension, and it
is **not a substitute for this one** — it answers a different question. It says
"whoever this record belongs to is in a context with me", so on `User` with
`context: Band` it would grant a caller read over *every band co-member's* `User`
record. That is a band-scoped directory, which is a narrowing of what Phase 101
closed rather than the row-level self-grant a profile screen needs. It also
requires deciding what `field: "id"` means when an object genuinely declares a
field named `id`, a magic-string collision this phase does not have. It stays on
the handoff list, unchanged.

**A self-referencing declared field on `User`.** Zero platform change: `isOwner`
already checks `values.OwnerId`, so an application could declare
`User.OwnerId` holding the record's own guid and `ALLOW READ OWNER` would work
today. It is available to any application right now and it is not the answer.
The runtime mints the record id (`ObjectStore.planCreateForTransaction`), so
populating the field means either passing `options.recordId` on create — pushing
id minting into every caller that wants a profile screen — or a second write
after create, with no declarative way to express either and nothing checking that
the stored value still equals the real id. It makes every application reinvent
the same convention by hand, unverifiably, and it adds a redundant field to the
`User` object's fingerprint. A platform invariant the platform already relies on
in two places (Evidence 4) should be a platform construct.

**Do nothing and wait for a profile screen to be requested.** Defensible on the
narrow facts — nothing ships worse today. Rejected because three phases have now
paid the cost of routing around this, and each time the reasoning had to be
rediscovered and re-argued from scratch (Phase 99 §6 got it half wrong and Phase
101 had to correct it). The capability is one line of runtime behind a small
surface; the deferral has cost more than the work will.

## Scope

- `src/model/resolved-model/policy.ts:16-22`: `PrincipalMatch` gains `"self"`.
- `src/runtime/policy-engine.ts`: an `isSelf` helper and a `case "self"` in
  `principalMatches`.
- `src/parser/grammar/policy.ts:150-177`: a `SELF` keyword branch beside
  `OWNER`; `SELF` added to the rule-option stop-word set (line 29-48) and to the
  `failUnexpected` accepted-options message.
- `src/compiler/print-adl.ts:1704-1710`: a `case "self": return "SELF"` branch.
- `src/model/adlj-schema.json:3398-3406`: `"self"` in the `PrincipalMatch` enum.
- `src/compiler/validate-model/policy.ts` and `codes.ts`:
  `ADL_POLICY_SELF_SEARCH_UNREACHABLE`.
- `docs/spec/language.md` (the `POLICY` principal vocabulary),
  `docs/spec/adlj.md` (the principal mapping table), and
  `docs/spec/runtime-semantics.md` (what `SELF` matches and when it cannot).
- `conformance/runtime/self-principal.json`: **new**, modelled on
  `conformance/runtime/context-member-principal.json`.
- Tests: unit, parser, printer round-trip, real-PostgreSQL integration.
- `learnings/implementation/policy-engine.md` and
  `learnings/implementation/context-grants-and-relationship-access.md`.

## Non-goals

- **No profile screen in either reference app, and no change to either app's
  `.adlj`.** See the recommendation below. The phase ships the capability; using
  it is a separate decision with a separate cost.
- **No `contextMember.field: "id"`.** Still the right *next* platform extension
  and still not this one.
- **No change to `isOwner`.** `OWNER` keeps exactly the four disjuncts it has.
- **No change to Phase 101's field-scoped rules.** Both apps' `UserPolicy` and
  `UserSystemAdminPolicy` are untouched; the directory stays closed.
- **No new expression kind, and no change to `ResolvedPolicyConditionOperand`.**
- **No "unreachable object" diagnostic for a `SELF` rule on an object that is not
  the user-context object.** Tempting by analogy with Phase 93, and deliberately
  not taken: unlike the `search` case, which is provably dead from the request
  shape, this one would rest on an assumption about which objects may hold
  records in the user-id namespace. Phase 93's own learning records that a
  diagnostic must have stated limits; this one's limits are not yet known well
  enough to make it an error. Named in the Planning Handoff.
- **No `modelVersion` or `modelFingerprint` movement.** Widening a union changes
  no application's content.

## Constraints

- `SELF` must match **only** `record.meta.guid === context.userId`, and must
  return false for an absent record or an empty `userId` — same fail-closed shape
  as `isOwner` and `recordBelongsToContextMember`.
- An explicit `DENY`, `HIDDEN` or `MASK` rule must still win over a `SELF`
  allow. Deny-wins is evaluated before allows
  (`src/runtime/policy-engine.ts:53-60`) and nothing here may change that.
- `SELF` must not widen `search`. Proven by test, not by inspection.
- Both reference apps' `modelVersion` and `modelFingerprint` must be **measured**
  unchanged, the way Phase 100 measured them — not assumed from "no `.adlj` was
  edited".
- Every new parser rule must be shown failing on the pre-change grammar
  (Phase 100's standard).
- No existing test, conformance case or constraint may be weakened. If the new
  `SEARCH` diagnostic fires on existing content, that content has a real dead
  rule and the content is what changes.
- Policy enforcement is an authority-side claim, so at least one proof runs
  against real PostgreSQL (`AGENTS.md`, Testing; the precedent is
  `tests/integration/user-directory-policy.test.ts`).

## Acceptance Criteria

1. `ALLOW READ SELF` on a `User`-shaped object lets a caller read their own
   record **in full**, including fields no field-scoped rule grants.
2. The same rule refuses another user's record — `PolicyDeniedError`, not a
   shaped-empty row.
3. The same rule grants no `search`: enumeration still fails at the object-level
   gate.
4. `ALLOW SEARCH SELF` is a compile error, `ADL_POLICY_SELF_SEARCH_UNREACHABLE`.
5. An explicit row-level `DENY … SELF`-matching rule still suppresses the read.
6. `SELF` parses from `.adl` text, prints back to `SELF`, and round-trips to an
   identical resolved model; the same rule expressed in `.adlj` as
   `{ "match": "self" }` resolves identically.
7. Both reference apps' `modelVersion` and `modelFingerprint` are byte-identical
   to their pre-phase values, measured and recorded.
8. The `SEARCH` diagnostic was shown failing before it worked, and the parser
   rule was shown failing on the pre-change grammar.
9. `npx tsc --noEmit`, `prettier --check`, unit, conformance and integration
   suites all clean, with no test weakened.

## Testing

- **Unit** (`npx vitest run`; baseline 1,128 after Phase 101).
  - `tests/policy-engine.test.ts`: `SELF` matches own record / refuses another's
    / refuses with no record / refuses with an empty `userId`; a `DENY` still
    wins; a `SELF` allow does not satisfy a field request differently from a row
    request.
  - `tests/parser.test.ts`: `ALLOW READ SELF` parses; `SELF` appears in the
    rule-option `failUnexpected` message; the pre-change grammar's failure
    (`Expected POLICY rule option … but found 'SELF'.`) is recorded.
  - `tests/model-validation.test.ts`: `ALLOW SEARCH SELF` produces
    `ADL_POLICY_SELF_SEARCH_UNREACHABLE`; `ALLOW READ SELF` produces nothing.
  - `tests/compile-adlj.test.ts`: a `.adlj` `{ "match": "self" }` rule prints as
    `SELF` and round-trips.
  - Model-version and fingerprint tripwires: **unchanged**, and that is the
    assertion.
- **Conformance.** `conformance/runtime/self-principal.json`, modelled on
  `context-member-principal.json`: own-record read allowed, other-record read
  denied, search denied, deny-wins. Each case must be shown to **discriminate**
  — break one expectation, watch the case fail — per
  `learnings/implementation/conformance-suite.md`.
- **Integration** (`--config vitest.integration.config.ts`, real PostgreSQL;
  baseline 163 + Phase 102's additions). Extend
  `tests/integration/user-directory-policy.test.ts`, or add a sibling: a model
  carrying Phase 101's field-scoped `UserPolicy` **plus** a `SELF` row rule,
  driven over `PostgresObjectStorageBackend`, proving the caller reads their own
  record whole, another user's not at all, and the directory not at all. The
  combination is the real claim — that adding `SELF` did not undo Phase 101 —
  and it is an authority-side claim, so it is proven against real PostgreSQL.
- **Mutation checks.** Removing the `case "self"` branch, and changing `isSelf`
  to compare `record.meta.createdBy` instead of `record.meta.guid`, must each
  turn a specific named test red. Deleting the `SEARCH` diagnostic must turn the
  validation test red.
- **Not run:** `npm run verify:push`, Playwright, `npm run build`. No browser
  rendering, shell chrome, reference-app screen, presentation output or CSS
  changes; no reference-app model content changes.

## Parallel Execution Plan

Mostly serial: the phase is one thin capability threaded through six layers, and
each layer's shape is decided by the one below it.

1. **Serial spine.** `PrincipalMatch` gains `"self"`; `isSelf` and the
   `principalMatches` branch land, with no other consumers. `tsc` then names
   every remaining site — parser, printer, schema, validator — which is the
   point of doing this first: later work receives a real exhaustiveness error
   list rather than a predicted one.
2. **Then parallel** (three streams over disjoint files):
   - grammar + AST/keyword-list edits, with the fail-first probes;
   - printer branch + `adlj-schema.json` enum + the `.adlj` round-trip test;
   - validator diagnostic + code + validation tests.
3. **Then serial again.** Conformance cases (the runner and case schema are a
   shared spine and stay serial by repository rule), the integration test, and
   the three specification documents.
4. **Barriers.** `npx vitest run` after (2). Conformance and
   `--config vitest.integration.config.ts` once, at the end.

Kept serial regardless: `docs/spec/*` (three documents describing one decision),
the conformance corpus, and this phase document. No reference-app fixture is
touched, so the usual fixture serialisation does not apply.

## Tasks

1. Prove the gap first: a test showing a caller cannot read their own `User`
   record under any rule the language has today. Keep it — after the phase it
   becomes the `SELF`-less control case.
2. Widen `PrincipalMatch`; add `isSelf` and the `principalMatches` branch; let
   `tsc` enumerate the rest.
3. Prove the `SELF` keyword fails on the pre-change grammar; add the grammar
   branch, the stop word and the message.
4. Add the printer branch and the `.adlj` schema enum entry; round-trip both
   directions.
5. Add `ADL_POLICY_SELF_SEARCH_UNREACHABLE`, shown failing first.
6. Add `conformance/runtime/self-principal.json`; show each case discriminates.
7. Add the real-PostgreSQL integration case combining `SELF` with Phase 101's
   field-scoped rule.
8. Run the mutation checks.
9. Measure both reference apps' `modelVersion` and `modelFingerprint` and record
   that neither moved.
10. Update `docs/spec/language.md`, `adlj.md` and `runtime-semantics.md`;
    compile-check every new ADL example through `compileAdl` / `compileAdlj` per
    `AGENTS.md`.
11. Update `learnings/implementation/policy-engine.md` and
    `context-grants-and-relationship-access.md`, including the
    `offline-dataset-service.ts:650` finding — the platform already asserted this
    invariant and only the policy engine could not say it.

## Recommendation on a profile screen (deliberately out of scope)

**Recommended: yes, for Giggle Band, as a follow-up phase — not here.**

Giggle Band is the better subject: its `User` carries `Name`, `Email` and
`ProfilePicture`, which is an actual profile, and it is the construct-richer app
that the repository already uses as the second precedent for new surfaces.
Jointly Care's `User` is `Email`, `DisplayName`, `Timezone` and would make a
thinner screen.

A follow-up would need, at minimum:

- **A `SELF` rule** in `UserPolicy`, alongside Phase 101's field-scoped rule
  (`ALLOW READ SELF`, and `ALLOW UPDATE SELF` if the screen is editable). This
  is the only part this phase unblocks.
- **A way for a view to bind to "my record".** A view resolves against a record
  id; nothing in the shell or presentation language today says "the current
  user's record". Read models already have `SCOPE CURRENT_USER`
  (`src/runtime/read-model-service.ts:423-437`), so the cheapest honest route is
  a `currentUser`-scoped read model over `User` plus an ordinary composite view —
  but a nav item that targets a *form* on the caller's own record would need new
  shell or view syntax, and that is a language decision, not a screen.
- **A `SHELL NAV` entry**, its icon, group and order.
- **A `modelVersion` bump with an empty-object migration hop, and a real-browser
  persisted-state upgrade test for Giggle Band** — the content change moves the
  fingerprint, which is the binding rule in `AGENTS.md`'s Testing section.
- **`npm run verify:push` with the new screenshots inspected**, plus an
  `/impeccable audit` pass, since it is a new user-facing screen.

That is a properly-sized phase of its own, most of whose cost is the view-binding
question rather than the policy. Bundling it here would hide a language decision
inside a capability phase — the move Phase 100 explicitly declined to make.

## Planning Handoff

**Next phase: Phase 104 — `MATRIX` text syntax**, as planned in the ordered run
102 → 103 → 104. It is the last of Phase 100's three named deferrals that is a
*construct* rather than an open language question, and it is the largest
remaining hole in the "`.adl` text is a complete printout of `.adlj`" contract.

Candidates that surfaced here and were not taken:

- **A profile screen for Giggle Band.** Recommended above; it is the natural
  consumer of this phase and needs a view-binding decision first.
- **`contextMember.field: "id"`.** Proposed by Phase 91, nominated by Phase 99,
  declined by Phase 101 and declined again here. It answers "only people I share
  a context with", which `SELF` does not and is not meant to. It remains the
  right next *platform* extension after this one, and it now has a smaller job to
  do: with `SELF` shipped, it no longer has to double as the self-read
  mechanism.
- **`ADL_POLICY_OWNER_SEARCH_UNREACHABLE`.** `ALLOW SEARCH OWNER` is dead for the
  identical reason `SELF` and `CONTEXT_MEMBER` are — `isOwner(undefined, …)` is
  false at the recordless gate — and has no diagnostic. Noticed while writing the
  `SELF` one. It is a pre-existing gap in shipped behaviour and adding it here
  would mean auditing existing content for rules it might newly refuse, which is
  a different phase's work.
- **A `SELF`-on-the-wrong-object diagnostic.** See Non-goals. Worth revisiting
  once there is a second application with a user-context object of a different
  name, which would show whether the rule generalises.

---

# Execution Note (2026-08-21)

## Evidence that had drifted, and what still held

The document re-verified itself at `3b9f7e0`; this was executed on a branch off
`adb8de8`. **Every substantive claim in "Evidence and Dependency" held.** Three
pointers had moved and one named file does not exist:

- `ResolvedPolicyConditionOperand` is at `src/model/resolved-model/policy.ts:63-66`,
  not `:64-67`, and `PolicyConditionRuntimeProperty` at `:23`, not `:24`. Content
  identical.
- `isSelf`'s intended neighbour `isOwner` is at `policy-engine.ts:364-375` and
  `principalMatches`' `case "owner"` at `:288-289` — both exactly as quoted.
- `src/model/adlj-schema.json`'s `PrincipalMatch` enum is at **line 2982**, not
  `3398-3406`. The Scope section's instruction to edit it by hand is wrong in a
  more useful way: the file is **generated** (`npm run generate:adlj-schema`,
  `ts-json-schema-generator` over `src/model/adlj-source.ts`). Regenerating
  produced exactly two diff hunks — the new enum member and the doc comment added
  to `PrincipalMatch` — and nothing else.
- **`tests/policy-engine.test.ts` does not exist** and never has. The Testing
  section names it four times. The nearest precedent is
  `tests/context-member-principal.test.ts`, the file the `CONTEXT_MEMBER`
  principal shipped with, so the new unit coverage is `tests/self-principal.test.ts`
  modelled on it.
- The unit baseline in the Testing section (1,128, "after Phase 101") is three
  phases stale; the measured baseline on `adb8de8` is **1,213**. Integration
  baseline is **180**, not "163 + Phase 102's additions".

Everything else was measured true: `search` is still gated once, recordlessly, at
`object-store.ts:563`; the `read` path still supplies a record
(`:285-310`); `offline-dataset-service.ts:650` still reads
`record.meta.guid === context.userId || record.meta.createdBy === context.userId`;
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` is still at
`validate-model/policy.ts:109-124` with its comment intact; and
`policy.field.allow-does-not-grant-row.001` is still at
`conformance/runtime/context-policy.json:2540`.

## `tsc` named exactly one exhaustiveness site, not four

The Parallel Execution Plan predicted that widening `PrincipalMatch` would make
`tsc` enumerate "parser, printer, schema, validator". It named **one**:
`print-adl.ts(1700,74): error TS2366: Function lacks ending return statement`.
The parser assigns `principal.match` from string literals, the validator compares
it with `===`, and the schema is generated — none of them is a `switch`. The
technique still paid for itself; it just pays less than the plan assumed, and a
reader should not treat a clean `tsc` after a union widening as proof the union's
consumers were all found.

That single site was also the most dangerous one. Before the branch existed,
`printPrincipal` fell out of its `switch` returning `undefined` and printed
`RULE allowPersonReadSelf ALLOW READ ` — an **empty** principal, which reparses
as the default `everyone`. A missing printer branch on a principal is a silent
widening, not a crash.

## Red-first evidence

| Claim | Seen failing against unmodified code |
|---|---|
| `"self"` is not a `PrincipalMatch` | `tsc`: `Type '"self"' is not assignable to type 'PrincipalMatch'.` |
| `SELF` grants nothing at runtime | `tests/self-principal.test.ts`: **3 failed / 9 passed**, each `PolicyDeniedError: Policy denied read on object 'User'.` |
| `SELF` is not in the grammar | `tests/parser.test.ts`: **3 failed**, the first being `ParseError: Expected POLICY rule option FIELD, STATE, ACTION, CHANNELS, principal selector ROLE, GROUP_ROLE, USER, OWNER, EVERYONE, AUTHENTICATED, ANONYMOUS, CONTEXT_MEMBER, or end of line, but found 'SELF'. at 5:37` — verbatim what the document predicted |
| the printer cannot render it | `tests/compile-adlj.test.ts`: printed `ALLOW READ ` with an empty principal |
| the diagnostic does not exist | `tests/model-validation.test.ts`: **2 failed** |
| the row grant is not enforced over PostgreSQL | `tests/integration/self-principal-policy.test.ts`: **3 failed / 3 passed** |

## Mutation checks

| Mutation | Named tests that turned red |
|---|---|
| `case "self"` → `return false` | `lets a caller read their own record in full…`, `lets a field-scoped HIDDEN beat the SELF allow…`, `grants the update it names and nothing it does not`, the whole `self-principal.json` corpus, and 3 of the 6 PostgreSQL cases |
| `isSelf` compares `meta.createdBy` | the same three unit tests, plus `policy.self.does-not-match-the-records-creator.003` |
| `isSelf` → `return userId.length > 0` (constant allow) | `refuses another user's record`, `cannot widen search even when the SELF rule names every action`, `still lets a caller resolve another user's display name…`, `matches on the record's own guid, not on who created it`, `fails closed with no record on the request`, and 4 of the 6 PostgreSQL cases |
| the `SEARCH` diagnostic deleted | `refuses a SELF principal granted the object-level SEARCH action`, `refuses a SELF principal on SEARCH even when the same policy also grants READ`, and `policy.self.cannot-gate-the-object-level-search-action.011` |

All eleven runtime conformance cases were additionally shown to discriminate by
flipping each one's own expectation in a throwaway harness; the `validateModel`
case was shown sensitive to the diagnostic's code, its path *and* its severity
independently.

## The search-refusal test was vacuous, and the mutation is what found it

The document's acceptance criterion 3 — "the same rule grants no `search`" — was
first written as: declare `ALLOW READ SELF` and `ALLOW UPDATE SELF`, then assert
`runtime.search` is refused. That test **passed under the constant-allow
mutation**, because the model declares no `search` rule at all, so its refusal
holds for every principal and says nothing about `SELF`.

The discriminating shape is `ALLOW * SELF` — which *does* name `search`, is not
refused by the new diagnostic (which keys on `action === "search"` exactly, like
its `CONTEXT_MEMBER` sibling), and is still denied at the object-level gate —
paired with a positive control proving the same wildcard rule is live on a
record. That pair exists in all three layers now: `tests/self-principal.test.ts`,
cases `.012`/`.013` of the corpus, and the PostgreSQL test. Criterion 3 as
originally worded is satisfiable by a test that proves nothing.

## Positive/negative pairs

Every new assertion is paired. The four corners the standing rule names:

| Corner | Where |
|---|---|
| the caller **can** read the record that is them | `lets a caller read their own record in full, including ungranted fields`; `policy.self.reads-own-record-in-full.001`; PostgreSQL `gives a caller their own record in full` |
| a different authenticated user **cannot** | `refuses another user's record`; `.002`; PostgreSQL `still refuses another user's record, their email, and the directory` |
| the grant confers **no** enumeration | `cannot widen search even when the SELF rule names every action`; `.012` with `.013` as its control; PostgreSQL `cannot widen search…` |
| fields outside a field-scoped grant are **absent** from the result | `expect(label?.values).toEqual({ Name: "Bob Brand" })` (an equality, so `Email` absent is asserted, not inferred from "no exception"); `.010` uses `"Email": "$absent"`; `lets a field-scoped HIDDEN beat the SELF allow for that field only` |

Others: `ALLOW READ SELF` compiles clean **and** `ALLOW SEARCH SELF` names
`ADL_POLICY_SELF_SEARCH_UNREACHABLE` by identity and path; `SELF` parses **and**
an unrecognised option lists `SELF` in its refusal; `{"match":"self"}` compiles
**and** `{"match":"myself"}` is refused by the generated schema at
`principal/match`; `SELF` prints as `SELF` **and** never as `OWNER`; the
`FIELDS` list stops at `SELF` **and** a quoted `'Self'` is still a field name.

**Backfilled positive-only coverage in the code touched.** `isOwner` had no test
saying what it does *not* match. The new `the gap SELF closes` describe block is
that negative: with `ALLOW READ OWNER` declared on `User`, and
`expect(seeded.alice.meta.createdBy).toBe("system-admin")` stated inline, a
caller is still refused their own record — and the same caller gets exactly
`{ Name: … }` from the field-scoped path. It passes before and after this phase,
which is the point: it is the `SELF`-less control the document asked to keep.

**One case with no meaningful negative counterpart**, disclosed rather than
manufactured: the `.adl`/`.adlj`/printed-text round-trip equality
(`reparsed.model` deep-equals `compiled.model`). Its negative is the schema
refusal above; a "these two do not resolve identically" assertion would be
asserting a defect.

## Fingerprints, measured

| App | `modelVersion` | `modelFingerprint` |
|---|---|---|
| Giggle Band | `1.12.0` | `sha256-8249bac35b2fa5282fd764db729ed3ed2b98121cab95b21c0bee47eb8f9de11c` |
| Jointly Care | `1.7.0` | `sha256-171158c70c06bfa0f975dd8fb92ae91ab58124e3d14210db026fb250813b8bef` |

Read out of the real compiled models, not asserted from "no `.adlj` was edited",
and byte-identical to the tripwires in `tests/band-reference-app.test.ts` and
`tests/jointly-reference-app.test.ts`, which pass unchanged. Widening a union
changes no application's content, as the document predicted.

## Verification

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run format:check` | clean |
| `npx vitest run` | **65 files / 1,240 tests passed** (baseline 64 / 1,213; +1 file, +27) |
| `npm run test:integration` | **19 files / 186 tests passed** (baseline 18 / 180; +1 file, +6) |

`npm run verify:push`, `npm run test:visual` and `npm run build` were not run.
Nothing here touches browser rendering, shell chrome, a reference-app screen,
presentation output or CSS, and no reference app's model content changed.

## Deliberately not done

- **No reference app declares a `SELF` rule.** Honoured exactly. Both
  `UserPolicy` declarations are untouched, including Giggle Band's long comment,
  whose closing paragraph — *"'My own record in full' needs the same thing…"* —
  is now stale prose. Correcting it would be a `.adlj` edit and a fingerprint
  move, which this phase's non-goals forbid. Whichever phase first adds a `SELF`
  rule should rewrite that paragraph in the same commit.
- **No `ADL_POLICY_SELF_CREATE_UNREACHABLE`.** `ObjectStore.create` supplies a
  `patch` and no `record` (`object-store.ts:224-234`), so `ALLOW CREATE SELF` is
  dead for exactly the reason `ALLOW SEARCH SELF` is. The document names only the
  `SEARCH` refusal and scope discipline kept it there. The general behaviour is
  pinned instead by `policy.self.fails-closed-with-no-record.005`, a
  `policyDecision` against a recordless request. `OWNER` has the identical gap on
  both actions and has since it shipped. Nominated below.
- **No `contextMember.field: "id"`, no profile screen, no `isOwner` change, no
  new expression kind, no "wrong object" diagnostic.** All as the document's
  Non-goals section states.
- **The throwaway discrimination and compile-check harnesses were deleted**, per
  `AGENTS.md`. Their results are recorded above.

---

# Planning Handoff (written after execution)

**Next phase: Phase 106 — an authority-minted identity has no `User` object
record.** Not Phase 104, and this reverses the document's own recommendation on
repository-wide grounds.

Phase 102's handoff already put this gap above both 103 and 104 and declined to
act on it because it needed its own document; that document is being written now.
Executing 103 sharpened the case rather than weakening it. This phase and Phases
93 and 101 have now each spent themselves on the *policy* half of "why does this
screen say `user-c52bac75-…`" — 93 made a dead grant a compile error, 101 made
the label a permitted field read, 103 makes a person's own row reachable at all.
All three made the label **permitted**. None of them makes the label **exist**.
A registered person still has no `User` record for any of that permission to
resolve against, on every screen that names a person, in both reference apps.
Three consecutive phases attacking one visible defect from the side it is not on
is the same signal that justified 103 — and 103 removed the last policy-side
excuse for not fixing it directly.

Phase 104 (`MATRIX` text syntax) stays queued behind it, unchanged in merit:
printer completeness for a view of a format nobody hand-authors, real and the
least urgent thing on the list. Phase 105 (an invitee cannot accept a band
invitation) is a genuine user-facing dead end and a defensible alternative to
106; 106 wins on breadth, because it is wrong on every screen rather than in one
flow, and because Phase 105's scope-gate diagnosis is already recorded in
`learnings/implementation/context-grants-and-relationship-access.md` and will not
go stale. Phase 107 (per-test browser evidence capture) is process work that pays
off across every later phase and should be scheduled when it does not displace a
user-visible defect.

Candidates this execution surfaced, none taken:

- **A profile screen for Giggle Band**, the natural consumer of this phase, and
  now blocked on nothing but the view-binding question the document sets out.
  Worth taking **after** 106: a profile screen for a person with no `User` record
  would render a blank page, so 106 is its real precondition, not this phase.
- **`ADL_POLICY_SELF_CREATE_UNREACHABLE` and `ADL_POLICY_OWNER_SEARCH_UNREACHABLE`
  / `_CREATE_UNREACHABLE`.** Four dead shapes, one diagnostic pattern, one small
  phase: any record-matching principal (`self`, `owner`, `contextMember`) on any
  gate evaluated without a record (`search`, `create`). Doing them together is
  cheaper than four visits and forces the general rule to be stated once. The
  `OWNER` half needs an audit of existing content for rules it would newly refuse
  — the same audit Phase 93 did over 352 principals — which is most of the cost.
- **`ALLOW * <record-matching principal>` is partly dead and nothing says so.**
  Not a bug, and not obviously fixable: a wildcard rule is live on five actions
  and dead on two. A warning naming the dead half would be honest; an error would
  be wrong. Below the bar on its own, worth folding into the phase above.
- **A union widening is not exhaustiveness-checked across this codebase.** One
  `switch` fired; the parser, validator and merge paths did not. If more principals
  are coming, a `satisfies Record<PrincipalMatch, …>` table or an exhaustive
  `default: assertNever` in the parser would make the next one mechanical. Too
  small for a phase; fold into whichever phase adds the next principal.
