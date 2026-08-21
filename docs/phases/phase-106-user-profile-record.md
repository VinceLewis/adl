# Phase 106 — A Registered Person Has a `User` Record, So Their Name Renders

Open Giggle Band's member list with one person who obtained their identity
through the product, and it reads:

```
Casey Morgan                             BandAdmin    2026-07-01
user-11111111-2222-4333-8444-555555555555  BandMember  2026-08-01
```

That is a verbatim capture of two `<tr>` elements from a real `<adl-app>`
render, not a description. Every person the authority has ever minted an
identity for — self-registered since Phase 99, invited since long before it —
appears that way, to themselves and to everybody else, wherever a member name
belongs. Phase 99's execution note found it, could not fix it inside an already
large phase, and nominated it as the next phase. This is that phase.

> **Phase numbers are no longer execution order in this repository.** The owner
> reprioritised mid-flight: Phases 100 and 101 were executed before Phase 99.
> This document executes after Phase 99, after the ordered run 102 → 103 → 104,
> and after Phase 105.

## Objective

Every identity this product mints gets a `User` application record whose id
**is** that identity, so `LOOKUP User DISPLAY Name` resolves to a name instead
of degrading to a raw id — and it does so without reopening the user directory
Phase 101 closed.

Concretely: a `COMMAND`'s `create` step can name the id it mints under
(`STEP createProfile CREATE User ID RUNTIME.userId`); both reference apps declare
a `RegisterProfile` command using it; the browser's account-creation surface
collects the name and email that command needs, at the one moment a person is
already filling in a form to exist; and identities minted before this phase get
a documented operator backfill.

## Evidence and Dependency

Phase 99's execution note is the origin of this analysis and it was written by
an agent that stopped rather than implementing, so **every claim in it was
re-measured here**, not carried forward. One of its four obstacles is partly
**false** (Evidence 8) and two new constraints it did not know about were found
(Evidence 10 and 11).

Everything below was measured against the working tree at `b14674b`, with
throwaway vitest files run under `happy-dom` — the real reference-app models,
the real `ApplicationRuntime`, and for the browser claims a real `<adl-app>`
element mounted into a real document. Claims that could not be measured are
marked **inferred**. The throwaway files were deleted; the harness shape is
described under Testing.

### 1. The defect, reproduced in a real browser render

Seeded Giggle Band, plus one `BandMember` row whose `User` is
`user-11111111-2222-4333-8444-555555555555` — the shape `provisionIdentity`
mints — with no `User` record behind it. Mounted `<adl-app>` as the band's
admin and read the member list's `<tbody>` rows:

```
["Casey MorganBandAdmin2026-07-01",
 "user-11111111-2222-4333-8444-555555555555BandMember2026-08-01"]
```

`contains raw newcomer id: true`. `contains Casey Morgan: true` — so the
renderer is working, the policy is working, and the record simply is not there.

### 2. It degrades silently, in the codebase's usual way

`BandMember.User` is `{ targetObject: "User", displayField: "Name" }` with no
`targetField`, so the stored value is the target record's own id. Measured, for
the newcomer's id:

```
resolveLookupTargetRecord(runtime, userField, id, ctx)  → null
runtime.readFieldsForDisplay("User", id, ["Name"], ctx) → null
```

and for a seeded user, `{ Name: "Casey Morgan" }`. Every caller falls back to
the raw stored value. Nothing throws, nothing logs, and every test stays green
— which is why this survived from before Phase 91 to now.

### 3. The fix is exactly "the record exists"

Same measurement, with a `User` record created under that id first:

```
["Casey MorganBandAdmin2026-07-01", "New ComerBandMember2026-08-01"]
```

`still contains raw id: false`. There is nothing else wrong: not the lookup, not
the policy, not the renderer.

### 4. Nothing creates one, on any path

- **`src/server` has exactly two `.create(` call sites.**
  `access-lifecycle.ts:627` writes the membership record a claimed invite
  grants; `authority-service.ts:294` replays a client's create intent. Neither
  is a `User` record.
- **`claimInvite`** writes `grant.membershipObjectName` and nothing else, on
  both the in-memory and the PostgreSQL store.
- **`scripts/dev/seed-local-admin.mjs`** calls `provisionIdentity`, then creates
  the context object (`Band`) and the membership (`BandMember`). No `User`.
- **The registration ceremony collects nothing about the person.**
  `webauthn-identity.ts:264` sets `userName = "New member"`, or the raw
  `session.userId`, or the raw `invite.recipientUserId`, and passes it as both
  `userName` and `userDisplayName`. `PasskeyRegistrationResult` (`:182-189`) is
  `userId`, `credentialId`, an optional `session` and an optional `invite`
  discriminator. There is no profile data anywhere in the ceremony, in either
  direction.
- **The browser's account-creation surface is one button.**
  `adl-session-panel.ts:460-474` renders a heading, an explainer and
  `Create an account`. No fields.

So the authority has nothing to put in a `User` record even if it were the right
component to write one.

### 5. Obstacle 1 — re-verified, and narrower than stated

Phase 99's note says the record's id must equal the authority `userId`, that no
command construct can express that, and that only
`ObjectStoreCreateOptions.recordId` — "a replay-path affordance" — can name one.
All three hold. But the note under-states how ready the rest of the stack is:

- `ResolvedCommandCreateStep` (`src/model/resolved-model/command.ts:49-74`) has
  `name`, `action`, `object`, `authority`, `values`, `preconditions`,
  `forEach?`, `establishesContext?`. No id.
- `ObjectStore.planCreateForTransaction` already takes `options.recordId`,
  shape-checks it (`RecordIdInvalidError`) and refuses a taken one
  (`RecordIdUnavailableError`, checked *after* authorisation so an unauthorised
  caller is not told whether an id exists).
- Measured: `runtime.create("User", …, ctx, { recordId: NEWCOMER })` produces a
  record whose `meta.guid` is exactly `NEWCOMER`.
- **The client already names every record it creates.**
  `AuthorityService.apply` replays a create as
  `runtime.create(intent.objectName, intent.values, context, { recordId: intent.recordId })`,
  with a comment saying the client names the record and a collision becomes a
  visible rejection. A command intent additionally carries a
  `recordIds` manifest so replay mints nothing server-side.

So the missing piece is purely the **model surface**. The runtime, the intent
format and the replay path are already built for a client-named id.

### 6. Obstacle 2 — confirmed

Measured: a second `runtime.create("User", …, { recordId: NEWCOMER })` throws

```
RecordIdUnavailableError: A record already exists for object 'User' under the supplied id.
```

And a `read` step cannot be used to branch on absence:
`ResolvedCommandReadStep`'s own doc comment states that *"a denied read or a
record that does not exist fails the whole command before any write is
planned"*. That is the opposite of the branch an idempotent create needs. There
is no conditional or idempotent write in the language.

### 7. Obstacle 3 — confirmed, and there is no free placeholder

Giggle Band's `User`: `Name` **required**, `Email` **required** with an `email`
validator, `ProfilePicture` optional. Jointly Care's: `Email` **required** with
an `email` validator, `DisplayName` optional, `Timezone` defaulted.

Measured, against Giggle Band:

```
create("User", { Name: "No Email" }, …)                      → RuntimeValidationError
create("User", { Name: "…", Email: "user-1111…@invalid" }, …) → RuntimeValidationError
```

So a synthetic address derived from the identity id does not pass either. The
information has to come from a person.

### 8. Obstacle 3's *collision* cost is FALSE — measured

Phase 99's note gives as part of the obstacle that `Email` "is the object's
`businessKey`", which reads as "duplicates would collide". Measured:

```
create("User", { Name: "Dup", Email: "casey@example.com" }, …)  → OK (no error)
```

`businessKey` is validated only to *name an existing field*
(`src/compiler/validate-model/object-field.ts:122-128`) and is otherwise used
solely as a display-label fallback (`context-service.ts:385`,
`edit-surface-runtime.ts:1396`). It enforces no uniqueness at runtime. The Email
obstacle is a **validation** obstacle and not a collision one, which makes it
smaller than recorded — and it exposes a separate, unrelated gap named in the
Planning Handoff.

### 9. Obstacle 4 — confirmed

`LOOKUP … TARGET_FIELD` resolution is a search however it is spelled:
`findLookupTargetByField` → `searchAuthorisedSourceRecords` →
`requireAllowed({ action: "search" })`. `UserPolicy` after Phase 101 is a single
`ALLOW READ AUTHENTICATED FIELDS Name` with no `search` rule at all. Keying the
lookup on a natural key is dead, exactly as recorded.

### 10. NEW — a record-matching principal cannot gate a `create`

`planCreateForTransaction` builds the policy request as
`{ objectName, action: "create", patch: preparedValues, currentState? }`. There
is **no** `record`. So `OWNER`, `CONTEXT_MEMBER` and Phase 103's `SELF` can
never match a create; there is no record to match against.

Measured: an authenticated newcomer creating their own profile —

```
create("User", { Name: "New Comer", Email: "n@example.com" }, newcomerCtx, { recordId: ownId })
  → PolicyDeniedError: Policy denied create on object 'User'.
```

`UserPolicy` grants no `create`, and no narrower `create` grant is expressible.
The two options are an unconditional `ALLOW CREATE AUTHENTICATED` on `User` —
which lets any signed-in caller mint arbitrary `User` records — or a step
declared `AUTHORITY command`, which bypasses **policy only** and never
validation, object scope, sync policy or constraints. That is the same
construction `CreateBand.createFounderMembership` and
`AcceptBandInvitation.createMembership` already use, and it is what this phase
uses. This constraint was not in Phase 99's note.

### 11. NEW — Phase 103's `SELF` changes none of the four obstacles, and Phase 103's own profile-screen recommendation does not work

Taken one at a time:

| Obstacle | Does `SELF` change it? |
|---|---|
| 1 — the record's id must equal the `userId` | **No.** `SELF` *presupposes* the invariant (`record.meta.guid === context.userId`); it does not establish it. If anything this phase is what makes `SELF` reachable on an authority-minted identity at all. |
| 2 — a second create is a hard failure | **No.** `SELF` is a read/update grant; it says nothing about creation, and Evidence 10 shows it structurally cannot gate one. |
| 3 — `Email` is required and never collected | **No.** `ALLOW UPDATE SELF` would let a person *edit* a profile that exists; it cannot bring one into existence with the required fields already populated. |
| 4 — `TARGET_FIELD` needs a `SEARCH` grant | **No.** `SELF` grants a row and explicitly not a search — Phase 103 ships `ADL_POLICY_SELF_SEARCH_UNREACHABLE` to make `ALLOW SEARCH SELF` a compile error. |

But `SELF` is not irrelevant, and the relationship runs the other way from what
Phase 103 assumed. Phase 103's *"Recommendation on a profile screen"* says the
cheapest honest route to a screen showing the caller their own record is
*"a `currentUser`-scoped read model over `User` plus an ordinary composite
view"*. **Measured, that route does not work**, for two independent reasons:

```
READ_MODEL MyProfile  CONTEXT NONE  SOURCE profile OBJECT User SCOPE currentUser
```

compiles clean (`diagnostics: []`) and then:

| policy in force | result for the caller's own record |
|---|---|
| `UserPolicy` as Phase 101 left it | `PolicyDeniedError: Policy denied search on object 'User'.` |
| plus `ALLOW SEARCH AUTHENTICATED` | `rows: []` — the field-scoped rule cannot satisfy the read-model row gate |
| plus a **whole-record** read grant as well | `[{ values: { Name: "Casey Morgan" } }]` |

The first row is the search gate Phase 101 deliberately closed;
`getCurrentUserSourceRecordId`'s read-by-id shortcut is only reached from
`resolveJoinedSource`, so a read model's **primary** source always goes through
`searchAuthorisedSourceRecords`. The second row is Phase 101's field-scoped
semantics: `canReadSourceRecord` issues a whole-record read, which a rule naming
`FIELDS` cannot match by design. The third row is what `SELF` would supply — and
`SELF` supplies only that half.

So a profile *screen* needs `SELF` **and** a route around the search gate, and
that is a separate phase from this one. This phase deliberately builds no
profile screen (see Non-goals), and the correction above belongs in Phase 103's
record.

**Dependency, stated plainly: this phase does not depend on Phase 103. Phase
103's recommended follow-up depends on this one.** There is nothing for a
`SELF` grant to match on an authority-minted identity until a `User` record
exists under that identity's id.

### 12. NEW — no shell visibility predicate expresses "this person has no profile"

`ShellVisibilityKind` (`src/model/resolved-model/shell.ts:40-47`) is exactly
`always`, `contextAvailable`, `contextUnavailable`, `contextSelected`, `online`,
`offline`. So a Phase 99 `COMMAND_ACTION` prompting somebody to create a profile
cannot be self-removing the way `createFirstBand` is — it would keep offering
itself after it had been used. This is what pushes the profile write to
registration time rather than to a shell control, and it is why the repair path
for pre-existing identities is an operator route rather than a screen.

### 13. Inferred, not measured

- **The browser can already tell a brand-new identity from an added
  authenticator.** `finishRegistration` computes
  `sessionGated = challenge.userId !== undefined && challenge.inviteRecipientUserId === undefined`
  and does not return it; the four-row table in its own comment implies
  "a session was issued **and** `invite !== 'identityRecovered'`" ⇒ the identity
  is new. Derived from the source comment, **not measured**, and indirect enough
  that this phase should add an explicit discriminator rather than rely on it.
- **The command-intent `recordIds` manifest carries a step's named id.** The
  device plans the write before reporting ids, so the manifest should carry
  whatever `ID` resolved to. Not measured. Acceptance Pair C− exists to measure
  it, because a mismatch would silently mint a different id server-side and the
  defect would look exactly like the one this phase is fixing.
- **Every measurement above runs against `ApplicationRuntime` over the in-memory
  backend.** The authority behaviour is proven in Testing, against real
  PostgreSQL, not inferred.

**Dependency:** Phases 99 (the identity paths and the `COMMAND_ACTION`
construct), 101 (the field-scoped `UserPolicy` this must not undo), and 105
(which is what gets a newly-registered person onto a member list in the first
place). Not 103 — see Evidence 11.

## Decision

The profile record is minted **once, at the moment the identity is minted**, by
the application's own model, through a new create-step record-identity clause;
and the name and email come from the surface the person is already using to
bring themselves into existence.

### Part 1 — `ResolvedCommandCreateStep` gains an optional `recordId` expression

```adl
COMMAND RegisterProfile
  INPUT Name TEXT REQUIRED
  INPUT Email TEXT REQUIRED
  STEP createProfile CREATE User ID RUNTIME.userId AUTHORITY command
    VALUE Name FROM INPUT Name
    VALUE Email FROM INPUT Email
END.COMMAND
```

`recordId?: ResolvedCommandValueExpression` — the same expression union
`values` already uses — resolved at plan time and threaded into
`planCreateForTransaction`'s existing `options.recordId`. Grammar, `.adlj`
mapping, printer branch, `adlj-schema.json` entry, validation, conformance and
specification, to the standard Phase 100 set for surface syntax.

**Why this and not a bespoke `RUNTIME.userId` keyword.** Reusing
`ResolvedCommandValueExpression` costs nothing and makes the clause say what it
is: the record's id comes from the same expression vocabulary every other value
in the step comes from. It also makes the `input`-sourced case sayable, which is
what an offline-created record with a client-minted id already needs.

**A named diagnostic for an expression that cannot resolve at plan time.**
`ADL_COMMAND_CREATE_ID_UNRESOLVABLE` for an `ID` naming a later step's
`stepField`/`stepMeta`, or `itemIndex`, or `item` outside an iterating step. An
`ID` that resolves to `null` at runtime would silently fall back to a minted id
— a create that looks like it named its record and did not — which is precisely
the class Phase 93 turned into a compile error and Phase 103 mirrored again.
The diagnostic ships **with** the clause, not after somebody trips over it.

**The step is `AUTHORITY command`.** Evidence 10: no policy grant can express
"create the record that is me", because a create request carries no record.
`AUTHORITY command` bypasses policy only — validation, object scope, sync policy
and constraints all still apply, which is what keeps Evidence 7's required
`Email` load-bearing. And the construction is safe by shape rather than by
careful authoring: the `ID` expression is `RUNTIME.userId`, so the command can
only ever mint a record under the *caller's own* identity, whoever calls it.

### Part 2 — idempotency is answered by sequencing, not by a new write mode

`RegisterProfile` runs **once per identity**, at registration, from the one
moment the application knows the identity is new. A second run is a hard,
honest `RecordIdUnavailableError`, and the surface never offers it twice.

**Rejected: an `IF_ABSENT` / upsert create.** It is the obvious answer and it is
a phase of its own. An idempotent write needs a defined interaction with the
authority's replay (is a no-op an accepted operation or a rejected one?), with
`baseRevision` conflict checking, with the outcome record a caller polls, and
with the sync queue's exactly-once story. Buying all of that here, to solve a
problem the sequencing removes, would put a second subject inside this phase —
the move Phase 100 explicitly declined to make.

**Identities minted before this phase** get a documented operator backfill in
`docs/operations/authority-production-runbook.md` and a matching
`scripts/dev/seed-local-admin.mjs` step: for each identity with no `User`
record, create one. That is a one-time migration of an existing deployment, it
belongs in the runbook beside the other operator procedures, and it is honest
about being manual. It is **not** a self-healing screen, because Evidence 12
says the shell cannot express the condition that would hide it again.

### Part 3 — the account-creation surface collects a name and an email

`adl-session-panel.ts`'s `Create an account` route gains two fields, and the
`Join with an invitation` route gains them too — both ceremonies mint a brand
new identity. On a successful `register/finish` that issued a session and did
not report `invite: "identityRecovered"`, the browser runs `RegisterProfile`
with what it collected.

**The authority gains an explicit discriminator** rather than the browser
inferring one from the shape of the response (Evidence 13):
`PasskeyRegistrationResult.identity: "created" | "existing"`, set from the
`sessionGated`/`recovering` decision the service already computes. One field, no
new logic, and it removes a piece of reasoning from the client that the server
already knows the answer to.

**What the fields are named is the application's business, and the panel's is
not.** The session panel is platform chrome shared by every application; it
cannot know that Giggle Band wants `Name` and Jointly Care wants
`DisplayName`. So the panel asks for a display name and an email as *ceremony*
inputs, and each application's `RegisterProfile` maps them onto its own fields
through ordinary `INPUT`s. If executing this phase finds that mapping needs a
model declaration — "which command do I run after registration?" — **stop and
report it** rather than hard-coding a command name in the panel.

### Rejected alternatives

**The authority mints the record.** It has nothing to fill it with (Evidence 4),
and doing it would require the server to know an application's field names,
which is exactly the boundary a runtime-model-first platform exists to keep.

**A self-referencing `OwnerId` field on `User`.** Phase 103 rejected this shape
for `SELF` on three grounds that all still apply, and it solves a different
problem anyway: it makes an existing record matchable, not a missing record
present.

**`AUTO_ID`.** It mints a *field value*, not a record id — `mintAutoIdFields`
runs over `preparedValues` before `buildNewRecord` takes `options.recordId`
separately. It cannot name a record.

**Make `User.Email` optional.** Tempting once Evidence 8 shows the businessKey
enforces nothing. Rejected: an email is real product data that both applications
model as required, and relaxing it to route around a missing collection point
would leave the object with neither a required key nor an enforced one. If the
`businessKey` should enforce uniqueness, that is its own phase (Planning
Handoff), and this phase must not pre-empt it by weakening the field.

**Put the profile step inside `CreateBand` / `CreateCircle`.** Phase 99's note
already rejected this and it is right: creating a second band would then fail on
a duplicate id. Acceptance Pair D+ exists to keep it rejected.

**Do nothing.** It is the first thing a new person sees about themselves, on
every screen, forever.

## Scope

- `src/model/resolved-model/command.ts` — `ResolvedCommandCreateStep.recordId?`
  and its `Partial…` counterpart.
- `src/parser/grammar/command.ts` — the `ID <expr>` clause on a `CREATE` step.
- `src/compiler/compile-adlj.ts` / `src/model/adlj-source.ts` /
  `src/model/adlj-schema.json` — the `.adlj` mapping and regenerated schema.
- `src/compiler/resolve-model/command.ts` and
  `src/compiler/validate-model/command.ts` + `codes.ts` —
  `ADL_COMMAND_CREATE_ID_UNRESOLVABLE`.
- `src/compiler/print-adl.ts` — the printer branch.
- `src/runtime/command-*` — resolve the expression and pass
  `options.recordId` into `planCreateForTransaction`; carry the id into the
  command intent's `recordIds` manifest.
- `src/server/webauthn-identity.ts` — `PasskeyRegistrationResult.identity`.
- `src/server/authority-http.ts` — that field on the wire.
- `src/ui/components/adl-session-panel.ts` and the browser authority bridge —
  the two fields and the post-registration command run.
- `src/reference/giggle-band/domain.adlj` and
  `src/reference/jointly-care/domain.adlj` — `COMMAND RegisterProfile`, one
  `modelVersion` hop each with an empty-object migration.
- `docs/spec/language.md`, `docs/spec/adlj.md`,
  `docs/spec/runtime-semantics.md` — the clause, its mapping, and what it means
  at runtime.
- `docs/phases/phase-103-own-record-policy-operand.md` — its
  *"Recommendation on a profile screen"* section, corrected per Evidence 11.
- `docs/operations/authority-production-runbook.md` and
  `scripts/dev/seed-local-admin.mjs` — the backfill.
- `conformance/runtime/` — a new case file for the clause.
- `learnings/implementation/passkey-identity.md` (its standing "nothing creates
  a `User` record" defect is closed), `implementation/auto-id-minting.md`,
  `implementation/offline-operation-identity.md`,
  `implementation/command-intent-replay.md`, and
  `implementation/policy-engine.md` (Evidence 10).

### Positive-only coverage this phase must backfill, first

`learnings/process/testing-expectations.md` requires that where a phase touches
code whose existing tests are positive-only — or absent in one direction — the
missing half goes in **before** the change. Three such gaps were found while
measuring:

1. **`RecordIdUnavailableError` and `RecordIdInvalidError` have no test
   anywhere.** `grep -rn` across `tests/` returns nothing for either. Part 2's
   entire idempotency answer rests on the first of them, and the collision check
   is also what stops one caller naming another's record. Both refusals get
   named assertions before the clause lands.
2. **`readFieldsForDisplay` has no case for a record that does not exist.** Its
   three existing sites (`tests/read-model-lookup-display.test.ts:209,232`,
   `tests/band-reference-app.test.ts:1367`) all pair a granted field against a
   denied one for a record that *is* there. The `null`-for-missing-record path
   — the one that makes the whole application degrade silently, and the subject
   of this phase — is untested. It gets a case, and it must keep passing after
   the phase (Pair B−).
3. **`businessKey` has no runtime test in either direction**, because it has no
   runtime behaviour (Evidence 8). Nothing is added for it here; it is recorded
   in the handoff so the next reader does not repeat Phase 99's inference.

## Non-goals

- **No profile screen, in either application.** Evidence 11: it needs Phase
  103's `SELF` *and* an answer to the read-model search gate, and it is a
  separate phase. This phase makes a person's name render where a *member* name
  belongs; showing a person their own record is a different feature.
- **No idempotent or conditional write construct.** Part 2's rationale.
- **No change to `UserPolicy` in either application.** Phase 101's single
  field-scoped rule stands, unmodified. Acceptance Pair E− asserts it.
- **No `businessKey` uniqueness enforcement.** Named in the handoff.
- **No change to `User.Email`'s requiredness or validator.**
- **No email verification.** Phase 99's non-goal, unchanged: the address is
  collected, not proven.
- **No `SELF` principal work.** That is Phase 103's, and this phase neither
  needs nor blocks it.
- **No change to what an unauthenticated caller can do.** The registration
  ceremony's own gating is Phase 99's and is untouched.

## Constraints

- The `ID` expression must be resolved from the **caller's** runtime context.
  A caller must have no way to name another identity's id: the reference apps
  use `RUNTIME.userId`, and the authority must reject a replayed intent whose
  named record id does not match what re-executing the command produces.
  Proven by test (Pair C−), not by inspection.
- `AUTHORITY command` must continue to bypass **policy only**. Validation,
  object scope, sync policy and constraints all still apply to the profile step.
  Proven by test (Pair F−).
- The clause must be **inert** for a model that does not use it. A `create` step
  with no `ID` mints its own id, byte-identically to today, and
  `src/ui/demo-fixture.ts`'s `modelVersion` and `modelFingerprint` must be
  measured unmoved (Pair G−).
- **Every acceptance assertion below is a named pair.** Neither half may be
  dropped, and each negative half must be written first and **seen to fail**
  against the unmodified code.
- **Assert rendered values, never the absence of an exception.** This is the
  phase where that rule bites hardest: the defect being fixed is *precisely* a
  silent fallback that raises nothing. `expect(...).resolves` proves nothing
  here. Assert the name that must appear and the `user-` substring that must
  not.
- **Assert diagnostics by identity.** `ADL_COMMAND_CREATE_ID_UNRESOLVABLE`, not
  `diagnostics.length > 0`.
- Every `.adl`/`.adlj` example that reaches `docs/spec/*` must go through
  `compileAdl` / `compileAdlj` with `diagnostics: []` before it is committed
  (`AGENTS.md`). The `RegisterProfile` example above **has not been compiled**
  and could not be: `ID` is the clause this phase creates. It is a
  specification, not verified source.
- Both reference apps change content, so **both** get a `modelVersion` hop, an
  empty-object migration and their own real-browser persisted-state upgrade
  test — not one representative app (`AGENTS.md`, Persisted-state upgrade
  testing).
- Authority and identity behaviour are server claims, so they are proven against
  real PostgreSQL under `tests/integration/`, never a fake.
- No existing test, conformance case or constraint may be weakened.

## Acceptance Criteria

Named pairs, per `learnings/process/phase-execution.md`. Every negative half is
written first and seen red against the unmodified code, with its failure message
recorded in the execution note.

### Pair A — the language clause

- **A+ `expectCreateStepMintsUnderTheNamedId`.** A command whose create step
  declares `ID RUNTIME.userId` produces a record with
  `record.meta.guid === context.userId`. Asserted on the guid, not on the
  command succeeding.
- **A− `expectCreateStepWithoutIdStillMintsItsOwn`.** A create step with no `ID`
  clause produces a record whose guid is freshly minted, is **not** the caller's
  `userId`, and matches the existing id shape. This is the half that stops the
  clause becoming the default; without it, "the id is the userId" would be
  satisfied by a runtime that always used the userId.
- **A− `expectUnresolvableIdExpressionIsANamedDiagnostic`.** An `ID` naming a
  later step's `stepMeta`, or `itemIndex` outside an iterating step, produces
  `ADL_COMMAND_CREATE_ID_UNRESOLVABLE` — asserted by **code identity**, with the
  matching valid source producing `diagnostics: []`.
- **A± `expectIdClauseRoundTrips` / `expectNoIdClausePrintsNone`.** A step with
  `ID RUNTIME.userId` prints as `ID RUNTIME.userId`, re-parses to an identical
  resolved model, and the same step expressed in `.adlj` as
  `"recordId": { "kind": "runtime", "property": "userId" }` resolves
  identically. Paired with: a step *without* the clause prints no `ID` token and
  round-trips identically — the negative half that keeps the printer from
  emitting a clause nobody declared.

### Pair B — the name renders, and the raw id does not

- **B+ `expectRegisteredPersonRendersByName`.** After a person registers and
  `RegisterProfile` runs, the Giggle Band member list row for them reads their
  name, captured from real `<tbody>` `textContent`.
- **B− `expectNoRawIdentityIdOnThatScreen`.** That same rendered text contains
  no `user-` substring and does not contain the identity's id, and no `@`
  appears anywhere on the screen. Phase 101's exact assertion shape.
- **B− `expectMissingProfileStillDegradesToTheRawId`.** A `BandMember` whose
  `User` names an identity with **no** profile record still renders the raw id,
  and `readFieldsForDisplay` for that id still returns `null`. Without this
  half, **B+** would also be satisfied by a renderer that invented a label — and
  this is the backfill item 2 case, kept as a permanent guard rather than
  deleted once the phase is green.

### Pair C — the id is the identity, and cannot be anyone else's

- **C+ `expectProfileRecordIdEqualsAuthorityUserId`.** After replay, the `User`
  row read out of `adl_authority_records` has `record_id` equal to the session's
  `userId`. Read from the table, not from the response.
- **C− `expectProfileCannotBeMintedForAnotherIdentity`.** A hand-crafted command
  intent whose `recordIds` manifest names a **different** identity's id is
  rejected by the authority, and `adl_authority_records` holds no `User` row for
  that id afterwards. This is the security half of Part 1 and it is also the
  measurement Evidence 13 flags as inferred: if the manifest and the re-executed
  `ID` can disagree, this is where it shows.

### Pair D — running it twice, and creating a second group

- **D+ `expectSecondBandCreationUnaffected`.** A person who already has a
  profile record runs `CreateBand` a second time and it succeeds, producing a
  second `Band` and a second `BandMember` with `Role: "BandAdmin"`. This is the
  assertion that the profile step is **not** inside `CreateBand` — Phase 99's
  obstacle 2, kept closed by construction.
- **D− `expectSecondProfileRegistrationRefusedByName`.** Running
  `RegisterProfile` a second time is refused with `RecordIdUnavailableError`
  naming the object, **and** the existing record is unchanged afterwards — same
  `revision`, same field values. A refusal that also overwrites is the failure
  mode this half exists to catch, and it is one of backfill item 1's two cases.
- **D− `expectMalformedNamedIdRefusedByName`.** An `ID` expression resolving to
  a value that fails `isValidRecordId` is refused with `RecordIdInvalidError`
  before any storage access — backfill item 1's other case.
- **D− `expectProfilePromptNotOfferedToSomeoneWhoHasOne`.** The registration
  surface does not offer the profile fields to a ceremony that returned
  `identity: "existing"` (adding an authenticator, or identity recovery),
  asserted from the rendered panel.

### Pair E — the directory Phase 101 closed stays closed

- **E+ `expectAuthenticatedCallerResolvesAnotherUsersDisplayName`.** A signed-in
  caller with no membership gets `{ Name: "Riley Stone" }` from
  `readFieldsForDisplay`, and a member list renders real names. Phase 101's
  positive half, re-asserted because this phase adds records to the object it
  protects.
- **E− `expectAuthenticatedCallerCannotEnumerateOrReadUsers`.** For that same
  caller, `search("User")` and `read("User", otherId)` both raise
  `PolicyDeniedError`; the rendered member list contains no `@`; and the new
  profile record appears in no other identity's `bootstrap`. Asserted on
  rendered values and returned rows, never on the absence of an exception.
- **E− `expectUserPolicyRuleSetUnchanged`.** After the phase, `UserPolicy`'s
  resolved rule list in each application is exactly its pre-phase content —
  asserted on rule names and effects, so a `create` or `search` grant added
  "temporarily" during execution cannot survive to `main`.

### Pair F — `AUTHORITY command` bypasses policy and nothing else

- **F+ `expectProfileAcceptsARealNameAndEmail`.** `RegisterProfile` with a valid
  name and address writes the record, from a caller `UserPolicy` grants no
  `create` to. This is what proves the `AUTHORITY command` step is doing its
  job.
- **F− `expectProfileRefusesAMissingOrMalformedEmail`.** The same command with
  `Email` absent, and again with `user-1111…@invalid`, raises
  `RuntimeValidationError` naming the field. Proves the bypass is policy-only —
  without this half, "`AUTHORITY command` works" is indistinguishable from
  "`AUTHORITY command` skips everything".

### Pair G — both apps, and the fixture that must not move

- **G+ `expectBothReferenceAppsAtOneNewVersion`.** Giggle Band and Jointly Care
  each carry exactly one new `modelVersion` hop with an empty-object migration,
  and each has its own real-browser persisted-state upgrade test that seeds the
  previous version's state, loads the real app URL, and reads the new version
  back from the mounted `<adl-app>`'s own `model.modelVersion` — never a
  hard-coded string.
- **G− `expectBrowserDemoFixtureUnmoved`.** `src/ui/demo-fixture.ts`'s
  `modelVersion` and `modelFingerprint` are byte-identical to their pre-phase
  values and `tests/visual/browser-demo.visual.spec.ts` and
  `tests/ui-runtime.test.ts` pass unmodified — the evidence that the new clause
  is genuinely optional and inert. Phase 99 used exactly this assertion for
  `REGISTRATION`; it is the right shape again.

### Pair H — the authority, against real PostgreSQL

- **H+ `expectProfileRowWrittenThroughTheAuthority`.** A real anonymous
  registration against a real socket, followed by a `RegisterProfile` replay,
  leaves a `User` row in `adl_authority_records` under that identity's id with
  the submitted name and email.
- **H− `expectNoProfileRowWithoutTheCommand`.** An identity minted by the same
  ceremony that does **not** run `RegisterProfile` has **zero** `User` rows —
  so **H+** cannot pass vacuously against a server that writes one anyway — and
  a `RegisterProfile` replay presenting no session is rejected with zero rows
  written.

### No meaningful negative counterpart

Disclosed rather than manufactured, per
`learnings/process/testing-expectations.md`:

- **The three specification documents and the five learnings updates.** Prose.
  The pairs that give them teeth are A, C and F.
- **The runbook's operator backfill procedure.** It is a documented manual
  sequence; its positive half is exercised by
  `scripts/dev/seed-local-admin.mjs`'s equivalent step (a fresh database, then a
  named profile renders), and there is no meaningful "the operator did not run
  it" case beyond **B−**, which already covers it.

### Suite-level

- `npx tsc --noEmit`, `prettier --check`, `npx vitest run` (baseline **1,212**
  across 64 files plus Phase 105's cases, plus this phase's), the conformance
  suite, `npx vitest run --config vitest.integration.config.ts` (baseline
  **169** across 17 files plus Phase 105's, plus this phase's),
  `npm run verify:push` with screenshots inspected, and an `/impeccable audit`
  on the changed session panel — all clean, with no test weakened.

## Testing

The measurement harness this document was written with was three throwaway
files, all deleted: a browser-level one mounting `<adl-app>` under
`@vitest-environment happy-dom` and reading `adl-list-view tbody tr`
`textContent`; a runtime-level one over `createBandReferenceRuntime` exercising
`create` with `options.recordId`, the duplicate-id refusal, the `Email`
validator and the businessKey; and a model-patching one that added a candidate
`MyProfile` read model to `domain.adlj` as JSON, recompiled through
`compileAdlProjectV2`, and ran it under three different `UserPolicy`
configurations. Note that `console.log` is swallowed by this project's vitest
configuration — the harness appended to a file instead.

**Order.** Backfill items 1 and 2 first, red where they should be red. Then Part
1's language surface. Then the reference apps. Then the identity surface.

- **Unit** (`npx vitest run`).
  - `tests/object-store.test.ts` (or its nearest equivalent): backfill item 1 —
    `RecordIdUnavailableError` and `RecordIdInvalidError`, both named, plus the
    positive case that a valid unused id is accepted.
  - `tests/read-model-lookup-display.test.ts`: backfill item 2 — B−'s
    missing-record case, added before the phase and kept after it.
  - `tests/parser.test.ts`: the `ID` clause parses; the pre-change grammar's
    failure message is recorded (Phase 100's standard); a step without it parses
    unchanged.
  - `tests/model-validation.test.ts`: A−'s diagnostic, by code.
  - `tests/compile-adlj.test.ts`: A±'s round-trips, both halves.
  - `tests/command-runtime.test.ts` (or nearest): A+, A−'s minting case, F+, F−,
    D−'s two refusals.
  - `tests/band-reference-app.test.ts` / `tests/jointly-reference-app.test.ts`:
    B+, B−, D+, E+, E−, G+.
  - `tests/ui-runtime.test.ts` + `tests/visual/browser-demo.visual.spec.ts`:
    G−, unmodified.
  - The session panel's rendered-surface halves: D−'s
    `expectProfilePromptNotOfferedToSomeoneWhoHasOne`.
- **Conformance.** A new case file for the `ID` clause: a command naming its
  record id resolves and executes to a record with that guid; the same command
  without the clause mints its own; the unresolvable-expression case is a model
  error. Each shown to **discriminate**
  (`learnings/implementation/conformance-suite.md`). The runner and case schema
  are a shared spine and stay serial.
- **Integration** (`--config vitest.integration.config.ts`, real PostgreSQL).
  Pairs C and H. Model the file on
  `tests/integration/authority-self-service-registration.test.ts`, which already
  runs a real anonymous WebAuthn ceremony against a real socket with the real
  `@simplewebauthn/server` verifier and the **real Giggle Band model** via
  `loadAuthorityModel` — a literal fixture model would prove the criteria about
  a fixture. Extend it rather than duplicating the ceremony setup, and extend
  `tests/integration/user-directory-policy.test.ts` for E− over real
  PostgreSQL.
- **Playwright / `verify:push`.** The session panel changes, so this is
  mandatory. `tests/visual/passkey-sign-in.spec.ts` gains the two fields and the
  post-registration command run against a real Chromium with a virtual
  authenticator, following Phase 99's own precedent. Both reference apps get
  their persisted-state upgrade cases (G+). Inspect every screenshot.
- **Design review.** `/impeccable audit` on the changed session panel. It is the
  first screen a new person meets and Phase 99 shipped its predecessor without
  one.
- **Mutation checks.** Each must turn a *specific, different, named* assertion
  red:
  - drop the `options.recordId` pass-through → **A+**, **C+** red; **A−** green.
  - make the clause default to `RUNTIME.userId` when absent → **A−** red,
    **A+** green.
  - remove `ADL_COMMAND_CREATE_ID_UNRESOLVABLE` → **A−**'s diagnostic case red.
  - change the step to `AUTHORITY caller` → **F+** red, **F−** green.
  - change the step to skip validation → **F−** red, **F+** green.
  - add `ALLOW SEARCH AUTHENTICATED` to `UserPolicy` → **E−** red, **E+** green.

## Parallel Execution Plan

The serial spine is the language surface: every later stream's shape is decided
by the resolved-model field and the plan-time resolution above it.

1. **Serial spine, no consumers.** Backfill items 1 and 2. Then
   `ResolvedCommandCreateStep.recordId?` plus the plan-time resolution and the
   `options.recordId` pass-through, with **A+** and **A−**'s minting case
   passing and nothing else touched. `tsc` then names every remaining site —
   parser, `.adlj`, printer, schema, validator, intent manifest — which is the
   point of doing this first: later work receives a real exhaustiveness error
   list rather than a predicted one.
2. **Then parallel**, four streams over disjoint files:
   - grammar + AST + the fail-first pre-change-grammar probe;
   - printer branch + `adlj-schema.json` + the `.adlj` round-trip pair;
   - validator diagnostic + code + its named-identity test;
   - `webauthn-identity.ts`'s `identity` discriminator + the HTTP edge.
3. **Then serial again**, at the repository's known contention points and in
   this order: the conformance corpus; the two reference apps' `domain.adlj`
   (version hops and migration entries are ordered content); the session panel
   and the browser authority bridge (shell chrome);
   `tests/band-reference-app.test.ts` and
   `tests/jointly-reference-app.test.ts`; the three specification documents and
   Phase 103's corrected recommendation.
4. **Barriers.** `npx vitest run` after (1) and again after (3).
   `npx vitest run --config vitest.integration.config.ts` **once**, after (3).
   `npm run verify:push` **exactly once**, at the very end.

## Tasks

1. Write backfill items 1 and 2 against the unmodified tree, with both halves
   each. Item 2's missing-record case should pass immediately — it is the
   defect's own signature — and item 1's cases should pass immediately too; if
   either does not, that is a second defect and it is reported, not absorbed.
2. Add `ResolvedCommandCreateStep.recordId?` and the plan-time resolution; make
   **A+** and **A−**'s minting case pass; let `tsc` enumerate the rest.
3. Prove the `ID` keyword fails on the pre-change grammar, record the message,
   then add the grammar branch.
4. Add the printer branch and the `.adlj` schema entry; make **A±** pass both
   ways.
5. Add `ADL_COMMAND_CREATE_ID_UNRESOLVABLE`, shown failing first, asserted by
   code identity.
6. Carry the resolved id into the command intent's `recordIds` manifest; add
   **C−** against real PostgreSQL before **C+**.
7. Add the conformance cases and show each discriminates.
8. Add `COMMAND RegisterProfile` to both `domain.adlj` files with one
   `modelVersion` hop each; compile-check with `compileAdlProjectV2` and assert
   `diagnostics` is `[]`; make **F+**, **F−**, **D+**, **D−** pass.
9. Add `PasskeyRegistrationResult.identity` and put it on the wire.
10. Add the two fields to the session panel and the post-registration command
    run; make **D−**'s panel case pass; run `/impeccable audit`.
11. Make **B+**, **B−**, **E+**, **E−** pass; add **G+** for both apps and
    confirm **G−** unmoved and unmodified.
12. Add **H+** and **H−** against real PostgreSQL.
13. Run every mutation check and confirm each turns a different named assertion
    red.
14. Add the operator backfill to the runbook and the `seed-local-admin.mjs`
    step.
15. Update `docs/spec/language.md`, `adlj.md`, `runtime-semantics.md`; correct
    Phase 103's *"Recommendation on a profile screen"* per Evidence 11; update
    the five learnings documents — including closing
    `implementation/passkey-identity.md`'s standing "nothing creates a `User`
    application record" defect, and recording Evidence 8 (a `businessKey`
    enforces nothing) and Evidence 10 (a create request carries no record, so no
    record-matching principal can gate one).
16. `tsc`, `prettier --check`, unit, conformance, integration, `/impeccable
audit`, `npm run verify:push` with screenshots inspected. Commit; push.

## Planning Handoff

**Recommended next: a profile screen for Giggle Band**, which is now unblocked
in a way it was not before. Phase 103 ships `SELF`; this phase ships the record
`SELF` matches. What remains is the one thing Evidence 11 measured and Phase
103's recommendation got wrong: a read model's **primary** source always goes
through the search gate, so *"a `currentUser`-scoped read model over `User` plus
an ordinary composite view"* cannot work while `UserPolicy` grants no `search`.
That phase's real subject is therefore how a view binds to "my record" without
enumerating — either `getCurrentUserSourceRecordId`'s read-by-id path being
reachable from a primary source, or a view-level binding — and it is a language
decision, which is exactly why Phase 103 declined to bundle it.

Candidates that surfaced here and were not taken:

- **`businessKey` enforces nothing.** Measured (Evidence 8): two `User` records
  with the same `Email` are accepted, and `businessKey` is validated only to
  name an existing field. Either it should imply a uniqueness constraint — in
  which case every shipped application needs auditing for the duplicates it may
  already hold — or the keyword should be renamed to say what it actually does,
  which is "the fallback display label". Both reference apps declare one, so
  this is not hypothetical.
- **An idempotent or conditional write.** Part 2 routes around it by sequencing
  and says so plainly. The next construct that needs "create if absent" —
  offline reconciliation is the obvious candidate — will have to answer the
  replay, conflict and outcome questions this phase declined to open.
- **A `profileMissing`-shaped shell visibility predicate.** Evidence 12:
  `ShellVisibilityKind` cannot express "this person has no profile", which is
  why the backfill for existing identities is an operator procedure rather than
  a self-healing screen. Phase 105's handoff nominates a sibling predicate for
  the granted-versus-joined context distinction; a single phase could reasonably
  take both, since both are the shell being unable to say something the runtime
  already knows.
- **`ADL_POLICY_OWNER_SEARCH_UNREACHABLE`.** Still standing from Phase 103's
  handoff, and Evidence 10 adds a sibling: `ALLOW CREATE OWNER` (or
  `CONTEXT_MEMBER`, or `SELF`) is dead for the identical reason, because a
  create request carries no record. Neither has a diagnostic. A single phase
  auditing every record-matching principal against every recordless request
  shape would close the class rather than one member of it.
