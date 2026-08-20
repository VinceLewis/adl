# Phase 101 — Closing the User-Directory Exposure in Both Reference Apps

Both reference apps granted `SEARCH` and `READ` on the whole `User` object to
any `AUTHENTICATED` caller, and `User.Email` is required in both. That was
defensible while registration was invite-only: every authenticated caller had
been vouched for by somebody already inside. Phase 99 removes that premise.
"Anyone who can reach the authority may sign up" plus "any authenticated caller
may read every `User` record" is an open directory of every user's name and
email address, and the repository owner asked for it closed before
self-registration ships.

## Objective

Narrow both apps' `UserPolicy` so an ordinary authenticated caller can resolve a
user's **display name and nothing else** — not their email, not their whole
record, and not the directory — while every lookup label that made the Phase 91
widening necessary still renders a real name.

Concretely: `UserPolicy` becomes a single field-scoped `ALLOW READ AUTHENTICATED
FIELDS <displayField>` rule in each app; the `SEARCH` grant is removed outright;
Jointly Care's `User.DISPLAY` moves off `Email`; and the two runtime paths that
turn a stored lookup value into a label stop issuing a whole-record read, which
a field-scoped rule can never satisfy.

## Evidence and Dependency

Re-verified against the worktree at `499d875` while executing.

**1. The exposure, as shipped.** `POLICY UserPolicy ON User` in
`src/reference/giggle-band/domain.adlj` and
`src/reference/jointly-care/domain.adlj` each carried
`allowAuthenticatedSearchUsers` (`ALLOW SEARCH AUTHENTICATED`) and
`allowAuthenticatedReadUsers` (`ALLOW READ AUTHENTICATED`), both with an empty
`fields` list — so both matched the whole record and every field on it.
`User.Email` is `required: true` in both apps. Jointly Care additionally
declared `DISPLAY Email`, and `CircleMemberRoster` projected `user.Email` onto
the circle overview, so the app rendered a per-circle email directory on a
screen the visual suite screenshots.

**2. Phase 91 put the widening there deliberately, and for a good reason.** The
rules it replaced named `ROLE BandMember` / `ROLE CircleMember`, which a
`User`-object policy check can never resolve
(`getPolicyRequestContextTargets`, `src/runtime/context-scope.ts`). No user
could be read at all, so every `LOOKUP User DISPLAY Name` label degraded to a
raw `user-…` id. Phase 93 turned that shape into a compile error
(`ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE`). Nothing here may reintroduce it.

**3. Phase 99 records this exposure as an accepted risk and hands it off.** Its
"The security surface" §6 states the exposure precisely and says the phase does
not close it, on the reasoning that the honest narrowing — "only people I share
a band with" — is not expressible. That reasoning is correct about
`CONTEXT_MEMBER` and about `OWNER`; it is **wrong** about a field-level grant,
which it dismisses with "there is no principal to un-mask it for". That framing
assumes a *mask* over an otherwise-readable record. A field-scoped `ALLOW` is
the opposite construction and needs no un-masking principal.

**4. Field-scoped rules already exist and are already enforced.**
`ResolvedPolicyRule.fields` is a `string[]`
(`src/model/resolved-model/policy.ts:37`), and `PolicyEngine.ruleMatches`
(`src/runtime/policy-engine.ts`) implements exactly the needed semantics: a rule
naming fields **cannot match a whole-record request**, and matches a field
request only for a field it names. The conformance corpus fixes this as spec:
`policy.field.allow-does-not-grant-row.001` and
`policy.field.allow-named-field.001` in `conformance/runtime/context-policy.json`.
**No language change is needed, and none was made.**

**5. The interaction that decides the phase.** `applyReadPolicy`
(`src/runtime/policy-engine.ts`) evaluates the **row** first and returns
`values: {}` when the row is refused. Both label paths went through it:
`ReadModelService.resolveLookupDisplayLabel` directly, and
`resolveLookupTargetRecord` (`src/ui/components/lookup-resolution.ts`) via
`runtime.read`, which calls `requireAllowed` for the whole record. Under a
field-scoped `UserPolicy` both refuse, and **both degrade silently to the raw
stored id** — the exact `user-c52bac75-…` defect Phase 91 fixed, reachable with
a clean `tsc` and a green unit suite. This is the real work of the phase.

**6. What actually needed the `SEARCH` grant.** Two read models used `User` as a
source (`CurrentUserAvailability` in Giggle Band, `CircleMemberRoster` in
Jointly Care) and both were secondary, lookup-joined sources, which
`resolveJoinedSource` resolves by id — no `search`, but a **row-level read**.
`adl-field-renderer` populates a lookup `<select>`'s options with
`runtime.search`. The seeding helpers (`seedBandReferenceRuntimeIfEmpty`,
`seedJointlyReferenceRuntimeIfEmpty`) search `User` by `Email` under a
`SystemAdmin` context, which `UserSystemAdminPolicy` still allows.

## Decision

**Grant the display field, and only the display field.**

```jsonc
// UserPolicy, Giggle Band            // UserPolicy, Jointly Care
{ "name": "allowAuthenticatedReadUserName",        // ...ReadUserDisplayName
  "effect": "allow",
  "principal": { "match": "authenticated" },
  "action": "read",
  "fields": ["Name"] }                             // ["DisplayName"]
```

Four consequences, each deliberate.

**`SEARCH` is removed, not narrowed.** A field-scoped `SEARCH` rule would be
dead on arrival — a `search` request carries no field, so a rule naming fields
can never match it — and the compiler has no diagnostic for that shape, so
writing one would have been a silent no-op dressed as a control. The real
question is whether an ordinary caller should be able to enumerate the directory
at all, and for a user directory behind self-service registration the answer is
no: enumeration is the primitive that turns a per-record grant into a directory.
Removing it is also what makes the row-level refusal complete —
`ObjectStore.search` filters results through the row-level read decision, so a
caller with a field-scoped grant would have received zero rows anyway.

**Jointly Care's `DISPLAY` moves from `Email` to `DisplayName`.** While `Email`
was the display field, "the display field only" would have granted precisely the
thing the policy exists to withhold; the narrowing would have been vacuous for
that app. All eight `LOOKUP User DISPLAY Email` declarations follow. This is
also closer to the PRD, which describes `display_name` as the label and the
email only as its fallback.

**Neither read model sources `User` any more.** `CircleMemberRoster` and
`CurrentUserAvailability` now project the membership/availability row's own
`LOOKUP User` field, inheriting the lookup the way Giggle Band's
`BandMemberAvailability.Member` already did (Phase 91). The label arrives in the
row's `display` channel through the same field-scoped read as every other label,
and `CircleMemberRoster` stops projecting `Email` onto the circle overview.

**`UserSystemAdminPolicy` is untouched** in both apps: `ALLOW * SystemAdmin`
with no `fields`, so an admin still reads the whole record, still searches, and
the seeding helpers still work.

### The runtime change the decision forces

A lookup label is a **field** read, so it is now issued as one:

- `PolicyEngine.applyDisplayFieldReadPolicy(object, record, fields, context)` —
  the field-only sibling of `applyReadPolicy`, deliberately not consulting the
  row gate. Nothing is widened by the omission: an explicit row-level `DENY`,
  `HIDDEN` or `MASK` rule carries no `fields`, so it matches a field request too
  and still wins. Only the *default* deny a row request would have hit is
  bypassed, which is exactly what a field-scoped allow is for.
- `ObjectStore.readFieldsForDisplay` / `ApplicationRuntime.readFieldsForDisplay`
  — the same thing for the browser: active record, object scope, then the named
  fields' own read decisions. No audit event (a label is not a disclosure of the
  record, and the read-model resolver has never written one), and every refusal
  returns `null` because the caller keeps the id the surface falls back to.
- `resolveLookupDisplayLabel` and `resolveLookupTargetRecord` call these instead
  of `applyReadPolicy` / `runtime.read`.
- `adl-field-renderer` resolves the *selected* option's label through the same
  helper. Without `SEARCH`, the candidate list is empty, and the `<select>`
  previously fell back to rendering the stored value as its own label — a raw
  `user-…` id in a form, the same defect by a narrower door.

### Rejected alternatives

**Row grant plus a field-level `DENY`/`HIDDEN` on `Email`.** The natural first
reach, and wrong twice over. A `deny` or presentation rule wins over *every*
matching allow across every policy on the object, and `SystemAdmin` is also
`AUTHENTICATED`, so the restriction would strip the admin's access too, with no
"authenticated but not admin" principal to scope it away from. And it fails the
objective anyway: the caller still pulls the whole record, minus one field.

**Keep `SEARCH` and make `ObjectStore.search` shape rows by field policy.** This
would have kept the lookup `<select>` populated without touching the field
renderer, but it changes search semantics platform-wide — every object with a
field-scoped read rule would start appearing in search results — for the sake of
preserving directory enumeration, which is the thing the phase is closing.

**A `CONTEXT_MEMBER` principal keyed on the `User` record's own id.** The honest
"only people I share a band with", and still not expressible:
`recordBelongsToContextMember` reads `record.values[field]`, and a `User` record
has no field holding its own id. Phase 91 proposed letting `contextMember.field`
accept `id`; that remains the extension to make, and it is not made here.

**"A user may read their own record in full."** Also not expressible, and worth
stating plainly rather than assuming. `OWNER` matches
`record.meta.createdBy`, `values.CreatedBy`, `values.OwnerId` or
`values.ownerId` (`isOwner`, `src/runtime/policy-engine.ts`); a `User` record
carries none of these about itself, and its `meta.createdBy` is the seeding
system identity. A policy condition cannot help either: `ResolvedPolicyConditionOperand`
is `field` / `runtime.userId` / `literal`, and `evaluateField` reads
`record.values` only — there is no operand for the record's own id. Neither app
has a profile screen in its nav, so nothing regressed; if one is ever added it
needs the same `contextMember.field: "id"` extension, or a self-referencing
field on `User`.

**Making Jointly Care's `DisplayName` required.** Tempting, since an empty
display name now leaves a raw id where a name belongs. It is a product decision
about the PRD's own default, not a security one, and it is left alone. The
fail-closed direction is right: an opaque id is not an email.

## Scope

- `src/reference/giggle-band/domain.adlj`: `UserPolicy` → one field-scoped read
  rule; `CurrentUserAvailability` drops its `User` source; `modelVersion`
  `1.9.0` → `1.10.0` with an empty-object migration hop.
- `src/reference/jointly-care/domain.adlj`: `UserPolicy` → one field-scoped read
  rule; `User.displayField` and all eight `LOOKUP User` display fields
  `Email` → `DisplayName`; `CircleMemberRoster` drops its `User` source and its
  `MemberEmail` field for a `Member` projection; `modelVersion` `1.4.0` →
  `1.5.0` with an empty-object migration hop.
- `src/reference/jointly-care/ui.adlj`: the circle-overview roster row renders
  `Member`, not `MemberEmail`.
- `src/runtime/policy-engine.ts`, `object-store.ts`, `application-runtime.ts`,
  `read-model-service.ts`: the field-scoped display read.
- `src/ui/components/lookup-resolution.ts`, `adl-field-renderer.ts`: the browser
  label paths.
- Tests: unit, real-PostgreSQL integration, and Playwright.
- `docs/spec/runtime-semantics.md`: the projected-lookup-display bullet now says
  a label read is a field read.
- `docs/phases/phase-99-self-service-registration.md` §6 and
  `learnings/implementation/policy-engine.md`.

## Non-goals

- No language or grammar change. `fields` on a policy rule already exists,
  already resolves, and is already enforced.
- No new policy principal, and no `contextMember.field: "id"` extension.
- No change to the generic browser demo — its `modelVersion` must not move.
- No change to the invitation flow. `BandInvitation.InviteeEmail` and
  `CircleInvite.InviteeEmail` are fields on the *invitation*, addressed to a
  person the inviter already knows the address of, governed by their own
  policies. They are not reads of the `User` directory and are untouched.
- No `required` change on Jointly Care's `DisplayName`.
- No profile screen, and no attempt to give a caller their own full record.

## Constraints

- A field-level allow must not grant row read. `policy.field.allow-does-not-grant-row.001`
  is a conformance case; it stays green.
- An explicit row-level `DENY`/`HIDDEN`/`MASK` must still suppress a label.
- `SystemAdmin` keeps whole-record read, search, and every field.
- Every lookup label that resolved before must still resolve. A changed label in
  a screenshot is a regression, not a snapshot to bless.
- Both apps' `modelVersion` must move with the fingerprint, each with a
  migration hop and a real-browser persisted-upgrade test.

## Acceptance Criteria

1. In both apps, an authenticated non-member is refused `read` of another user's
   whole record (`PolicyDeniedError`), refused `search` on `User`, and receives
   only the display field from the field-scoped read path.
2. In both apps, a `SystemAdmin` still reads `Email` and still searches.
3. Lookup labels still resolve to real names: on Giggle Band's read-model-backed
   availability board and object-backed member list, and on Jointly Care's
   read-model-backed circle roster — asserted in the real browser, containing a
   name and containing neither `user-` nor `@example.com`.
4. A field-scoped grant resolves a label while still refusing the row; an
   explicit row-level `DENY` still suppresses the label.
5. `npx tsc --noEmit`, `prettier --check`, unit, integration and Playwright
   suites all clean, with no test weakened.
6. The generic browser demo's `modelVersion` and fingerprint are unchanged.

## Testing

- **Unit** (`npx vitest run`): baseline 61 files / 1,121 tests.
  - `tests/read-model-lookup-display.test.ts`: a field-scoped grant resolves the
    label but still refuses the row, the ungranted field and the directory; an
    explicit row-level `DENY` still suppresses it.
  - `tests/band-reference-app.test.ts`, `tests/jointly-reference-app.test.ts`:
    the three refusals, the `SystemAdmin` retention, the roster's `display`
    labels, and a rendered `BandMemberList` containing a name and no `user-` id.
  - `tests/ui-lookup-target-field.test.ts`: a lookup `<select>` labels its
    selected option by name when the target refuses `SEARCH`, instead of
    rendering the stored id as its own label.
  - Model-version and fingerprint tripwires updated from the failure diff.
- **Integration** (`--config vitest.integration.config.ts`, real PostgreSQL):
  baseline 159. `tests/integration/user-directory-policy.test.ts` drives both
  apps' policies and both read models over `PostgresObjectStorageBackend`,
  because policy enforcement is an authority-side claim and `AGENTS.md` does not
  accept a fake for one.
- **Playwright** (`npx playwright test`): baseline 54. One new test per app
  asserting a real name, no `user-` and no `@example.com` on the screen.
- **Mutation checks.** Reverting `resolveLookupTargetRecord` to `runtime.read`,
  reverting `resolveLookupDisplayLabel` to `applyReadPolicy`, and disabling the
  field renderer's selected-label resolution each turn specific tests red. A
  guard no test can distinguish from its absence is not a guard.

## Parallel Execution Plan

Executed serially; the fan-out is not worth its coordination here.

1. **Serial spine.** `applyDisplayFieldReadPolicy`, `readFieldsForDisplay` and
   their `ApplicationRuntime` surface, with no consumers.
2. **Then, in principle parallel** (three streams over disjoint files, run
   serially in practice because each is minutes of work): the two `.adlj`
   policy/read-model edits; the two label consumers plus the field renderer;
   the test and doc updates.
3. **Barriers.** `npx vitest run` after (2). `--config vitest.integration.config.ts`
   once, at the end. `npx playwright test` once, at the end, with the changed
   screenshot inspected by eye.

Kept serial regardless: both `.adlj` files (one fingerprint each, and both feed
the same two test files), and the phase document.

## Tasks

1. Add `applyDisplayFieldReadPolicy` to `PolicyEngine`.
2. Add `readFieldsForDisplay` to `ObjectStore` and `ApplicationRuntime`.
3. Point `resolveLookupDisplayLabel` and `resolveLookupTargetRecord` at them.
4. Resolve the selected option's label in `adl-field-renderer`, patching the
   option's text in place rather than re-rendering a possibly-focused control.
5. Narrow both `UserPolicy` declarations; move Jointly Care's `DISPLAY`; drop
   both `User` read-model sources; bump both `modelVersion`s with hops.
6. Update the Jointly Care circle-overview row fragment.
7. Unit, integration and Playwright tests, including the mutation checks.
8. Update the spec bullet, Phase 99 §6, and `learnings/`.

## Planning Handoff

The highest-value remaining gap repository-wide is **Phase 99 itself**:
self-service registration is specified in full, is the work this phase was
commissioned to unblock, and is now unblocked. Its §6 no longer records an open
exposure. Nothing else in the repository is both specified and blocking a
shipped promise the way it is.

The nearest competing candidates, and why they wait:

- **The `.adl` printer completion** (Phase 98's original handoff, executing in
  parallel with this phase). Real, but it is a developer-facing view of a source
  format nobody hand-authors any more.
- **`contextMember.field: "id"`**, which would make "only people I share a
  context with" expressible for the first time. Phase 91 proposed it, Phase 99
  nominated it, and this phase declined it in favour of a narrower grant that
  needs no platform change. It is the right *next* platform extension, not the
  right next phase: nothing currently ships worse for its absence, because the
  display-name grant covers what both reference apps actually surface.
- **A profile screen** for either app, which would need the above.

## Execution Note

### The narrowing was expressible; Phase 99's reasoning was half right

Phase 99 §6 concluded that the exposure could not be closed in scope, from two
true premises — `CONTEXT_MEMBER` cannot key on a `User` record's own id, and a
`ROLE` on `User` is the dead-rule trap Phase 93 refuses — and one false one:
"A field-level mask on `Email` has the same problem: there is no principal to
un-mask it for." That is true of a *mask*, which is a restriction over an
otherwise-readable record. It is not true of a field-scoped `ALLOW` over a
default-deny object, which needs no un-masking principal because nothing was
granted in the first place. The construction was available the whole time, with
two conformance cases already pinning its semantics.

### Jointly Care's display field was the load-bearing detail

"Grant the display field only" reads like a complete answer until you notice
that Jointly Care's display field *was* `Email`, and that `CircleMemberRoster`
projected `user.Email` onto a screenshotted screen. Narrowing the policy alone
would have changed nothing an attacker could not still reach, and would have
read as a fix in the diff. The display field had to move first, and the roster
had to stop sourcing `User` at all.

### The silent-degradation trap, confirmed by mutation

Both label paths were whole-record reads. Restoring either one turns tests red
in a way that names the defect:

- `resolveLookupTargetRecord` → `runtime.read`: two tests fail, including the
  rendered `BandMemberList`, which is what a person would actually have seen.
- `resolveLookupDisplayLabel` → `applyReadPolicy`: three fail, across both apps
  and the synthetic model.
- Disabling `queueSelectedLookupLabel`: the lookup `<select>` test fails with
  `expected 'person-05c2bf8e-…' to be 'Casey Morgan'` — the same defect, in a
  form field rather than a list cell.

Without those assertions the phase would have type-checked, passed 1,121 tests,
and shipped both apps rendering `user-c52bac75-…` wherever a name belongs.

### `SEARCH` was decided separately, and differently

`READ` was narrowed; `SEARCH` was removed. A field-scoped `SEARCH` rule is dead
on arrival (a `search` request carries no field), and no diagnostic catches that
shape, so the only real options were "whole-object search" or "none". For a user
directory behind self-service registration, none. Nothing legitimate needed it
once the two read models stopped sourcing `User`; the lookup `<select>` lost its
candidate list, which is why the field renderer now resolves the selected
option's label directly.

### The circle overview changed, deliberately

`jointly-care-*-circle-overview.png` now reads `Sam Rivera - CircleMember`
where it read `sam@example.com - CircleMember`. Inspected by eye on both
viewports. That is the one screenshot this phase intends to change, and it is
both the security fix and the better label.

### Results

- `npx tsc --noEmit` clean; `prettier --check` clean.
- `npx vitest run`: 61 files / **1,128** tests (baseline 1,121; +7).
- `npx vitest run --config vitest.integration.config.ts`: **163** (baseline
  159; +4), against real PostgreSQL via Docker.
- `npx playwright test`: **58** (baseline 54; +4 — two tests × two projects).
- Model versions: Giggle Band `1.9.0` → `1.10.0`
  (`sha256-bcab87d0…`), Jointly Care `1.4.0` → `1.5.0` (`sha256-73c3718a…`).
  The generic browser demo did not move, as intended — it declares no `User`
  policy of this shape and nothing in its model changed.

### Not done, and why

- `npm run verify:push` was not run: the integrator runs it once across
  branches. Its constituent parts (`tsc`, `format:check`, `vitest`,
  `playwright`) were each run here; `npm run build` was not.
- No conformance case was added. The two that pin field-scoped rule semantics
  already exist and stay green; what this phase changed is which runtime call a
  label makes, which the runtime suites cover directly.
