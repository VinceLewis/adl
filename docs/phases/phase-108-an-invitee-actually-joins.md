# Phase 108 — An Invited Person Actually Joins, Against a Real Server

Phase 105 fixed the shell. Jointly Care's `Accept` button now works in a real
`<adl-app>` render over a seeded local runtime, and Giggle Band gained the
invitee surface it never had. Against a real deployment the flow still does not
work, and Phase 105 measured why: two independent blockers, in two different
layers.

This phase closes both, and the thing it delivers is the sentence neither half
can deliver on its own:

> A person who has been invited to a band or a care circle, and belongs to
> nothing, opens the application on a real device talking to a real server,
> finds their invitation, clicks **Accept** once, and is a member — with the
> membership row in the server's own storage, not in a banner.

**A language change is required**, and this document establishes that by
compiling and running every existing alternative rather than by reading the
grammar (Evidence 4). The new construct is a policy principal spelled
`CONTEXT_GRANT` in `.adl` and `{ "match": "contextGrant" }` in `.adlj`.

> **Phase numbers are no longer execution order in this repository.** This
> document executes after Phase 105 and **before** Phase 106 (the missing `User`
> record), on the owner's instruction that finishing something half-built beats
> starting something new.

## Objective

Close both remaining blockers in the invitation flow and prove the whole path
end to end, in a real browser, against a real authority, with the result read
back out of the server's storage:

1. **The click is refused on delivery.** A `CONTEXT ALL` screen holds no context
   selection, so the queued operation records `selectedContexts: {}` and the
   authority's deliberately narrow replay resolution refuses the write.
2. **The row never reaches the device.** `bootstrap` selects records by read
   policy, and no policy vocabulary can say "a grant admits me to this context",
   so the context's own root record never travels, `mergeGrantedContexts`
   reports no available instance, and the screen shows an empty state instead of
   an invitation.

## One phase, not two — and why, from measurement

The two blockers are independent mechanisms in different layers, which is a
real argument for two documents. The measurement below rules it out.

**Blocker 1 has no reachable trigger until blocker 2 is closed.** Measured
(Evidence 3): on a device that bootstrapped from a real authority with the
shipped Giggle Band model, `listAvailableContexts("Band")` is `[]`, the
`CONTEXT ALL` view context carries no grants, and
`executeCommand("AcceptBandInvitation", …)` is refused **locally**:

```
Policy denied update on object 'BandInvitation' outside its runtime context scope.
```

Nothing is queued, so there is nothing to deliver and nothing for a fix to
change. A Phase 108 that shipped blocker 1 alone would ship a change whose only
possible proof is a hand-built context over a fully-seeded local runtime — the
exact shape Phase 105 identified as proving nothing
(`tests/band-reference-app.test.ts`, its Evidence 4).

**Blocker 2 alone is worse than the status quo.** Measured (Evidence 5): with
the read principal in place and nothing else, the row and the enabled `Accept`
button appear, the command commits locally, and the replay is refused
`ADL_POLICY_DENIED / Policy denied update on object 'BandInvitation' outside its
runtime context scope.` with nothing written. That is Phase 105's shipped defect
reproduced one layer out, in front of a person who now has a button to press.

So neither half is independently shippable with a proof, and neither is
independently reachable in a shipped application. One document, one end-to-end
acceptance test.

**This also corrects a claim in the current learnings.**
`learnings/implementation/context-grants-and-relationship-access.md` says *"an
invitee's `Accept` commits locally and is refused on delivery in any deployment
that has an authority"*. Measured false for a real device: the local execution
is refused too, with the same message, because the grant never resolves. The
sentence is true only of the seeded demo runtime, where every record exists
locally. Correcting it is in scope.

## Evidence and Dependency

Everything below was **measured** against the working tree at `d8dd81d` —
throwaway vitest files for the runtime claims, `tests/integration/`-shaped files
against a real throwaway PostgreSQL for every authority, replay, projection and
bootstrap claim, and the Phase 105 `invitation` Playwright project against a real
authority in a real browser for the rendering claims. Prototypes of both fixes
were built, measured, and reverted; the tree is unmodified by this document, and
`npx tsc --noEmit`, `npm run format:check` and `npx vitest run` (67 files /
1,284 tests) were re-run afterwards to prove it. Claims that could not be
measured are marked **inferred**.

The probe files were deleted. Their shapes are described in Testing so they can
be rebuilt.

### 1. Both blockers, reproduced against real PostgreSQL

The shipped Giggle Band model, a real `AuthorityService` over a real
`PostgresObjectStorageBackend`, a founder who creates a band and sends an
invitation, and an invitee who is a member of nothing:

```
invitee  bootstrap: ["BandInvitation:invitation-1"]
stranger bootstrap: []
founder  bootstrap: ["Band:band-1","Band:band-2","BandInvitation:invitation-1",
                     "BandMember:member-founder","BandMember:member-founder-2","Song:song-1"]
```

The invitation travels. **The band does not.** `bootstrap` filters candidates
through `runtime.read`, and `allowAuthenticatedReadBandName` is field-scoped by
design (Phase 101's construction), which a whole-record read cannot match.

That is blocker 2. Blocker 1 is pinned already by Phase 105's
`expectContextAllIntentWithNoSelectionIsRejectedByTheAuthority`
(`tests/integration/authority-invitation-accept.test.ts:320`), re-run here and
still red-by-design.

### 2. The refusal on the context's own record is *policy*, not the scope gate

This is the finding that decides where the fix goes, and it contradicts the
natural reading of `context-grants-and-relationship-access.md`'s opening section
("check the scope gate before checking the rule").

Measured, invitee context, both reference applications:

```
runtime.read("Circle", <the circle they are invited to>, inviteeCtx)
  → PolicyDeniedError: Policy denied read on object 'Circle'.
    reasons: [{ policyName: "CircleDefaultDeny",
                message: "No policy rule allowed read; default deny applies." }]

runtime.read("Band", <the band they are invited to>, inviteeCtx)
  → PolicyDeniedError: Policy denied read on object 'Band'.
    reasons: [{ policyName: "BandDefaultDeny", … }]
```

Compare the same caller reading the invitation itself with no selection:

```
runtime.read("BandInvitation", <their own invitation>, inviteeCtx)
  → policyName: "BandInvitationContextScope", ruleName: "requireRuntimeContextScope"
```

Two different layers, two different refusals. The context's own bound object is
**not** scope-gated for its own context, so nothing but a policy rule stands
between a grant-holder and the record. A policy principal is therefore
sufficient, and no change to `context-scope.ts` is needed.

Also measured, and useful: `runtime.readFieldsForDisplay("Band", …, ["Name"], …)`
**does** return `{ Name: "The Betas" }` for the same caller. Phase 101's
field-scoped grant works for a label and cannot work for `bootstrap`. Both
statements are true simultaneously, which is exactly why this was invisible.

### 3. Blocker 1 is unreachable on a real device today

A real device (`ApplicationRuntime` over `InMemoryObjectStorageBackend`) that
bootstrapped as the invitee from a real `AuthorityService` over real PostgreSQL,
with the **shipped** model:

```
device bootstrap applied: ["BandInvitation"]
device holds:             ["BandInvitation:invitation-1"]
listAvailableContexts(Band): []
view context grants:         []
local executeCommand: FAILED  Policy denied update on object 'BandInvitation'
                              outside its runtime context scope.
queued command selectedContexts: (nothing queued)
```

The command never executes, so nothing is queued and there is nothing to
deliver. See "One phase, not two".

### 4. No existing policy vocabulary can express it. Every candidate compiled and run

Each candidate was pushed onto Jointly Care's `CirclePolicy` as `.adlj`,
compiled through `compileAdlProjectV2` (**`diagnostics: []`** for every one that
compiled), seeded, and run for two callers against two circles. `invitee` holds
one `pendingCircleInvite` grant on circle 1 and nothing else.

| candidate rule on `Circle` | invitee → circle 1 | invitee → circle 2 | verdict |
|---|---|---|---|
| *(baseline, no extra rule)* | denied | denied | the defect |
| `ALLOW READ AUTHENTICATED` | **OK** | **OK** | works, and is a directory of every care circle for every signed-in stranger |
| `ALLOW READ AUTHENTICATED WHEN Owner == RUNTIME.userId` | denied | denied | the condition channel reads `record.values`; nothing there names the invitee |
| `ALLOW READ OWNER` | denied | denied | `meta.createdBy` is the circle's creator |
| `ALLOW READ SELF` | denied | denied | the record's id is a circle id, never a user id |
| `ALLOW READ AUTHENTICATED FIELDS Name` | denied | denied | a field rule cannot match a whole-record request (Phase 101, by design) |
| `ALLOW READ ROLE CircleMember` | denied | denied | an invitee holds no membership; a grant confers no role |
| `ALLOW READ CONTEXT_MEMBER Circle FIELD Owner` | denied | denied | matches the *co-carer* (both circles), never the invitee: `resolveContextMembers` counts membership only, so a grant-holder is nobody's co-member |

Exactly one existing principal admits the invitee, and it admits everybody to
everything. **The vocabulary gap is real and measured**, not argued from the
grammar. This is what Jointly Care's `MyPendingCircleInvites` comment has said
since Phase 79.

### 5. The proposed principal was prototyped, and it works — measured at four levels

A prototype added `"contextGrant"` to `PrincipalMatch`, one `case` in
`principalMatches`, one enum member in `adlj-schema.json`, one printer branch and
one parser branch. Semantics: *the request's record **is** a business context's
own bound object record, and the caller's `contextGrants` admit them to that very
instance*.

**Runtime.** Jointly Care, `ALLOW READ CONTEXT_GRANT` on `CirclePolicy`:

```
READ invitee circle1(invited): OK  {"Name":"Mum's Care Circle", …}
READ invitee circle2(not):     DENIED  Policy denied read on object 'Circle'.
READ outsider circle1:         DENIED
READ outsider circle2:         DENIED
READ invitee, grants NOT resolved onto the context: DENIED   ← fails closed
SEARCH invitee:                DENIED  Policy denied search on object 'Circle'.
```

**Bootstrap, real PostgreSQL.** Giggle Band, `ALLOW READ CONTEXT_GRANT` on
`BandPolicy`:

```
invitee  bootstrap: ["Band:band-1","BandInvitation:invitation-1"]
stranger bootstrap: []
invitee's Band record: {"Name":"The Alphas","CreatedBy":"user-founder","Description":null}
```

Exactly the one band the grant admits. `band-2` does not travel. Nothing else
scoped to `band-1` travels either — no `Song`, no `Event`, no `BandMember`.

**And it does not close blocker 1.** With the read principal in place, the same
invitee replaying the identical accept with `selectedContexts: {}`:

```
{"code":"ADL_POLICY_DENIED","status":"rejected",
 "message":"Policy denied update on object 'BandInvitation' outside its runtime context scope."}
```

and with the band named, `accepted`. Two independent blockers, confirmed.

**Language surface.** `.adlj` `{ "match": "contextGrant" }` prints as

```adl
  RULE allowGrantedContextRead ALLOW READ CONTEXT_GRANT
```

and `compileAdl` reparses that text with **`diagnostics: []`** — against a model
that *also* declares a real `CONTEXT_GRANT pendingCircleInvite ON Circle`, so
the keyword reuse is measured non-ambiguous, not assumed.

### 6. Widening `tsc` finds exactly one consumer, again

Adding `"contextGrant"` to `PrincipalMatch` produced exactly **one** production
type error: `src/compiler/print-adl.ts:1852`, `printPrincipal` lacking an ending
return. Identical to Phase 103's measurement, and identical to its warning: the
parser assigns from string literals, the validator compares with `===`, and the
schema is generated. **Enumerate consumers by search, not by compiler error.**

The full surface, from the Phase 103 commit (`e038b37`) plus this prototype:
`src/model/resolved-model/policy.ts` (the union), `src/parser/ast.ts:1088-1095`
(the union, **duplicated as string literals** and invisible to `tsc`),
`src/parser/grammar/policy.ts:29-47` (`FIELD_LIST_STOP_WORDS`), `:151-186` (the
keyword branch and the `failUnexpected` message), `src/compiler/print-adl.ts:1852`
(`printPrincipal`) **and `:1799-1816` (`POLICY_RULE_LIST_STOP_WORDS`, see
Evidence 9)**, `src/model/adlj-schema.json` (generated),
`src/compiler/validate-model/{codes,policy}.ts`, `src/runtime/policy-engine.ts`.

### 7. The narrow selection capture works, and the obvious wider version breaks `CreateBand`

The candidate shape Phase 105's handoff proposed — the operation records the
instance the row belongs to — was prototyped in `OperationLog.record`, which is
the one place every operation kind passes through and which already holds the
written record and the context.

The rule that was measured: *if the written object is context-scoped, the
caller's selection names no instance for that context, and the record's scope
field holds an instance `getAllowedContextIds` already reports for this caller,
record that instance.*

```
AcceptCircleInvite from a CONTEXT ALL context → {"Circle":"circle-…"}
CreateCircle outside any context              → {}
```

**The guard is load-bearing and the naive version is a real regression.**
Measured: `CreateCircle`'s single queue entry carries `command.records` naming
both the new `Circle` *and* the `CircleMember` scoped to it. A derivation that
looked at every written record would name a circle that does not exist at the
authority when the intent replays, and `withSelectedContext` would reject it
`ADL_RUNTIME_CONTEXT_ERROR` — precisely the defect
`command-intent-replay.md` records Phase 57 fixing. `establishesContext` adds its
grant to the *in-flight step* context, so the outer context this check reads
does not report the new instance, and the entry stays `{}`.

`tests/authority-sync-client.test.ts`'s four selection cases stay green under the
prototype, for that reason: the two "outside any context" cases (`:938`, `:950`)
because the caller can reach no instance, and the two legacy-fallback cases
(`:962`, `:976`) because they carry no captured selection at all.

### 8. Neither prototype is detected by a single existing test

With **both** prototypes applied:

```
npx vitest run                                    67 files / 1,284 tests passed
npx vitest run --config vitest.integration.config.ts  20 files / 190 tests passed
```

The current baselines exactly. Two behavioural changes — one to the policy
vocabulary, one to what every queued operation records — and nothing anywhere
moves. That silence is the same silence
`context-grants-and-relationship-access.md` already names as the Phase 105
defect's life support, and it is why the backfill in Scope goes in first.

### 9. `POLICY_RULE_LIST_STOP_WORDS` already diverges from the parser's set

`src/parser/grammar/policy.ts:29-47` includes `"SELF"`;
`src/compiler/print-adl.ts:1799-1816` does not. A field, state or role literally
named `Self` would be printed unquoted by `printPolicyRuleListName` and reparse
as the principal keyword — the round-trip defect the comment above that set was
written about, for Giggle Band's field named `Role`. Phase 103 added the keyword
to one set and not the other. Not a live defect in any shipped model
(**inferred** — no model declares such a name; the compiler does not check it),
and this phase must not add a second instance of it.

### 10. Removing Phase 105's `allowAuthenticatedReadBandName` is a real narrowing

Measured, with the grant principal in place, Giggle Band:

| | `MyBandInvitations` row for the invitee | a signed-in stranger's `readFieldsForDisplay("Band", …, ["Name"])` |
|---|---|---|
| `allowAuthenticatedReadBandName` kept | `display.Band = "The Betas"` | `{ "Name": "The Alphas" }` |
| `allowAuthenticatedReadBandName` removed | `display.Band = "The Betas"` | `null` |

The invitation row still names the band, and the band-name directory Phase 105
opened for every signed-in user closes. The grant principal grants the row for
one instance, which is strictly narrower than a field for all of them.

### 11. The grant's lifetime is the read's lifetime

Measured, Jointly Care, with the principal in place, before and after the
invitee declines:

```
before:  grants: [{ context:"Circle", contextId:"circle-…", grant:"pendingCircleInvite", … }]
         READ Circle1: { Name: "Mum's Care Circle", … }
after:   grants: []
         READ Circle1: DENIED  Policy denied read on object 'Circle'.
         listAvailableContexts("Circle"): []
```

The `CONTEXT_GRANT`'s own `WHEN Status == 'pending'` is what expires it. The
read cannot outlive the grant, because it *is* the grant.

### 12. Both fixes together: the whole flow, in a real browser, against a real authority

The Phase 105 `invitation` Playwright project (port 5473, authority 8790),
Jointly Care patched with the one policy rule and nothing else, both prototypes
applied. Signed in as the invitee, who is a member of nothing:

```
listAvailableContexts("Circle"):
  [{ context:"Circle", id:"circle-224d…", label:"Mum's Care Circle",
     roles:[], roleEntries:[],
     grantEntries:[{ grant:"pendingCircleInvite", grantRecordId:"circleinvite-d15d…" }] }]

SHELL: … Circle | Choose Circle | Mum's Care Circle | Online | Synced …
       Your pending invites | alex@example.com |  - invited  | Fri 14 Aug | Accept |   | Decline

presentation actions: 2
  action: accept  enabled=true  input={"Invite":"circleinvite-d15d…"}
  action: decline enabled=true  input={"Invite":"circleinvite-d15d…"}

AFTER CLICK: … Accept invite completed. … Your pending invites | No pending invites

authority invite status:    accepted
authority invitee is member: true
```

The last two lines are read out of the **authority's own storage**, not out of
the banner. This is the phase's Objective, measured.

Separately measured on the real-PostgreSQL device probe, the same flow end to
end with the Giggle Band model:

```
device bootstrap applied: ["Band","BandInvitation"]
listAvailableContexts(Band): [{ … grantEntries:[{ grant:"pendingBandInvitation", … }] }]
queued command → intent: { kind:"command", commandName:"AcceptBandInvitation",
                           selectedContexts:{ Band:"band-1" } }
AUTHORITY ROWS:
  BandInvitation:invitation-1  { …, "Status":"Accepted", "RespondedAt":"2026-08-21", … }
  BandMember:bandmember-54f0…  { "Band":"band-1","Role":"BandMember","User":"user-invitee", … }
```

### 13. The evidence layer cannot see a rejected replay, and this phase needs it to

Measured directly from the `authority.jsonl` the `invitation` project's evidence
recorder produced for a run containing two replays, one of them rejected:

```
1 authority_request_rejected / denied  / /v1/session/current  / unauthenticated
1 authority_request_rejected / denied  / /v1/sync/bootstrap   / unauthenticated
2 http_request               / allowed / /v1/sync/replay      / —
…
```

A policy rejection is HTTP 200 with a rejection body, so the security log's
`denied` outcomes are transport-level only and `expectAuthorityDenied` cannot
see it. Phase 105 recorded this and worked around it with a raw `page.request`
post that asserts the response body. This phase's browser negatives need the
server's own record of a refusal — the only thing that distinguishes a hidden
control from an enforced one (`process/testing-expectations.md`) — so closing
the gap is in scope. See Pair M.

### 14. Inferred, not measured

- **An in-flight `establishesContext` grant and the new principal.** A command's
  create step adds a `RuntimeContextGrant` to the in-flight step context; whether
  a later step of the same command can therefore read the context record it just
  created through a `CONTEXT_GRANT` rule was not measured. Neither reference app
  declares such a rule on a context created by a command, so nothing today
  depends on the answer. Named in Testing as a case the phase must measure.
- **`docs/spec/resolved-model.md:157`.** It still lists the principals without
  `self`; Phase 103 missed it. That it is *only* stale (rather than wrong about
  something else) is inferred from reading it.
- **Whether any shipped model declares a field, state or role named `Self` or
  `ContextGrant`.** Not measured across `examples/`; Evidence 9's divergence is a
  latent round-trip trap, not an observed failure.

**Dependency:** Phase 105 (the shell's `CONTEXT ALL` grant resolution, the
`invitation` Playwright project, and the integration case that pins blocker 1),
Phase 103 (the principal-shaped surface this copies line for line), Phase 101
(the field-scoped grant this **replaces** in Giggle Band), and Phase 102's
evidence-gate machinery for Pair M.

## Decision

Two changes, and they ship together for the reason argued above.

### Part 1 — a `CONTEXT_GRANT` policy principal

```adl
POLICY CirclePolicy ON Circle
  RULE allowGrantedContextReadCircle ALLOW READ CONTEXT_GRANT
END.POLICY
```

`.adlj`: `{ "match": "contextGrant", "roles": [], "groupRoles": [], "users": [],
"owner": false }`.

**What was and was not compile-checked.** The `.adlj` form was compiled through
`compileAdlProjectV2` against both real reference applications, `diagnostics: []`,
and run. The `RULE` line above is `print-adl.ts`'s own output for that `.adlj`,
and the whole printed document was fed back through `compileAdl` with
`diagnostics: []` — both **under the prototype**. Against the current tree the
keyword does not exist, so the snippet cannot compile today; that is a
specification, and `AGENTS.md`'s compile-check rule binds from Task 2 onward for
every example that reaches `docs/spec/*`. The block syntax matches the shipped
`SELF` example at `docs/spec/language.md:653-656` line for line.

**Semantics, one predicate.** The rule matches when the request carries a record,
that record's object is a declared business context's own bound `OBJECT`, and
the caller's `RuntimeContext.contextGrants` contains an entry for that context
naming that record's own id. Nothing else.

Five properties make this the right construction:

**It is the missing member of a family, not a new idea.** `OWNER` says "I made
this", `SELF` says "this is me", `CONTEXT_MEMBER` says "this belongs to somebody
I share a context with". `CONTEXT_GRANT` says "a grant admits me here". All four
answer "what is the caller's relationship to this record?", which is what a
principal is for.

**It reads what the runtime already resolved.** `contextGrants` is already on
`RuntimeContext`, already populated by `withSelectedContext`,
`resolveExecutionContext`, `resolveBootstrapContext` and the shell. Unlike
`CONTEXT_MEMBER`, which needed `withContextMembers`, this principal needs **no
new resolution step** — measured: the bootstrap path already carries grants, and
the rule fires there today.

**It grants exactly one instance, and only while the grant lasts.** Measured
twice: circle 2 and band 2 are refused (Evidence 5), and the read expires with
the invitation (Evidence 11).

**It cannot reopen the user directory Phase 101 closed.** Measured (Pair N's
evidence): `ALLOW READ CONTEXT_GRANT` added to Jointly Care's `User` policy
grants the invitee nothing — not the carer's record, not the co-carer's, not
their own — because the `User` context declares no `grants` and the principal has
nothing to match. And `search` stays refused even under a wildcard rule
(Evidence 5), so there is no request shape in which it enumerates.

**It replaces a wider rule rather than adding to one.** Giggle Band's
`allowAuthenticatedReadBandName` goes away (Evidence 10).

Two diagnostics ship **with** the principal, not after somebody trips over them —
the discipline Phase 103 set and Phase 93 earned:

- **`ADL_POLICY_CONTEXT_GRANT_SEARCH_UNREACHABLE`**, modelled line for line on
  `ADL_POLICY_SELF_SEARCH_UNREACHABLE`
  (`src/compiler/validate-model/policy.ts:129-146`). The object-level search
  check is evaluated with no record, so the principal is dead there — measured,
  including under the discriminating `ALLOW * CONTEXT_GRANT` shape.
- **`ADL_POLICY_CONTEXT_GRANT_PRINCIPAL_UNREACHABLE`**, for a rule naming the
  principal on an object that is **no** business context's bound `OBJECT`. That
  is decidable from the model alone (`getBusinessContextsForObject` returns
  empty), unlike Phase 103's declined "unreachable object" check which would have
  rested on an assumption. Deliberately **not** extended to "the context declares
  no `CONTEXT_GRANT`": `ResolvedCommandCreateStep.establishesContext` adds a
  grant for a context that may declare none, so that half is not decidable.

### Part 2 — an operation records the context instance it landed in

`OperationLog.record` derives the selection under Evidence 7's rule. It is the
right place for three reasons.

**It is where the selection is already captured**, on every operation kind, for
the same reason: an operation replays against the state that was in force when it
was made. Phase 57 put the capture there and its own learning says the bug "was
never specific to commands".

**It records what happened rather than widening anything.** The instance is on
the record's own scope field, and the object-scope gate has already proved the
caller could reach it. The authority's narrow replay resolution is untouched —
`AuthorityService.resolveContext` still iterates `intent.selectedContexts` and
nothing else, and Phase 105's `expectContextAllIntentWithNoSelectionIsRejectedByTheAuthority`
must stay green, because an intent naming nothing must still be refused.

**The reachability guard is what makes it safe**, and it is measured (Evidence 7).

### Rejected alternatives

**Widen `AuthorityService.resolveContext`.** Rejected by Phase 105's own
Decision, and still right: it would authorise every command against a context
different from the one its own view was rendered with, on every channel.

**Derive the selection in the presentation action handler instead.** Phase 105's
handoff named it. Rejected on measurement: it fixes only presentation row
actions, while `OperationLog.record` fixes the same defect for a plain update or
delete from any cross-context surface, in one place, with one rule — and the
handler does not hold the row's record, only the `INPUT` the `ACTION` declared.

**Make `bootstrap` ship a granted context's root record regardless of policy.**
Cheaper-looking, and wrong twice: it would put a record on the device that the
device's own `runtime.read` then refuses, and it would make `bootstrap` the
second place in the system that decides what a caller may see.

**`ALLOW READ AUTHENTICATED` on `Circle`/`Band`.** Measured to work (Evidence 4)
and measured to be a directory of every circle and band for every signed-in
stranger. It is what "no language change needed" actually costs here.

**Give the principal parameters** — `CONTEXT_GRANT Circle GRANT pendingCircleInvite`,
parallel to `CONTEXT_MEMBER Band FIELD User`. `CONTEXT_MEMBER` needs them because
the co-member field is arbitrary; here the record *is* the context instance and
the context is derivable from the object. The bare form was measured working.
Named in the Planning Handoff as the extension to make if an application ever
declares two grants on one context and wants only one of them to admit a read.

**Spell it `CONTEXT_GRANTEE`.** Avoids reusing the declaration keyword, and reads
marginally better in English. Rejected because the principal's whole meaning is
"the `CONTEXT_GRANT` declaration admits me", naming it after that declaration is
how a reader finds it, and the reuse was measured unambiguous: a model that
declares `CONTEXT_GRANT pendingCircleInvite ON Circle` *and* uses
`ALLOW READ CONTEXT_GRANT` prints and reparses with `diagnostics: []`.

**Ship blocker 1 as its own phase first.** See "One phase, not two".

## Scope

- `src/model/resolved-model/policy.ts` — `PrincipalMatch` gains `"contextGrant"`,
  with the TSDoc the schema generator lifts.
- `src/parser/ast.ts:1088-1095` — the duplicated union. **`tsc` will not flag it.**
- `src/parser/grammar/policy.ts` — `FIELD_LIST_STOP_WORDS`, the keyword branch
  (via `matchUnderscoreOrDottedWord`, like its `CONTEXT_MEMBER` sibling), and the
  `failUnexpected` accepted-options string.
- `src/compiler/print-adl.ts` — `printPrincipal`'s branch **and**
  `POLICY_RULE_LIST_STOP_WORDS`, which must gain `"SELF"` as well (Evidence 9).
- `src/model/adlj-schema.json` — regenerated via `npm run generate:adlj-schema`,
  never hand-edited.
- `src/compiler/validate-model/{codes.ts,policy.ts}` — the two diagnostics.
- `src/runtime/policy-engine.ts` — one `case` and one predicate beside `isSelf`.
- `src/runtime/operation-log.ts` — the selection derivation.
- `src/reference/jointly-care/domain.adlj` — `CirclePolicy` gains
  `allowGrantedContextReadCircle`; `1.7.0 → 1.8.0` with an empty-object migration.
- `src/reference/giggle-band/domain.adlj` — `BandPolicy` gains
  `allowGrantedContextReadBand` and **loses** `allowAuthenticatedReadBandName`;
  `1.13.0 → 1.14.0` with an empty-object migration.
- `conformance/runtime/context-grant-principal.json` — **new**, modelled on
  `conformance/runtime/self-principal.json`; plus cases in
  `conformance/runtime/context-grants.json` for the selection capture.
- `tests/visual/support/{authority-log.ts,expect-absence.ts}` and the recorder —
  a replay's own outcome becomes an authority event (Pair M).
- `docs/spec/language.md` (the principal vocabulary), `docs/spec/adlj.md:175`
  (the mapping row), `docs/spec/runtime-semantics.md` (what it matches and when
  it cannot), and `docs/spec/resolved-model.md:157` — which must also gain
  `self`, missed by Phase 103.
- `learnings/implementation/{policy-engine,context-grants-and-relationship-access,
  command-intent-replay,remote-bootstrap-and-sync-state,context-ui-navigation}.md`.
- `learnings/index.md` — the "Before tasks that change business context/scope
  modelling…" and "Before tasks that change ADL lexer/parser syntax…" routes both
  need to name the new principal's documents, and
  `process/syntax-uniformity-and-behavioral-guardrails.md`'s "a parser keyword
  alias, … `CONTEXT_MEMBER` policy principals" route should name `CONTEXT_GRANT`
  too. This document deliberately does not edit the index: the executing agent
  makes that edit in the same pass as the learnings it points at, so the two
  cannot drift.
- Tests: unit, parser, printer round-trip, model validation, conformance,
  real-PostgreSQL integration, and the `invitation` Playwright project.

### Positive-only coverage this phase must backfill, first

`process/testing-expectations.md` requires the missing half to go in **before**
the change. Measured (Evidence 8): both prototypes leave 67 files / 1,284 unit
tests and 20 files / 190 integration tests entirely green. Three specific gaps:

1. **`OperationLog.record`'s selection capture has no case for a scoped write
   made from a de-selected context.** `tests/authority-sync-client.test.ts`
   covers "selection in force", "no selection at all", and "legacy entry" — never
   "a context the caller can reach that the selection does not name". Pair F's
   negative half is that case, and it must be seen red.
2. **`AuthorityService.bootstrap`'s read-policy selection of a *context root*
   record is tested in one direction only.**
   `expectBootstrapCarriesTheInvitationAndNothingElse`
   (`tests/integration/authority-invitation-accept.test.ts:357`) asserts the
   `Band` is absent. Nothing asserts that a policy which *does* admit it puts it
   on the device — so "bootstrap filters by read policy" and "bootstrap never
   ships a context record" are indistinguishable. Pair E+ is that case.
3. **`printPrincipal`'s stop-word set is untested against its parser twin.**
   Evidence 9: `SELF` is in one set and not the other, and no test noticed.
   Pair D− covers both keywords and the divergence is fixed in the same pass.

## Non-goals

- **No change to `AuthorityService.resolveContext`.** The narrow replay
  resolution stays exactly as it is, and Phase 105's case pinning it stays green.
- **No change to `getAllowedContextIds`, `context-scope.ts`, or the object-scope
  gate.** Evidence 2 shows none is needed.
- **No `contextMember.field: "id"`.** Still the other unbuilt extension, still a
  different question.
- **No parameters on the new principal.** Named in the handoff.
- **No `DeclineBandInvitation`.** Giggle Band still cannot say no; Jointly Care
  can. Unchanged by this phase and still on the handoff list.
- **No `User` record for a registered person.** That is Phase 106, which this
  phase makes more urgent rather than less: the member list an invitee now lands
  on shows them a raw `user-…` id.
- **No demo seed that arrives as an invitee.** Named in Phase 105's handoff and
  still open; it would make this feature visible in `npm run test:visual`.
- **No fix for the presentation diagnostics that leak internal names.**
- **No widening of the principal to objects *scoped to* a granted context.**
  `ALLOW READ CONTEXT_GRANT` on `Event` must be a compile error, not a grant over
  every event of a band you were invited to.

## Constraints

- **Both blockers must be closed, and each must be shown to be independently
  insufficient.** The two "one alone is not enough" measurements (Evidence 3 and
  Evidence 5) become assertions, not just prose.
- **Every negative half is written first and seen red against the unmodified
  tree**, and its failure message recorded verbatim in the execution note. A
  negative assertion written after the fix passes the moment it is typed.
- **Every absence assertion carries a present-anchor** *in the same assertion*.
  Named per assertion below. `expectAbsentWithin` and `expectRequestRefused`
  rather than a bare `toHaveCount(0)`.
- **Assert rendered values and named reasons, never the absence of an
  exception.** A denied read here returns `null`, a raw record id, or an empty
  list, depending on the path.
- **The wildcard shape is mandatory for the search negatives.** A model whose
  only `CONTEXT_GRANT` rules name `READ` proves nothing about `search`; the
  discriminating shape is `ALLOW * CONTEXT_GRANT`, which does name it, refused
  anyway, with a positive control on a record. This is Phase 103's measured
  vacuity, and it must not recur.
- **The new principal must fail closed** on an absent record, an empty `userId`,
  and a context whose grants were never resolved. All three measured working in
  the prototype; all three become assertions.
- **A grant must still confer no role.** `runtimeContextHasScopedRole` must still
  never read `contextGrants` after this phase.
- **Both reference apps' `modelVersion` and `modelFingerprint` must be
  *measured*** — each moved by exactly one hop — the way Phase 100 measured them.
  Both apps' persisted-state upgrade tests must be updated
  (`AGENTS.md`'s per-app rule; this is the failure mode that recurred four
  times).
- **Every `.adlj` fragment through `compileAdlProjectV2` with `diagnostics: []`
  before it is committed**, and every `.adl` example that reaches `docs/spec/*`
  through `compileAdl` the same way.
- **`adlj-schema.json` is regenerated, never hand-edited.**
- Policy, bootstrap and replay are authority-side claims, so the proofs run
  against real PostgreSQL under `tests/integration/`.
- No existing test, conformance case or constraint may be weakened. Phase 105's
  `invitation` spec asserts the defect; those assertions **change** because the
  behaviour changes, and each change must be justified in the execution note
  rather than deleted.

## Acceptance Criteria

Named pairs. The left is the assertion that something happens; the right is the
assertion that the matching thing does not. Both halves are named here so the
executing agent builds against both.

### Pair A — the principal admits exactly the instance the grant admits

- **A+ `expectGrantHolderReadsTheContextTheGrantAdmits`.** A caller holding one
  `pendingCircleInvite` grant and no membership reads the `Circle` record and
  gets `values.Name === "Mum's Care Circle"`. Asserted on the value, not on the
  call resolving.
- **A− `expectGrantHolderReadsNoOtherContextInstance`.** The same caller's read
  of the **second** circle is refused with a `PolicyDeniedError` naming
  `CircleDefaultDeny`, *and* A+'s successful read is asserted in the same test as
  the present-anchor, so "both denied" cannot pass. Mutation: making the
  predicate ignore `contextId` must turn A− red and leave A+ green.
- **A− `expectUnresolvedGrantsMatchNothing`.** A caller whose context carries no
  `contextGrants` (the bare shape a direct API call produces) is refused, with
  the same caller's grant-resolved read as the anchor. Fail-closed, proven.

### Pair B — it cannot enumerate

- **B+ `expectRoleHolderStillSearchesContexts`.** A `CircleMember` with the
  circle selected still searches `Circle` and gets that circle back, by id.
  Without this the whole pair is satisfied by "search is broken".
- **B− `expectWildcardGrantPrincipalStillRefusesSearch`.** A model declaring
  `ALLOW * CONTEXT_GRANT` — a rule that *does* name `search` — still refuses the
  grant-holder's `search`, while the same rule is proven live by a successful
  `read` on a record in the same test. Mutation: replacing the predicate with
  `return true` must leave B− green and turn A− red; replacing the recordless
  guard must turn B− red.
- **B− `expectGrantPrincipalOnSearchIsRefusedAtCompileTime`.**
  `ADL_POLICY_CONTEXT_GRANT_SEARCH_UNREACHABLE`, asserted by **code and path**,
  paired with a `READ` rule in the same model that produces no diagnostic.

### Pair C — a rule that could never fire is refused

- **C+ `expectGrantPrincipalOnAContextObjectCompilesClean`.** `CONTEXT_GRANT` on
  `Circle` / `Band` — objects that *are* a context's bound `OBJECT` — compiles
  with `diagnostics: []`.
- **C− `expectGrantPrincipalOnANonContextObjectIsRefused`.** The same rule on
  `Event` produces `ADL_POLICY_CONTEXT_GRANT_PRINCIPAL_UNREACHABLE`, asserted by
  code and path, with C+'s clean compile as the anchor. Mutation: removing the
  check must turn C− red and leave C+ green.

### Pair D — the language surface round-trips

- **D+ `expectContextGrantPrincipalRoundTrips`.** `.adlj`
  `{ "match": "contextGrant" }` prints as `ALLOW READ CONTEXT_GRANT` and
  `compileAdl` reparses that text with `diagnostics: []`, against a model that
  also declares a real `CONTEXT_GRANT` — so the keyword reuse is under test.
- **D− `expectPrinterEmitsNoEmptyPrincipal`.** Deleting the `printPrincipal`
  branch must fail this, not produce `ALLOW READ ` reparsing as `EVERYONE`
  (Phase 104's measured silent widening). Asserted on the printed text.
- **D− `expectPrincipalKeywordsAreNotSwallowedByAFieldList`.** A rule whose
  `FIELDS` list is followed by `CONTEXT_GRANT` parses as a principal, not as a
  field name — **and the same for `SELF`**, closing Evidence 9's divergence.
  Both sets asserted, with a control field name that *is* consumed as the anchor.
- **D− `expectUnknownPrincipalKeywordNamesTheAcceptedOptions`.** The
  `failUnexpected` message lists `CONTEXT_GRANT`. Asserted verbatim, as the
  existing `SELF` case does.

### Pair E — bootstrap carries the granted context and nothing else

Real PostgreSQL. Both halves in one test so the anchor is genuine.

- **E+ `expectBootstrapCarriesTheGrantedContextRecord`.** The invitee's
  `bootstrap` includes `Band:band-1`, and its `values.Name` is the band's name.
- **E− `expectBootstrapCarriesNoOtherBandAndNothingScopedToIt`.** The same
  response contains no `band-2`, no `Song`, no `Event`, no `Availability`, no
  `BandMember` and no other person's `InviteeEmail` — asserted by **exhaustive
  equality on the returned `{objectName, recordId}` list**, so absence is
  asserted rather than inferred, with E+'s record as the anchor. A stranger's
  `bootstrap` is `[]`.

### Pair F — the operation records its row's own context

- **F+ `expectContextAllRowActionRecordsItsRowsContext`.** A command executed
  from a `CONTEXT ALL`-shaped context queues **one** entry whose
  `selectedContexts` is `{ Circle: <that row's circle> }`, asserted on the id.
- **F− `expectAContextEstablishingCommandRecordsNoSelection`.** `CreateCircle` /
  `CreateBand` executed outside any context still queue `selectedContexts: {}`,
  with F+'s entry in the same test as the anchor. This is the regression Evidence
  7 measured the naive version causing. Mutation: dropping the
  `getAllowedContextIds` guard must turn F− red and leave F+ green.
- **F− `expectAnUnreachableContextIsNeverRecorded`.** A write whose record names
  a context instance the caller cannot reach records no selection for it.
- **F− `expectALegacyQueueEntryStillFallsBackToDrainTime`.**
  `tests/authority-sync-client.test.ts`'s four existing selection cases (`:938`,
  `:950`, `:962`, `:976`) stay green, unmodified. Named here so the executor does
  not "fix" them; an entry with no captured selection at all must still fall back
  to the drain-time one, and an entry made outside any reachable context must
  still carry `{}`.

### Pair G — the authority, real PostgreSQL

- **G+ `expectInviteeAcceptCommitsFromADeviceThroughTheAuthority`.** A device
  bootstraps as the invitee, executes the accept from a `CONTEXT ALL` context,
  drains through a real `AuthoritySyncClient`, and the accepted `BandInvitation`
  and new `BandMember` are read back **out of `adl_authority_records`**.
- **G− `expectContextAllIntentWithNoSelectionIsStillRejectedByTheAuthority`.**
  Phase 105's existing case, unmodified and still green: an intent naming no
  context is still refused `ADL_POLICY_DENIED / Policy denied update on object
  'BandInvitation' outside its runtime context scope.`, and the invitation row in
  `adl_authority_records` is byte-identical — same `revision`, same `record`. The
  fix is on the client, so this must not move.
- **G− `expectNonInviteeAcceptStillRejected`.** The stranger
  (`ADL_RUNTIME_CONTEXT_ERROR`) and the founding `BandAdmin`
  (`ADL_POLICY_DENIED` from the step guard) are both still refused, with no row
  written. Phase 105's existing case, still green.

### Pair H — the browser, end to end, against a real authority

The `invitation` Playwright project. This is the Objective's own assertion.

- **H+ `expectInviteeAcceptsInTheBrowserAndBecomesAMember`.** Signed in as the
  invitee: the context selector offers the circle; `My Invites` renders one row
  containing the invitee's email and the sent date; `Accept` renders
  `enabled=true` with `input: { Invite: <that row's id> }`; after the click the
  list reads `No pending invites`; and — read out of the **authority's own
  storage** — the invite is `accepted` and the invitee is a member.
- **H− `expectStrangerSeesNoInvitationAndNoContext`.** A signed-in identity with
  no invitation sees `No Circle contexts are available for this view.`, and
  `expectAbsentWithin` proves no `button[data-presentation-action='true']` exists
  **within that empty state**, whose presence is the anchor. Their persisted
  record set contains no `Circle`.
- **H− `expectNoOtherPersonsInvitationReachesTheDevice`.** With a second invite
  seeded to somebody else in the same circle, neither its email nor its id
  appears anywhere in the invitee's persisted records or rendered output, with
  their own email present as the anchor.

### Pair I — the narrowing Giggle Band gets for free

- **I+ `expectInvitationRowStillNamesTheBand`.** With
  `allowAuthenticatedReadBandName` **removed**, the invitee's `MyBandInvitations`
  row still resolves `display.Band` to `"The Betas"`.
- **I− `expectStrangerLearnsNoBandName`.** A signed-in caller with no invitation
  and no membership gets `null` from `readFieldsForDisplay("Band", …, ["Name"])`
  — where today they get the name (Evidence 10) — with I+'s resolved label as the
  anchor. This half is the whole point of removing the rule.

### Pair J — the read expires with the grant

- **J+ `expectPendingGrantAdmitsTheContextRead`.** Before the invitation is
  answered, the read succeeds and `listAvailableContexts` reports the instance.
- **J− `expectAnsweredInvitationRevokesTheContextRead`.** After the invitation is
  declined: `contextGrants` is `[]`, the read is refused, and
  `listAvailableContexts` is `[]`, with J+'s successful read in the same test as
  the anchor. Mutation: removing the `CONTEXT_GRANT`'s `WHEN Status == 'pending'`
  must turn J− red and leave J+ green.

### Pair K — conformance

- **K+** a `contextGrant` principal admits a grant-holder to the context's own
  record; a `CONTEXT ALL` command against a record in that context authorises;
  the queued operation carries that context.
- **K−** the same model and caller with the grant's `WHEN` unsatisfied: no
  context available, the read denied, the write denied, and no selection
  recorded; plus `validateModel` cases for both new diagnostics; plus the
  recordless-`read` fail-closed case Phase 103's
  `policy.self.fails-closed-with-no-record.005` models. Each case shown to
  **discriminate** — break one expectation, watch that case and only that case
  fail.

### Pair L — model versions, both applications

- **L+ `expectBothReferenceAppsAtOneNewVersion`.** Giggle Band is `1.14.0` with a
  `1.13.0 → 1.14.0` empty-object migration; Jointly Care is `1.8.0` with a
  `1.7.0 → 1.8.0` one. Both persisted-state upgrade tests seed the previous
  version's real shape, load the real app URL, and read the new version back from
  the mounted `<adl-app>`'s own `model.modelVersion`.
- **L− `expectNoOtherModelMoved`.** The generic browser demo's `modelVersion`
  **and** `modelFingerprint` are byte-identical, measured the way Phase 100
  measured them rather than assumed from which files were edited, and its
  upgrade test is unmodified and still passes.

### Pair M — the evidence layer can see a server refusal

- **M+ `expectRejectedReplayRecordedAsADenial`.** A replay the authority rejects
  produces an authority event `expectAuthorityDenied` can match, carrying the
  rejection's own code. Today it records `http_request / allowed / 200`
  (Evidence 13).
- **M− `expectAcceptedReplayRecordedAsNoDenial`.** An accepted replay produces
  **no** matching denial, with M+'s denial in the same run as the anchor, so
  "everything is a denial" cannot pass. Both halves must survive the
  `evidence-self-check` gates.

### Pair N — nothing the directory closed reopens

- **N+ `expectGrantPrincipalGrantsTheContextRecord`.** The anchor: it does grant
  something.
- **N− `expectGrantPrincipalOnUserGrantsNothing`.** `ALLOW READ CONTEXT_GRANT`
  added to a `User` policy grants a grant-holding caller **no** `User` record —
  not another person's, not their own — and `search` on `User` stays refused.
  Measured for the prototype; it becomes the assertion that Phase 101's closure
  survives this phase. Mutation: matching on *any* held grant rather than on the
  record's own id must turn N− red.

### No meaningful negative counterpart

Disclosed rather than exempted (`process/testing-expectations.md`):

- **The four specification edits**, including `resolved-model.md:157`'s missing
  `self`. Prose. The pairs that give them teeth are A, B and C.
- **The five learnings updates**, including the correction to
  `context-grants-and-relationship-access.md`'s "commits locally" sentence.

### Suite-level

- `npx tsc --noEmit`, `npm run format:check`, `npx vitest run` (baseline **67
  files / 1,284 tests**, plus this phase's), the conformance suite,
  `npm run test:integration` (baseline **20 files / 190 tests**, plus this
  phase's), `npx playwright test` (baseline **80 passed**), `npm run verify:push`
  with `VERIFY_EXIT` read from a captured variable and every screenshot and
  `test-results/visual/EVIDENCE.md` inspected, and an `/impeccable audit` pass on
  the changed screens.
- `git diff --stat` **does** touch `src/parser/`, `src/compiler/print-adl.ts` and
  `src/model/adlj-schema.json`. **A language change is shipped** — deliberately,
  and Evidence 4 is why.

## Testing

**Order.** The three backfill items in Scope go in first, red, against the
unmodified tree. Then Part 1 (the principal, with its diagnostics). Then Part 2
(the selection derivation). Then the reference-app content. Then the browser.

The measurement harness this document was written with is the starting point:
seven throwaway vitest files (four hermetic over the seeded reference apps and a
JSON-patched `.adlj` recompiled through `compileAdlProjectV2`; three under
`tests/integration/` over real PostgreSQL, one of which drives a real
`ApplicationRuntime` and a real `AuthoritySyncClient` into a real
`AuthorityService` through a direct in-process `AuthorityTransport`), plus one
throwaway Playwright spec in the `invitation` project. `console.log` is swallowed
by this project's vitest configuration — the probes appended to a file. All were
deleted.

- **Unit** (`npx vitest run`).
  - `tests/context-grant-principal.test.ts` (**new**, modelled on
    `tests/self-principal.test.ts`): Pairs A, B, J, N.
  - `tests/parser.test.ts`, `tests/compile-adlj.test.ts`,
    `tests/model-validation.test.ts`: Pair D, Pair C, and the two diagnostics —
    each modelled on its Phase 103 `SELF` sibling.
  - `tests/authority-sync-client.test.ts`: Pair F. Its four existing selection
    cases (`:938`, `:950`, `:962`, `:976`) are the standing controls and stay
    unmodified.
  - `tests/band-reference-app.test.ts`, `tests/jointly-reference-app.test.ts`:
    Pair I, and the model assertions for both version hops.
- **Conformance.** Pair K, in a new `conformance/runtime/context-grant-principal.json`
  plus additions to `conformance/runtime/context-grants.json`. The runner and case
  schema are a shared spine and stay serial. Note the corpus limit
  `command-intent-replay.md` records: `"selectedContexts": {}` asserts presence
  and object-ness only, so a "records no selection" case must name each context
  that is *not* there.
- **Integration** (real PostgreSQL). Pairs E and G, extending
  `tests/integration/authority-invitation-accept.test.ts` and adding a
  device→authority file. Model it on the probe described above rather than on a
  hand-built intent: a hand-built intent proves the authority and says nothing
  about what a device would actually send.
  - Also measure Evidence 14's first inferred claim here: whether a command's
    later step can read, through a `CONTEXT_GRANT` rule, the context record an
    earlier `establishesContext` step just created. Whatever the answer, assert
    it; do not leave it undecided.
- **Playwright / `verify:push`.** Mandatory — a new screen state in both apps and
  a changed shell path. Pairs H and M in the `invitation` project, and
  `tests/visual/invitation-accept.spec.ts`'s two existing tests **rewritten**:
  its "no circle reaches the device" assertion becomes its opposite, and its
  raw-`page.request` workaround for the rejected replay becomes an
  `expectAuthorityDenied` once Pair M lands. Both reference apps' persisted-state
  upgrade cases (Pair L). Inspect every screenshot and read
  `test-results/visual/EVIDENCE.md`.
- **Design review.** `/impeccable audit` on the invitee screens in both apps.
  Phase 105's audit recorded four app-wide findings it deliberately did not act
  on; check whether any is now this phase's.
- **Mutation checks.** Each must turn a *specific, different, named* assertion
  red and leave the others green:
  - predicate ignores the record's own id → **A−**, **N−** red; **A+** green.
  - predicate returns `true` → **A−**, **N−** red; **B−** *green* (the recordless
    gate is what refuses search, not the predicate).
  - remove the recordless guard → **B−** red.
  - remove `ADL_POLICY_CONTEXT_GRANT_PRINCIPAL_UNREACHABLE` → **C−** red, **C+**
    green.
  - delete the `printPrincipal` branch → **D−** red (and it must fail loudly, not
    print an empty principal).
  - drop the `getAllowedContextIds` guard in `OperationLog.record` → **F−** red,
    **F+** green.
  - remove the whole derivation → **F+**, **G+**, **H+** red; **G−** green.
  - remove `allowGrantedContextReadBand` → **E+**, **H+** red; **E−** green.
  - remove the `CONTEXT_GRANT`'s `WHEN Status == 'pending'` → **J−** red.
  - flip each new conformance case's expectation → exactly that case.

## Parallel Execution Plan

The serial spine is genuinely serial: the principal is a type-union widening that
every later stream consumes, and the reference-app content cannot compile until it
exists.

1. **Serial spine, no consumers.** The three backfill items from Scope, written
   red. Then the union member, the predicate, the parser branch, the printer
   branch (both sets), the regenerated schema, and the two diagnostics — one pass,
   `npx tsc --noEmit` clean, `npx vitest run` for the whole suite. This is the
   barrier; everything after it receives a real principal instead of a predicted
   one.
2. **Then parallel**, four streams over disjoint files:
   - `src/runtime/operation-log.ts` + Pair F in `tests/authority-sync-client.test.ts`;
   - `tests/context-grant-principal.test.ts` (Pairs A, B, J, N);
   - the four specification files and the five learnings documents;
   - `tests/visual/support/*` for Pair M (its own evidence plumbing, no model).
3. **Then serial again** — the repository's known write-contention points:
   `src/reference/jointly-care/domain.adlj`, then
   `src/reference/giggle-band/domain.adlj` (both are reference-app fixtures that
   `tests/integration/` builds its fixtures from), then the conformance corpus
   and its runner, then `tests/visual/invitation-accept.spec.ts` and the two
   persisted-state upgrade specs.
4. **Barriers.** `npx vitest run` after (1) and after (3).
   `npm run test:integration` **once**, after (3) — a reference-app `.adlj` edit
   changes the legality of every fixture built from that model
   (`process/testing-expectations.md`), so it is not optional here.
   `npm run verify:push` **exactly once**, at the very end, with `VERIFY_EXIT`
   captured on the line after the command and read.

Not touched, so the usual serialisation does not apply: `src/index.ts`,
`src/ui/components/register.ts`, shell chrome, the ordered migration SQL.

## Tasks

1. Write the three backfill pairs from Scope against the unmodified tree.
   Record each failure message verbatim.
2. Widen `PrincipalMatch`; add the `case` and the predicate; add the parser
   keyword, both stop-word sets (including the missing `SELF`), the
   `failUnexpected` string and the AST union member; add the printer branch;
   regenerate `adlj-schema.json`. `tsc` clean.
3. Add both diagnostics with their negative controls. Prove Pair C and Pair B's
   compile half.
4. Prove Pairs A, B, J, N against the seeded reference apps, including the
   `ALLOW * CONTEXT_GRANT` wildcard shape.
5. Change `OperationLog.record`. Prove Pair F, including the
   `CreateBand`/`CreateCircle` negative, and confirm the four existing selection
   cases are untouched and green.
6. Add `allowGrantedContextReadCircle` to Jointly Care and
   `allowGrantedContextReadBand` to Giggle Band; **remove**
   `allowAuthenticatedReadBandName`; bump both `modelVersion`s with empty-object
   migrations; `compileAdlProjectV2` with `diagnostics: []` asserted. Prove
   Pair I.
7. Prove Pairs E and G against real PostgreSQL, including the
   `establishesContext` question from Evidence 14.
8. Land Pair M's evidence plumbing, then rewrite
   `tests/visual/invitation-accept.spec.ts` and prove Pair H.
9. Add Pair K to the conformance corpus; show each case discriminates.
10. Add Pair L: both apps' persisted-state upgrade cases, and the generic demo
    measured unmoved.
11. Run every mutation check; confirm each turns a different named assertion red;
    restore every mutated file.
12. Correct the four specification files and the five learnings documents —
    including the measured correction that an invitee's `Accept` does **not**
    commit locally on a real device, that a context's own bound object is refused
    by policy rather than by the scope gate, and that a union widening still
    finds exactly one consumer through `tsc`.
13. `tsc`, `format:check`, unit, conformance, integration, `/impeccable audit`,
    `npm run verify:push` with `VERIFY_EXIT` read and every screenshot inspected.
    Commit; push.

## Planning Handoff

*(Written after execution, per `learnings/process/phase-execution.md`. The
candidate this document expects to nominate is **Phase 106 — a registered person
has a `User` record, so their name renders**: with this phase landed, an invitee
who accepts arrives on a member list showing their own `user-…` id where their
name belongs, one screen earlier than before, which strengthens rather than
weakens Phase 106's case. The executing agent must confirm that against the
repository as a whole rather than adopting it.)*

Candidates surfaced while writing this document and deliberately not taken:

- **Parameters on the `CONTEXT_GRANT` principal** — `CONTEXT_GRANT Circle GRANT
  pendingCircleInvite` — for an application declaring two grants on one context
  that wants only one of them to admit a read. Neither reference app needs it.
- **`contextMember.field: "id"`**, still unbuilt after Phases 91, 99, 101 and 103.
- **A demo seed that arrives as an invitee.** Phase 105 named it; still the
  cheapest way to make this feature visible in `npm run test:visual`.
- **`DeclineBandInvitation`.** Jointly Care can say no; Giggle Band cannot.
- **A visibility predicate distinguishing a granted context from a joined one.**
  Phase 105's Pair H pins that an invitee is denied "Create a band" because a
  grant made a context *available*. This phase makes that state reachable on a
  real device for the first time, so it stops being hypothetical.
- **Presentation diagnostics leak internal construct names to users.**
- **`requireObjectScopeForSearch` and `sourceCanSearchScopedObject` disagree**
  (`read-model-service.ts:309` vs `:327-342`). Still unreached, still unfixed.
- **An exhaustiveness table for `PrincipalMatch`.** Phase 103's handoff asked for
  it and this phase confirms the need: widening the union again found exactly one
  consumer by type error, and the parser's duplicated union found none. A
  `satisfies Record<PrincipalMatch, …>` table or an `assertNever` default in the
  parser would make the fifth principal mechanical.
