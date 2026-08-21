# Phase 105 — An Invitee Can Accept a Band Invitation in the Browser

A musician who has been invited to a band, and has not yet joined it, opens
Giggle Band and sees this:

```
List 'UpcomingEvents' could not bind source 'HomeUpcomingEvents'.
List 'PendingInvitations' could not bind source 'PendingInvitations'.
Welcome Back!  …  Invitations   No pending invitations
```

There is no button to accept the invitation, anywhere in the application, and
the "Create a band" affordance Phase 99 shipped is **hidden from them** — the
one person in the product with a reason to be there has strictly fewer options
than a stranger. That paragraph is a verbatim `textContent` capture from a real
`<adl-app>` render, not a description (Evidence 5).

> **Phase numbers are no longer execution order in this repository.** The owner
> reprioritised mid-flight: Phases 100 and 101 were executed before Phase 99.
> This document executes after Phase 99, and after the ordered run
> 102 → 103 → 104.

## Objective

An invited musician can find their invitation in Giggle Band without joining
anything first, and accept it with one click, ending the interaction as a
`BandMember` of that band.

Concretely: the browser shell resolves a caller's **context grants**, not only
their context roles, when it builds the runtime context for a cross-context
(`CONTEXT ALL`) view — so a command run from such a view is authorised the same
way the view's own data already is; and Giggle Band gains the invitee-facing
read model, view, nav item and row action that Jointly Care has had since
Phase 79 and Giggle Band never got.

**No language change is required.** Every construct this phase needs already
exists, compiles, and has a shipped worked example. That was established by
compiling the proposed content and running it, not by reading the grammar
(Evidence 10).

## Evidence and Dependency

Everything below was **measured** against the working tree at `b14674b` with
throwaway vitest files run under `happy-dom` — the real reference-app models,
the real `ApplicationRuntime`, and for the browser claims a real `<adl-app>`
element mounted into a real document. Reading a resolver in this codebase tells
you what it does when permitted and never whether it is permitted, so nothing
here is taken from a prior document or from inspection alone. The two claims
that could not be measured are marked **inferred**.

The throwaway files were deleted after the measurements were recorded; the
harness shape is described in Testing so it can be rebuilt.

### 1. The premise that motivated this phase is FALSE: an invitee *does* have a Band context

The commissioning note reasoned that `PendingInvitations` and
`SentBandInvitations` are both `CONTEXT REQUIRED Band`, that an invitee is not a
`BandMember`, and that they therefore have no `Band` context. The middle step is
right and the conclusion is wrong.

`src/reference/giggle-band/domain.adlj`, `contexts[1]`, declares a
`CONTEXT_GRANT`:

```json
{ "name": "pendingBandInvitation", "object": "BandInvitation",
  "userField": "Invitee", "contextField": "Band",
  "condition": "Status == 'Pending'" }
```

Measured — `listAvailableContexts("Band", inviteeContext)` for a seeded guest
holding one `Pending` invitation to the second band:

```json
[{ "context": "Band", "id": "band-2c63…", "label": "The Betas",
   "roles": [], "roleEntries": [],
   "grantEntries": [{ "context": "Band", "contextId": "band-2c63…",
                      "grant": "pendingBandInvitation",
                      "grantRecordId": "bandinvitation-7a22…" }] }]
```

`withSelectedContext("Band", …)` then succeeds for that caller and stamps the
grant onto `contextGrants`. The band appears in the browser's context selector.

This matters beyond correcting the record: because a `Band` context *is*
available, `createFirstBand`'s `VISIBLE WHEN CONTEXT Band UNAVAILABLE` evaluates
false and the onboarding button disappears for exactly the person who has been
invited (Evidence 5).

### 2. The real block is a missing `search` grant

Measured, with and without a selected `Band` context:

```
executeReadModel("PendingInvitations",  inviteeCtx)
  → PolicyDeniedError: Policy denied search on object 'BandInvitation'.
executeReadModel("SentBandInvitations", inviteeCtx)
  → PolicyDeniedError: Policy denied search on object 'BandInvitation'.
runtime.search("BandInvitation", {}, inviteeCtx)
  → PolicyDeniedError: Policy denied search on object 'BandInvitation'.
```

`BandInvitationPolicy` grants `search` only to `ROLE BandAdmin`. A grant widens
the object-scope gate and never confers a role
(`learnings/implementation/context-grants-and-relationship-access.md`), so an
invitee never matches it. `ReadModelService.searchAuthorisedSourceRecords`
(`src/runtime/read-model-service.ts:302`) checks `search` *first*, before any
scope or per-record filtering, and throws.

So the invitee's exclusion has nothing to do with `CONTEXT REQUIRED` and
everything to do with a policy vocabulary that Phase 18 already tripped over
once. Widening the `search` grant is safe by construction here — see Evidence 12.

### 3. Reading the invitation, and running the command, already work

Measured, with the band selected through `withSelectedContext`:

- `runtime.read("BandInvitation", ownInvitationId, ctx)` returns the record.
  `allowInviteeReadOwnInvitation` (`WHEN Invitee == RUNTIME.userId`) fires once
  the grant has widened the object-scope gate.
- `runtime.read` of an invitation in a *different* band is refused at the scope
  gate, not by the rule.
- `executeCommand("AcceptBandInvitation", { Invitation }, ctx)` runs both steps:
  `acceptInvitation` sets `Status: "Accepted"` / `RespondedAt`, and
  `createMembership` writes the `BandMember` row.

The command is not the gap. The surface is.

### 4. `tests/band-reference-app.test.ts` proves less than it looks like it does

Its `accepts invitations with a generic transaction command` case builds
`inviteeContext` **by hand**, with `selectedContexts: { Band: … }` and nothing
else. That is a context no browser session ever produces. The test is correct
about the command and silent about every question this phase asks.

### 5. What an invitee actually sees today, in a real browser render

Measured by mounting `<adl-app>` with the real Giggle Band model and a guest who
holds one `Pending` invitation, then reading `textContent`:

```
Giggle Band ADL Example | Band: Choose Band / The Betas | Online | …
List 'UpcomingEvents' could not bind source 'HomeUpcomingEvents'.
List 'PendingInvitations' could not bind source 'PendingInvitations'.
Welcome Back!  Add Event  …  Schedule  No upcoming events
Invitations  No pending invitations
```

`"Create a band" button present: false`.

The same measurement for a signed-in person with **no** invitation and no band —
Phase 99's onboarding state — gives:

```
Band: No Band contexts | No Band contexts are available for this view.  Create a band
```

`"Create a band" button present: true`.

Both diagnostics in the first capture are the presentation runtime degrading a
thrown read model into a list-level message. `HomeUpcomingEvents` is a correct
refusal (a non-member may not search `Event`); `PendingInvitations` is the one
this phase closes. Neither string should be shown to a person, which is noted in
the Planning Handoff rather than fixed here.

### 6. Jointly Care already ships the entire pattern, and it renders

`src/reference/jointly-care/domain.adlj` and `ui.adlj`:

- `CONTEXT_GRANT pendingCircleInvite ON Circle` — the mirror of Giggle Band's.
- `READ_MODEL MyPendingCircleInvites`, `CONTEXT ALL Circle`, one source
  `CircleInvite SCOPE allAvailableContexts`.
- `CircleInvitePolicy.allowAuthenticatedSearchInvites` — `ALLOW SEARCH
AUTHENTICATED`, deliberately unconditioned, with a comment explaining that a
  `WHEN`-conditioned `SEARCH` rule can never match.
- `VIEW MyPendingInvites`, `CONTEXT ALL Circle`, with row `ACTION`s for
  `AcceptCircleInvite` / `DeclineCircleInvite`, each `INPUT Invite FROM id` and
  `WHEN Invitee == RUNTIME.userId`.
- `SHELL NAV` item "My Invites", `group Main`, `order 15`, no visibility
  predicate.

Measured, mounting `<adl-app>` as the pending invitee and navigating to it:

```
Your pending invites   alex@example.com - invited Fri 14 Aug   Accept   Decline
```

Both buttons render `visible: true, enabled: true`, with
`input: { Invite: "circleinvite-0662…" }`.

So the language expresses the required read model today, in a shipped
application, with `context.mode: "all"` and `SCOPE allAvailableContexts`.

### 7. …and Jointly Care's Accept button is dead. Measured.

Clicking it, in that same real render:

```
Policy denied update on object 'CircleInvite' outside its runtime context scope.
ADL_POLICY_DENIED
Object 'CircleInvite' is scoped to context 'Circle', but the runtime context has
no selected or resolved context instance for update.
```

Read back afterwards through a `SystemAdmin` context: the invite is still
`Status: "pending"` with no `RespondedAt`, and `CircleMember` still holds exactly
the two seeded rows. Nothing was written.

Selecting "Mum's Care Circle" in the context selector **first** does not help.
Measured separately: the selector offers it, the selection takes, the nav
expands to the circle's views — and the same denial appears.

This is a live, user-visible defect in a shipped reference application. It is not
introduced by this phase; this phase is where it stops being invisible, because
Giggle Band's port would inherit it verbatim.

### 8. Root cause, isolated to one branch

`src/ui/components/adl-app/data.ts:500-519`, `resolveActiveViewContext`, the
`mode === "all"` branch:

```ts
const contextRoles = await this.runtime.contextService.resolveContextRoles(
  contextName,
  this.baseRuntimeContextWithoutSelected(contextName),
);
return {
  context: this.withContextRoles(
    this.baseRuntimeContextWithoutSelected(contextName),
    contextName,
    contextRoles,
  ),
};
```

Roles only. The selection is dropped (correctly — that is what `CONTEXT ALL`
means) and nothing puts the grants back, so `getAllowedContextIds` returns `[]`
and every scoped write from that screen is refused.

`ReadModelService.resolveExecutionContext`
(`src/runtime/read-model-service.ts:83-112`) does the same job for the same
`mode: "all"` and resolves **both**, with a comment that states exactly why:

> Grants are re-resolved alongside roles for the same reason roles are: dropping
> the selection also dropped everything derived from it. Omitting them would make
> a context reachable only through a grant — a pending invitation — invisible to
> precisely the cross-context view that exists to surface it.

Two code paths, one question, two answers. The read path renders the row; the
command path refuses to act on it.

`docs/spec/runtime-semantics.md:611` carries the fossil of the same mistake:
*"Cross-context read models remove the selected context for that business
context and use available context **roles**."* Roles, not roles and grants. The
sentence is a correct description of the shell and an incorrect description of
the read-model runtime it names.

Measured isolation — same runtime, same command, same invitee, two contexts:

| context built | `AcceptCircleInvite` |
|---|---|
| `baseRuntimeContextWithoutSelected` + `resolveContextRoles` (what `data.ts` builds today) | `PolicyDeniedError: … outside its runtime context scope.` |
| the same, plus `resolveContextGrants` | **both steps commit** — `Status: "accepted"`, `RespondedAt` set, a `CircleMember` row written |

### 9. The candidate fix, measured

Adding the grant resolution to that one branch, temporarily, and re-running the
browser measurements:

- Jointly Care, **unmodified model**, invitee clicks Accept →
  `Accept invite completed.` and the list becomes `No pending invites`.
- The Giggle Band prototype (Evidence 10) → `Accept invitation completed.`, the
  invitation reads back `Status: "Accepted"`, `RespondedAt: "2026-07-08"`, and a
  second `BandMember` row exists for the invitee in that band.
- `npx vitest run`: **64 files / 1,212 tests passed** — the current baseline,
  unchanged. No existing test asserts the roles-only shape.

The patch was reverted; no production file is modified by this document.

### 10. The Giggle Band content compiles clean and works

Drafted as `.adlj`, compiled with `compileAdlProjectV2` over the real
`app.yaml` + the real `ui.adlj`: **`diagnostics: []`**. The draft adds

- `BandInvitationPolicy.allowAuthenticatedSearchInvitations` — `ALLOW SEARCH
AUTHENTICATED`, unconditioned;
- `BandPolicy.allowAuthenticatedReadBandName` — `ALLOW READ AUTHENTICATED FIELDS
Name` (Evidence 11);
- `READ_MODEL MyBandInvitations`, `CONTEXT ALL Band`, source
  `BandInvitation SCOPE allAvailableContexts`, fields `Band`, `Role`, `Status`,
  `SentAt`, `Invitee`;
- `VIEW MyBandInvitationList` on `BandInvitation`, `CONTEXT ALL Band`, one
  section, one `readModel` list with `FILTER Status == 'Pending'` and a row
  `ACTION accept` → `AcceptBandInvitation`, `INPUT Invitation FROM id`,
  `WHEN Invitee == RUNTIME.userId`;
- a `SHELL NAV` item, `group Main`, `order 15`.

Measured against that model, for the invitee:

```json
{ "values": { "Band": "band-b4b9…", "Role": "BandMember",
              "Status": "Pending", "SentAt": "2026-07-07",
              "Invitee": "user-d1e9…" },
  "display": { "Band": "The Betas", "Invitee": "Riley Stone" } }
```

and in the browser: `Your invitations  The Betas - invited as BandMember on Tue
7 Jul  [Accept]`.

### 11. `Band.Name` needs Phase 101's field-scoped grant, or the row names a raw id

`BandPolicy` has no rule a pending invitee can match: `allowBandMemberReadBand`
needs the role they do not have, `allowBandCreatorReadOwnBand` needs
`CreatedBy == RUNTIME.userId`. Jointly Care hit this and recorded it — its
`MyPendingCircleInvites` deliberately does not name the circle, because a
`CONTEXT_GRANT` reaches the granted object and never the context's own root
object.

Measured: with `ALLOW READ AUTHENTICATED FIELDS Name` added to `BandPolicy`,
`display.Band` resolves to `"The Betas"`. Without it, the row reads
`band-b4b935e2-…`. This is Phase 101's exact construction — a field-scoped
`ALLOW` over a default-deny object, which grants the field and never the record
— reused rather than invented.

### 12. The `SEARCH` widening does not open a directory

Measured against the prototype model:

- Invitee, direct `runtime.search("BandInvitation", {}, ctx)`: **one row**,
  their own invitation. Not the seeded invitation in the other band.
- The founding `BandAdmin` of the first band, `MyBandInvitations`: **one row**,
  that band's own invitation. Not the invitee's.
- A signed-in stranger with no band and no invitation, `MyBandInvitations`:
  `rows: []` — an empty list, **not** an error. `hasNoAvailableAllContext`
  (`read-model-service.ts:114-121`) short-circuits a `CONTEXT ALL` read model
  when the caller can reach no instance, which is why the "no contexts at all"
  state does not become an exception.

Two independent gates produce that: `ObjectStore.search` filters every result
through `canReadSearchResult` (`object-store.ts:576`), and
`requireObjectScopeForSearch` narrows to `getAllowedContextIds` first. An
unconditioned `ALLOW SEARCH` on a context-scoped object with a row-level read
rule is the pattern `context-grants-and-relationship-access.md` already
prescribes — *"Grant `SEARCH` to a wider principal and let the per-record read
filter do the work"* — and Jointly Care already ships it.

### 13. Inferred, not measured

- **The authority path.** Every measurement above runs against
  `ApplicationRuntime` over the in-memory backend. That the same command
  replays correctly through `AuthorityService` over real PostgreSQL for a
  grant-holding caller is **inferred** from
  `tests/integration/authority-postgres.test.ts`'s existing coverage and from
  `shapingContext` re-resolving after a membership-creating write. This phase's
  Testing section requires it to be measured, against real PostgreSQL, before
  the phase is done.
- **The offline dataset.** Whether an invitee's `BandInvitation` row reaches
  their device is governed by `AuthorityService.bootstrap`'s read-policy filter
  rather than by declared sync scope
  (`context-grants-and-relationship-access.md`). Not measured. Named in Testing.

**Dependency:** Phase 99 (the `CONTEXT_GRANT`, `COMMAND_ACTION` and
`EMPTY_STATE` machinery this builds beside), and the ordered run 102 → 103 → 104
ahead of it. Nothing here depends on Phase 103's content: `SELF` is a
whole-record grant on the caller's *own* record and has nothing to say about an
invitation, which is somebody else's record about the caller.

## Decision

Two parts, and the order matters.

### Part 1 — the shell resolves grants, not only roles, for a `CONTEXT ALL` view

`resolveActiveViewContext`'s `mode === "all"` branch resolves
`contextService.resolveContextGrants` alongside `resolveContextRoles` and merges
both into the returned context, filtering any prior entry for that context name
exactly as `withContextRoles` already does for roles.

Five reasons this is the right place and the right shape:

**It makes two runtime paths agree instead of adding a third opinion.**
`ReadModelService.resolveExecutionContext` already does precisely this, for
precisely this reason, with a comment saying so. The shell is the one that
diverged.

**It is the context the screen is already described by.** Every other consumer
of `activeRuntimeContext` — the presentation evaluation, the list refresh, the
edit surface — is already being handed a context that under-describes the
caller. Fixing it once fixes all of them.

**It cannot widen anything.** `resolveContextGrants` returns exactly what
`listAvailableContexts` already returned to build the picker the person is
looking at, and a grant confers no role
(`runtimeContextHasScopedRole` never reads `contextGrants`). The screen already
shows the row; this lets the caller act on the row it showed them.

**It is behaviour-preserving for every existing app.** Measured: the full unit
suite is unchanged at 64 files / 1,212 tests.

**It fixes a shipped defect in Jointly Care with no model change at all.**
Measured, twice, in a real browser.

### Part 2 — Giggle Band gets the invitee surface

Mirroring Jointly Care's, with two deliberate differences.

**`Band` is named, Jointly's `Circle` is not.** Jointly Care could not name the
circle and recorded why. Phase 101 shipped the mechanism that makes it
possible — a field-scoped `ALLOW` over a default-deny object — after that
comment was written. `ALLOW READ AUTHENTICATED FIELDS Name` on `Band` grants the
band's name and never the band, and it is measured working (Evidence 11).
"You have been invited to The Betas" is the whole point of the screen.

**Accept only; no Decline.** Giggle Band declares no `DeclineBandInvitation`
command. Adding one is a product decision with its own state transition
(`Status: 'Declined'`, `RespondedAt`, and the `respondedAtRequiredAfterResponse`
validation already anticipates it) and it is not this phase's subject. Named in
the Planning Handoff.

### Rejected alternatives

**Hang the Accept button off the existing `PendingInvitations` read model.** It
is `CONTEXT REQUIRED Band`, so the invitee must first find and select a band
they have not joined in a picker they have no reason to open, and a
`CONTEXT REQUIRED` view resolves its context through `withSelectedContext`,
which *does* carry grants — so the button would work. Rejected on two grounds:
it makes the product's first interaction a treasure hunt, and it leaves the
`CONTEXT ALL` defect standing in Jointly Care, undetected, for the next phase to
rediscover. A route around a bug is not a fix for it.

**Put the Accept affordance in shell chrome, as a `COMMAND_ACTION`.** Phase 99's
construct, and it renders without a context — which is why it was right for
`CreateBand`. It is wrong here: `AcceptBandInvitation` takes an `Invitation` id,
and a generated form asking a person to type a record id is not an affordance.
A row action on a list of their invitations is the shape that carries the id for
free, and Phase 69 built the `id` token to do exactly this.

**Re-resolve grants inside `ApplicationRuntime.executeCommand`.** Cheaper-looking
and wrong. It would make every command silently authorised against a context
different from the one its own view was rendered with, on every channel
including `sync`, and the authority's replay deliberately keeps a *narrow*
resolution (`context-grants-and-relationship-access.md`: *"Replay itself keeps
its narrow resolution"*). Widening the caller's context is a browser-side
description of who is on the screen, not a runtime entitlement.

**Change `getAllowedContextIds` to consult grants when no selection exists.** It
already does. The shell simply never puts the grants in the context it passes.

**Give `BandInvitation` a `contextMember`-shaped read principal instead of a
`SEARCH` grant.** `contextMember` explicitly cannot gate `search` (the
object-level check has no record), which is why
`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` exists. It is not an option.

**Wait for a language change.** None is needed. Measured, with a compiling
prototype that renders and — behind Part 1 — commits.

## Scope

- `src/ui/components/adl-app/data.ts` — the `mode === "all"` branch of
  `resolveActiveViewContext`.
- `src/reference/giggle-band/domain.adlj` —
  `BandInvitationPolicy.allowAuthenticatedSearchInvitations`,
  `BandPolicy.allowAuthenticatedReadBandName`, `READ_MODEL MyBandInvitations`,
  and a `1.12.0 → 1.13.0` `modelVersion` hop with an empty-object migration.
- `src/reference/giggle-band/ui.adlj` — `VIEW MyBandInvitationList` and its
  `SHELL NAV` item.
- `tests/band-reference-app.test.ts` — the model assertions
  (`modelVersion`, the migration hop, the new read model and view) and the
  browser cases.
- `tests/ui-onboarding.test.ts` or a sibling — the shell-context regression
  (see Testing).
- `tests/visual/giggle-band.visual.spec.ts` — the persisted-state upgrade test
  for the `1.12.0 → 1.13.0` hop, and a screenshot of the new screen.
- `tests/integration/` — the real-PostgreSQL acceptance case.
- `conformance/runtime/context-grants.json` — a case pinning that a
  `CONTEXT ALL` consumer resolves grants.
- `docs/spec/runtime-semantics.md:611` — the "available context roles" sentence
  becomes "roles and grants", which is what both runtimes will then do.
- `learnings/implementation/context-grants-and-relationship-access.md`,
  `learnings/implementation/context-ui-navigation.md` and
  `learnings/implementation/reference-app-models.md`.

### Positive-only coverage this phase must backfill, first

`learnings/process/testing-expectations.md` requires that where a phase touches
code whose existing tests are positive-only — or absent in one direction — the
missing half goes in **before** the change. Three such gaps were found while
measuring this document's premises, and closing them is in scope:

1. **`resolveActiveViewContext`'s `mode === "all"` branch has no direct test in
   either direction.** Measured: adding grant resolution to it changed nothing
   across 64 files and 1,212 tests. A branch that can be rewritten without a
   single assertion moving is untested, and its silence is what let the two
   runtime paths diverge for four phases. Pair A goes in first.
2. **No browser-level test clicks an invite action in either reference app.**
   `tests/jointly-reference-app.test.ts:279` proves `AcceptCircleInvite` through
   a hand-built `withSelectedContext` context and carries a comment explaining
   that shape — a correct runtime proof that is silent about the browser, which
   is exactly where the button is dead.
   `tests/visual/jointly-care.visual.spec.ts:19` navigates to `MyPendingInvites`
   and asserts the heading text, and never touches the buttons under it. Pair B
   goes in first.
3. **The `pendingBandInvitation` `CONTEXT_GRANT` is tested only as syntax.**
   `tests/parser.test.ts:499` and `tests/compile-adl.test.ts:955` prove it
   parses and resolves; nothing proves it makes a band *available* to an invitee,
   and nothing proves a non-`Pending` invitation does **not**. Pair F's negative
   half depends on the second, so both go in first.

## Non-goals

- **No language change.** No new keyword, no new resolved-model field, no
  printer branch, no `adlj-schema.json` edit. If executing this phase turns up a
  reason one is needed, **stop and report it** rather than growing the language
  at the end of a content phase.
- **No `DeclineBandInvitation`.** Named in the Planning Handoff.
- **No change to `PendingInvitations`, `SentBandInvitations` or
  `MyInvitationList`.** The admin-facing surfaces are correct and stay as they
  are; this phase adds a second, invitee-facing one beside them.
- **No change to Jointly Care's `.adlj`.** Part 1 fixes its Accept button with
  no content change, and that is the evidence the fix is a platform fix. Its
  `modelVersion` must be **measured** unchanged, not assumed.
- **No fix for the two "could not bind source" diagnostics** an invitee sees on
  the Home dashboard today. One of them stops appearing as a side effect of the
  `search` grant; the other (`HomeUpcomingEvents`) is a correct refusal rendered
  badly. Both belong to a presentation-diagnostics phase. Named in the handoff.
- **No `contextMember.field: "id"`, no new policy principal.**
- **No self-service registration change.** The invited path and the
  self-service path are unchanged; only what the invited person can do
  afterwards changes.

## Constraints

- Part 1 lands **before** Part 2, and its proof is Jointly Care's Accept button
  working with **no `.adlj` edit**. That ordering is what distinguishes a
  platform fix from a Giggle-Band-shaped workaround.
- The defect must be **seen red first**, in both applications: a test that
  renders the invitee's list and clicks Accept must fail with
  `Policy denied update on object '<Invite>' outside its runtime context scope.`
  before the fix lands. A test that has never been red is not evidence.
- `resolveContextGrants` must be resolved from the **same**
  `baseRuntimeContextWithoutSelected(contextName)` the roles are, so the two
  cannot disagree about which selection was dropped.
- A grant must still confer **no** role. After the change,
  `runtimeContextHasScopedRole` must still never read `contextGrants`, and a
  `ROLE`-gated action on a `CONTEXT ALL` screen must still be refused for a
  grant-holder. Proven by test, not by inspection.
- The `SEARCH` widening must be proven not to enumerate: an invitee's direct
  `search("BandInvitation")` returns their own invitation and nothing else, and
  a `BandAdmin` sees their own band's invitations and nothing else.
- Both reference apps' `modelVersion` and `modelFingerprint` must be
  **measured** — Giggle Band moved by exactly one hop, Jointly Care
  byte-identical — the way Phase 100 measured them, not assumed from which files
  were edited.
- Every `.adlj` fragment must go through `compileAdlProjectV2` with
  `diagnostics: []` before it is committed (`AGENTS.md`).
- No existing test, conformance case or constraint may be weakened.
- Policy and command authorisation are authority-side claims, so at least one
  proof runs against real PostgreSQL under `tests/integration/`.
- **Every acceptance assertion below is a named pair.** Neither half may be
  dropped, and each negative half must be written first and **seen to fail**
  against the unmodified code, per `learnings/process/testing-expectations.md`.
  A negative assertion written after the fix passes the moment it is typed and
  nothing tells you whether it could ever fail.
- **Assert rendered values, never the absence of an exception.** This codebase
  degrades silently in both directions: a denied lookup returns the raw stored
  id and a denied read model can return an empty list. `expect(...).resolves`
  proves nothing here. Every negative half names the value that must be absent
  or the refusal reason that must be present.

## Acceptance Criteria

Named pairs. The left column is the assertion that something happens; the right
is the assertion that the matching thing does not. Both halves are named here so
the executing agent builds against both — a criterion written only positively
produces a positive-only suite however conscientious the executor
(`learnings/process/phase-execution.md`). Phase 102's
`expectFullDmlOnEveryProjectionTable` / `expectDdlAndTruncateRefused` is the
model.

Every negative half must be **seen red first**, against the unmodified code, and
its failure message recorded in the execution note.

### Pair A — the shell's `CONTEXT ALL` runtime context

- **A+ `expectContextAllViewContextCarriesGrants`.** For a caller holding one
  `pendingBandInvitation` grant and no membership, the context
  `resolveActiveViewContext` returns for a `CONTEXT ALL Band` view carries a
  `contextGrants` entry naming `pendingBandInvitation` and that band's id.
  Asserted on the entry, not on the array being non-empty.
- **A− `expectContextAllViewContextCarriesNoRoles`.** The same context's
  `contextRoles` is `[]`, and a `ROLE BandAdmin`-gated action evaluated against
  it — `revoke` on `SentBandInvitations` — is refused with a `PolicyDeniedError`
  naming the `search`/`update` action it was denied. Mutation-checked: making
  `resolveContextGrants` return role entries must turn **A−** red and leave
  **A+** green. Without this half, "resolve grants" is indistinguishable from
  "grant everything".

### Pair B — Jointly Care's dead button, with no model change

- **B+ `expectInviteeAcceptCommitsFromTheBrowser`.** In a real `<adl-app>`
  render of the **unmodified** Jointly Care model, the pending invitee navigates
  to `MyPendingInvites`, clicks `Accept`, and afterwards — read back through a
  `SystemAdmin` context, not out of the banner — `CircleInvite.Status` is
  `"accepted"` with a non-null `RespondedAt`, and `CircleMember` holds a row for
  that user in that circle.
- **B− `expectCoCarerSeesNoAcceptOnSomeoneElsesInvite`.** The co-carer — a real
  `CircleMember`, not the invitee — mounted on the same screen sees the invite
  row and **no** `Accept` or `Decline` button on it (`WHEN Invitee ==
RUNTIME.userId` is false), and a direct `AcceptCircleInvite` with that invite id
  from their context is refused, asserted on the refusal naming the
  `Invitee == runtime.userId` precondition. This is the standing negative; the
  seen-red-first run of **B+** against the pre-fix `data.ts` (expected:
  `Policy denied update on object 'CircleInvite' outside its runtime context
scope.`) is recorded in the execution note and is not a substitute for it.

### Pair C — Giggle Band, what the invitee's list contains

- **C+ `expectInviteeSeesTheirOwnInvitationRow`.** With no context selected,
  `My Invitations` renders exactly one row whose text contains `The Betas`,
  `BandMember` and the invitation's `SentAt` date.
- **C− `expectInviteeSeesNoOtherInvitations`.** That list's row count is exactly
  one; the rendered text contains neither the other band's name nor the seeded
  invitation's `InviteeEmail`; and the invitee's direct
  `search("BandInvitation", {}, ctx)` returns exactly one record, whose
  `meta.guid` is their own invitation's. Asserted on the ids, not on the count
  alone.

### Pair D — the band is named, and the record still is not readable

- **D+ `expectInvitationRowNamesTheBand`.** The row's rendered text contains
  `The Betas`, resolved through `display.Band`.
- **D− `expectInvitationRowLeaksNoBandRecord`.** The row's rendered text
  contains no `band-` substring, and the same caller's
  `runtime.read("Band", thatBandId, ctx)` is still refused with a
  `PolicyDeniedError`, and `Description` and `Biography` appear nowhere in the
  rendered output. This is the pair that proves
  `allowAuthenticatedReadBandName` grants a *field* and not a *record*; without
  **D−** the phase could ship a whole-record grant and every test would stay
  green. Mutation-checked: widening the rule to `ALLOW READ AUTHENTICATED` with
  no `FIELDS` must turn **D−** red and leave **D+** green.

### Pair E — accepting works, and confers nothing wider

- **E+ `expectAcceptMakesTheInviteeABandMember`.** After the click,
  `BandInvitation.Status` is `"Accepted"` with a non-null `RespondedAt`, and a
  `BandMember` row exists with that user, that band and `Role: "BandMember"`,
  all read back out of storage through a `SystemAdmin` context.
- **E− `expectAcceptConfersNoWiderInvitationAccess`.** After the click, the new
  member's `MyBandInvitations` does not include any other invitation that band
  has sent; no rendered row offers a `revoke` action; and a direct
  `RevokeBandInvitation` on another invitation of that band is refused with a
  `PolicyDeniedError`. Joining as a `BandMember` must not silently become
  joining as a `BandAdmin`.

### Pair F — the affordance's own gate, proved from the browser

The command's step preconditions (`Invitee == RUNTIME.userId`,
`Status == 'Pending'`) are the runtime's existing claim. These assertions prove
them **through the surface**, which is where a user meets them.

- **F+ `expectAcceptOfferedOnAPendingInvitation`.** The `Accept` button renders
  `visible: true, enabled: true` with `input: { Invitation: <that row's id> }`.
- **F− `expectAcceptAbsentOnANonPendingInvitation`.** With three further
  invitations seeded to the same person — `Accepted`, `Declined`, `Revoked` —
  none of them renders a row in `My Invitations` at all (the list's
  `FILTER Status == 'Pending'`), and invoking `AcceptBandInvitation` directly
  with each of those three ids is refused, asserted on the refusal naming the
  `Status == 'Pending'` precondition rather than on the call rejecting.
- **F− `expectAcceptAbsentOnSomeoneElsesInvitation`.** A `BandAdmin` viewing
  `My Invitations` sees their own band's pending invitations and **no** `Accept`
  button on any row they are not the `Invitee` of, and a direct
  `AcceptBandInvitation` with such an id is refused, asserted on the refusal
  naming the `Invitee == RUNTIME.userId` precondition.
- **F− `expectPendingGrantLapsesOnceAnswered`.** Once the invitation is no
  longer `Pending`, `listAvailableContexts("Band", …)` for a caller whose *only*
  route to that band was the grant no longer returns it. This is the paired
  negative for the `CONTEXT_GRANT`'s `WHEN Status == 'Pending'`, which today has
  no behavioural test in either direction (Scope, backfill item 3).

### Pair G — the person with nothing

- **G+ `expectStrangerSeesTheInvitationsEmptyState`.** A signed-in caller with
  no band and no invitation opens `My Invitations` and sees the declared
  `No invitations` empty state, and `executeReadModel("MyBandInvitations", …)`
  returns `rows: []`.
- **G− `expectStrangerReadModelRaisesNothingAndReturnsNoRow`.** The same call
  raises no `PolicyDeniedError` — the failure mode a `CONTEXT REQUIRED` read
  model would have produced — *and* the rendered output contains no `Accept`
  button and no invitation text from any other user. Both halves matter: an
  exception and a silently-populated list are opposite defects.

### Pair H — the onboarding affordance, pinned rather than left accidental

Measured (Evidence 1 and 5): because the grant makes a `Band` context available,
`createFirstBand`'s `VISIBLE WHEN CONTEXT Band UNAVAILABLE` hides "Create a
band" from an invitee. This phase does not change that rule — see Non-goals —
but it must stop being an accident nobody wrote down.

- **H+ `expectCreateBandOfferedToAPersonWithNoContext`.** A caller with no band
  and no invitation sees the `Create a band` control in the empty state.
- **H− `expectCreateBandHiddenFromAnInvitee`.** A caller whose only `Band`
  context comes from a `pendingBandInvitation` grant does **not** see it. If the
  owner decides that is wrong, the fix is a visibility predicate that
  distinguishes a granted context from a joined one, and it is a separate
  phase — see the Planning Handoff. Either way the behaviour is now asserted.

### Pair I — the `SEARCH` widening does not open a directory

- **I+ `expectBandAdminSearchesTheirOwnBandsInvitations`.** A `BandAdmin` with
  that band selected gets every invitation that band has sent.
- **I− `expectAuthenticatedSearchReturnsOnlyOwnInvitations`.** A signed-in
  caller who is neither an admin of any band nor the `Invitee` of any invitation
  gets a result containing zero records; no other person's `InviteeEmail`
  appears in any rendered surface for any of the three callers above; and a
  `BandAdmin` of the first band gets zero rows for the second band's
  invitation. Asserted on the returned record ids and on rendered email text,
  not on lengths alone.

### Pair J — the authority, against real PostgreSQL

- **J+ `expectInviteeAcceptCommitsThroughTheAuthority`.** An identity holding
  only a `Pending` invitation replays `AcceptBandInvitation` through a real
  `AuthorityService` over a real `PostgresObjectStorageBackend`; the accepted
  `BandInvitation` and the new `BandMember` are read back **out of
  `adl_authority_records`**, not out of the response.
- **J− `expectNonInviteeAcceptRejectedByTheAuthority`.** A different identity
  replaying the identical intent is rejected, **and** the invitation's row in
  `adl_authority_records` is byte-identical to before — same `revision`, same
  `record` — and no `BandMember` row was written. A rejection response with a
  committed write is the failure mode this half exists to catch.
- **J± `expectBootstrapCarriesTheInvitationAndNothingElse`.** Positive: the
  invitee's `bootstrap` includes their own `BandInvitation`. Negative: it
  includes no `Event`, `Song`, `Availability` or `BandMember` of that band, and
  contains no `@` — Phase 99's own bootstrap assertion, extended to the grant
  path.

### Pair K — conformance

- **K+** a `CONTEXT ALL` read model over a grant-reachable scoped object returns
  the row for a caller holding the grant and no role, and a command against that
  record is authorised.
- **K−** the identical model and caller with the grant's `WHEN` condition
  unsatisfied: the context is not available, the read model returns no rows, and
  the command is denied. Each case shown to **discriminate** — break one
  expectation, watch that case and only that case fail
  (`learnings/implementation/conformance-suite.md`).

### Pair L — model versions

- **L+ `expectGiggleBandAtOneNewVersion`.** Giggle Band is `1.13.0`, carries a
  `1.12.0 → 1.13.0` empty-object migration, and its real-browser
  persisted-state upgrade test seeds `1.12.0` state, loads the real app URL, and
  reads `1.13.0` back from the mounted `<adl-app>`'s own `model.modelVersion`.
- **L− `expectJointlyCareUnmoved`.** Jointly Care's `modelVersion` **and**
  `modelFingerprint` are byte-identical to their pre-phase values, measured the
  way Phase 100 measured them rather than assumed from which files were edited,
  and its persisted-state upgrade test is unmodified and still passes. This is
  the assertion that Part 1 is a platform fix: if Jointly Care's fingerprint
  moved, something was fixed in its model instead of in the shell.

### No meaningful negative counterpart

Two deliverables have none, and this is a disclosure rather than an exemption
(`learnings/process/testing-expectations.md`):

- **The `docs/spec/runtime-semantics.md:611` wording correction.** Prose. There
  is no test that a sentence is right; the pair that gives it teeth is **A+/A−**,
  which is what the corrected sentence describes.
- **The three learnings updates.** Same reason.

### Suite-level

- `npx tsc --noEmit`, `prettier --check`, `npx vitest run` (baseline **1,212**
  across 64 files, plus this phase's cases), the conformance suite,
  `npx vitest run --config vitest.integration.config.ts` (baseline **169**
  across 17 files, plus this phase's cases), `npm run verify:push` with the
  screenshots inspected, and an `/impeccable audit` pass on the new screen — all
  clean, with no test weakened.
- `git diff --stat` touches no file under `src/parser/`,
  `src/model/resolved-model/`, `src/compiler/print-adl.ts` or
  `src/model/adlj-schema.json`. **No language change shipped.**

## Testing

The measurement harness this document was written with is the starting point,
not a substitute. It was five throwaway files, all deleted: a runtime-level one
over `createBandReferenceRuntime` / `seedBandReferenceRuntime` plus a hand-built
invitee `RuntimeContext`; a browser-level one mounting `<adl-app>` under
`@vitest-environment happy-dom` and driving `button[data-shell-menu='true']`,
`button[data-view-nav='…']` and `button[data-presentation-action='true']` by
`.click()`; a cause-isolation one comparing a roles-only context against a
roles-plus-grants one; and a prototype one that patched the two `.adlj`
documents as JSON and recompiled them through `compileAdlProjectV2`. Note that
`console.log` is swallowed by this project's vitest configuration — the harness
appended to a file instead.

**Order.** The three backfill pairs named in Scope go in first, red, against the
unmodified tree. Then Part 1. Then Part 2's pairs.

- **Unit** (`npx vitest run`; baseline **1,212** across 64 files).
  - Shell: Pair A, in a new test file beside `tests/ui-onboarding.test.ts` or
    within it. Both halves; **A−** is the one that keeps **A+** honest.
  - `tests/jointly-reference-app.test.ts`: Pair B. Its existing runtime-level
    accept case stays and is not weakened; the browser-level pair is added
    beside it.
  - `tests/band-reference-app.test.ts`: Pairs C, D, E, F, G, H, I, L+.
  - `tests/jointly-reference-app.test.ts`: L−.
- **Conformance.** Pair K, in `conformance/runtime/context-grants.json`. The
  conformance runner and case schema are a shared spine and stay serial.
- **Integration** (`--config vitest.integration.config.ts`, real PostgreSQL;
  baseline **169** across 17 files). Pair J. Model the file on
  `tests/integration/authority-self-service-registration.test.ts`, which already
  loads the real Giggle Band model through `loadAuthorityModel` and drives a
  real socket — a literal fixture model would prove the criteria about a
  fixture. Docker required, or `ADL_TEST_DATABASE_URL`.
- **Playwright / `verify:push`.** A new screen and a new nav item, so this is
  mandatory. `tests/visual/giggle-band.visual.spec.ts` gains the persisted-state
  upgrade case (L+) and desktop + mobile screenshots of `MyBandInvitationList`.
  `tests/visual/jointly-care.visual.spec.ts:19`'s `my-invites` page gains a
  click on `Accept` and an assertion on the resulting state — closing backfill
  item 2's visual half. Inspect every generated screenshot.
- **Design review.** `/impeccable audit` on the new view and the changed shell
  path, per `AGENTS.md`. Phase 99 shipped without one and recorded it as an
  outstanding obligation; do not repeat that.
- **Mutation checks.** Each must turn a *specific, different, named* assertion
  red, and the others green:
  - remove the `resolveContextGrants` call → **B+**, **E+**, **J+** red;
    **A−** green.
  - make `resolveContextGrants` return `roleEntries` → **A−** red, **A+** green.
  - remove `allowAuthenticatedSearchInvitations` → **C+** red, **I−** green.
  - widen `allowAuthenticatedReadBandName` to a whole-record rule → **D−** red,
    **D+** green.
  - remove the list's `FILTER Status == 'Pending'` → **F−** red, **F+** green.

## Parallel Execution Plan

The serial spine is genuinely serial: Part 2's pairs cannot pass until Part 1
lands, and Part 1's proof is a Jointly Care pair that touches no model.

1. **Serial spine, no consumers.** The three backfill pairs from Scope, written
   red. Then Pair B− and Pair B+ observed red, with their messages recorded.
   Then the `data.ts` change. Then `npx vitest run` — the whole suite, because
   this branch is on the path of every `CONTEXT ALL` screen in every app and the
   regression surface is the shell, not one view. This is the barrier;
   everything after it receives a working shell context rather than a predicted
   one.
2. **Then parallel**, three streams over disjoint files:
   - `domain.adlj` — the two policy rules, the read model, the version hop and
     the migration entry, with `compileAdlProjectV2` diagnostics checked;
   - `docs/spec/runtime-semantics.md` + the three learnings documents;
   - the integration test for Pair J (its own throwaway PostgreSQL, no shared
     fixture).
3. **Then serial again**, because these are the repository's known
   write-contention points: `ui.adlj` (the view *and* the `SHELL NAV` item are
   the same file, and the shell is shared chrome), then
   `tests/band-reference-app.test.ts`, then
   `conformance/runtime/context-grants.json`.
4. **Barriers.** `npx vitest run` after (1) and again after (3).
   `npx vitest run --config vitest.integration.config.ts` **once**, after (3) —
   concurrent runs are safe but each provisions its own throwaway PostgreSQL.
   `npm run verify:push` **exactly once**, at the very end; its screenshot pass
   is the slowest step and its inspection is manual.

Not touched, so the usual serialisation does not apply: `src/index.ts`,
`src/ui/components/register.ts`, the ordered migration SQL, the parser, the
printer and the `.adlj` schema.

## Tasks

1. Write the three backfill pairs named in Scope, against the unmodified tree.
   **A+** and **A−** will both fail (no such resolution, no such test); **F−
   `expectPendingGrantLapsesOnceAnswered`** should pass immediately — if it does
   not, that is a second defect and it is reported, not absorbed.
2. Write Pair B and observe **B+** red with
   `Policy denied update on object 'CircleInvite' outside its runtime context
scope.` Record the message verbatim.
3. Change `resolveActiveViewContext`'s `mode: "all"` branch to resolve context
   grants alongside roles, from the same
   `baseRuntimeContextWithoutSelected(contextName)` the roles come from. Make
   **B+** pass with **no `.adlj` edit**. Run the whole unit suite.
4. Run the Pair A mutation check (grants→roles) and the Pair B removal check.
5. Add `allowAuthenticatedSearchInvitations` and
   `allowAuthenticatedReadBandName` to `domain.adlj`; prove Pair I both ways
   before any UI exists.
6. Add `READ_MODEL MyBandInvitations`; bump `modelVersion` to `1.13.0` and add
   the empty-object migration hop; compile-check with `compileAdlProjectV2` and
   assert `diagnostics` is `[]`.
7. Add `VIEW MyBandInvitationList` and its `SHELL NAV` item to `ui.adlj`;
   compile-check; make Pairs C, D, E, F, G, H pass.
8. Add Pair K to the conformance corpus and show each case discriminates.
9. Add Pair J against real PostgreSQL, including the bootstrap halves.
10. Add L+ (Giggle Band's persisted-state upgrade case and the two screenshots)
    and L− (Jointly Care measured unmoved and untouched).
11. Run the remaining mutation checks and confirm each turns a different named
    assertion red.
12. Correct `docs/spec/runtime-semantics.md:611` and update the three learnings
    documents — including the finding that a shipped reference app rendered a
    button that could never work, that two runtime paths answered the same
    context question differently for four phases, and that the branch responsible
    could be rewritten without a single assertion moving.
13. `tsc`, `prettier --check`, unit, conformance, integration, `/impeccable
audit`, `npm run verify:push` with screenshots inspected. Commit; push.

## Planning Handoff

**Next phase: Phase 106 — a registered person has a `User` record, so their name
renders.** It is the only remaining defect that a person using either shipped
application sees about *themselves*, on the first screen, every time; Phase 99's
execution note nominated it and nothing since has displaced it. This phase makes
the case stronger rather than weaker: after it, a newly-registered person can
actually get into a band, at which point the member list they land on shows them
a raw `user-…` id where their own name belongs.

Candidates that surfaced here and were not taken:

- **`DeclineBandInvitation`.** Giggle Band has no way to say no. The object
  already models `Status: 'Declined'` and its
  `respondedAtRequiredAfterResponse` validation already anticipates the
  transition; only the command and the second row action are missing. Small, and
  a product decision rather than a platform one.
- **A visibility predicate that distinguishes a granted context from a joined
  one.** Pair H pins today's behaviour: an invitee is denied the "Create a band"
  affordance because a grant made a `Band` context *available*. `CONTEXT X
UNAVAILABLE` cannot express "available, but only because somebody invited me",
  even though `RuntimeAvailableContext` already keeps `roleEntries` and
  `grantEntries` separate for exactly this reason. Small, and it is the second
  time this phase has met the roles/grants distinction being collapsed at the
  shell boundary.
- **Presentation diagnostics leak internal names to users.** An invitee's Home
  dashboard today reads `List 'PendingInvitations' could not bind source
'PendingInvitations'.` Half of that stops appearing after this phase and the
  other half (`HomeUpcomingEvents`, a correct refusal) does not. A denied read
  model should render its list's declared `emptyState`, not a diagnostic naming
  a construct the person has never heard of. Worth a small phase of its own; it
  touches every application at once.
- **`requireObjectScopeForSearch` and `sourceCanSearchScopedObject` disagree.**
  `read-model-service.ts:327-342` returns `true` for an `allAvailableContexts`
  source with no reachable context, and `:309` then throws for the same caller.
  Today the throw is unreachable in both reference apps because
  `hasNoAvailableAllContext` short-circuits first; a `CONTEXT REQUIRED` or
  `CONTEXT NONE` read model over an `allAvailableContexts` source would reach
  it. Noticed while measuring Evidence 12; not measured as a live failure, and
  named here so it is not rediscovered from scratch.
- **A read principal for "a grant admits me to this context".** Jointly Care's
  `MyPendingCircleInvites` comment states it plainly: no policy vocabulary
  expresses "may read because a grant admits me here", so a pending invitee
  cannot read the context's own root object. This phase routes around it with
  Phase 101's field-scoped grant, which is honest and narrow. The general
  construct remains unbuilt and remains a real gap.
