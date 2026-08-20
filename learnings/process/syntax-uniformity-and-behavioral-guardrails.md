# Syntax Uniformity And Behavioral Guardrails (Phase 72)

Read this before changing ADL parser keyword aliases, modifier-value
parenthesization, `AUTO_ID`, `CONTEXT_MEMBER` policy principals, sync scope
windows, or `LOOKUP TARGET_FIELD`.

## Two independent classes of "compiles fine, wasn't what the author meant"

Phase 72 named two distinct traps an LLM (or a human new to the language) hits
without a compile step, and treated them with genuinely different mechanisms —
forcing one shape onto both would have been wrong for at least one of them.

- **Class A — spelling/shape ambiguity.** More than one legal spelling for the
  same construct, with no rule for which one to reach for. Self-correcting
  (a parse error) if guessed wrong, but pure waste to memorize.
- **Class B — behavioral surprise.** A construct that parses and validates
  cleanly and then silently does something other than a reasonable reading
  implies. No diagnostic, no feedback loop — worse than Class A because
  nothing tells the author it happened.

## Class A: two different enforcement mechanisms, not one

**Keyword aliases keep parsing, with a new warning.** `AdlParser` gained
`recordDeprecatedSpelling`/`matchCanonicalOrDeprecatedWord`/
`matchUnderscoreOrDottedWord`/`expectUnderscoreOrDottedWord` (`parser.ts`,
near the top of the `AdlParser` class) and a `styleWarnings: StyleWarningAst[]`
field on `AdlDocumentAst`. `compileAdl` (`compile-adl.ts`) turns each into an
`ADL_STYLE_DEPRECATED_SPELLING` warning-severity `Diagnostic` and merges it
ahead of `validateApplicationModel`'s own diagnostics. **This is a
parser-level fact with no representation on the resolved model** — a JSON
`PartialApplicationModel` (hand-built, or a future `.adlj` front-end) never
produces this diagnostic, because there is no "spelling" to have gotten wrong
once a model is already structured data. `MODEL_VALIDATION_CODES.STYLE_DEPRECATED_SPELLING`
lives in `validate-model.ts` anyway, alongside every other code, even though
`validateApplicationModel` itself never emits it.

The full catalogue is `docs/spec/language.md`'s "Deprecated Spellings" table —
21 constructs, not the 4 the originating plan document named. The 4 were what
surfaced from targeted greps; a full sweep (delegated to an `Explore` agent)
found a whole additional family — every `X_Y`/`X.Y` dotted-keyword pair
(`AUTO_ID`/`AUTO.ID`, `TOP_BAR`/`TOP.BAR`, `READ_MODEL`/`READ.MODEL`, and 12
more) — that used the exact same underscore-canonical convention Phase 59
already established but had never been given the same enforcement. Re-verify
against a fresh grep before assuming this list is exhaustive; the Constraints
section of a phase document that says "this is not exhaustive" means it.

**Modifier-value parentheses and `DECISION_TABLE ROW`'s `WHEN` are hard
parse errors, not warnings.** This is the one place the originating plan
document's own sections briefly disagreed with each other — one paragraph
described "the parser keeps accepting the deprecated spelling" as the
enforcement mechanism for all of Class A, while the Acceptance Criteria
section was unambiguous that `MIN 0` (bare) "now fails to parse" and a
`DECISION_TABLE ROW` with no `WHEN` "now fails to parse." The Acceptance
Criteria won, because it was the only place precise enough to be
unmisreadable, and because the Scope section's own migration list
(`domain.adl`, `ui.adl`, `examples/*.adl`) only makes sense as a
consequence of a real breaking change — nothing needs migrating for a
diagnostic that still compiles. `consumeModifierValue` now unconditionally
`expectSymbol("(", ...)`; `consumeStateListUntilTo` (the `ACTION FROM` state
list) does the same. Neither function tracks a style warning any more — a
bare value simply does not parse (`ADL_PARSE_EXPECTED_TOKEN`).
**When a phase document's prose and its Acceptance Criteria disagree on
enforcement mechanism, the Acceptance Criteria is the binding contract** —
prose is where an idea gets explained, criteria are what the phase is
actually graded against.

The practical consequence: every real `.adl` file, every test-embedded ADL
source string, and every conformance-JSON `"adl": [...]` fixture using a bare
modifier value needed migrating in this phase, not left to warn. `grep`-based
sweeps found five separate failure classes across the run — reference-app
source, `examples/*.adl`, `tests/*.test.ts` string literals, and JSON
conformance fixtures embedding ADL text — because a hard parse error surfaces
differently depending on whether the calling test asserts on `diagnostics`
(a value mismatch) or just calls `compileAdl`/`parseAdl` directly (a thrown
`ParseError`, visible only by running the suite, not by grepping for an
assertion pattern).

## Class B: four gaps, four different treatments

None of the four got the same fix shape — read `docs/phases/phase-72-*.md`'s
"The Decision" section for the reasoning behind each, not just the outcome:

1. **`AUTO_ID` with no `DEFAULT`** — refused at the time (`ADL_AUTO_ID_NO_DEFAULT`),
   because `AUTO_ID` minted nothing at runtime yet, so a field declaring it
   with no fallback value had no reading that produced correct behaviour.
   **Superseded by Phase 74**: `ObjectStore.planCreateForTransaction` now
   mints a value on create, so the refusal was removed — see
   [[auto-id-minting]]. This entry is kept as the historical record of why the
   refusal existed, not as current behaviour.
2. **`CONTEXT_MEMBER` granted `SEARCH`** — refused
   (`ADL_POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE`). Confirmed genuinely
   unchecked before this phase (not already refused, as the plan flagged as a
   possible outcome) — `recordBelongsToContextMember` returns `false`
   whenever `record === undefined`, and every `search` policy check
   (`object-store.ts`, `read-model-service.ts`) issues with no `record` at
   all, so the combination silently never matched.
3. **`SCOPE recent`'s implied window** — made visible, not refused.
   `ResolvedSyncWindow.windowSource: "authored" | "impliedByScope"`. See
   [[offline-dataset-runtime]] for what a window means; this only adds
   provenance to one that already existed.
4. **`LOOKUP TARGET_FIELD` unhonoured by a `currentUser` read-model source** —
   warned, not fixed, by this phase.
   `ADL_LOOKUP_TARGET_FIELD_CURRENT_USER_SOURCE_UNHONOURED`
   named the one shape known to hit the gap (`recordMatchesCurrentUser`
   matched by identity against `RUNTIME.userId`, which a `TARGET_FIELD`
   lookup's stored natural-key value will never equal). The browser UI's
   lookup-label display had the identical defect and no equivalent check —
   deliberately out of scope, named as a candidate below. **Phase 75 fixed
   both paths for real** (`recordMatchesCurrentUser` now compares against the
   current user's own record's target-field value; the browser lookup-label
   display now does an exact-match search when a lookup declares
   `TARGET_FIELD`) and removed this diagnostic, since the defect it warned
   about no longer exists. See [[read-model-runtime]].

## Two real capability gaps this phase made visible but did not close — both since closed

At the time this phase shipped, both remained exactly as true after it as
before it — the guardrails named them, they did not fix them.

- ~~**`AUTO_ID` runtime minting.**~~ Closed by Phase 74 — see
  [[auto-id-minting]]. `ObjectStore.planCreateForTransaction` now mints a
  value for every `AUTO_ID` field with no caller-supplied value, and
  `ADL_AUTO_ID_NO_DEFAULT` was removed because it would now refuse a
  perfectly legal, functional declaration.
- ~~**The two `LOOKUP TARGET_FIELD`-unhonoured paths.**~~ Both fixed in Phase
  75 — see the note above and
  [[read-model-runtime]]/[[browser-ui-runtime]]. `recordMatchesCurrentUser`
  now compares against the current user's own record's target-field value
  instead of matching by identity, and the browser lookup-label display now
  does an exact-match search when a lookup declares `TARGET_FIELD`.
- ~~**The two smaller `TARGET_FIELD` gaps Phase 75 found and left open.**~~
  Both closed in a later pass. `OfflineDatasetService`'s own
  `recordMatchesCurrentUser` (for `SYNC ... SCOPE currentUser`/`assignedToUser`/`ownedByUser`,
  not a read-model source) had the identical identity-only defect as
  `ReadModelService`'s did before Phase 75 — fixed the same way, by reading
  the current user's own record and comparing its `targetField` value, minus
  the read-policy gate `ReadModelService` needs and this file does not (it
  decides what a device *syncs*, not what a caller may *read*). Making the
  fix async required converting its entire caller chain
  (`recordMatchesSyncScope`, `recordMatchesReadModelSource`,
  `getObjectSyncReasons`, `getReadModelSourceReasons`,
  `recordSatisfiesWindowLimit`, `recordSatisfiesDeclaredBound`,
  `getDatasetReasons`, `computeWindowLimitRecordIds`) to `async`/`await`,
  replacing every `.filter()`/`.flatMap()` over an async predicate with a
  sequential `for` loop — `Array.prototype.filter` cannot await. See
  [[offline-dataset-runtime]]. `adl-field-renderer.ts`'s lookup `<select>`
  had the write-side counterpart: every candidate `<option>`'s `value` was
  the candidate's own record id (`option.meta.guid`) unconditionally, so
  choosing an option wrote a record id into a field meant to hold a
  `TARGET_FIELD` natural key. Fixed with a `lookupOptionValue` helper
  (mirroring the existing `lookupLabel` helper's `displayField` pattern) that
  reads the declared `targetField` off each candidate instead, falling back
  to the record id only when `targetField` is unset. See
  [[browser-ui-runtime]]. Both fixes verified with a regression test
  confirmed to fail against the pre-fix code (stashed, re-run, restored) and
  pass against the fix, not just written and assumed correct.

## Practical guidance

- A new keyword alias needs the same treatment as every other: pick canonical
  by real corpus usage (`src/reference/*/{domain,ui}.adlj`, `examples/*.adl`,
  `examples/multi-source/*`, `conformance/**/*.json`) when it exists, not by
  guessing, and wire it
  through `matchCanonicalOrDeprecatedWord`/`matchUnderscoreOrDottedWord`
  rather than a bare `matchWord(X) || matchWord(Y)` — the latter is exactly
  the pattern this phase spent its effort undoing.
- A new modifier value (a `KEYWORD <value>`-shaped clause) should go through
  `consumeModifierValue`/`consumeIntegerModifierValue` from the start, so it
  is parenthesized-only from birth rather than joining a future cleanup list.
- After adding or migrating `.adl` source — reference app, examples, or a
  test fixture — always run it through `compileAdl` and inspect
  `diagnostics`, per `AGENTS.md`'s standing rule. This phase is the concrete
  case that rule exists for: a spelling that looks plausible from reading the
  spec is a guess until the compiler has actually run over it, and this
  phase changed what the compiler accepts.
