# Phase 72 - Syntax Uniformity And Behavioral Guardrails

> This phase is not derived from re-reading a subsystem a prior phase
> touched. It is commissioned directly by the user, by name, following a
> conversation about why LLM-authored ADL source is harder to get right
> first time than Go or TypeScript. That conversation identified two
> distinct classes of trap — spelling/shape ambiguity in the grammar
> ("Class A") and syntactically-valid constructs that behave surprisingly
> at runtime ("Class B") — and this phase addresses both, plus starts the
> process change ("compile-check ADL source before presenting it", now in
> `AGENTS.md`/`CLAUDE.md`) that the same conversation identified as the
> single highest-leverage, lowest-cost fix. Per
> `learnings/process/phase-execution.md`'s "Rolling Handoff Stopped At Phase
> 63" rule, no phase after 64 is code-derived; this is the same condition
> that authorised Phase 69, Phase 70, and Phase 71.
>
> **This document is a plan, not a completed phase.** Unlike Phase 71's
> document (written after execution, with actual test counts), nothing
> below has been implemented. It exists so the design decisions — the part
> most worth getting right before touching the parser and the reference
> app — are settled first. Executing it is a separate step.

## Objective

Reduce two independent classes of "compiles fine, but wasn't what the
author meant" risk in ADL source, identified while assessing how reliably
an LLM (or a human new to the language) gets ADL right without a compile
step:

- **Class A — spelling/shape ambiguity.** The grammar currently accepts
  more than one legal spelling for the same idea in several places, with
  no consistent rule for which constructs require which spelling. Getting
  this wrong today is already a parse error (self-correcting, cheap), but
  every inconsistent case is still a fact someone has to memorize rather
  than infer, and it is pure waste: no author benefit trades off against
  it.
- **Class B — behavioral surprise.** A handful of constructs parse and
  validate cleanly today but silently do something other than a reasonable
  reading implies — no diagnostic, no compile-time signal, discoverable
  only by reading a caveat paragraph or by testing runtime behaviour
  directly. This class is more dangerous than Class A because it produces
  no feedback loop at all.

Both classes are enumerated below with the current evidence for each. Class
A gets a uniform spelling rule and a deprecation path for the spelling that
loses. Class B gets, case by case, either a new compile-time refusal, a
resolved-model transparency addition, or an explicit "this is a real
capability gap, not a consistency issue" call-out — the three are not
interchangeable and this phase does not force one shape onto all four
cases.

## Evidence and Dependency

Re-verify against current code (main at `df2e106`) before executing — the
line numbers below are grep-confirmed as of this writing but a full
enumeration (see "Constraints") is itself the first execution task, not
assumed complete here.

### Class A inventory, confirmed sites

- **Optional-vs-mandatory parentheses**, `src/parser/parser.ts:1264-1304`
  (`parseFieldValidator` or equivalent): `DEFAULT`, `MIN`, `MAX`,
  `MIN_LENGTH`, `MAX_LENGTH`, and `MAX_SIZE` each accept their argument bare
  or parenthesised (`MIN 0` and `MIN(0)` both parse). `IN` and `MIME_TYPE`,
  a few lines later in the same chain, require parentheses because their
  argument is a comma-separated list. `docs/spec/language.md:160-164`
  documents this exact split today as a fact of the language rather than
  a wart — this phase proposes changing that framing.
- **Exact keyword aliases**: `VALIDATE`/`PREDICATE` at the field-validator
  level (`parser.ts:1308`, `this.matchWord("VALIDATE") ||
  this.matchWord("PREDICATE")`); `CHANNEL`/`CHANNELS` on a policy rule
  (`parser.ts:3221`); `=`/`FROM` on a `DECISION_TABLE INPUT` line
  (`parser.ts:3526`, `this.matchSymbol("=") || this.matchWord("FROM")`,
  comment: `// Both forms are accepted for readability`).
- **Optional noise keyword**: `WHEN` after a `DECISION_TABLE ROW` name is
  itself optional (`parser.ts:3540`, comment: `// WHEN is optional noise
  after the row name`) — `ROW bulk amount >= 1000 OUTPUT ...` and `ROW bulk
  WHEN amount >= 1000 OUTPUT ...` both parse. Not previously named in the
  conversation that commissioned this phase; found while re-reading the
  `DECISION_TABLE INPUT` alias site for this document, and included because
  it is the same class of trap under a different mechanism (an optional
  token rather than an alternate spelling).

Not yet enumerated, and required before implementation: every other
`matchWord(X) || matchWord(Y)` and every other bare-vs-parenthesised
argument site in `parser.ts`. The four bullets above are what surfaced
from targeted greps for the cases already discussed; they are evidence
that the pattern is real and worth fixing, not a claim that the list is
exhaustive.

### Class B inventory, confirmed against `docs/spec/language.md`

1. **`AUTO_ID` is declarative-only.** `language.md:189-193`: "`AUTO_ID` is
   declarative only today: it is captured and validated on the resolved
   field, but no runtime path mints a value from it." A field declared
   `AUTO_ID` with no `DEFAULT` parses and validates cleanly and then simply
   never gets a value from the mechanism its own declaration names.
2. **`CONTEXT_MEMBER` cannot gate `SEARCH`.** `language.md:398-400`: "It
   **cannot gate `search`**. The object-level search check is evaluated
   with no record, so there is nothing for the field to be read from."
   Nothing in the spec text names a diagnostic for this — the phrasing
   describes a rule that silently never fires, not one the validator
   currently refuses. Confirm this reading against `validate-model.ts`
   and `policy-engine.ts` before implementing.
3. **`SCOPE recent` uniquely implies a window.** `language.md:310-312`:
   "`SCOPE recent` with no window resolves to 30 days over `_updatedAt`
   ... It is the one scope that *implies* a window; every other scope
   bounds nothing unless the model says so." This is a deliberate,
   documented default, not a bug — it does not belong in Class A's "pick
   one spelling" treatment or get a compile-time refusal. It is included
   in Class B because a resolved model built from `SCOPE recent WHERE ...`
   and one built from `SCOPE currentContext WINDOW ... 30 DAYS` currently
   look identical downstream, with no record of which was authored and
   which was defaulted.
4. **`LOOKUP TARGET_FIELD` unhonoured by two legacy paths.**
   `language.md:926-932`: a "current user" read-model scope match against a
   lookup field, and the browser UI's lookup-label display, both match by
   identity and do not yet honour `TARGET_FIELD`. Named in the spec as a
   caveat, not gated by any diagnostic.

## The Decision

### Class A: one spelling per construct

Two sub-decisions, because "pick the shorter form everywhere" does not
survive contact with `IN`/`MIME_TYPE`'s structural need for parentheses
around a comma-separated list (`IN 'Active', 'Closed'` is genuinely
ambiguous against a following clause in a way `IN ('Active', 'Closed')` is
not).

- **Parenthesization: require parentheses everywhere, not bare-or-either.**
  Rejected alternative: make parentheses optional everywhere, including
  `IN`/`MIME_TYPE`. That would need a permanent special case in the grammar
  (list arguments still need a delimiter of some kind) and would still
  leave two shapes to remember, just with the asymmetry flipped. Requiring
  parentheses uniformly removes the asymmetry with no structural exception
  left over: `MIN(0)`, `MAX(150)`, `DEFAULT(0)`, `MAX_SIZE(5000000)` join
  `IN(...)`/`MIME_TYPE(...)` as the only legal forms.
- **Aliases: keep exactly one canonical spelling per pair, going forward.**
  For each of `VALIDATE`/`PREDICATE`, `CHANNEL`/`CHANNELS`, and
  `INPUT name = expr`/`INPUT name FROM expr`, pick the canonical form as
  whichever the reference app and conformance corpus already predominantly
  use (verify during execution — do not guess), so canonicalization forces
  minimal reference-app churn rather than an arbitrary pick. The
  `DECISION_TABLE ROW`'s optional `WHEN` is handled the same way as an
  alias pair conceptually (`WHEN` present vs `WHEN` absent) — recommend
  making `WHEN` **required**, not dropped, since a bare condition
  immediately after a row name reads worse and `WHEN` costs one word to
  require permanently rather than sometimes.
- **Enforcement without breaking existing content.** No `adlfmt` formatter
  exists yet (a Tier 1 idea from the originating conversation, not built).
  Until one does, enforcement in this phase is: the parser keeps accepting
  the deprecated spelling but the validator emits a new **warning-severity**
  diagnostic (`ADL_STYLE_DEPRECATED_SPELLING`, one code reused across all
  four constructs with a construct-specific message) rather than an error,
  so no existing `.adl` file — including every conformance case not
  produced by this phase — needs to change to keep compiling. Migrating
  Giggle Band's `domain.adl`/`ui.adl` and `docs/spec/language.md`'s
  examples to the canonical spelling is in scope for this phase (see
  "Scope"), because `df2e106`, the commit immediately preceding this one,
  is "Ground language.md examples in real Giggle Band ADL source" — spec
  examples matching the reference app's actual spelling is an
  already-established, actively-maintained property of this repository,
  and shipping a new canonical form the spec teaches while the reference
  app keeps using the deprecated one would immediately break that
  property.
- **Explicitly not in scope**: removing the deprecated spelling. That is a
  breaking grammar change against every `.adl` file this project or any
  downstream user has ever written and is a separate decision with its own
  migration story, not a free consistency cleanup.

### Class B: compile-time refusal, resolved-model transparency, or an honest "not this phase" — decided per case

Class B is not one fix shape. Forcing all four into "add a validator
error" would be wrong for at least one of them (case 3 is a deliberate
default, not a defect), so each is decided on its own facts:

1. **`AUTO_ID` with no `DEFAULT`: refuse it.** New diagnostic
   `ADL_AUTO_ID_NO_DEFAULT`. Rationale: today this field declaration
   parses, validates, and then does nothing its own keyword promises —
   there is no reading of `AUTO_ID` with no `DEFAULT` that produces
   correct behaviour, so refusing it costs a real author nothing and saves
   discovering the gap in production. Implementing actual runtime minting
   is a separate, larger capability (a real feature, not a consistency
   fix) and is explicitly out of scope here — see "Non-goals".
2. **`CONTEXT_MEMBER` gating `SEARCH`: refuse it, once confirmed silent
   today.** New diagnostic (tentatively
   `ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE`) refusing a policy rule
   whose action includes `SEARCH` and whose principal is `CONTEXT_MEMBER`.
   Same rationale as `AUTO_ID`: a rule that can never fire is worse than a
   parse error, because it looks like a working grant. If evidence
   re-verification instead finds this is already refused today, this item
   drops from scope with no other change needed.
3. **`SCOPE recent`'s implied window: make it visible in the resolved
   model, do not refuse anything.** Add an explicit flag distinguishing an
   authored `WINDOW` from one a scope implied by default (for example
   `ResolvedSyncScope.windowSource: "authored" | "impliedByScope"`), so a
   future inspection tool — or a human reading a dumped resolved model —
   never has to already know `recent`'s special case to answer "was this
   90-day bound intentional." This is additive and non-breaking: every
   existing resolved model gains one field, nothing currently valid
   becomes invalid.
4. **`LOOKUP TARGET_FIELD` unhonoured paths: warn, do not fix the paths.**
   New warning-severity diagnostic when a `TARGET_FIELD` lookup field is
   used in the one shape known to hit an unhonoured path today (a
   "current user" read-model source scope match against that field).
   Fixing the browser UI's lookup-label display and the "current user"
   match themselves is real implementation work against
   `implementation/read-model-runtime.md`/`implementation/context-runtime.md`
   territory (see `learnings/index.md`'s routing for that area) and does
   not belong in a phase framed as consistency and guardrails — flagged
   here as a **named candidate for a future phase**, not claimed by this
   one, matching Phase 71's own restraint around the audit-configuration
   gap it found and did not fix.

## Scope

- `src/parser/parser.ts`: parenthesization made mandatory at the
  identified sites (and any further site the full re-verification finds);
  `WHEN` required on `DECISION_TABLE ROW`; deprecated-alias acceptance
  kept, paired with the new style diagnostic.
- `src/compiler/validate-model.ts`: `ADL_STYLE_DEPRECATED_SPELLING`;
  `ADL_AUTO_ID_NO_DEFAULT`; `ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE`
  (pending confirmation it does not already exist); the `TARGET_FIELD`
  legacy-path warning.
- `src/model/resolved-model.ts`: `windowSource` (or equivalent) on the
  resolved sync-scope shape.
- `docs/spec/language.md`, `docs/spec/resolved-model.md`,
  `docs/spec/runtime-semantics.md`: canonical spellings taught throughout;
  deprecated spellings mentioned once each, not used in running examples;
  the four Class B behaviours documented as compile-time-checked (1, 2, 4)
  or resolved-model-visible (3) rather than only as prose caveats.
- `src/reference/giggle-band/domain.adl`, `.../ui.adl`: migrated to
  canonical spellings wherever they currently use a deprecated one.
- `conformance/**/*.json`: existing cases updated only where they
  deliberately exercise a deprecated spelling (kept, to prove the
  deprecation warning fires and old content still compiles); otherwise
  migrated to canonical form so the corpus itself teaches the canonical
  grammar, consistent with `df2e106`'s reasoning for `language.md`.
- Tests: `tests/parser.test.ts`, `tests/model-validation.test.ts`,
  `tests/conformance-suite.test.ts` (via new conformance cases).
- `learnings/` (new document; `learnings/index.md` updated).

## Constraints

- The first execution task is the full re-verification this document's
  Evidence section flags as incomplete: every optional-parenthesis site
  and every `matchWord(X) || matchWord(Y)`-shaped alias in `parser.ts`,
  not only the four confirmed here. Do not implement against a partial
  list and call it done.
- No removal of a deprecated spelling's acceptance. Warning-severity only,
  this phase.
- No `AUTO_ID` runtime minting implementation. Class B item 1 refuses a
  currently-broken declaration; it does not build the feature that would
  make the declaration meaningful.
- No fix to the two `TARGET_FIELD`-unhonoured paths. Class B item 4 adds a
  warning only.
- Canonical spelling choice for each Class A alias must be verified
  against actual corpus usage, not assumed, before migrating anything.

## Deliverables

Listed under "Scope" above; repeated here as the completion checklist once
executed.

- Mandatory parentheses on `DEFAULT`/`MIN`/`MAX`/`MIN_LENGTH`/`MAX_LENGTH`/
  `MAX_SIZE`, joining `IN`/`MIME_TYPE`.
- Required `WHEN` on `DECISION_TABLE ROW`.
- `ADL_STYLE_DEPRECATED_SPELLING` warning on each deprecated alias form,
  alias acceptance otherwise unchanged.
- `ADL_AUTO_ID_NO_DEFAULT` refusing `AUTO_ID` fields with no `DEFAULT`.
- `ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE` (or evidence it already
  exists, with this item dropped).
- `windowSource` (or equivalent) on the resolved sync-scope shape.
- `TARGET_FIELD` unhonoured-path warning.
- Spec docs, reference app, and conformance corpus migrated to canonical
  spellings.
- `learnings/` write-up naming the two remaining, explicitly out-of-scope
  capability gaps (`AUTO_ID` minting; the two `TARGET_FIELD` paths) as
  candidates for a future phase.

## Acceptance Criteria

- `MIN 0` (bare) now fails to parse; `MIN(0)` still parses. Same pattern
  for every site in scope.
- A deprecated-alias spelling (e.g. `PREDICATE`) still compiles, and its
  compile now includes an `ADL_STYLE_DEPRECATED_SPELLING` diagnostic
  naming the canonical replacement.
- `DECISION_TABLE ROW bulk amount >= 1000 OUTPUT ...` (no `WHEN`) now
  fails to parse; `ROW bulk WHEN amount >= 1000 OUTPUT ...` still parses.
- A field declared `AUTO_ID` with no `DEFAULT` fails validation with
  `ADL_AUTO_ID_NO_DEFAULT`; the same field with a `DEFAULT` still
  validates.
- A policy rule granting `SEARCH` to `CONTEXT_MEMBER` fails validation
  (unless evidence shows this was already refused, in which case this
  criterion is dropped and recorded as such).
- A resolved model built from `SCOPE recent` with no authored `WINDOW`
  reports its window as implied, not authored; one built with an explicit
  `WINDOW` on any scope reports it as authored.
- Giggle Band's resolved model (`tests/band-reference-app.test.ts`)
  compiles clean of every new error-severity diagnostic introduced here.
- `npm test`, `npm run typecheck`, and `npm run format:check` pass.
- `npm run verify:push` passes if any Giggle Band `.adl` source or
  rendered UI changed as part of the migration (expected, since
  `domain.adl`/`ui.adl` are in scope).
- Every pre-existing conformance case and unit test unrelated to this
  phase is unmodified and still passes, except where deliberately migrated
  to canonical spelling per "Scope".

## Testing (planned)

- `npm test` — parser, model-validation, and conformance-suite cases for
  every new diagnostic and every tightened grammar rule, plus regression
  coverage that the deprecated spellings still compile with a warning.
- `npm run typecheck`, `npm run format:check`.
- `npm run test:integration` — expected not required; nothing in this
  phase touches the authority server, PostgreSQL projection, or the HTTP
  edge. Confirm this holds once the diff is final rather than assuming it
  from this plan.
- `npm run verify:push` — required if `domain.adl`/`ui.adl` migrate to
  canonical spellings, since that changes Giggle Band's compiled UI
  source even if no rendering output actually differs. Screenshots must
  still be inspected, not merely run, per standing testing policy.

## Non-goals

- `AUTO_ID` runtime minting (Class B item 1's underlying capability).
- Fixing the two `TARGET_FIELD`-unhonoured paths (Class B item 4's
  underlying capability) — the "current user" read-model scope match and
  the browser UI's lookup-label display.
- An `adlfmt` formatter. Referenced as the eventual proper enforcement
  mechanism for Class A; not built here. Warning diagnostics are this
  phase's enforcement.
- A formal grammar file (PEG/ANTLR/Ohm) as a generated single source of
  truth for the parser. A separate, larger idea from the same originating
  conversation; not started here.
- The `.adlj` JSON authoring-surface idea from the same conversation. Real
  and worth pursuing, but its own design decision (expression
  representation inside a JSON source format, printer fidelity, staleness
  policy between `.adl` and `.adlj`) — see "Planning Handoff".
- Removing any deprecated spelling's acceptance outright.

## Dependencies

- `src/parser/parser.ts` (`parseFieldValidator`-equivalent branch chain
  around lines 1264-1308, `parseDecisionTableInput`, `parseDecisionTableRow`,
  the `CHANNEL`/`CHANNELS` branch around line 3221).
- `src/compiler/validate-model.ts` (wherever `AUTO_ID`, policy principal/
  action matching, and `LOOKUP TARGET_FIELD` are currently validated).
- `src/model/resolved-model.ts` (resolved sync-scope shape).
- `docs/spec/language.md`, `resolved-model.md`, `runtime-semantics.md`.
- `src/reference/giggle-band/domain.adl`, `ui.adl`.
- `conformance/**/*.json` and `tests/conformance-suite.test.ts`'s glob.
- `learnings/index.md` and whichever existing learning documents currently
  describe `AUTO_ID`, policy evaluation, and offline dataset scope (route
  through `learnings/index.md`'s own "before tasks that..." index rather
  than assumed here).

## Parallel Execution Plan

Class A and Class B are genuinely independent workstreams (different
files, different diagnostics, no shared types), so this phase fans out
after the full re-verification (a strictly serial prerequisite, since
Class A's migration scope depends on its result):

1. **Serial spine**: full re-verification of every Class A site (the
   "Constraints" item above), and confirmation of Class B item 2's current
   behaviour against `validate-model.ts`/`policy-engine.ts`. Nothing else
   starts until this lands, because it determines the actual diff size for
   both streams.
2. **Fan out, two agents**:
   - Agent A: Class A — parser changes, deprecated-alias diagnostic,
     spec/reference-app/conformance migration to canonical spellings.
   - Agent B: Class B — the four validator/resolved-model changes and
     their conformance cases.
3. **Barrier**: `npm test` once both land, since Giggle Band's resolved
   model (touched by both streams) must compile clean of both changes
   together, not each in isolation.
4. **Barrier**: `npm run verify:push` once, at the end, only if Agent A's
   reference-app migration actually changed `domain.adl`/`ui.adl` content
   (expected).

## Tasks

1. Full re-verification of Class A sites and Class B item 2's current
   behaviour (serial spine above).
2. `src/parser/parser.ts`: mandatory parentheses; required `WHEN`;
   deprecated-alias diagnostic wiring.
3. `docs/spec/language.md` etc.: canonical spellings throughout; deprecated
   forms mentioned once each.
4. `src/reference/giggle-band/domain.adl`, `ui.adl`: migrate.
5. `conformance/**/*.json`: migrate, except cases deliberately proving the
   deprecation warning.
6. `src/compiler/validate-model.ts`: the four Class B diagnostics/flags.
7. `src/model/resolved-model.ts`: `windowSource` (or equivalent).
8. Tests: parser, model-validation, conformance cases for every item.
9. `npm test`, `npm run typecheck`, `npm run format:check`.
10. `npm run verify:push` if reference-app source changed.
11. `learnings/` new document plus `learnings/index.md` update, naming the
    two out-of-scope capability gaps as candidates.
12. Planning handoff.
13. Commit and push.

## Planning Handoff

Two named candidates surfaced by this document's own "Non-goals", neither
claimed here, per the same standing rule Phase 71 used for the
audit-configuration gap it found:

- **`AUTO_ID` runtime minting** and **the two `TARGET_FIELD`-unhonoured
  paths** are real, currently-live capability gaps this phase's guardrails
  make visible (via a refusal and a warning, respectively) but does not
  close. Either is a legitimate next phase if the user wants the
  capability rather than only the guardrail.
- **The `.adlj` JSON authoring-surface idea.** Worth recording precisely
  because `compile-adl.ts`'s actual pipeline
  (`parseAdl` → `adlAstToPartialApplicationModel` → `resolveApplicationModel`
  → `validateApplicationModel`) already separates "get to a
  `PartialApplicationModel`" from "resolve and validate it" — a JSON
  front-end producing `PartialApplicationModel` directly would share 100%
  of resolution and validation with the text parser, not duplicate it, so
  the "two divergent compilers" risk that idea would carry in a
  differently-shaped codebase mostly does not apply here. The one design
  question that does need settling before that phase could be scoped:
  `PartialApplicationModel`'s expression-bearing fields (`VALIDATE`/`WHEN`/
  `WHERE`/decision-table conditions) already hold structured
  `ResolvedExpression` trees, not source text — a JSON format that
  expanded every expression into a hand-authored AST would be more
  error-prone to write than ADL's infix expression syntax, not less, which
  would work against the idea's own goal. A `.adlj` phase should keep
  expressions as embedded strings in the existing infix syntax, parsed as
  a leaf conversion, and use JSON structure only for the declarative
  skeleton around them. Per the standing rule, this is recorded as a
  candidate for the user to commission, not claimed as this phase's own
  handoff.

## Closing Note

Not yet executed. This document exists to settle the design — the uniform
spelling rule for Class A, and the case-by-case (refuse / make visible /
name-as-out-of-scope) treatment for Class B — before any parser or
reference-app change is made, per the user's explicit "don't change
anything yet" instruction earlier in the conversation that produced this
plan. The "compile-check ADL source before presenting it" process change
this document's provenance note references is not part of this phase's
scope — it was added directly to `AGENTS.md` and `CLAUDE.md` as an
immediate, zero-risk process change, separately from this document.
