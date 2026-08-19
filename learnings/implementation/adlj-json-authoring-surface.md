# `.adlj` JSON Authoring Surface (Phase 73, Phase 77)

Read this before changing `.adlj` (`src/model/adlj-source.ts`,
`src/compiler/compile-adlj.ts`, `src/compiler/print-adl.ts`,
`src/compiler/adl-to-adlj.ts`, `parseExpressionSource`), before adding a new
`Partial*Model` field to the `.adl` pipeline, or before designing
`PartialApplicationModel`-level source merging.

## Full detail lives in `docs/spec/adlj.md`

This document records what was true only during implementation — decisions,
the defects that surfaced, and what to check before extending this surface.
The format's actual contract (scope boundary, expression-as-string rule, the
`match` default-inference gap, schema validation, the printer's
one-directional policy and its known gaps) is in `docs/spec/adlj.md`; read it
first for anything a `.adlj` *consumer* needs to know. This document is for
whoever next touches the *implementation*.

## Phase 76: `PartialApplicationModel`-level source merging

Phase 73 deliberately left "mixing `.adl` and `.adlj` sources in one
`app.yaml`" and "merging several `.adlj` files" out of scope, because
`compileAdlProject`'s only merge rule (`mergeViewOnlyObjectDeclarations`) ran
at the AST level over one string-concatenated `.adl` parse, and no
equivalent existed at the `PartialApplicationModel` level. Phase 76 built
that equivalent. Full user-facing contract in `docs/spec/adlj.md`'s "Scope"
section; this is the implementation-side record.

- **New type, not a new pipeline stage**: `PartialApplicationModelFragment`
  (`src/model/resolved-model.ts`) is `PartialApplicationModel` with `app` and
  `shell` also made optional (`modelVersion` already was). One source file —
  `.adl` or `.adlj` — produces one fragment; `mergePartialApplicationModelFragments`
  (`src/compiler/merge-partial-model.ts`) combines an ordered array of them
  into one real `PartialApplicationModel`, which then goes through
  `resolveApplicationModel`/`validateApplicationModel` exactly once, same as
  always. Nothing about the resolve/validate stage changed.
- **Three different merge policies, one per field shape**: `app` and
  `modelVersion` are "first fragment that declares one wins"; `shell` is
  "last fragment that declares one wins" (chosen specifically to reproduce
  today's actual `.adl`-concatenation behaviour — `parseDocument`'s loop
  just overwrites `shell` with no merging every time it sees a `SHELL`
  block, so whichever block is textually last already wins); every other
  array field (`roles`, `contexts`, `readModels`, `decisionTables`,
  `commands`, `policies`, `themes`, `sync`, `migrations`) is a plain
  fragment-order concatenation; `objects` is a concatenation followed by the
  view-only-object merge pass. Four different rules for what looks like one
  "combine several partial models" operation — worth remembering as a
  pattern the next time a similar merge is needed: don't assume one policy
  fits every field, ask what each field's *first-declaration-wins* vs.
  *last-wins* vs. *union* semantics should be by checking what the existing
  single-parse behaviour already does for it.
- **The view-only-object check must test `undefined`, not `.length === 0`**.
  `compile-adl.ts`'s AST-level `isViewOnlyObjectDeclaration` checks
  `object.fields.length === 0` etc., because `ObjectDeclarationAst`'s array
  fields are never `undefined` — the parser always produces an array, empty
  or not. `PartialObjectModel`'s equivalent fields are genuinely optional,
  so the `PartialApplicationModel`-level check
  (`isViewOnlyObject` in `merge-partial-model.ts`) tests `=== undefined`
  instead: "declares nothing but a name and views" means the fragment never
  mentioned the field, not that it mentioned it with an empty array. Porting
  an AST-level structural check to the `Partial*Model` level is not a
  mechanical find-and-replace of the field names — the "unset" representation
  is genuinely different between the two layers.
- **`compileAdlProjectV2` cannot parse each `.adl` source separately**, for
  the same reason `.adlj` couldn't originally be given parity by a small
  patch: `.adl`'s parser requires `APP ... END.APP` as the literal first
  thing in any document (`parseDocument` calls `parseApp()` unconditionally
  before its main loop), so a fragment like `ui.adl` with no `APP` block is
  not independently parseable. `compileAdlProjectV2` sidesteps this by
  concatenating *all* `.adl`-extension manifest entries into one text blob
  first (exactly as `compileAdlProject` already does), parsing that once
  into a single fragment, and only compiling `.adlj` entries independently.
  This is why fragment ordering places that one `.adl`-derived fragment at
  the position of the *first* `.adl` entry rather than truly interleaving
  fragment-per-file — a real, named limitation (see `docs/spec/adlj.md`), not
  an oversight.
- **`compileAdlProject` itself was not touched.** `compileAdlProjectV2` is an
  additive sibling in the same file, sharing `parseAdlProjectManifest`
  unchanged. The existing Giggle Band `compileAdlProject` test continues to
  pass unmodified, and a dedicated regression test
  (`tests/compile-adl-project-v2.test.ts`) recompiles Giggle Band through
  `compileAdlProject` again to confirm no shared code path regressed.
- **Fixtures**: `examples/multi-source/` holds both a three-file `.adlj`-only
  split (`tasks-core.adlj` + `tasks-views.adlj` + `tasks-policy.adlj`,
  proving array concatenation and the view-only merge together) and a mixed
  `.adl` + `.adlj` pair (`domain.adl` + `extra.adlj`). Neither reuses
  `examples/task-tracker.adl`/`.adlj` — those stay the single-document
  fixture Phase 73 introduced.

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

## Phase 77: the importer reuses the printer's expression printers, not a second implementation

`partialApplicationModelToAdljSource` (`src/compiler/adl-to-adlj.ts`) is the
`PartialApplicationModel -> AdljSourceDocument` direction — the mirror image
of `adljSourceToPartialApplicationModel` (`compile-adlj.ts`). The key design
decision was **not writing a second expression-to-string printer**:
`print-adl.ts` already had `printExpression`/`printCondition`, both
previously module-private. This phase's entire change to `print-adl.ts` is
adding the `export` keyword to those two function declarations — no logic
touched, so it cannot conflict with a concurrent agent extending that file's
presentation coverage. Every other `.adl`/`.adlj`-adjacent file in this
codebase follows the same "reuse the existing tested implementation" rule;
this was a straightforward application of it, not a new pattern.

Structurally, `adl-to-adlj.ts` is a field-for-field walk mirroring
`compile-adlj.ts`'s mapper functions one-to-one (`objectToAdlj` next to
`objectToPartial`, `commandStepToAdlj` next to `commandStepToPartial`, and so
on) with the conversion direction reversed and `parseExpressionSource(...)`
replaced by `printExpression(..., true)`/`printCondition(..., true)`. Keeping
that pairing exact (same function names with `ToAdlj`/`ToPartial` suffixes,
same destructure-before-spread order) is what makes the two files easy to
audit against each other when a new expression-bearing field appears in
`resolved-model.ts` in the future — add it to both mapper functions in
lockstep the same way `AdljXModel`/`Partial*Model` are already kept in sync.

The legacy `ResolvedPolicyCondition` shape (`equals`/`all`/`any`/`not`) gets
the same refusal `printCondition` already gives the `.adl` printer: a clear
thrown error rather than a silent, wrong translation. No new decision here —
just inheriting the printer's existing one for free by calling into it.

**Correctness contract, not byte-identical JSON.** Round-tripping
`examples/task-tracker.adl` through `importAdlAsAdlj` does not need to
produce `examples/task-tracker.adlj` byte-for-byte (field order and
formatting can differ) — the test in `tests/adl-to-adlj.test.ts` instead
checks that `compileAdlj` on the *imported* document resolves to a
`ResolvedApplicationModel` that `toEqual`s `compileAdl(task-tracker.adl).model`.
This is the same "reparses to the identical tree" standard the printer's own
round-trip test already uses, applied one stage further down the pipeline.

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
