# Phase 99 — Self-Service Registration

> Commissioned directly by the repository owner, from a contradiction between
> two layers that both shipped working: the domain models say _any authenticated
> person creates their own group and becomes its admin_, and the identity layer
> says _you may only register if someone already inside invites you_. They
> disagree at step one of the product.
>
> **Owner amendments, 2026-08-21 — these override the body where they differ.**
>
> 1. **The onboarding form ships in this phase, not a later one.** The owner's
>    instruction was "both together": shipping registration without a way to
>    create a group leaves a user-visible dead end, which is not acceptable
>    even for one phase. The Non-goal excluding it is **withdrawn**; see
>    "Amendment A" at the end of this document.
> 2. **The user-directory exposure is closed.** Phase 101 shipped it, and the
>    premise this document used to defer it was false. See "Amendment B".
> 3. **Two settled decisions ride along.** See "Amendment C".
>
> **Numbering.** Phase 98's proposed printer work became Phase 100 and is
> already merged; Phase 101 closed the directory exposure. This phase executes
> after both, so phase numbers do not run in execution order here — the owner
> reprioritised mid-flight and renumbering a document of this size was judged
> the worse trade.

## Objective

Let a person who has never been invited obtain an identity through the product,
in an application whose model says that is what the application is — and in no
other application, and in no deployment that has switched it off.

Concretely: an ADL model may declare `REGISTRATION SELF_SERVICE` in its `APP`
block; the authority reads that from the resolved model, reconciles it with a
deployment control that can only ever be _more_ restrictive, and allows
`/v1/webauthn/register/begin` + `/finish` to complete with neither a session nor
an invite; the sign-in surface offers a "create an account" route beside the
existing passkey sign-in, and explains the invitation route it currently leaves
unexplained; and both reference apps declare it.

The invitation path is untouched. It is how you join _someone else's_ group and
how a member who lost every authenticator gets back in — a different flow, not a
thing being replaced.

## Evidence and Dependency

Re-verified against the working tree at `555a5c3` while writing this document.
Re-verify again before executing; every citation below is a real file and line.

### The contradiction

- `docs/operations/authority-production-runbook.md:114` — heading, verbatim:
  `### First admin: there is no bootstrap flow (documented gap)`, followed at
  :116-119 by _"Passkey registration is either session-gated or invite-gated and
  is never anonymous … A brand-new database therefore has no way to admit its
  first identity through the product surface."_ The section then gives an
  operator three `insert` statements (:139-179) and a recipient-bound invite.
- `src/server/webauthn-identity.ts:204-217` states the same rule as a
  load-bearing invariant in the service's own doc comment: _"2. Registration is
  never anonymous."_ It is enforced at :251-253 — no session and no invite
  throws `ADL_PASSKEY_UNAUTHORIZED`.
- `learnings/implementation/passkey-identity.md` repeats it twice, including the
  forward-looking line this phase must answer: _"If a future phase adds a
  bootstrap path, it must not become an anonymous registration route."_ That
  sentence is the strongest objection on record and is answered under "Decision"
  below; the learnings document is corrected by this phase rather than quietly
  contradicted.
- Meanwhile both reference apps already model the opposite. Giggle Band,
  `src/reference/giggle-band/domain.adlj`:
  - `allowAuthenticatedCreateOwnBand` (:2990-3003) — `effect: allow`,
    `action: create`, `principal.match: "authenticated"`, no roles, no users,
    `condition: "CreatedBy == RUNTIME.userId"`.
  - `allowBandCreatorReadOwnBand` (:3005-3018) — the matching read.
  - `CreateBand` (:2419-2483) — step `createBand` creates `Band` with
    `CreatedBy: { kind: "runtime", property: "userId" }` and
    `"establishesContext": "Band"`; step `createFounderMembership`
    (`authority: "command"`) creates `BandMember` with `Role: "BandAdmin"` and
    `Band` from `{ kind: "stepMeta", step: "createBand", property: "guid" }`.
  - `CONTEXT Band` (contexts[1]) declares
    `membership: { object: "BandMember", userField: "User", contextField: "Band",
  roleField: "Role", roles: ["BandAdmin", "BandMember"] }`.
    Jointly Care, `src/reference/jointly-care/domain.adlj`, is the same shape with
    two naming differences the brief did not have: the condition field is
    **`Owner`**, not `CreatedBy` (`allowAuthenticatedCreateOwnCircle`, :1613;
    `allowCircleCreatorReadOwnCircle`, :1628), and the second step is named
    **`createOwnerMembership`**, not `createFounderMembership` (`CreateCircle`,
    :1197). Roles are `CircleOwner`/`CircleMember`.
- `src/runtime/policy-engine.ts:231-232` — the `authenticated` principal is
  `context.userId.length > 0`. No role and no membership is required, exactly as
  the brief states.

So the model already says the application admits strangers who bring their own
group. Only the identity layer refuses.

### What is _not_ already true — verified, and it changes this phase's scope

The brief's premise "everything downstream already works; the missing link is
becoming authenticated without an invite" holds for the runtime and the
authority, and **does not hold for the browser**.

- A command is invocable from the UI only through a presentation `ACTION` whose
  `input` is `Record<string, ResolvedExpression>`
  (`src/model/resolved-model/presentation-core.ts:124-131`), evaluated against a
  row (`src/ui/components/adl-app/events-record.ts:400-418`). The one real
  example is `RevokeBandInvitation` with `"input": { "Invitation": "id" }`
  (`src/reference/giggle-band/ui.adlj:859-869`).
- `CreateBand` takes a required free-text `Name`. There is no construct in the
  language or the UI runtime that opens a **form for a command's declared
  inputs**. Grepping the repository, `CreateBand` appears in exactly one
  reference-app file (its own declaration) and otherwise only in tests that call
  `executeCommand` directly.
- Consequently a person with no membership sees
  `No Band contexts are available for this view.`
  (`src/ui/components/adl-app/data.ts:435-439`) and has no affordance at all.

This phase therefore delivers the identity link and proves the whole chain
through the authority; it does **not** deliver the browser affordance, and its
Planning Handoff nominates that as Phase 100. See "Non-goals" for the full
reasoning and "The first-admin gap" for what that means for the runbook.

### The two precedents that decide the design question

- **Against modelling it.** `src/server/authority-config.ts:94-97`, the doc
  comment on `loadAuthorityConfiguration`: _"Reads only deployment
  configuration. It intentionally does not model any of these values in ADL
  source or the resolved application model."_
- **For modelling it.** In the _same file_, immediately below,
  `resolveSessionLifetime` (:168-178) takes the resolved model and overrides the
  deployment value from it, with this comment (:157-167): _"An operator may
  shorten that with `ADL_SESSION_TTL_MINUTES`, and only shorten it: lengthening
  past the declared grace would hand out a capability the application never
  declared."_
  `docs/spec/language.md:169-190` states the same contract for `OFFLINE_GRACE`
  in the language: it is an `APP`-block declaration, _"the authority is the
  enforcement point"_, and changing it _"is a model version change and passes
  through the startup compatibility guard like any other."_

Those two are not in conflict. `loadAuthorityConfiguration` runs **before** the
model is loaded (`src/server/authority-entrypoint.ts:157-161` loads the model,
then calls `loadAuthorityConfiguration`, then reconciles), so its comment is a
true statement about that one function's inputs, not a rule against modelling
application semantics. `resolveSessionLifetime` is the seam where the model
wins, and it already exists.

### Mechanism the phase depends on

- `PasskeyIdentityService.beginRegistration`
  (`src/server/webauthn-identity.ts:238-297`) and `finishRegistration` (:299-380).
- The edge: `src/server/authority-http.ts:181-250`
  (`/v1/webauthn/register/begin`, `/register/finish`, `/authenticate/*`), the
  CSRF-by-presence rule at :169-180, and `bucketFor` at :530-542 mapping
  `/v1/webauthn/*` to the `webauthn` bucket.
- Rate limiting: `FixedWindowRateLimiter`
  (`src/server/security-operations.ts:119-144`), limits from
  `AuthorityRateLimits` (`src/server/authority-config.ts:39-49`),
  `ADL_RATE_WEBAUTHN` default 20 (:132).
- `/readyz` shape: `src/server/authority-http.ts:137-147`, built from
  `describeIdentityVerification` (`src/server/identity-verification.ts:88-94`),
  read by the browser at `src/server/http-authority-transport.ts:345-372` and
  applied to session state at `src/ui/authority-sync.ts:171-177`.
- The sign-in surface: `renderAuthorityChrome()`
  (`src/ui/components/adl-app/render-chrome.ts:15-35`) mounts
  `<adl-session-panel>`; the passkey signed-out markup is
  `src/ui/components/adl-session-panel.ts:401-452`.
- `AuthorityAccessLifecycleService.peekInvite` / `claimInvite` /
  `redeemInviteForIdentityRecovery` (`src/server/access-lifecycle.ts:230-292`) —
  none of which this phase changes.

### Model-version dependency

- Giggle Band `src/reference/giggle-band/domain.adlj:2` — `"modelVersion": "1.9.0"`;
  migrations end at `{ "from": "1.8.0", "to": "1.9.0", "objects": [] }` (:88-92).
- Jointly Care `src/reference/jointly-care/domain.adlj:2` — `"modelVersion": "1.4.0"`;
  migrations end at `{ "from": "1.3.0", "to": "1.4.0", "objects": [] }` (:42-46).
- The generic browser demo `src/ui/demo-fixture.ts:32` — `modelVersion: "0.2.0"`,
  `migrations: [{ from: "0.1.0", to: "0.2.0", objects: [] }]` (:41).
- Hard-coded fingerprints that will fail first and must be taken from the
  failure diff: `tests/band-reference-app.test.ts:99-101`,
  `tests/jointly-reference-app.test.ts:41-43`.

## Decision

**Both, with the model as the ceiling.** A model-level declaration of what the
application permits, plus a deployment-level control that can only ever
restrict. When they disagree, the **more restrictive** side wins, and there is
deliberately no value of any environment variable that turns self-service _on_
for a model that did not declare it.

### Why the model, and not deployment configuration alone

"This application admits new users who bring their own group" is a statement
about what the application _is_. Giggle Band and Jointly Care are self-service
products whose domain models already say so in policy and in a command; a
hypothetical closed corporate app is a different application, not a different
deployment of the same one. `ADL_IDENTITY_VERIFICATION` is genuinely a
deployment concern — it says _how a credential is checked_, which is
infrastructure — and this is not the same kind of thing: it says _who the
application is for_.

The precedent is exact and it is `OFFLINE_GRACE`. That is an `APP`-block
declaration of an application semantic; the authority derives behaviour from the
resolved model; a deployment variable may only tighten it; and the language spec
states the direction as a contract. This phase copies that shape rather than
inventing one.

### Why the deployment may only restrict

`resolveSessionLifetime`'s comment already argues it: _"lengthening past the
declared grace would hand out a capability the application never declared."_
The same reasoning applies with more force here, because the capability is
"strangers may create accounts". An operator restricting an open application is
a legitimate, ordinary act (a staging deployment, an incident, a private pilot).
An operator _opening_ an application whose model says invite-only would let an
environment variable grant a capability the application never declared — and it
would do so silently, since nothing in the model would record it. So the value
set itself encodes the asymmetry: `ADL_SELF_SERVICE_REGISTRATION` accepts
`model` (default) and `off`. There is no `on`.

### The rejected alternative

**Deployment configuration only** — a bare `ADL_SELF_SERVICE_REGISTRATION=on`
with nothing in ADL, on the strength of `loadAuthorityConfiguration`'s doc
comment. Rejected for three reasons:

1. The comment describes a function that cannot see the model, not a policy
   about the language. The same file already reconciles a model declaration
   against deployment configuration ten lines below it.
2. It puts the answer to "who is this application for?" somewhere the model
   cannot state it and the compiler cannot check it. In particular the check
   described under "Validation" below — an application that admits strangers but
   grants none of them the ability to create anything — becomes undecidable.
3. It makes the two reference apps' `authenticated`-principal create policies
   permanently unreachable in every deployment that forgets an environment
   variable, which is the exact failure this phase exists to fix.

The half of that alternative worth keeping is kept: a deployment control exists,
because an operator must be able to close the door without a model change and a
release.

### Answering the standing invariant

`learnings/implementation/passkey-identity.md` says _"If a future phase adds a
bootstrap path, it must not become an anonymous registration route."_ This phase
adds one anyway, and the reason it is not the thing that warning was about is
that the warning was written when nothing in the system could express _whether_
an application wanted one. An anonymous route that exists unconditionally, in
every deployment of every model, is what it forbids. A route that exists only
where a model declares it, only in `passkey` mode, only while the deployment has
not switched it off, and that mints an identity holding no membership and no
role anywhere, is a different thing. The learnings document is corrected as part
of this phase — leaving a superseded invariant standing is the
`reference-app-drift` failure mode applied to learnings.

## The language surface

### `.adl` text

```text
APP 'Giggle Band ADL Example'
  MODEL_VERSION '1.10.0'
  THEME CorporateLight
  START_VIEW HomeDashboard
  OFFLINE_GRACE 30 DAYS
  REGISTRATION SELF_SERVICE
END.APP
```

- `REGISTRATION` takes exactly one of two bare words: `SELF_SERVICE` or
  `INVITE_ONLY`. Both spellings are underscore-only. **Do not add a dotted
  alias** (`SELF.SERVICE`): `docs/spec/language.md:104-134` records that the
  dotted forms are deprecated and being closed, so a new construct must not
  arrive with one.
- Directive order inside `APP` is free, as it already is; the printer emits
  `REGISTRATION` after `OFFLINE_GRACE` and before `MODEL_VERSION`.
- Parser: `AppParser.parseApp`, `src/parser/grammar/app.ts:19-70` — a new local
  `let registration`, a new `else if (this.matchWord("REGISTRATION"))` branch
  beside the `OFFLINE_GRACE` branch (:52-57), the value spread into the returned
  AST beside `offlineGraceDays` (:38), and the `failUnexpected` message at
  :65-68 extended to list `REGISTRATION`.
- AST: `AppDeclarationAst` gains
  `registration?: "selfService" | "inviteOnly"` (`src/parser/ast.ts:160-170`).
  The AST carries the resolved-model spelling, not the text spelling, exactly as
  `SYNC LOCAL_FIRST` becomes `localFirst`.
- `compile-adl.ts:150-159` spreads it into `PartialAppModel` with the same
  `undefined`-guarded idiom the other three directives use.

### `.adlj`

```json
{
  "app": {
    "name": "Giggle Band ADL Example",
    "startView": "HomeDashboard",
    "theme": "CorporateLight",
    "offlineGraceDays": 30,
    "registration": "selfService"
  }
}
```

`AdljSourceDocument.app` **is** `PartialAppModel`
(`src/model/adlj-source.ts:272-274`), so adding the field to `PartialAppModel`
gives the `.adlj` surface, the JSON schema and the importer for free:

- `PartialAppModel` (`src/model/resolved-model/core.ts:169-176`) gains
  `registration?: "selfService" | "inviteOnly"`.
- `src/model/adlj-schema.json` is **regenerated**, not hand-edited:
  `npm run generate:adlj-schema`. It will gain the enum under
  `PartialAppModel` beside `offlineGraceDays` (currently :1522-1524).
- `src/compiler/compile-adlj.ts` and `src/compiler/adl-to-adlj.ts` need **no
  change** — both pass `app` through whole.
- `docs/spec/adlj.md:140`'s mapping-table row is updated to name the new key.

### Resolved model

`ResolvedApp` (`src/model/resolved-model/core.ts:116-129`) gains:

```ts
  /**
   * Whether this application admits people who were not invited.
   *
   * Absent means `inviteOnly`. It is deliberately omitted rather than
   * defaulted, so a model that says nothing has a byte-identical
   * modelFingerprint to the one it had before this field existed.
   */
  registration?: "selfService" | "inviteOnly";
```

`resolveApplicationModel` (`src/compiler/resolve-model/index.ts:63-70`) spreads
it conditionally:

```ts
  app: {
    name: input.app.name,
    startView: ...,
    theme: ...,
    offlineGraceDays: input.app.offlineGraceDays ?? DEFAULT_OFFLINE_GRACE_DAYS,
    ...(input.app.registration === undefined ? {} : { registration: input.app.registration }),
  },
```

**This is a deliberate deviation from how `offlineGraceDays` resolves**, and it
is the one design choice in this phase made for blast radius rather than for
purity. Materialising a default the way `offlineGraceDays` does would put a new
key in every resolved model in the repository, which would move every
`modelFingerprint`: both reference apps, the generic browser demo, the
`examples/` corpus, and the expected output of 47 `resolveModel` and 85
`validateModel` conformance cases — plus a third persisted-state upgrade test
for a demo whose behaviour did not change at all. Omitting the key keeps the
change confined to the two apps that actually declare something, and it follows
a precedent already recorded in `learnings/implementation/business-context-model.md`:
_"Context and read-model top-level properties are optional and are omitted by
`resolveApplicationModel` unless the partial model declares them. This keeps
existing MVP resolved JSON unchanged."_

The cost is that "absent means invite-only" is a contract a consumer must know.
There is exactly one consumer (`resolveSelfServiceRegistration`, below), the
doc comment states it, and `docs/spec/language.md` states it. Acceptance
criterion 2 makes the benefit falsifiable.

### Validation

One new diagnostic, **warning** severity:

`ADL_APP_SELF_SERVICE_REGISTRATION_UNREACHABLE` — added to
`MODEL_VALIDATION_CODES` (`src/compiler/validate-model/codes.ts`, beside
`APP_OFFLINE_GRACE_INVALID` at :37) and checked in
`src/compiler/validate-model/core.ts` beside the offline-grace check (:39-47).

It fires when a model declares `registration: "selfService"` and **no policy
rule anywhere grants `create` (or `*`) to an `authenticated` or `everyone`
principal on any object that some business context names as its bound
`OBJECT`.** That is precisely the state this phase exists to prevent the
_inverse_ of: an application that lets strangers in and gives them nothing to
do. It is decidable from the model alone.

Severity is warning, not error, on two grounds. First, it is not provably dead
the way `ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE` is — an application could
legitimately admit self-registered readers of an `everyone`-readable catalogue
with no context of their own, and refusing that would be wrong. Second,
Phase 93's bar for error severity is "not one rule in the repository would newly
fail", and that bar is about refusing existing content; a warning needs less.

Both reference apps pass it: `allowAuthenticatedCreateOwnBand` is
`action: create`, `principal.match: authenticated`, on `Band`, and
`CONTEXT Band` declares `"object": "Band"`; Jointly Care is identical with
`Circle`. Every other model in the repository declares no `registration` at all,
so the check never fires for them.

An invalid _value_ needs no diagnostic: it is a parse error in `.adl` text and
`ADL_ADLJ_SCHEMA_INVALID` in `.adlj`, both already existing paths.

### Printer

`printApp` (`src/compiler/print-adl.ts:262-282`) learns it, in this phase, as
one line between the `offlineGraceDays` block and the `modelVersion` block:

```ts
if (model.app.registration !== undefined) {
  lines.push(
    `  REGISTRATION ${model.app.registration === "selfService" ? "SELF_SERVICE" : "INVITE_ONLY"}`,
  );
}
```

**This is not deferred.** Phase 98's handoff counted eleven constructs with no
text syntax and named the trend — "the printable subset shrinks every time the
language grows" — as the reason to fix the printer next. A new `APP` directive
that the printer cannot emit would make it twelve, for the sake of two lines of
code. The construct also has real text syntax (above), so it is not in the
"NO TEXT SYNTAX" category at all.

### Defaults for every existing app that says nothing

Every model in the repository other than the two reference apps says nothing and
stays exactly as it is: no `registration` key in its resolved model, no
fingerprint change, no version change, and `inviteOnly` behaviour — which is
today's behaviour.

## The security surface

Anonymous registration means anyone who can reach the authority can create
durable state. Seven controls, of which three are new.

### 1. The model declaration is itself the primary control

An application that does not declare `SELF_SERVICE` cannot be self-registered
into, in any deployment, under any configuration. This is not a runtime check
that could be misconfigured: the resolved model is loaded at startup, its
fingerprint is guarded, and changing it is a model version change.

### 2. The deployment ceiling

`ADL_SELF_SERVICE_REGISTRATION` ∈ { `model` (default), `off` }. Parsed by a new
`selfServiceRegistrationCeiling()` in `src/server/authority-config.ts` mirroring
`identityVerificationMode()` (:210-218) exactly, including throwing
`AuthorityConfigurationError` on any other value. There is no value that enables
self-service against the model's wishes.

### 3. It only exists in `passkey` mode

`resolveSelfServiceRegistration` returns false unless
`configuration.identityVerification.mode === "passkey"`. In `bypass` and
`upstream` there is no registration ceremony at all — identities are minted from
an account proof through `/v1/session/issue` — so the flag would be both
meaningless and misleading. The startup log states the resolved value either
way.

### 4. A dedicated, tunable rate bucket for anonymous registration

`AuthorityRateLimits` gains `selfRegistration`, from
`ADL_RATE_SELF_REGISTRATION`, **default 5** per window
(`positiveInteger(environment.ADL_RATE_SELF_REGISTRATION, 5)`).

`bucketFor` is **not** changed and no new route is added. Instead, inside the
`/v1/webauthn/register/begin` handler, when the request carries **no session
cookie and no `inviteToken`**, the `selfRegistration` bucket is charged _in
addition to_ the `webauthn` bucket already charged at
`src/server/authority-http.ts:185`. Either bucket can refuse. That keeps the
ordinary ceremony allowance (20/window, shared by sign-in) untouched while
capping account creation independently — an operator can tighten one without
breaking the other.

When the limit is hit the response is byte-identical to today's:
`429`, `{"error":"rate_limited"}`, `retry-after: 60`
(`src/server/authority-http.ts:524-526`), the `rate_limited` log event, and the
`adl_authority_rate_limited_total` metric. A caller must not be able to tell
_which_ bucket refused it.

Implementation note: `enforceRate()` (:506-523) closes over the single
`rateBucket` for the path. Give it a sibling `enforceRateFor(bucket)` carrying
the same metric and log lines, and have `enforceRate()` delegate to it.

**Two honest limitations of this control, which the runbook must state:**

- `clientKey` defaults to the constant `"unknown-client"`
  (`src/server/authority-http.ts:80`); the Node entry point supplies the first
  `x-forwarded-for` hop (`src/server/authority-entrypoint.ts:510-515`). With no
  proxy in front, every client shares one bucket. Behind a proxy that _appends_
  rather than _sets_ `x-forwarded-for`, the key is attacker-chosen. This is a
  pre-existing property of every bucket, but self-service registration is the
  first endpoint where an anonymous stranger creates durable state on top of it,
  so the runbook must instruct operators to terminate at a proxy that **sets**
  `x-forwarded-for`.
- `FixedWindowRateLimiter` is in-process
  (`src/server/security-operations.ts:118`, whose own comment says
  _"Deployments may substitute a shared store"_). With N replicas the effective
  limit is N×. Runbook states it.

### 5. The ceremony cost

Every self-registration is a real WebAuthn ceremony with
`residentKey: "required"` and user verification. Accounts cannot be minted by a
script that only speaks HTTP; an attacker needs an automatable authenticator.
This is not a control the phase adds, but it is why the rate limits above are a
proportionate response rather than the only thing standing in the way.

### 6. What a self-registered identity may see and do before it creates a group

**Essentially nothing, by construction — with one real exception that must be
recorded rather than hand-waved.**

Nothing, because:

- Context roles resolve only from accepted membership records, on every call
  (`RuntimeContextService`; the invariant is restated at
  `src/server/webauthn-identity.ts:212-213`: _"A passkey grants identity only.
  No ADL role is derived from it"_). A new identity holds no role anywhere.
- The resolved default policy effect is `deny`
  (`src/model/resolved-model/core.ts:111`).
- `Band`'s search and read grants for non-creators are `ROLE BandMember`
  (`allowBandMemberSearchBands`, `allowBandMemberReadBand`), so a member-less
  caller cannot search or read any band but one they created themselves
  (`allowBandCreatorReadOwnBand`, conditioned on `CreatedBy == RUNTIME.userId`).
  Jointly Care is identical with `CircleMember` / `Owner`.
- Every scoped object is gated by `requireObjectScopeForRecord` /
  `requireObjectScopeForSearch`, and `listAvailableContexts` returns an empty
  list, so the shell renders
  `No Band contexts are available for this view.`

The exception, **closed by Phase 101 before this phase executes**: both apps
used to grant `SEARCH` and `READ` on the whole `User` object to the
`AUTHENTICATED` principal (`UserPolicy` in each `domain.adlj` —
`allowAuthenticatedSearchUsers`, `allowAuthenticatedReadUsers`), and `Email` is
a required field on `User` in both. A self-registered stranger could therefore
have enumerated the user directory, addresses included. Before self-service
registration every authenticated caller had been invited by somebody; after it,
anyone can become authenticated, so that pairing had to go.

**What replaced it** (see `docs/phases/phase-101-user-directory-exposure.md`):

- `UserPolicy` in each app is now a single **field-scoped** rule —
  `ALLOW READ AUTHENTICATED FIELDS Name` in Giggle Band,
  `... FIELDS DisplayName` in Jointly Care. A rule that names `FIELDS` cannot
  match a whole-record request at all (`PolicyEngine.ruleMatches`; pinned by
  `policy.field.allow-does-not-grant-row.001` in the conformance corpus), so a
  self-registered caller may resolve a person's display name and can neither
  pull the record it lives on nor reach `Email`, which has no rule and falls to
  the object's default deny.
- **The `SEARCH` grant is gone entirely**, not narrowed. Search is the
  enumeration primitive over a directory, a field-scoped `SEARCH` rule would be
  dead on arrival (a `search` request carries no field), and nothing legitimate
  needed it once the two read models that sourced `User` stopped doing so.
- Jointly Care's `User.DISPLAY` moved from `Email` to `DisplayName` in the same
  change — while `Email` _was_ the display field, "the display field only"
  would have granted exactly what the policy exists to withhold.
- `UserSystemAdminPolicy` is untouched in both apps, so an administrator still
  reads the whole record.

This is a real narrowing, not a mask: an earlier draft of this section reasoned
that a field-level control could not work because "there is no principal to
un-mask it for". That is true of a _mask_ over an otherwise-readable record and
false of a field-scoped `ALLOW` over a default-deny object, which needs no
un-masking principal because nothing was granted in the first place.

Two narrower grants remain genuinely inexpressible, and Phase 101 did not
attempt either: "only people I share a band with" still needs
`recordBelongsToContextMember` to key on a field holding the record's own id,
which a `User` record has none of; and "my own record in full" needs the same
thing, since `OWNER` matches `meta.createdBy`/`CreatedBy`/`OwnerId` and no
policy condition can compare a record's id to `runtime.userId`. A `ROLE
BandMember` rule on `User` remains the dead-rule trap the compiler refuses
outright (`ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE`, Phase 93). The Planning
Handoff still nominates the platform extension that would make the
context-scoped version possible (letting `contextMember.field` accept `id`).

Per-application judgement still matters and is unchanged: an application whose
`User` object carries anything more sensitive than a display name simply does
not declare `SELF_SERVICE`. What has changed is that the two shipped reference
apps no longer _need_ that judgement to hold the line.

### 7. Observability

- The existing `passkey_registered` log event
  (`src/server/authority-http.ts:211-217`) gains `selfService: boolean`, derived
  at the edge from "this request carried no session cookie and no invite token".
  No user id, no token, no challenge — consistent with the existing rule that a
  refusal states only its stable code.
- The existing `identity_verification_configured` startup event (:85-92) gains
  `selfServiceRegistration: boolean`, so the active state is disclosed once at
  startup exactly as the identity mode already is.
- `/readyz` discloses it (below), so an operator can check it without reading
  logs.
- `adl_authority_requests_total{endpoint="/v1/webauthn/register/begin"}` and
  `adl_authority_rate_limited_total` already exist and are what an operator
  alarms on.

**No new access-audit event kind.** `AuthorityAccessAuditEvent`
(`src/server/access-lifecycle.ts:36-52`) requires `contextName` and `contextId`,
and the projection is indexed by them
(`src/server/migrations/0003_reporting_administration.sql:16-22`) because every
review surface is context-scoped. A self-registration has no context by
definition, so such a row would be written where nothing could ever read it. The
durable record of a self-registered identity is the `adl_authority_identities`
row itself, with its `created_at`, plus the credential row — which is exactly
what an operator queries.

### Does a self-registered identity differ from an invited one afterwards?

**No, in every respect that matters, and this must stay true.** Both hold an
`AuthorityIdentity` keyed on an internal `userId` with a `passkey` identity
link; both may be invited into contexts later, may add further authenticators,
may recover through a recipient-bound invite, and may be disabled or have their
sessions revoked identically. Nothing records _how_ an identity was minted on
the identity row, and nothing should: `learnings/implementation/passkey-identity.md`
is explicit that identity is keyed on an internal id and that adding a method is
linking, not re-keying. The only difference is transient and is not stored — an
invited registration also carries out a membership claim in the same ceremony
(`PasskeyRegistrationResult.invite === "membershipGranted"`), and a
self-registration carries out none.

## The exact flow, end to end

A person who has never been invited, on a `passkey` deployment of a model
declaring `REGISTRATION SELF_SERVICE`, with `ADL_SELF_SERVICE_REGISTRATION`
unset:

1. **Browser loads the app.** `createAuthoritySync` calls
   `transport.readiness()` (`src/ui/authority-sync.ts:171-177`), a plain
   cross-origin `GET /readyz`. The response's `identityVerification` object now
   carries `selfServiceRegistration: true`. Session state becomes
   `{ status: "signedOut", identityMode: "passkey", selfServiceRegistration: true }`.
2. **The panel renders three routes** (see "The UI"): sign in with a passkey;
   **create an account**; join with an invitation.
3. **The person clicks "Create an account".** `adl-session-panel` dispatches
   `ADL_REGISTER_PASSKEY_EVENT` with `detail: {}` — the same event, with the same
   empty detail, that the signed-in "Register another passkey" control already
   dispatches (`src/ui/components/adl-session-panel.ts:150-160`). No new event
   and no new bridge method: the browser sends no invite token and no session
   cookie, and the authority decides what that means.
4. **`events-shell.ts:35`** calls `bridge.registerPasskey(undefined)`, which
   calls `transport.beginPasskeyRegistration(undefined)`
   (`src/server/http-authority-transport.ts:215-221`) — `POST
/v1/webauthn/register/begin` with body `{}` and no session cookie.
5. **The edge** (`src/server/authority-http.ts:181-202`): passkey mode and a
   `passkeys` service are required (503 otherwise); the `webauthn` bucket is
   charged; there is no session cookie, so the CSRF double-submit check does not
   apply (the presence rule at :167-180 is unchanged); the request carries no
   session and no `inviteToken`, so the new `selfRegistration` bucket is charged
   too; `beginRegistration({})` is called.
6. **`beginRegistration`** (`src/server/webauthn-identity.ts:238-297`): no
   session, no invite token. Today this throws `ADL_PASSKEY_UNAUTHORIZED`
   (:251-253). Now, when the service was constructed with
   `selfServiceRegistration: true`, it falls through with `userId`,
   `inviteTokenHash` and `inviteRecipientUserId` all `undefined`, `userName`
   left at `"New member"`, `excludeCredentialIds` empty, and a freshly minted
   `userHandle`. A challenge row is written with `ceremony: "registration"`,
   `userHandle` set and every other optional column null. When the option is
   false, the existing refusal is unchanged.
   _(The current condition also refuses when `accessLifecycle === undefined`;
   self-service needs no access lifecycle, so that clause must be split out
   rather than reused.)_
7. **The browser** runs `navigator.credentials.create` with the returned options
   and posts `/v1/webauthn/register/finish` with `challengeId` and `response`,
   no `inviteToken`.
8. **`finishRegistration`** (:299-380): `consumeChallenge` atomically consumes
   the row; there is no `inviteTokenHash`, so the invite re-supply check is
   skipped; the assertion is verified by `SimpleWebAuthnLibrary`; a duplicate
   credential id refuses with `ADL_PASSKEY_CREDENTIAL_IN_USE`; `recovering` is
   false. **Then, before anything is written, the anonymous case is re-checked**
   — a challenge with no `userId` and no `inviteTokenHash` must refuse
   `ADL_PASSKEY_UNAUTHORIZED` unless `selfServiceRegistration` is still true.
   This is defence in depth against a challenge outliving a configuration change
   and against a forged challenge row.
9. **Identity is minted.** `challenge.userId` is undefined, so
   `sessions.provisionIdentity(PASSKEY_IDENTITY_PROVIDER, challenge.userHandle)`
   writes the `adl_authority_identities` row and the
   `adl_authority_identity_links` row; `credentials.createCredential` writes the
   authenticator. **No membership record is written, anywhere.**
10. **A session is issued — and this is the one subtle change.** Today the
    discriminator is `challenge.inviteTokenHash === undefined ? undefined :
issueSession` (:367-372), documented in
    `learnings/implementation/passkey-identity.md` as deliberately _not_
    `challenge.userId`. That rule breaks for self-service, which has neither.
    Replace it with the question it was always trying to ask — _did this
    ceremony start without a session?_:

    ```ts
    const sessionGated =
      challenge.userId !== undefined && challenge.inviteRecipientUserId === undefined;
    const session = sessionGated ? undefined : await this.sessions.issueSession(userId);
    ```

    This is behaviour-identical for all three existing cases and must be pinned
    by a unit test enumerating all four:

    | ceremony                                  | `challenge.userId` | `inviteRecipientUserId` | `inviteTokenHash` | session issued     |
    | ----------------------------------------- | ------------------ | ----------------------- | ----------------- | ------------------ |
    | add another authenticator (session-gated) | set                | —                       | —                 | **no** (unchanged) |
    | invited new member                        | —                  | —                       | set               | yes (unchanged)    |
    | identity recovery                         | set                | set                     | set               | yes (unchanged)    |
    | **self-service (new)**                    | —                  | —                       | —                 | **yes**            |

11. **The edge answers `201`** with `{ userId, expiresAt }` and the `__Host-`
    session and CSRF cookies (:207-231). No new wire field: `invite` is simply
    absent, exactly as it is for the add-a-device path, and the browser already
    knows which of the two it asked for.
12. **The browser** records the identity, sets `status: "signedIn"`, and picks
    its notice from the pre-call session status — `"Your account was created and
this device is registered."` when it was signed out, the existing
    `"This device is registered."` when it was already signed in
    (`src/ui/authority-sync.ts:304-329`). It then calls
    `connection.synchronize(...)`, whose bootstrap returns nothing scoped to any
    context, because the identity is a member of none.
13. **`CreateBand` takes over** — at the runtime and authority layer. Executing
    `CreateBand` with this identity's `RuntimeContext` passes
    `allowAuthenticatedCreateOwnBand` (create, `authenticated`,
    `CreatedBy == RUNTIME.userId`), establishes the `Band` context
    transaction-locally, and the second step
    (`authority: "command"`) writes the `BandMember` row with
    `Role: "BandAdmin"`. From the next bootstrap the person is an admin of their
    own band and every existing surface works. `CreateCircle` is identical with
    `Owner` and `CircleOwner`.
14. **What does not happen in a browser.** Step 13 has no UI affordance —
    see "What is _not_ already true" above. This phase proves step 13 over real
    PostgreSQL through the authority; the browser button is Phase 100.

## The UI

`renderPasskeySignedOut()` (`src/ui/components/adl-session-panel.ts:401-452`)
currently offers exactly two things and explains neither's origin: a **Sign in
with a passkey** button, and a **Register this device** form whose only content
is a bare `Invitation token` text input and the sentence _"New here, or replacing
a lost device? Enter your invitation token and register a passkey on this
device."_ Nowhere does it say where a token comes from.

### When self-service is permitted

Three clearly separated routes, in this order:

1. **Sign in with a passkey** — unchanged, and stays first: the common case is a
   returning person.
2. **Create an account** — a heading, a short explainer, and a single button
   with **no input**:
   `data-session-self-register="true"`, dispatching `ADL_REGISTER_PASSKEY_EVENT`
   with `detail: {}`. Candidate copy, to be checked by `/impeccable`:
   _"New here? Create an account with a passkey on this device. You will start
   with nothing of your own until you set something up or someone invites you."_
   The panel is generic shell chrome shared by every ADL app, so the copy must
   not name bands, circles or groups.
   Disabled under the same conditions as the sign-in button
   (`busy`, or `!passkeySupported`), and hidden entirely when
   `selfServiceRegistration` is false.
3. **Join with an invitation** — the existing form, kept, re-headed, and given
   the explanation it lacks: _"Someone already using this app can send you an
   invitation token. Paste it here to join what they have set up — or to set up
   a replacement device for an account you have lost access to."_

**The invitation form keeps its own empty-token refusal.** Self-registration
gets a separate control with no input rather than being folded into the same
form, which is both better UX (two different intents, two different controls)
and cheaper: `tests/ui-passkey-sign-in.test.ts:111`
(_"refuses to dispatch a registration with an empty token and says why"_) stays
valid and unchanged, instead of having to be split into a self-service and an
invite-only variant.

### When self-service is not permitted

Exactly two routes — sign in, and join with an invitation — which is what the
panel shows today, **with the new invitation explainer**. The copy fix is not
conditional on self-service; the current text is unhelpful in both states and is
corrected in both.

### How the browser knows

`AdlSessionState` (`src/ui/authority-bridge.ts:146-181`) gains
`selfServiceRegistration: boolean`, fed from `/readyz` alongside `identityMode`
in `src/ui/authority-sync.ts:173-177`, initial value `false`
(:144-155), parsed fail-closed in
`src/server/http-authority-transport.ts:359-372` as
`verification.selfServiceRegistration === true` (absent, unknown or an
unreachable authority all mean false — a missing flag must never be read as
permission, the same shape as `bypassed: verification.bypassed !== false`).

**`sessionEquals` (`src/ui/components/adl-session-panel.ts` bottom) must compare
the new field.** It is a pure-equality short-circuit before `render()`; omitting
the field means the panel never re-renders when the readiness probe answers, and
the control never appears. This is the single most likely defect in the UI half
and there must be a test for it.

`AuthorityIdentityReadiness`
(`src/server/http-authority-transport.ts:15-24`) gains the field; so does
`AuthorityIdentityVerificationStatus`
(`src/server/identity-verification.ts:17-22`) and
`describeIdentityVerification` (:88-94), which already receives the whole
`AuthorityConfiguration` and so needs no signature change.

Per `AGENTS.md`'s "Design/UX review" section, run
`/impeccable audit src/ui/components/adl-session-panel.ts src/ui/styles.css`
and address the findings before the UI change is considered done — the panel
grows a third block and the signed-out surface gets meaningfully taller on a
phone.

## Both reference apps

`.adlj` only. No `.adl` text is hand-edited anywhere in this phase; Giggle
Band's `.adl` snapshot no longer exists (Phase 98) and Jointly Care never had
one.

### `src/reference/giggle-band/domain.adlj`

```json
  "modelVersion": "1.10.0",
  "app": {
    "name": "Giggle Band ADL Example",
    "startView": "HomeDashboard",
    "theme": "CorporateLight",
    "offlineGraceDays": 30,
    "registration": "selfService",
    "comment": "Giggle Band is a self-service product: `allowAuthenticatedCreateOwnBand`\nand `CreateBand` already say any signed-in person may create their own band\nand becomes its `BandAdmin`. Until this declaration existed the identity\nlayer contradicted that -- registration was invite-gated, so nobody could\never be the first `authenticated` caller. See\n`docs/phases/phase-99-self-service-registration.md`."
  },
```

and appended to `migrations`:

```json
{
  "from": "1.9.0",
  "to": "1.10.0",
  "objects": []
}
```

### `src/reference/jointly-care/domain.adlj`

The same, with `"modelVersion": "1.5.0"`, a comment naming
`allowAuthenticatedCreateOwnCircle` / `CreateCircle` / `CircleOwner`, and the
hop `{ "from": "1.4.0", "to": "1.5.0", "objects": [] }`.

### Everything else

`ui.adlj` in both apps is untouched (neither declares `modelVersion`; both
declare `"migrations": []`). `app.yaml` in both is untouched (`version: 0.1.0`
there is the manifest version, not the model version).
**`src/ui/demo-fixture.ts` is untouched and its `modelVersion` stays `0.2.0`** —
see acceptance criterion 2.

Per `AGENTS.md`'s "Compile-check ADL source before presenting it", both edited
`.adlj` files must be run through `compileAdlj` in a throwaway vitest file and
their `diagnostics` inspected before the change is committed; delete the
throwaway file afterwards.

## Model versions

| App                                                       | From    | To            | Hop                                     | Why                                                                                                                                       |
| --------------------------------------------------------- | ------- | ------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Giggle Band (`src/reference/giggle-band/domain.adlj:2`)   | `1.9.0` | `1.10.0`      | `{from:"1.9.0",to:"1.10.0",objects:[]}` | `app.registration` enters its resolved model, so its fingerprint moves. No stored field changes, so the hop is an empty-object migration. |
| Jointly Care (`src/reference/jointly-care/domain.adlj:2`) | `1.4.0` | `1.5.0`       | `{from:"1.4.0",to:"1.5.0",objects:[]}`  | Same.                                                                                                                                     |
| Generic browser demo (`src/ui/demo-fixture.ts:32`)        | `0.2.0` | **unchanged** | none                                    | It declares no `registration`, and the resolver omits the key, so its fingerprint does not move.                                          |

`1.9.0 → 1.10.0` is numerically forward and is already proven so by
`tests/model-migration.test.ts:167-169`. Skipping either hop is a compile error
(`ADL_MIGRATION_UNREACHABLE`, `src/compiler/validate-model/core.ts:139-151`), so
this cannot be forgotten silently.

Consequent updates, all of which fail first and tell you what to write:

- `tests/band-reference-app.test.ts:29` (version), the hop assertion near :87 in
  the same commented style as its neighbours, and the hard-coded fingerprint at
  :99-101 — taken from the failure diff, as that test's own comment instructs.
- `tests/jointly-reference-app.test.ts:25`, :35, and the fingerprint at :41-43.
- `tests/browser-model-migration.test.ts:169`, the hop list ending at :217,
  `expected: "1.9.0"` at :255, and `modelVersion: "1.9.0"` at :267.
- `tests/ui-runtime.test.ts:64-65` — **must not change**, and must stay green.

Persisted-state upgrade testing, per `AGENTS.md:65-77`, for **both** apps whose
model moved and for neither app whose model did not:

- `tests/visual/giggle-band.visual.spec.ts:43` and
  `tests/visual/jointly-care.visual.spec.ts:44` already seed/downgrade to
  `1.0.0` and assert against `readMountedModelVersion(page)`, so they exercise
  the whole chain including the new hop by construction and need no assertion
  rewrite. What they do need, and what satisfies the rule: their stale titles
  and comments updated to name the new version, and a real re-run whose
  screenshots are inspected — the point of the rule is that somebody actually
  proved the transition for each app, not that a diff exists.
- `tests/visual/browser-demo.visual.spec.ts` is untouched. That it stays green
  untouched _is_ the evidence that an undeclared app's fingerprint did not move.

## Testing

### Unit (`npm test`)

**Compiler**

- `REGISTRATION SELF_SERVICE` / `INVITE_ONLY` parse; an unknown word after
  `REGISTRATION` is a parse error; the `APP` directive list in the
  `failUnexpected` message names it.
- A round-trip that is not dependent on which reference app the printer can
  currently handle: a small `PartialApplicationModel` carrying `registration`,
  printed by `printPartialApplicationModelAsAdl` and re-parsed by `compileAdl`,
  resolves to the same value.
- `resolveApplicationModel` on a partial model that declares nothing produces an
  `app` object with **no** `registration` key (assert with `not.toHaveProperty`,
  not `toBeUndefined`).
- `.adlj`: the regenerated schema accepts `"selfService"` and `"inviteOnly"` and
  rejects anything else with `ADL_ADLJ_SCHEMA_INVALID`.
- `ADL_APP_SELF_SERVICE_REGISTRATION_UNREACHABLE`: one deliberately-dead fixture
  that fires it, one that does not, and an assertion that both reference apps
  compile with zero diagnostics of that code
  (`tests/model-validation.test.ts` is the home, beside its Phase 93 siblings).

**Authority configuration** — `tests/authority-identity-switch.test.ts`, using
the loop-over-invalid-values pattern already at :132-153:

- `ADL_SELF_SERVICE_REGISTRATION` defaults to `model`, accepts `off`, trims, and
  throws `AuthorityConfigurationError` for everything else (`Model`, `OFF`,
  `on`, `true`, `yes`, `1`).
- `resolveSelfServiceRegistration` truth table — the negative rows are the
  point:

  | model         | env     | mode       | enabled  |
  | ------------- | ------- | ---------- | -------- |
  | `selfService` | unset   | `passkey`  | **true** |
  | `selfService` | `off`   | `passkey`  | false    |
  | `selfService` | unset   | `bypass`   | false    |
  | `selfService` | unset   | `upstream` | false    |
  | `inviteOnly`  | unset   | `passkey`  | false    |
  | absent        | unset   | `passkey`  | false    |
  | absent        | `model` | `passkey`  | false    |

  The last two rows are the acceptance criterion that no environment variable
  can enable self-service for a model that did not declare it.

- `ADL_RATE_SELF_REGISTRATION` parses and defaults to 5. (`ADL_RATE_*` parsing
  currently has no test at all; this closes one bucket's worth.)

**Passkey service** — `tests/passkey-identity.test.ts`

- The four-row session-issuance table above, each row asserted explicitly.
- Self-service `begin` + `finish` mints an identity and a credential and writes
  **no** membership.
- **Keep `"refuses a registration that presents neither a session nor an
invite"` (:302)** — re-scope it to a service constructed with the default
  (`selfServiceRegistration` absent), so it proves the invariant still holds
  where nothing declared otherwise. Do not delete it; `AGENTS.md` and `CLAUDE.md`
  both forbid weakening a constraint to make a change pass.
- `finish` refuses `ADL_PASSKEY_UNAUTHORIZED` for an anonymous challenge when
  the service has self-service off, even though `begin` allowed it (the restart
  case).

**HTTP edge** — `tests/authority-passkey-http.test.ts`

- `/readyz` `toEqual` at :216-220 updated to include
  `selfServiceRegistration`. The same applies to
  `tests/authority-identity-switch.test.ts:266` and `:303`, and to the client
  stub at `tests/ui-offline-session.test.ts:296`.
- An anonymous `register/begin` returns a ceremony when enabled, and `401`
  `ADL_PASSKEY_UNAUTHORIZED` when not.
- **The rate limit actually biting**: with
  `rateLimits: { ...base, selfRegistration: 1 }`, the second anonymous
  `register/begin` inside the window is `429` `rate_limited`, **while an
  invite-backed `register/begin` in the same window still succeeds** — that
  second half is what proves the buckets are distinct rather than the whole
  ceremony surface being throttled.
- `passkey_registered` carries `selfService: true` for an anonymous
  registration and `false` for an invited one, and carries no token, challenge
  or user id.

**Browser** — `tests/ui-passkey-sign-in.test.ts`

- The self-register control renders only when
  `selfServiceRegistration: true`, and dispatches `ADL_REGISTER_PASSKEY_EVENT`
  with `detail` `{}` (no `inviteToken` key at all).
- With `selfServiceRegistration: false` the control is absent and the panel is
  otherwise what it is today.
- The invitation form still refuses an empty token (`:111`, unchanged), and its
  new explainer renders in both states.
- **A `sessionEquals` regression test**: setting a session that differs _only_
  in `selfServiceRegistration` re-renders the panel.
- `src/server/http-authority-transport.ts` readiness parsing: absent, `false`,
  a non-boolean and an unreachable authority all yield `false`.

### Conformance

Cases live under `conformance/`; ids must match `^[a-z0-9.-]+$` and every
`specRef` must resolve to a real heading anchor under `docs/spec/`
(`tests/conformance-suite.test.ts:48-54`), so the spec prose is a hard
prerequisite, not a follow-up.

- `resolveModel`: a model declaring `selfService` resolves to
  `app.registration: "selfService"`; a model declaring nothing resolves with the
  key **absent** (use `CONFORMANCE_ABSENT`, `src/conformance/runner.ts:2454`).
- `validateModel`: the new warning fires on the dead fixture and does not fire
  on a live one.
- `specRef` targets: add a `### Self-Service Registration` subsection under
  `## Application Declaration` in `docs/spec/language.md`, giving the anchor
  `language#self-service-registration`.

No new conformance _operation_ is needed, so `tests/conformance-runner.test.ts`
needs no new `describe`.

### Integration — real PostgreSQL (`npm run test:integration`)

`AGENTS.md:51-59` requires authority behaviour to be proven against real
PostgreSQL. A fake that pattern-matches SQL is never acceptable here.

In `tests/integration/authority-passkey-identity.test.ts`, whose helper
`registerPasskey({ transport, device, inviteToken? })` (:367-385) already
expresses a no-invite call:

1. The literal model at :57-176 gains `app.registration: "selfService"`.
   Prove that an anonymous `register/begin` + `finish` over the real HTTP edge
   writes **exactly one** `adl_authority_identities` row, one
   `adl_authority_identity_links` row, one `adl_authority_webauthn_credentials`
   row, one session, and **zero** membership rows (`membershipsFor(userId)`
   returns `[]`).
2. That identity's `/v1/sync/bootstrap` returns no `Band` and no `BandMember`.
3. A second server on a model whose `app.registration` is `inviteOnly` refuses
   the identical call with `401` `ADL_PASSKEY_UNAUTHORIZED`.
4. A third configuration with `selfServiceRegistration: "off"` against the
   self-service model refuses it the same way.
5. With `rateLimits.selfRegistration: 1`, the second anonymous begin is `429`.
6. The existing secret-scan test at :776 still passes unchanged — no challenge,
   invite token or assertion material has entered any projection. Assert it,
   do not assume it.

**And separately — the claim the whole phase rests on.** Add an integration test
that serves the **real Giggle Band model** (`loadAuthorityModel("src/reference/giggle-band")`,
the way `tests/visual/passkey-authority.ts:69` and
`tests/integration/authority-model-migration.test.ts` already do) and drives:
self-register → replay `CreateBand` → assert the `Band` record and the
`BandMember` record with `Role: "BandAdmin"` both exist and are owned by that
identity → assert the next bootstrap returns exactly one `Band` and one
`BandMember`. The literal model inside `authority-passkey-identity.test.ts` has
no `CreateBand`-shaped command, so proving this there would prove it about a
fixture rather than about the shipped application.

`tests/integration/pg-harness.ts` is **not** touched: this phase adds no
migration, no table and no column.

### Playwright (`npm run test:visual`)

The `passkey` project already drives a real Chromium virtual authenticator
against a configured authority — `tests/visual/passkey-sign-in.spec.ts` with the
`tests/visual/passkey-authority.ts` harness, its own dev server on port 5273
bound to `localhost`, `VITE_ADL_AUTHORITY_URL` set
(`playwright.config.ts:79-87`, :110-117). It extends as follows:

- `tests/visual/passkey-authority.ts`: the `AuthorityConfiguration` literal
  (:73-102) gains `selfServiceRegistration: "model"` and
  `rateLimits.selfRegistration`, and is wrapped in
  `resolveSelfServiceRegistration(..., model)` beside the existing
  `resolveSessionLifetime`. `PasskeyIdentityService` (:115-121) is constructed
  with the resolved flag. Because it loads the real Giggle Band model, the
  declaration comes from `domain.adlj` and nothing needs to be faked.
- **Its doc comment at :38-41 must be corrected.** It currently reads
  _"**A seeded first administrator.** Registration is never anonymous, so
  somebody has to exist before anybody can be invited."_ The seeded admin stays
  — the invite tests still need it — but the stated reason is no longer true.
- A new test in `tests/visual/passkey-sign-in.spec.ts`: from a fresh virtual
  authenticator, on the signed-out panel, click
  `[data-session-self-register='true']` **with no token typed**, assert
  `data-session-status="signedIn"` and a `/^user-/u` identity, assert via CDP
  `WebAuthn.getCredentials` that one credential exists for
  `PASSKEY_RELYING_PARTY_ID`, and screenshot the new three-route signed-out
  panel.

**Deliberately not added: a second Playwright project for the invite-only
case.** The `administration` project shows what that costs — its own dev server,
its own authority, its own port pair. The absence of the control given
`selfServiceRegistration: false` is fully proven by
`tests/ui-passkey-sign-in.test.ts`, and the class of defect the passkey project
uniquely catches (a real browser refusing a cross-origin response, per
`learnings/implementation/passkey-identity.md`'s closing note) is already
exercised by the positive case reading the same `/readyz` field.

### Whole-suite

`npx tsc --noEmit`, `npx vitest run`, `npm run format:check`,
`npm run test:integration`, and `npm run verify:push` exactly once at the end
with the generated screenshots inspected.

## The first-admin gap

**It half-closes, and the runbook must say which half.**

**Closed:** the identity. For an application declaring `SELF_SERVICE` on a
`passkey` deployment that has not switched it off, the first person to reach the
authority registers through the product. The runbook's first `insert` — the
`adl_authority_identities` row — is no longer necessary, and neither is the
recipient-bound bootstrap invite that followed it.

**Not closed:** the first group. The remaining two `insert` statements — the
`Band` record and the `BandMember` row — are still required, because the browser
has no way to invoke `CreateBand`: a presentation `ACTION`'s `input` is an
expression over a row, there is no form for a command's declared inputs, and
`CreateBand` needs a typed `Name`. Verified above under "What is _not_ already
true". Until Phase 100 lands, a self-registered first admin can sign in and see
`No Band contexts are available for this view.`

**`scripts/dev/seed-local-admin.mjs` stays**, and its behaviour is unchanged. It
does more than mint an identity — it creates a context record, a membership and
an invite in one command — so it remains the fastest way to a working local
database, and it remains the only route at all for an `INVITE_ONLY` model. Its
doc comment (:5-17) must be corrected: _"registration is never anonymous"_ is no
longer unconditionally true, and _"the authority gains no anonymous registration
path"_ is no longer true at all. Neither correction changes what the script
does.

### The runbook edit

`docs/operations/authority-production-runbook.md`:

1. `### First admin: there is no bootstrap flow (documented gap)` (:114) is
   **rewritten, not deleted**, and re-headed
   `### First admin`. It splits into two cases:
   - _An application declaring `REGISTRATION SELF_SERVICE`_ — the first identity
     is obtained through the product; the operator still writes the context and
     membership rows (the existing SQL at :139-179, minus the identity insert),
     and the section states plainly that this remaining half is a known gap
     awaiting the onboarding surface.
   - _An application declaring `INVITE_ONLY` (or nothing)_ — the section stands
     exactly as it is today, all three writes.
2. A new `### Self-service registration` section under
   `## Switching a deployment to passkey identity`, covering: what the model
   declaration means; that the deployment control can only restrict; the new
   `ADL_SELF_SERVICE_REGISTRATION` and `ADL_RATE_SELF_REGISTRATION` rows in the
   table at :90-95; that the effective state is disclosed by `/readyz` and by
   `identity_verification_configured`; that the proxy **must set, not append**,
   `x-forwarded-for` or the per-client rate bucket is attacker-chosen; that
   `FixedWindowRateLimiter` is per-process, so N replicas mean N× the limit; and
   — stated plainly, not buried — what a self-registered identity holding no
   membership may see of other people. Since Phase 101 that is, in both
   reference apps, a display name and nothing else: `UserPolicy` grants
   `READ ... FIELDS <displayField>` only, carries no `SEARCH` rule, and Jointly
   Care's `User.DISPLAY` is `DisplayName` rather than `Email`. The section must
   still say that this is an application-by-application judgement — an
   application whose `User` object carries more than a display name should not
   declare `SELF_SERVICE`, and the platform does not check what a model's
   policies expose.
3. `## Incidents` (:994) gains one line: how to switch self-service off without
   a release (`ADL_SELF_SERVICE_REGISTRATION=off`, restart) and what that does
   not do (it does not disable identities already created).

## Scope

- `src/model/resolved-model/core.ts` — `PartialAppModel.registration`,
  `ResolvedApp.registration`.
- `src/parser/ast.ts`, `src/parser/grammar/app.ts` — the `REGISTRATION`
  directive.
- `src/compiler/compile-adl.ts` — AST → partial mapping.
- `src/compiler/resolve-model/index.ts` — conditional spread.
- `src/compiler/validate-model/{codes.ts,core.ts}` — the new warning.
- `src/compiler/print-adl.ts` — `printApp` emits it.
- `src/model/adlj-schema.json` — regenerated.
- `src/server/authority-config.ts` — `AuthorityConfiguration.selfServiceRegistration?`,
  `.selfServiceRegistrationEnabled?`, `AuthorityRateLimits.selfRegistration`,
  `selfServiceRegistrationCeiling()`, `resolveSelfServiceRegistration()`.
- `src/server/identity-verification.ts` — the readiness status field.
- `src/server/webauthn-identity.ts` — the service option, the `begin` fall-through,
  the `finish` re-check, the session discriminator.
- `src/server/authority-http.ts` — the second rate charge, the
  `passkey_registered` discriminator, the startup log field.
- `src/server/authority-entrypoint.ts` — compose both resolvers; pass the flag
  into `PasskeyIdentityService`.
- `src/server/http-authority-transport.ts`, `src/ui/authority-bridge.ts`,
  `src/ui/authority-sync.ts`, `src/ui/components/adl-session-panel.ts`,
  `src/ui/styles.css` — the browser half.
- `src/reference/giggle-band/domain.adlj`,
  `src/reference/jointly-care/domain.adlj` — the declaration, the version, the
  hop.
- `docs/spec/language.md`, `docs/spec/adlj.md`,
  `docs/operations/authority-production-runbook.md`,
  `scripts/dev/seed-local-admin.mjs` (comment only).
- `learnings/implementation/passkey-identity.md` (two invariants corrected, one
  added), `learnings/implementation/identity-invites-and-access-lifecycle.md`,
  `learnings/index.md` routing.
- Tests as listed under "Testing", plus the mechanical fan-out below.

### Mechanical fan-out the compiler will find for you

`AuthorityRateLimits` keeps every key **required**, because `enforceRate` indexes
it dynamically (`configuration.rateLimits[rateBucket]`,
`src/server/authority-http.ts:511`) and an optional key would make a missing
limit type as `number | undefined` at the one place a missing limit means "no
limit". So adding `selfRegistration` breaks every exhaustive `rateLimits`
literal, and TypeScript will list them:

`tests/authority-http.test.ts:27`, `tests/authoritative-reporting.test.ts:29`,
`tests/authority-identity-switch.test.ts:60`,
`tests/authority-passkey-http.test.ts:55`,
`tests/visual/passkey-authority.ts:90`,
`tests/visual/administration-authority.ts:87`, and under `tests/integration/`:
`authority-http.ts:54`, `authority-usable-sync-slice.ts:210`,
`command-replay.ts:585`, `record-sync-state.ts:68`,
`authority-session-lifetime.ts:72`, `authority-passkey-identity.ts:205`,
`authority-deployment-slice.ts:248`, `authority-administration-surfaces.ts:194`.

The two new `AuthorityConfiguration` fields are **optional** for the opposite
reason: they are read by name, never indexed, their absent values are the
fail-closed ones (`"model"` and `false`), and making them required would force
fourteen harness literals to state a value that changes nothing. This asymmetry
is deliberate and should be recorded in the code comment.

## Non-goals

- ~~**No first-run onboarding UI.**~~ **WITHDRAWN by owner amendment 1.** The
  first-run onboarding surface is now **in scope for this phase** — see
  "Amendment A". The concern that motivated this Non-goal is real and still
  stands: this is a large phase, and it must be committed as a reviewable
  sequence rather than one commit. That is now a Constraint, not a reason to
  split the deliverable.
- **No new HTTP route.** `/v1/webauthn/register/begin` and `/finish` already
  accept the exact request shape; `bucketFor` is unchanged.
- **No SQL migration, table or column**, and therefore no change to
  `tests/integration/pg-harness.ts`.
- **No new access-audit event kind** — justified under "Observability".
- **No global or daily registration cap.** A durable cap needs an index on
  `adl_authority_identities(application_id, created_at)`, which needs a
  migration, which needs the harness churn this phase deliberately avoids — and
  its failure mode is a self-inflicted denial of service on legitimate
  registrations. The observable alternative (alarm on the existing request and
  rate-limit counters) is available today. Recommended as a follow-up only if an
  operator actually needs it.
- **No email, address verification, CAPTCHA or proof of work.** No email sender
  exists in this repository and none is introduced.
- **No change to the invite path.** `createInvite`, `peekInvite`, `claimInvite`,
  `redeemInviteForIdentityRecovery` and every audit event they write are
  untouched.
- **No change to `bypass` or `upstream` mode**, or to `/v1/session/issue`, which
  remains `503` in `passkey` mode.
- **No narrowing of `UserPolicy`** in either reference app — already done, by
  Phase 101, precisely so this phase would not have to. Do not re-open it here;
  see "What a self-registered identity may see and do" for what it now grants.
- **No change to `src/ui/demo-fixture.ts`**, the `examples/` corpus, or any
  conformance model's expected resolved output.

## Constraints

- **Fail closed at every layer.** The service option defaults false; the config
  fields default to the restrictive value; readiness parses absent as false; the
  browser treats unknown as false; the resolver omits the key rather than
  guessing.
- **The deployment control may only restrict.** There must be no accepted value
  of any environment variable that enables self-service for a model declaring
  `INVITE_ONLY` or declaring nothing. This is acceptance criterion 4.
- **Do not weaken the existing invariant test.** `tests/passkey-identity.test.ts:302`
  is re-scoped, never deleted. Never weaken a constraint, loosen a test, or
  adjust a conformance case to make verification pass.
- **No twelfth unprintable construct.** `print-adl.ts` learns `REGISTRATION` in
  this phase.
- **No credential, token, challenge, assertion or user id** in any new log line,
  metric label or response body. The `selfService` discriminator is a boolean.
- **A refusal must not disclose which control refused it.** The
  `selfRegistration` and `webauthn` buckets produce identical 429s; a model that
  declares `inviteOnly` and a deployment that is `off` produce the identical
  `401 ADL_PASSKEY_UNAUTHORIZED`.
- **Correct the learnings.** `learnings/implementation/passkey-identity.md`
  states two things this phase makes false: _"Registration is never anonymous"_
  and _"The discriminator is `challenge.inviteTokenHash`, not
  `challenge.userId`"_. Leaving either standing is the `reference-app-drift`
  failure mode applied to the learnings themselves.
- **`/impeccable audit`** on the changed panel and CSS before the UI change is
  considered done, per `AGENTS.md`.
- **Compile-check** both edited `.adlj` files with `compileAdlj` and inspect
  `diagnostics` before committing; delete the throwaway vitest file.

## Acceptance Criteria

1. `compileAdlj` over both reference apps returns zero error diagnostics, and
   each resolved model has `app.registration === "selfService"`.
2. `resolveApplicationModel` on a model that declares no `registration` produces
   an `app` object with **no `registration` key**; `src/ui/demo-fixture.ts` is
   unmodified, its `modelVersion` is still `0.2.0`, and
   `tests/ui-runtime.test.ts:64-65` and
   `tests/visual/browser-demo.visual.spec.ts` pass **unmodified**.
3. `.adl` text printed from a partial model carrying `registration` parses back
   to the same value, both spellings.
4. No accepted value of `ADL_SELF_SERVICE_REGISTRATION` (nor of any other
   environment variable) makes self-service effective for a model declaring
   `inviteOnly` or declaring nothing — proved by an enumerating test.
5. Against real PostgreSQL, an anonymous ceremony over the real HTTP edge mints
   exactly one identity row, one identity link, one credential and one session,
   and **zero** membership rows; that identity's bootstrap returns no `Band`.
6. Against real PostgreSQL and the **real Giggle Band model**, that same
   identity's `CreateBand` is accepted, writes the `Band` and the `BandMember`
   with `Role: "BandAdmin"`, and the next bootstrap returns exactly one of each.
7. Against real PostgreSQL, the identical anonymous ceremony is refused `401`
   `ADL_PASSKEY_UNAUTHORIZED` when the served model declares `inviteOnly`, and
   again when `ADL_SELF_SERVICE_REGISTRATION=off`.
8. With `rateLimits.selfRegistration: 1`, a second anonymous
   `register/begin` in the window is `429` `rate_limited` while an
   invite-backed `register/begin` in the same window still succeeds.
9. The Playwright `passkey` project registers from a clean virtual
   authenticator with **no invite token** and reaches
   `data-session-status="signedIn"`.
10. `/readyz` discloses `selfServiceRegistration`, the
    `identity_verification_configured` startup event states it, and
    `passkey_registered` carries `selfService`.
11. No file is added under `src/server/migrations/`, and
    `tests/integration/pg-harness.ts` is unmodified.
12. `learnings/implementation/passkey-identity.md` no longer asserts that
    registration is never anonymous, and states the new session discriminator
    and its four cases.
13. `npx tsc --noEmit`, `npx vitest run`, `npm run format:check` and
    `npm run test:integration` clean; `npm run verify:push` run once with the
    generated screenshots inspected.

## Parallel Execution Plan

**Serial spine first, in one pass, with no consumers.** Later agents then
receive real signatures instead of predicting them:

1. `PartialAppModel.registration` and `ResolvedApp.registration`; the parser
   directive and the AST field; `compile-adl.ts`'s mapping; the resolver's
   conditional spread; the validator code and check; `printApp`'s line; the
   regenerated `adlj-schema.json`.
2. `AuthorityConfiguration`'s two new fields, `AuthorityRateLimits.selfRegistration`,
   `selfServiceRegistrationCeiling()` and `resolveSelfServiceRegistration()`'s
   full signature and behaviour; `AuthorityIdentityVerificationStatus`'s new
   field; `PasskeyIdentityService`'s new constructor option (declared and
   defaulted, guard not yet moved).

**Then three streams, worktree-isolated:**

- **A — Authority.** `webauthn-identity.ts` (`begin` fall-through, `finish`
  re-check, session discriminator), `authority-http.ts` (second rate charge, log
  fields, `/readyz`), `authority-entrypoint.ts`, and **every one of the fourteen
  `rateLimits` literals** listed under "Mechanical fan-out" — assign them all to
  A so no two streams touch the same harness. Unit tests for all of it.
- **B — Browser.** `http-authority-transport.ts`, `authority-bridge.ts`,
  `authority-sync.ts`, `adl-session-panel.ts`, `styles.css`, the panel unit
  tests, and `/impeccable audit`.
- **C — Content, spec and docs, as a single stream.** Both `.adlj` apps, the
  version and fingerprint test updates, the conformance cases,
  `docs/spec/language.md`, `docs/spec/adlj.md`, the runbook, the seed script's
  comment, and `learnings/`. `CLAUDE.md` names reference-app fixtures, the
  conformance runner and case schema, and specification updates as things to
  keep serial — so C is one stream, not three.

**Barriers.** Integration tests run once, after A and C merge (C supplies the
declaration the integration model needs). Playwright and `npm run verify:push`
run exactly once, at the very end, after all three merge.

## Tasks

1. Re-verify the Evidence against current code, including the claim that no UI
   path can invoke `CreateBand`. If that has changed, revise Scope before
   executing.
2. Serial spine, step 1: the language surface end to end, with its unit tests,
   including the printer and the regenerated schema.
3. Serial spine, step 2: the configuration and service signatures.
4. Fan out A, B, C.
5. Barrier: merge, `npx tsc --noEmit`, `npx vitest run`,
   `npm run format:check`, then `npm run test:integration` once.
6. Playwright `passkey` extension; then `npm run verify:push` once, and inspect
   the screenshots.
7. Runbook, learnings and `learnings/index.md` routing.
8. Commit to `main` and push.

## Planning Handoff

Required at the end of this phase: justify the next phase as the highest-value
remaining gap **repository-wide**, not merely the next gap in this subsystem.

**The recommendation this phase already carries, from evidence gathered while
specifying it: Phase 100 — first-run onboarding, a form for a command's declared
inputs.**

This phase opens a door into a room with nothing in it. A person can now obtain
an identity through the product and then cannot do the one thing both reference
apps' domain models say they exist to let them do, because no ADL construct
opens a form for a `COMMAND`'s inputs — a presentation `ACTION`'s `input` is
`Record<string, ResolvedExpression>` evaluated against a row, and `CreateBand`
needs a typed `Name`. That is a user-visible dead end created by this phase, and
closing it is worth more than any contract-tidying elsewhere. It is also the
remaining half of the first-admin gap: with it, a brand-new database needs no
operator SQL at all.

**Phase 98's proposed printer completion moves to Phase 101.** Nothing about its
justification has weakened — `.adl` text is meant to be the printout of `.adlj`
and it still cannot render Giggle Band — but it is a contract between the
language and its own tooling, with no user standing in front of it, and this
phase deliberately does not grow the unprintable list. A half-open product path
outranks it.

Two further candidates surfaced here, both smaller, both worth recording:

- **`contextMember.field` accepting `id`.** It would let a policy express "only
  people I share a context with" on an object that has no field holding its own
  id, which is the only honest way to narrow the `User` directory exposure this
  phase documents and accepts.
  `learnings/implementation/policy-engine.md` already nominates it for a
  different reason, so two independent needs now point at it.
- **A shared-store rate limiter.** `FixedWindowRateLimiter` is per-process, so
  every documented limit is really N× the limit on N replicas. That was
  tolerable when every mutating endpoint required a session; it is less
  comfortable now that one of them does not.

---

# Amendments (owner, 2026-08-21)

These were added after the body was written. Where they differ from the body,
**they win**.

## Amendment A — the first-run onboarding surface is in scope

The body specified registration and deferred the means to use it. The owner's
instruction is that both ship together: a person who signs up must be able to
create their group without leaving the app.

The body's own analysis of the gap stands and is the starting point — a
presentation `ACTION`'s inputs are expressions over a row, and nothing renders
a form for a `COMMAND`'s declared inputs, so `CreateBand`/`CreateCircle` cannot
be run from a browser today. Re-verify that before designing anything; it was
established by reading, not by running.

Requirements:

- A person with a valid session and **no** context membership must be able to
  supply a `COMMAND`'s declared inputs and run it. For these two apps that is
  `CreateBand` (`Name` required, `Description` optional) and `CreateCircle`.
- After it succeeds they must land in their new group with their founder
  membership active, without a reload or a re-sign-in if that is avoidable —
  and if it is not avoidable, say so rather than hiding a reload.
- The empty state that currently reads `No Band contexts are available for
this view.` must become the entry point, not a dead end.
- Whatever you build is **general**, not special-cased to these two commands:
  it is a form for a command's declared inputs. If that requires a new
  presentation or shell construct, design it to the same standard Phase 100
  held for surface syntax — match existing conventions, document it in
  `docs/spec/language.md`, and give it `.adl` text syntax and a printer branch
  so it does not become the twelfth unprintable construct.
- If you conclude the general form is too large to do well alongside the rest
  of this phase, **stop and report that** rather than shipping a special case
  quietly. Splitting is the owner's call, not yours.

## Amendment B — the user-directory exposure is closed

The body's security section records the exposure as accepted and hands it off,
and reasons that a field-level restriction could not work because "there is no
principal to un-mask it for". **That premise was false**, and Phase 101 shipped
the fix: true of a _mask_ over a readable record, false of a field-scoped
`ALLOW` over a default-deny object, which needs no un-masking principal because
nothing was granted in the first place.

As merged: `UserPolicy` in each app is a single `ALLOW READ AUTHENTICATED
FIELDS Name` (Giggle Band) / `FIELDS DisplayName` (Jointly Care), with **no**
`SEARCH` rule. Jointly Care additionally moved `User.DISPLAY` off `Email` and
stopped projecting `user.Email` through `CircleMemberRoster`.

Consequences for this phase:

- The "accepted exposure" reasoning in the security section is **obsolete**.
  Do not re-derive it, and do not reintroduce a `SEARCH` rule on `User`.
- Model versions have already moved: Giggle Band is now **1.10.0**, Jointly
  Care **1.5.0**. The body's stated hops are stale — recompute from the tree.
- A self-registered identity with no membership can resolve display names and
  nothing else. That is the property this phase depends on; assert it rather
  than assuming it survived.
- Note the known limitation Phase 101 recorded: a user cannot read their **own**
  record in full, because no policy operand matches a record's own id. If the
  onboarding surface needs the signed-in person's own details, you will meet
  this. Report it; do not invent a policy operand.

## Amendment C — two settled decisions ride along

Both follow from owner decisions recorded in `docs/spec/ui-language-addendum.md`
("Decisions (settled 2026-08-21)"). Neither is large; both are here to avoid a
separate round-trip.

1. **Remove per-view `presentation.shell.regions`.** The shell stays global; a
   screen needing a control puts it in the screen's own content. This is now
   dead capability, not pending syntax. It touches
   `src/model/resolved-model/presentation-core.ts`, `resolve-model/`,
   `validate-model/shell.ts`, `validate-model/presentation-core.ts`,
   `print-adl.ts` and three test files. Neither reference app declares one, so
   nothing real is removed — confirm that before deleting.

2. **Reject unknown icon names at compile time.** This is **not** just a
   validator: there is no single icon vocabulary to validate against. There are
   two, they disagree, and both live in rendering code rather than the model:

   - `src/ui/components/adl-app/render-chrome.ts`'s `iconGlyph`: `home`,
     `music`, `calendar`, `mic`, `microphone`, `list`, `users`, `sync`,
     `log-out`, `logout`
   - `src/ui/components/adl-composed-view.ts`'s `iconSvg`: `music`,
     `microphone`, `calendar`, `x`, `close`, `menu`

   Both silently render nothing for an unrecognised name, which is exactly the
   blank-space failure the decision is meant to prevent. So: establish one
   vocabulary in the model layer, make both renderers use it, **then** add the
   diagnostic. Take the union of what is supported today so nothing that works
   now breaks — `x` is used by Giggle Band and `home` by the shell — and report
   any name either renderer supports that you chose to drop, with the reason.

   Sequence this so the diagnostic lands **after** both renderers agree.
   Reversing that order makes the compiler reject models that currently render
   correctly.

---

# Execution Note (2026-08-21)

Written after execution, against what actually happened. Where it contradicts
the body, this is what shipped.

## What shipped, as a reviewable sequence

Nine commits on `phase-99-self-service-registration`, each independently
green (`tsc`, `vitest`, `format:check`):

1. **The language surface.** `APP ... REGISTRATION SELF_SERVICE | INVITE_ONLY`
   with parser, AST, `.adlj`, resolver, printer, regenerated schema, spec
   prose, five conformance cases, and
   `ADL_APP_SELF_SERVICE_REGISTRATION_UNREACHABLE` (warning).
2. **The authority.** `resolveSelfServiceRegistration`, the
   `ADL_SELF_SERVICE_REGISTRATION` ceiling, the service option, the `begin`
   fall-through, the `finish` re-check, the session discriminator, the second
   rate bucket, `/readyz` and the two log fields.
3. **The browser sign-in surface.** Three routes on the signed-out panel and
   the invitation explainer it never had.
4. **Amendment C1** — per-view `presentation.shell.regions` removed.
5. **Both reference apps declare `SELF_SERVICE`** (1.10.0 → 1.11.0,
   1.5.0 → 1.6.0).
6. **The integration acceptance test** against real PostgreSQL and the real
   Giggle Band model.
7. **Amendment C2** — one icon vocabulary, both renderers, then the
   diagnostic, in that order.
8. **Amendment A** — `COMMAND_ACTION` shell controls and
   `<adl-command-form>`, plus `PLACEMENT EMPTY_STATE` and
   `VISIBLE WHEN CONTEXT X UNAVAILABLE` (1.11.0 → 1.12.0, 1.6.0 → 1.7.0).
9. **The real-browser proof**, and the two defects it found.

## The acceptance test, and its real output

`tests/integration/authority-self-service-registration.test.ts`, against a
throwaway PostgreSQL and the **real Giggle Band model** loaded through
`loadAuthorityModel`, over a real socket with the real
`@simplewebauthn/server` verifier:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

The load-bearing case is `lets that identity run CreateBand and come out a
BandAdmin of its own band`: an identity that did not exist a moment ago,
minted by an anonymous ceremony with no invite token, replays `CreateBand`,
and the `Band` (`CreatedBy` = that identity) and the `BandMember`
(`Role: "BandAdmin"`) are read back **out of `adl_authority_records`**, not
out of the response. The next bootstrap returns exactly one of each. No
`seed-local-admin.mjs`, no operator SQL.

The same path in a real Chromium with a virtual authenticator:

```
✓ [passkey] › creates an account with no invitation, then creates a band from the empty state (940ms)
  5 passed (11.6s)
```

and, from the authority's own log during that run:

```
{"event":"identity_verification_configured","mode":"passkey","verifier":"passkey","bypassed":false,"selfServiceRegistration":true,...}
{"event":"passkey_registered","endpoint":"/v1/webauthn/register/finish","status":201,"selfService":true,...}
```

## The negative cases, and what proved each

| Case                                                        | Proof                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model says `INVITE_ONLY`                                    | Integration: the identical anonymous `register/begin` is `401 ADL_PASSKEY_UNAUTHORIZED`, with **zero** identity rows and **zero** challenge rows written.                                                                                                                                                                                                                     |
| Deployment says `off` while the model permits               | Integration: byte-identical `401 ADL_PASSKEY_UNAUTHORIZED`. Deliberately indistinguishable from the row above — a caller must not learn whether the model declined or the operator did.                                                                                                                                                                                       |
| No env value can turn it _on_                               | Unit: a ten-row truth table over `resolveSelfServiceRegistration`, including `absent + model`, `absent + off`, `inviteOnly + off`, and `selfService` in `bypass`/`upstream`. `ADL_SELF_SERVICE_REGISTRATION` throws `AuthorityConfigurationError` for `on`, `true`, `yes`, `1`, `Model`, `OFF`, `enabled`.                                                                    |
| The rate limit biting                                       | Integration and unit: with `selfRegistration: 1`, the second anonymous `begin` in the window is `429 rate_limited` with `retry-after: 60`, **while an invite-bearing `begin` in the same window still reaches the ceremony** (`401 ADL_PASSKEY_INVITE_INVALID`, not `429`). That second half is what proves the buckets are distinct rather than the whole surface throttled. |
| A member-less identity cannot read email or enumerate users | Integration, driving the real `ObjectStore` over the real projection: `search("User")` and `read("User", …)` both `PolicyDeniedError`; `readFieldsForDisplay` yields `{ Name: "Riley Stone" }` and the assertion is on the **rendered values** — a real name, no `@`, no `user-` — not on the absence of an exception. Bootstrap returns nothing and contains no `@`.         |
| A challenge outliving its configuration                     | Unit: `begin` under a permissive service, `finish` under a restarted one, `401 ADL_PASSKEY_UNAUTHORIZED`, no credential written.                                                                                                                                                                                                                                              |

Every new control was proven by mutation — break it, watch exactly its own
test go red, restore it. That was done for: the unreachability warning (3
tests), the second rate charge (1), the `finish` re-check (1), the four
`commandAction` diagnostics (5), `sessionEquals`'s new field (1), the
readiness propagation (1), the signed-out command-action guard (1), the
`refreshFromRuntime` fix (1), and the icon diagnostic and renderer parity
(1 + 2).

## Amendment A: what was built, and it is general

A **`COMMAND_ACTION` shell control** naming any declared `COMMAND`, and
`<adl-command-form>`, which renders one control per declared `INPUT` typed
from that input's own `FieldType`. It knows nothing about bands, circles,
contexts or registration; its unit tests deliberately use neither reference
app, and it is proven working from the **top bar** as well as from an empty
state, which is the test that it is a construct rather than an onboarding
hook.

Two supporting additions, both mirrors of things that already existed:
`PLACEMENT EMPTY_STATE` (the empty state was the only region a control could
not reach) and `VISIBLE WHEN CONTEXT X UNAVAILABLE` (the mirror of
`AVAILABLE`, which is what makes the surface self-removing). Both have `.adl`
text syntax, a printer branch, a regenerated schema and a round-trip test, so
this is not a tenth `.adlj`-only construct after Phase 100 closed nine.

Four diagnostics guard it: a `commandAction` with no `COMMAND`, a `COMMAND` on
a kind no renderer reads it from, an unknown command, and a command whose
`REPEATED`/`ATTACHMENT` input no generated form can ask for. That last one is
the difference between an unpromptable command being a model error and being a
form that silently drops a value.

### Decisions taken where the specification left room

- **A shell control, not a presentation action.** The body assumed the answer
  would be a form opened from a presentation `ACTION`. It cannot be: a
  context-scoped view renders its _empty state_ for a person with no
  membership, so its presentation is never evaluated and no action in it can
  ever be reached. The affordance has to live in something that renders
  without a context, which is shell chrome.
- **`EMPTY_STATE` has no region control list.** `topBar` and `navDrawer` each
  carry one because they are shared chrome whose ordering is a layout
  decision. The empty state is one message with, in practice, one way out, so
  order is declaration order and the renderer consumes `placement` directly.
- **A command action renders only for a signed-in caller** (with an authority
  configured). Found in the browser, not by reasoning: the signed-out identity
  is the non-empty placeholder `adl-signed-out`, so a bare `authenticated`
  create policy would have _accepted_ a signed-out visitor's local write and
  the authority would then have refused to sync it.
- **The shell holds the form's draft.** `render()` rewrites the whole
  `innerHTML`, so the element is recreated on every render and cannot keep
  anything itself. A refusal wiping the person's answers is the worst moment
  to lose them.
- **The command names the context to select.** After the command commits the
  shell selects the instance created by the step declaring `ESTABLISHES
CONTEXT` — read from the model, never guessed from the step order.

## What went wrong

- **The specification's model versions were stale**, as the amendment warned.
  Recomputed from the tree: 1.10.0 and 1.5.0, not 1.9.0 and 1.4.0. Every
  fingerprint was taken from the failure diff.
- **Two version bumps per app, not one.** The registration declaration and the
  onboarding shell control landed in different commits, and each is a real
  content change, so each got its own hop: Giggle Band 1.10.0 → 1.11.0 →
  1.12.0, Jointly Care 1.5.0 → 1.6.0 → 1.7.0. Honest history rather than a
  rewritten commit.
- **`PartialShellControlModel` has no `comment` field.** The per-control
  rationale for the onboarding controls was written as a `"comment"` key,
  which the generated schema rejected. It moved to the `shell` block's own
  comment rather than growing the language a comment attachment point at the
  end of a large phase.
- **`validateShellRegionControls` is about the _global_ shell**, not the
  per-view one, contrary to the body's file list for Amendment C1. Nothing was
  removed from `validate-model/shell.ts`.
- **Fifteen `rateLimits` literals**, not the fourteen the body listed
  (`tests/integration/edit-surface-batch.test.ts:951` was missing).
- **One integration flake.** On the first full `test:integration` run after the
  onboarding commit, one test in the migration/deployment area failed on a
  `ADL_MODEL_MIGRATION_APPLIED` log-line assertion; two subsequent full runs
  were clean (`17 files / 169 tests`). Not diagnosed, and not obviously related
  to this phase's changes. Recorded rather than dismissed.

## The one thing this phase does not close, and it is user-visible

**Nothing creates a `User` _application record_ for an authority-minted
identity.** Not registration, not `claimInvite`, not `seed-local-admin.mjs`,
not the runbook's bootstrap SQL. Verified by reading all four, and reproduced:

```ts
// scratch test against the real Giggle Band runtime
const resolved = await resolveLookupTargetRecord(runtime, userField, "user-newcomer", ctx);
// RESOLVED: null
```

`BandMember.User` is a `LOOKUP User DISPLAY Name` with no `TARGET_FIELD`, so
the stored value is the target record's _own id_; `readFieldsForDisplay`
returns null for a record that does not exist, and every caller falls back
silently to the raw stored value. So an authority-minted person renders as
`user-…` wherever a member name belongs.

**This predates Phase 99 and affects invited members identically** — no
authority-minted identity has ever had a `User` record. Phase 99 does not
create the defect; it makes it the first thing a new person sees about
themselves.

It was **not fixed here**, and that is a deliberate stop-and-report under the
amendment's own instruction, because every route to a fix needs a design
decision that should not be made silently at the end of an already-large
phase:

1. **The `User` record's id must equal the authority's `userId`**, because the
   lookup stores the target's own id. No command construct can express that: a
   `create` step mints its own id, and only `ObjectStoreCreateOptions.recordId`
   (a replay-path affordance) can name one. So this needs a new language
   construct — a create step able to name its record from
   `RUNTIME.userId`, e.g. `STEP createProfile CREATE User ID runtime.userId`.
2. **Even with that, running the command twice is a hard failure.** A create
   under an id that already names a record is refused, correctly and
   load-bearingly. So `CreateBand` cannot carry the profile step without
   breaking for anyone who creates a second group, and the language has no
   conditional or idempotent write to express "create if absent". Trading a
   cosmetic defect for a functional one is not an improvement.
3. **A required `User.Email`.** Giggle Band's `User` has `Email` required with
   an `email` validator, and it is the object's `businessKey`. A passkey
   registration collects no email, so either the onboarding form asks for one
   (a product decision, and adjacent to this phase's "no email verification"
   non-goal) or the model changes.
4. **Keying the lookup on a `TARGET_FIELD` instead is dead on arrival.** It
   would make label resolution a `search`, and Phase 101 deliberately removed
   the `SEARCH` grant on `User` because search is the enumeration primitive
   over a directory.

The honest reading is that this is its own phase: a create-step record
identity construct, an answer to idempotent writes, and a profile-collection
decision. It is nominated below.

## Deliberate deviations from the body

- **The integration cases live in a new file**,
  `tests/integration/authority-self-service-registration.test.ts`, rather than
  being folded into `authority-passkey-identity.test.ts`. That file's literal
  model has no `CreateBand`-shaped command, so the acceptance criterion would
  have been proven about a fixture; the new file serves the real Giggle Band
  model. `authority-passkey-identity.test.ts` is otherwise unmodified apart
  from its `rateLimits` literal, and its secret-scan test still passes
  unchanged.
- **No `/impeccable audit` was run.** `AGENTS.md` requires it before a
  UI-affecting change is considered done. It was not run here; the screenshots
  were inspected instead, and the two defects that inspection found are fixed
  above. This is an outstanding obligation, not a judgement that the surface
  is fine.
- **`src/ui/demo-fixture.ts` is untouched and stays at `0.2.0`**, and
  `tests/visual/browser-demo.visual.spec.ts` and `tests/ui-runtime.test.ts`
  pass unmodified — which is the evidence that omitting the `registration` key
  from the resolved model really does leave an undeclaring app byte-identical.

## Planning Handoff

**The next phase is the `User` profile record**, and it outranks everything
else in the repository right now: it is the only known defect that a person
using either shipped application sees about _themselves_, on the first screen,
every time. Its scope is the three decisions listed above — a create-step
record-identity construct, an answer to idempotent creation, and where a
display name (and a required `Email`) comes from — and the acceptance test is
the one this note could not write: after a brand-new person self-registers and
creates their group, their **name** renders on the member list, with no
`user-`/`person-` prefix anywhere, asserted at the same three layers Phase 101
used.

Two smaller candidates, both still standing from the body:

- **`contextMember.field` accepting `id`**, which is the only honest way to
  express "only people I share a context with" on an object that has no field
  holding its own id.
- **A shared-store rate limiter.** `FixedWindowRateLimiter` is per process, so
  every documented limit is really N× the limit on N replicas. That was
  tolerable when every mutating endpoint required a session; it is less
  comfortable now that one of them does not.
