# `.adlj` JSON Authoring Surface (Phase 73)

Read this before changing `.adlj` (`src/model/adlj-source.ts`,
`src/compiler/compile-adlj.ts`, `src/compiler/print-adl.ts`,
`parseExpressionSource`), before adding a new `Partial*Model` field to the
`.adl` pipeline, or before designing `PartialApplicationModel`-level source
merging.

## Full detail lives in `docs/spec/adlj.md`

This document records what was true only during implementation — decisions,
the defects that surfaced, and what to check before extending this surface.
The format's actual contract (scope boundary, expression-as-string rule, the
`match` default-inference gap, schema validation, the printer's
one-directional policy and its known gaps) is in `docs/spec/adlj.md`; read it
first for anything a `.adlj` *consumer* needs to know. This document is for
whoever next touches the *implementation*.

## `AdljSourceDocument`: derive with `Omit`/intersection, never hand-copy

`AdljSourceDocument`'s ~24 nested types are each declared as
`Omit<PartialXModel, "expressionField"> & { expressionField: string }`
against the real `Partial*Model` interfaces in `resolved-model.ts`, not
hand-copied field lists. This means a field added to the `.adl` text
pipeline in a future phase appears in `.adlj` automatically — only the small,
now-enumerated set of expression-bearing fields need a name added by hand.
**The full field-by-field audit that produced that enumeration matters more
than it looks**: the phase-73 planning document's own evidence section named
four expression-bearing categories ("field `VALIDATE`, lifecycle guards,
decision-table conditions, command preconditions... `SYNC WHERE`, computed
fields, read-model expression fields, list `WHERE`"); a full sweep of every
`ResolvedExpression`/`PartialPolicyConditionModel` field in `resolved-model.ts`
found **18 sites**, not that list — including `PartialContextGrantModel.condition`,
`PartialPresentationActionControlModel.input`/`visibleWhen`,
`PartialPresentationConditionalFragmentModel.when`, and — the one that would
have silently broken commands — **every `PartialCommand*StepModel.preconditions`**,
which is `PartialPolicyConditionModel[]`, not `ResolvedExpression[]` as the
sibling `Resolved*Step` interfaces are. Re-verify with a fresh grep
(`grep -n "ResolvedExpression\|PartialPolicyConditionModel" src/model/resolved-model.ts`)
before assuming this enumeration is still exhaustive after any change to
`resolved-model.ts`.

## The `Omit`-then-spread trap: destructure before you spread

Every JSON-to-Partial mapper in `compile-adlj.ts` follows one shape:

```ts
function objectToPartial(object: AdljObjectModel): PartialObjectModel {
  const { fields, computedFields, validations, lifecycle, views, sync, ...rest } = object;
  return {
    ...rest,
    ...(fields === undefined ? {} : { fields: fields.map(fieldToPartial) }),
    ...
  };
}
```

The first draft instead spread the whole source object first —
`{ ...object, ...(object.fields === undefined ? {} : { fields: ... }) }` —
which type-checks as plausible but **fails under `exactOptionalPropertyTypes`**:
`AdljObjectModel.fields` and `PartialObjectModel.fields` are different types
(`AdljFieldModel[]` vs `PartialFieldModel[]`), and when the conditional spread's
`{}` branch is taken, TypeScript's inferred type for the whole expression is a
*union* across both branches — one of which still carries the spread's
original, wrong-shaped `fields` type. The fix is to destructure every
field the mapper transforms out of the source object *before* spreading the
rest, so the base spread carries no conflicting key at all. This is the same
idiom `compile-adl.ts`'s AST-to-partial converters already use (they never
spread a base object of a different shape to begin with); it is worth
naming explicitly here because the failure mode is a wall of confusing
nested `exactOptionalPropertyTypes` errors, not an obviously-wrong line.

## `resolveApplicationModel` does less default-inference than `.adl` text's own front end

Two real, load-bearing findings from getting the golden-equivalence fixture
to `toEqual` byte-for-byte against the `.adl` original — both are things
`compileAdl`'s AST-to-partial conversion (`compile-adl.ts`) does that
`resolveApplicationModel` itself does not, meaning a JSON front-end that
skips the AST layer does not get them for free:

1. **`principal.match` has no default inference.** `compile-adl.ts`'s
   `principalToPartial` infers `match: "specific"` when `roles`/`users`/`groupRoles`
   is non-empty and `match` was not written. `resolvePrincipal` in
   `resolve-model.ts` defaults an omitted `match` to `"everyone"`
   unconditionally — it does not look at `roles` at all. Documented in
   `docs/spec/adlj.md` as a real authoring gotcha, not fixed here: fixing it
   would mean changing `resolveApplicationModel`'s shared behaviour for
   every `PartialApplicationModel` producer (including hand-built JSON
   conformance fixtures), which this phase's "no change to
   `resolveApplicationModel`" constraint explicitly ruled out — and rightly,
   since it would be a behaviour change with its own migration story, not a
   `.adlj`-specific fix.
2. **`contexts`/`readModels` are never defaulted to `[]`.** `compile-adl.ts`
   always supplies `contexts: ast.contexts.map(...)` and
   `readModels: ast.readModels.map(...)`, which are `[]` when nothing was
   declared — the AST never carries `undefined` for these. `resolveApplicationModel`
   treats an *omitted* `contexts`/`readModels` key as "not declared" and
   leaves it out of the resolved model, rather than defaulting it to `[]`.
   Cosmetic, not behavioural (nothing downstream distinguishes an empty
   array from an absent key), but it means a `.adlj` document that omits
   both keys will not `toEqual` an equivalent `.adl` model byte-for-byte.
   `examples/task-tracker.adlj` declares both explicitly for exact parity.

Neither of these is a defect — both are pre-existing, correct behaviour of
`resolveApplicationModel`, discovered only because this phase built a second
front end that bypasses the layer that was quietly compensating for them.
Worth remembering the general shape: **a shared "reused unchanged" pipeline
stage is only as shared as its actual inputs are equivalent**, and the AST
layer for `.adl` text has accumulated small ergonomic defaults over many
phases that were never pushed down into `resolveApplicationModel` itself
because no second front end existed to notice they weren't there.

## The printer: parenthesize everything, don't replicate precedence

`printExpression` wraps every binary/unary sub-expression in parentheses
unconditionally rather than tracking the parser's actual operator-precedence
table to omit redundant ones. This produces uglier output
(`(Priority >= 1) AND (Priority <= 10)` instead of
`Priority >= 1 AND Priority <= 10`) but is strictly safer: getting a
precedence table subtly wrong would silently change what a printed-then-reparsed
expression means, which is exactly the failure mode the printer's whole
contract ("reparses to the identical tree") exists to prevent. Revisit only
if output readability becomes a real complaint — it is a correctness/prettiness
trade made deliberately, not an oversight.

## JSON import needs `resolveJsonModule`, and must not use `readFileSync`

The generated schema (`src/model/adlj-schema.json`) is loaded with a static
`import adljSchema from "../model/adlj-schema.json" with { type: "json" }`,
requiring `"resolveJsonModule": true` in `tsconfig.json` (added by this
phase). The first implementation used
`readFileSync(new URL("../model/adlj-schema.json", import.meta.url))`, which
works under plain Node but **throws `TypeError: The URL must be of scheme
file` in every `happy-dom`-environment test** (`tests/ui-*.test.ts`), because
`compile-adlj.ts` is reached transitively through `src/index.ts`'s barrel
export, which the browser-environment tests also import, and `import.meta.url`
in that environment is not a `file://` URL. A static JSON import is resolved
by whatever loader is active (Node's ESM loader, or Vite for the browser
bundle) instead of doing a runtime filesystem read, so it works in both.
**Any future file this project needs to load by path from inside `src/`
should default to a static import, not `readFileSync` + `import.meta.url`,
unless it is known to run only in a pure-Node context** (the authority
server entry point, a CLI, a Node-only test).

## Browser bundle cost, not yet addressed

Reaching `compile-adlj.ts` through `src/index.ts`'s barrel export pulls
`ajv` and the generated schema into the browser bundle unconditionally: gzip
size grew from 158 KB to 203 KB at introduction. Nothing in this phase
required avoiding that, and the barrel-export-everything convention already
carries some Node-only surface the same way (see the `simplewebauthn-adapter.ts`
comment in `src/index.ts`), so this was accepted rather than solved. Code-splitting
`compile-adlj.ts`/`print-adl.ts` behind a dynamic `import()` — used only where
a `.adlj` authoring surface is actually reachable in the UI — is the natural
fix if this compounds with future additions. Not attempted here.

## Practical guidance

- Every new `.adlj` construct needs three things kept in sync by hand: the
  `AdljXModel` type in `adlj-source.ts`, the mapper function in
  `compile-adlj.ts`, and (automatically, via `npm run generate:adlj-schema`)
  the checked-in schema. Re-run the generator after any `adlj-source.ts`
  change — it is not run automatically as part of `npm test`/`typecheck`.
- A `.adlj` document that legitimately needs to prove equivalence with `.adl`
  text should be checked with `toEqual`, not `toMatchObject` — the two
  findings above (default inference, `contexts`/`readModels`) are exactly
  the kind of divergence a partial-match assertion would hide.
- Do not add expression-as-JSON-AST support to `.adlj`, ever, without a
  fresh design conversation. It was considered and rejected once already
  (see `docs/spec/adlj.md`) for a concrete, still-true reason: it would make
  the format's most consequence-bearing fields (policy conditions,
  validations, sync predicates) more error-prone to author by hand, not
  less — directly against the format's own purpose.
