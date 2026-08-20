# `.adlj` JSON Authoring Surface (Phase 73; extended in Phases 76, 77, 78)

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

A later proactive sweep (grepping `compile-adl.ts` for every `??` whose
right-hand side is not a bare `[]`/`""`/`false`/`true`/`undefined` — i.e.
every place the AST-to-partial conversion infers a value rather than passing
one through) found three more candidates structurally identical to
`principal.match`: `validator.expression ?? {kind: "literal", value: true}`,
`calendar.dateField ?? "Date"`, and `step.recordId ?? {kind: "literal", value: null}`
on command `update`/`read` steps. Cross-checked against
`src/model/adlj-schema.json`'s generated `required` lists, none of the three
reproduces the trap: the `Partial*Model` type backing each one marks the
field *required*, so the generated JSON Schema inherits that requirement and
rejects a `.adlj` document that omits it (`ADLJ_SCHEMA_INVALID`) before
`resolveApplicationModel` is ever reached. **The general rule this sweep
established: the trap can only occur where the `Partial*Model` field is
*optional* and `.adl`'s AST-to-partial conversion infers a non-trivial value
for it — `principal.match` is the only field in the codebase meeting both
conditions.** A required field can never produce this trap by construction.
(`step.recordId` is worth a footnote even though it's not a gap: `.adl` text
lets an `UPDATE`/`READ` step omit `RECORD_ID` entirely to mean "no specific
record," while `.adlj`'s schema requires the key — an authoring-ergonomics
rough edge, not a silent-default one, since a `.adlj` document that omits it
is loudly rejected, not silently miscompiled.) Full writeup in
`docs/spec/adlj.md`'s "Swept for more of these" section.

Neither of the original two is a defect — both are pre-existing, correct behaviour of
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

## Browser bundle cost: addressed (Phase 79), regressed by integration, fixed again

Reaching `compile-adlj.ts` through `src/index.ts`'s barrel export pulled
`ajv` and the generated schema into the browser bundle unconditionally: gzip
size grew from 158 KB to 203 KB at introduction (Phase 73). Phase 79 fixed
this the simple way — no dynamic `import()` or Vite-level code-splitting was
needed. A grep of `src/ui/**` confirmed nothing in the shipped browser app
calls `compile-adlj.ts`/`compileAdlj` directly, so the fix was to remove
`compile-adlj.ts`, `print-adl.ts`, and `model/adlj-source.ts` from
`src/index.ts`'s `export *` list entirely, with a comment explaining why —
the same pattern the barrel already applies to `simplewebauthn-adapter.ts`.
Measured in isolation: gzip size returned to 158.18 KB (684.81 KB raw).

**That fix silently regressed the moment Phases 74–79 were integrated onto
`main`.** Each of the six phases ran in its own worktree, branched before the
others existed, and each verified clean in isolation — but two of them
independently reopened the same hole through two different paths, and
neither could see the other:

1. Phase 77 added `adl-to-adlj.ts` (a real, non-type-only import of
   `print-adl.ts`, now much larger after Phase 78's presentation/edit-surface
   coverage) to `src/index.ts`'s barrel, at the same time Phase 79 was
   removing its siblings from that same barrel on a different branch.
2. Phase 76 added `compileAdlProjectV2` **inside `compile-adl-project.ts`**,
   importing `compile-adlj.ts` directly to support `.adlj` sources in a
   multi-file project. `compile-adl-project.ts` is reachable from the real
   browser bundle via `src/reference/band-app.ts` (the Giggle Band demo
   fixture) — **without going through `src/index.ts`'s barrel at all.**
   `compile-adlj.ts` has a top-level side effect (`new Ajv(...)`,
   `ajv.compile(...)`), which Rollup cannot tree-shake away regardless of
   whether the importing module's own exports (`compileAdlProjectV2`) are
   ever used — importing the module is enough to keep its whole payload.

`npm run build` after integration showed 852.94 kB / 203.12 KB gzip again —
Phase 79's exact regression, reintroduced via a path Phase 79's own worktree
never contained. The real fix (applied once, after all six phases were
integrated, not per-phase): exclude `adl-to-adlj.ts` from the barrel
alongside its siblings, **and** split `compileAdlProjectV2` out of
`compile-adl-project.ts` into a new `compile-adl-project-v2.ts` so the file
`band-app.ts` actually imports never carries a `.adlj` import in the first
place. Both new exclusions are documented in `src/index.ts`'s barrel comment,
which is now the authoritative, continuously-updated record of every module
excluded and why. Measured after the fix: 685.38 KB / 158.34 KB gzip.
`npm run test:visual` (all 36 checks) passed both before and after.

**The lesson that matters beyond this specific bug**: barrel exclusion is
*necessary but not sufficient* — anything reachable from `src/ui/main.ts`'s
actual import graph carries its weight regardless of the barrel, and a
module with an unguarded top-level side effect (no `sideEffects: false` in
`package.json`, no `/*#__PURE__*/`) can't be tree-shaken even when its
exports go unused. **Verifying a bundle-size fix in one isolated worktree is
not sufficient proof it holds after integration** when other concurrent
worktrees touch the same or adjacent files — this is a case where the
Parallel Execution Plan's instruction to keep barrel-adjacent files in the
serial spine (`src/index.ts` is explicitly named) would have caught this at
integration time rather than after. Before adding or re-exporting anything
`.adlj`-adjacent in future, trace its full static import chain against
`src/ui/main.ts`'s actual reachable set and run `npm run build` to check —
don't infer bundle membership from the barrel file alone.

### Reopened a third time — this time by a demo that genuinely needs it

Every fix above assumed the browser bundle never has a *real* reason to reach
`.adlj` tooling — every prior reachability was accidental (a barrel
re-export, a same-file import nobody's code path used). That assumption
broke once the Jointly Care reference app was converted from `.adl` text to
`.adlj` (see [reference-app-models](reference-app-models.md)): its browser
demo fixture (`src/reference/jointly-app.ts`) now has a genuine, load-bearing
need to call `compileAdlProjectV2` at runtime, and it is reachable from
`src/ui/main.ts` via the reference-demo registry (`reference-demos.ts`)
unconditionally, on every page load, regardless of which `?demo=` is
selected. A static import — the exact shape every earlier fix in this
section was written to catch and forbid — reopened the hole for real:
719 KB / 167 KB gzip -> 938 KB / 213 KB gzip.

The earlier fixes don't generalize to this case because "don't let anything
reachable import it" stops being an option once something reachable
legitimately needs it. The fix here is different in kind, not degree: defer
*when* the cost is paid, not avoid paying it. `compileJointlyReference()` in
`jointly-app.ts` wraps a dynamic `import("../compiler/compile-adl-project-v2.js")`
inside a memoized async function, called only from `createJointlyReferenceModel()`
— never at module top level. Rollup code-splits the dynamic import target
into its own chunk (`compile-adl-project-v2-*.js`, ~173 KB / 47 KB gzip)
that is only fetched when Jointly Care's demo is actually mounted; the main
entry chunk returned to ~766 KB / 167 KB gzip. This also forced
`ReferenceDemoDefinition.createModel` (`reference-demo.ts`) to become
`() => Promise<ResolvedApplicationModel>` — every `.adl`-sourced demo's
`createModel` still resolves synchronously underneath, just wrapped in
`async () => ...` to satisfy the shared signature, since there is no dynamic
import to await for them.

**The rule this adds, alongside "trace the static import graph":** when a
`.adlj`-sourced reference app's browser fixture needs `compileAdlProjectV2`/
`compileAdlj` for real, it must reach it only through a dynamic `import()`
called lazily (inside the function that needs it, never at module scope),
never a static import — and `npm run build` must be re-checked (main chunk
size, not just "it compiles") every time, the same as for the earlier three
fixes.

### A second caller of the same dynamic import shares one chunk, and doesn't reopen the hole

Converting Giggle Band to `.adlj` too (see below) gave `band-app.ts` its own
`compileBandReference()`, structurally identical to `jointly-app.ts`'s
`compileJointlyReference()` — same memoized-async-wrapping-a-dynamic-`import()`
shape, same target module path
(`../compiler/compile-adl-project-v2.js`). Rollup does not duplicate the
target into two chunks for two independent dynamic-`import()` call sites
against the same specifier: it produces one shared
`compile-adl-project-v2-*.js` chunk, fetched once and reused by whichever
`.adlj`-sourced demo mounts first. Measured before/after adding the second
caller: main entry 777.43 kB/170.73 KB gzip → 844.30 kB/170.06 KB gzip (gzip
essentially flat — the raw growth is `domain.adlj`/`ui.adlj`'s own raw-text
`?raw` imports, ~127 KB of JSON vs. `domain.adl`/`ui.adl`'s ~40 KB of `.adl`
text, both still statically imported into the main chunk since the *source
text* has to be available before the dynamic import resolves — JSON's
verbosity compresses well, which is why gzip barely moved); shared chunk
176.33 kB/46.71 KB gzip → 196.24 kB/51.45 KB gzip. The lazy chunk grows a
little because it is now reachable from two call graphs instead of one, but
it still only downloads when a `.adlj`-sourced demo is actually mounted, so
the fix's actual property — the `ajv`-carrying payload is absent from every
page load that never touches Giggle Band or Jointly Care — holds unchanged
with a second real caller. Confirms the pattern generalizes rather than
needing a per-app variant.

## Giggle Band's `.adlj` conversion

Giggle Band (`src/reference/giggle-band/`) is the second app converted from
`.adl` text to `.adlj`, done after the `comment` field above landed —
unlike Jointly Care's first pass, comments did not need to be sacrificed.
`importAdlAsAdlj` round-tripped the real `domain.adl` + `ui.adl` with zero
converter changes needed: every construct Giggle Band exercises that Jointly
Care doesn't (`UNION` read models, `ORDERED` object constraints,
`CHILD_COLLECTION`/`PICKER`, `ICON_MAP`/`STATUS_MAP`, a multi-hop
`READ_MODEL SOURCE JOIN`, `EDIT_SECTION`) survived a `toEqual` check against
`compileAdlProjectV2`'s resulting model, matching what `compileAdlProject`
produces from the original `.adl` text byte-for-semantic-equivalent — no
converter bug found this time, in contrast to how many real printer defects
Phase 78's Giggle Band round-trip found. All 14 real leading comments
survived (matching commit `a76f7ab`'s own count for this corpus).

- **Splitting one converted document into `domain.adlj` + `ui.adlj` needs the
  same synthetic-`APP`-prefix technique Jointly Care's first (pre-`comment`)
  conversion used, not `importAdlAsAdlj` directly.** `importAdlAsAdlj` is a
  single-document entry point; `ui.adl` has no `APP` block and
  `parseDocument` requires one as the literal first thing (see above), so it
  cannot be converted on its own. The fix: parse `domain.adl` normally
  (`adlAstToPartialApplicationModel(parseAdl(domainAdl))`, it has a real
  `APP`), and parse a placeholder-prefixed `ui.adl`
  (`` `APP 'Giggle Band UI Views (placeholder, discarded on merge)'\nEND.APP\n\n` + uiAdl ``)
  the same way, then convert each fragment through
  `partialApplicationModelToAdljSource` independently. The placeholder
  `app.name` is discarded at merge time (`mergePartialApplicationModelFragments`'s
  "first fragment that declares `app` wins" rule), so its exact text is
  cosmetic — but the JSON Schema still requires `app` to be present on every
  `AdljSourceDocument`, so it cannot be omitted either. Confirmed this is the
  same mechanism Jointly Care's `ui.adlj` used (its own `app.name` is the
  identical placeholder-shaped string) even though that conversion predates
  this file's account of it.
- **The "AST always supplies `[]`, `isViewOnlyObject` wants `undefined`" trap
  (documented above for Jointly Care) reproduces identically for
  `ui.adl`'s four view-only `OBJECT` blocks** (`Event`, `BandInvitation`,
  `Availability`, `SetList` — each only adding `VIEW`s to an object
  `domain.adl` declares in full). Same fix: strip each to `{name, views,
  comment?}` by hand after `adlAstToPartialApplicationModel`, before
  `partialApplicationModelToAdljSource`. None of the four objects happens to
  have a comment attached directly to its own `OBJECT` line in this corpus
  (the comments found sit after `OBJECT X`, before the first nested `VIEW`,
  so they attach to that `VIEW`/`SECTION` instead, per the leading-comment
  rule) — but the strip preserves `comment` when present, so this is not a
  coincidence-dependent fix.
- **Keeping `domain.adl`/`ui.adl` on disk needed a trailing note, not
  Jointly Care's header note.** `docs/spec/language.md` and several
  `docs/phases/*.md` documents cite ~19 *exact line numbers* into these two
  files as illustrative examples (`giggle-band/domain.adl:471`,
  `ui.adl:24`, etc.) — grep the repo for `giggle-band/domain\.adl:` /
  `giggle-band/ui\.adl:` before ever touching a line in either file. A
  prepended header comment, the way Jointly Care's kept `.adl` files carry
  one, would silently invalidate every one of those citations by shifting
  every later line number down. The files are instead left byte-for-byte
  identical up to their last real content line, with the
  "SUPERSEDED AS COMPILED SOURCE" note *appended* after it — same
  information, placed where it cannot perturb an existing citation. Worth
  checking for this before reflexively reusing the header-note pattern on
  any future `.adl` file that has accumulated external line-number
  references. **Phase 94 follow-up:** keeping the files was right, but the
  note's wording was not -- "superseded as compiled source" read to every
  later reader as "same content, different encoding", and the two files had
  in fact drifted through nine model versions. The note now says what the
  files *are* (a frozen model-version-1.0.0 snapshot, unregenerable because
  the real source uses three constructs with no ADL text syntax at all), the
  frozen region is hashed by `tests/reference-adl-snapshot.test.ts` rather
  than requested by comment, and the divergence itself is pinned there too.
  See `implementation/reference-app-drift.md`.
- **A generic, non-browser consumer of `app.yaml`+sources also needed
  `.adlj` support for real, not just the browser bundle.**
  `src/server/authority-entrypoint.ts`'s `loadAuthorityModel` reads any
  deployed app's `app.yaml` and sources from a real directory on disk
  (`ADL_MODEL_PATH`) via `compileAdlProject` — `tests/integration/
  authority-deployment-slice.test.ts` and `authority-membership-projection
  .test.ts` point `ADL_MODEL_PATH` straight at
  `src/reference/giggle-band`, so once its `app.yaml` listed `.adlj`
  sources, `compileAdlProject` tried to lex JSON as `.adl` text and failed
  with `ADL_LEX_UNEXPECTED_CHARACTER` on the opening `{`. Fixed by switching
  `loadAuthorityModel` to `compileAdlProjectV2`. This file is server-only
  Node code, never reachable from the browser bundle (it already depends on
  `pg` and other Node-only packages), so — unlike `band-app.ts`/
  `jointly-app.ts` — it has no reason to defer this behind a dynamic
  `import()`; a plain static import is correct here. **The general point:**
  a browser-bundle-focused fix (barrel exclusion, dynamic import) does not
  automatically cover every real consumer of a generically-loaded app
  manifest — grep for other `parseAdlProjectManifest`/`compileAdlProject`
  call sites whenever a reference app's `sources:` list changes format, not
  just the browser demo registry.
- **`band-app.ts`'s exported model/runtime factories had to become async**,
  the same way Jointly Care's did, to defer the compile behind a dynamic
  `import()` — `createBandReferenceModel`, `createGiggleBandExampleModel`,
  and `createBandReferenceRuntime` are now
  `() => Promise<...>`, and `createPersistentBandReferenceRuntime`/
  `createPersistentGiggleBandExampleRuntime` lost their `= createXModel()`
  default-parameter fallback (an async call cannot live in a default-parameter
  position). Unlike Jointly Care — whose test file was authored fresh in the
  same conversion — Giggle Band already had a large, pre-existing synchronous
  test surface (`tests/band-reference-app.test.ts` and ~9 other files) built
  directly against the old synchronous signatures. There is no way to keep a
  function's call sites synchronous while also deferring its heavy dependency
  behind `import()`: the two are mutually exclusive by JS module semantics
  (an `await` is unavoidable once anything in the call chain awaits a dynamic
  import). Every call site across ~10 files was updated mechanically —
  `it("...", () => {` → `it("...", async () => {` plus an added `await`, or
  (for four `tests/integration/*.test.ts` module-top-level `const model =
  createGiggleBandExampleModel();` declarations) a plain top-level `await`,
  which Vitest's ESM test-file handling supports directly. No assertion or
  expected value changed in any of these files — confirmed by a full green
  `npm test` (1056 tests) and `npm run test:integration` (158 tests) run
  after the edits. **The practical rule this adds:** before converting a
  reference app's `createXModel` function to the async/dynamic-import
  pattern, grep every test file for direct (non-`ReferenceDemoDefinition`)
  callers first — a mature reference app can have accumulated far more
  synchronous call sites than a freshly-authored one, and every one of them
  is a mechanical but real edit, not something the type checker will find
  for you until you try.

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

## Phase 78: the printer now covers composed presentation and edit surfaces

`printPartialApplicationModelAsAdl` used to throw for any view declaring
`presentation` or an edit surface (`editContainer`/`editSections`). Phase 78
closed that gap for every construct that has ADL text syntax at all, proven
against Giggle Band's actual compiled `partialModel` — not a hand-built
fixture — via `printPartialApplicationModelAsAdl` → `compileAdl` →
`toEqual(original.model)` (`tests/compile-adlj.test.ts`).

**A small, named set of constructs has no ADL text syntax at all** and the
printer throws a clear, named error for each rather than guessing at
invented syntax: `MATRIX`, `select`/`contextSelector` presentation controls,
conditional row fragments, a field text fragment's `fallback`, a `LIST`'s
`fields`, an empty state's `icon`, a calendar's `month.labelFormat`, and
per-view `presentation.shell.regions` (only the global `SHELL` block has
source syntax). See `docs/spec/adlj.md`'s printer section for the full list
and the reasoning for each — every one was confirmed against the parser
grammar (`src/parser/parser.ts`), not the spec prose, per this repository's
standing rule that a diagnostic (or, here, an absent grammar branch) is
ground truth over any assumption about what should parse.

**Getting a real reference app to round-trip finds real printer defects a
narrow fixture never would — this is the actual value of the Giggle Band
proof, not a formality.** Every one of these was a pre-existing bug in
`print-adl.ts` *outside* composed presentation/edit surfaces, invisible only
because `examples/task-tracker.adl` never exercised the construct:

- **`APP`'s name was never quoted.** `APP Giggle Band ADL Example` is not
  parseable — the app's display name is the one declared name in the whole
  language allowed to contain spaces, and `consumeName` accepts a quoted
  string identically to a bare identifier. Fixed by quoting unconditionally
  (harmless for a single-word name too, since both forms reparse to the same
  string).
- **`CONTEXT` was printed as a multi-line `... END.CONTEXT` block, but the
  grammar has no `END.CONTEXT` at all** — `parseBusinessContext` reads every
  directive (`OBJECT`, `SELECTION`, `AUTO_SELECT`, `PERSISTENCE`, `SOURCE`,
  `ROUTE_PARAM`, `MEMBERSHIP` and its own sub-options) in one
  `while (!isLineEnd())` loop and calls `consumeLineEnd` once, never
  `parseEnd`. `SELECTION`/`AUTO_SELECT`/`PERSISTENCE` are also independent
  directives, not one directive grouped under `SELECTION` the way the old
  code assumed. Confirmed live in Giggle Band's own source:
  `CONTEXT Band OBJECT Band SELECTION OPTIONAL AUTO_SELECT false PERSISTENCE local MEMBERSHIP ...`
  — one physical line, no trailing `END`.
- **`READ_MODEL`'s `union` strategy was printed as `STRATEGY UNION`, a
  keyword the grammar does not have.** The parser only recognises a bare
  `UNION` directive; `join` (the default) has no keyword of its own at all —
  it is simply the absence of `UNION`.
- **A `READ_MODEL SOURCE ... JOIN ... ON` clause printed an unqualified
  right-hand field** (`ON User == User` instead of `ON User == member.User`).
  `sourceField` is stored *unqualified* in the resolved/partial model — the
  parser strips the `<joinSource>.` prefix `consumeQualifiedName` requires on
  the way in — so the printer has to re-add it, or the printed clause
  reparses as a bare field name and `READ_MODEL SOURCE JOIN` always rejects
  that.
- **A policy rule's `FIELDS`/`STATE`/`ROLE`/`GROUP_ROLE`/`USER` name lists
  can collide with `POLICY RULE`'s own stop words.** `RULE ... FIELDS ...
  WHEN ...` is one physical line with no separating scope, so the parser
  recognises a fixed reserved-word set (`FIELD_LIST_STOP_WORDS` in
  parser.ts: `ROLE`, `ROLES`, `GROUP_ROLE`, `GROUP_ROLES`, `USER`, `USERS`,
  `OWNER`, `EVERYONE`, `AUTHENTICATED`, `ANONYMOUS`, `CONTEXT_MEMBER`,
  `STATE`, `ACTION`, `CHANNEL`, `CHANNELS`, `WHEN`) to know where one name
  list ends and the next directive begins. Giggle Band's `BandInvitation` has
  a field literally named `Role`, and its own `.adl` source works around the
  ambiguity by quoting it (`FIELDS ... 'Role' ...`) — `consumeName` accepts a
  quoted string identically to a bare identifier, but a *bare* `Role` there
  gets read as the `ROLE` principal-selector keyword instead, consuming
  whatever follows as a (possibly empty, hence a parse error) role list. The
  printer now quotes any list entry whose uppercased form is in that same
  stop-word set, for every name list that shares this ambiguity: rule
  `fields`, `state`, and principal `roles`/`groupRoles`/`users`.
- **A list-typed `COMMAND INPUT` with structured item fields silently
  dropped every item field's shape.** `INPUT Songs LIST ... \n FIELD Title
  TEXT REQUIRED \n ... \n END.INPUT` is a real nested block the parser
  supports (`ResolvedCommandInput.itemFields`/
  `PartialCommandInputModel.itemFields`) for a list input whose items are
  records rather than scalars — the printer never looked at `itemFields` at
  all, so `ImportSongs`' `Songs` input (each item carrying `Title`/
  `Composer`/`DurationSeconds`) reparsed as items with no fields, which
  broke every command step reading `ITEM Title` etc.
  (`ADL_COMMAND_STEP_ITEM_FIELD_UNKNOWN`).

**The general lesson, restated for future phases that touch this printer:**
a construct's printer code is only proven by an input that actually contains
it. `examples/task-tracker.adl` is deliberately small and does not declare a
`CONTEXT`, a `UNION`/`JOIN` read model, a policy field colliding with a
principal keyword, or a structured list command input — so six real defects
sat undetected in already-"finished" printer code until a phase that needed
a richer fixture (Giggle Band) actually ran it end-to-end. Treat "the
existing tests still pass" as necessary, never sufficient, evidence that a
printer change (or any change to code whose only proof is round-tripping
through a fixture) is correct — run it against the richest real content
available before considering it done.

## Comments: a shared `comment` field on `Partial*Model`, not an `AdljSourceDocument`-only channel

`.adlj` had no way to carry the design-rationale comments every real `.adl`
file in this repository accumulates — strict `JSON.parse`, no JSON5/comment
stripping, `additionalProperties: false` everywhere in the generated schema.
This surfaced for real when the Jointly Care reference app was converted from
`.adl` text to `.adlj`: the original, heavily-commented `.adl` files had to be
left on disk unwired from `app.yaml`, headed with a note that they were
rationale-only reference and not reparsed — a workaround, not a fix, and one
that would have had to repeat for every future `.adlj`-sourced app.

**That workaround no longer exists.** Once this field landed, Jointly Care's
`domain.adl`/`ui.adl` were reconverted to `.adlj` a second time via
`importAdlAsAdlj`/`partialApplicationModelToAdljSource`, this time carrying
every one of their 17 real leading comments through as `"comment"` keys, and
the now-redundant `.adl` files were deleted outright —
`src/reference/jointly-care/domain.adlj` and `.../ui.adlj` are the real,
full, comment-carrying compiled source (see `app.yaml`'s `sources:`), not a
comment-free stand-in with a separate rationale-only file kept on the side.
`compileAdlProjectV2`'s own view-only-object merge (`isViewOnlyObject` in
`merge-partial-model.ts`) surfaced one more real instance of the "AST always
supplies `[]`, `resolveApplicationModel`/this merge check wants `undefined`"
class of gap already documented above for `contexts`/`readModels`: `compile-
adl.ts`'s `objectToPartial` always supplies `fields: []`, `computedFields:
[]`, `validations: []`, `constraints: []`, `policies: []` even for an
`OBJECT` block that declares none of them, so a `.adlj` document produced by
converting `ui.adl` on its own (it declares three genuinely view-only
`OBJECT` blocks — no fields, just extra `VIEW`s for objects `domain.adl`
declares in full) fails `isViewOnlyObject`'s `=== undefined` check and is
treated as a real, conflicting object declaration instead of merging. The
fix applied when regenerating `ui.adlj` was to strip those artefactual empty
arrays back to "not declared" for any object entry that has nothing else —
removing an artifact of the AST-to-partial conversion, not real content,
since `ui.adl` truly declares zero fields for those objects. Worth checking
for again the next time a `.adl` pair that splits an object's fields from
its views (`domain.adl` + `ui.adl`, the same shape Giggle Band uses) is
reconverted to a two-file `.adlj` split via this importer.

The fix adds one optional `comment?: string` field, sibling to a construct's
other properties (`.adlj`'s `"comment"` key; `Partial*Model`'s `comment`
field), to exactly the node shapes real usage needed. A multi-line comment is
one string with `\n` separating the original lines, not a string array,
matching the literal shape asked for and keeping the representation simple.

**Why the field lives on `Partial*Model`, not only on `AdljSourceDocument`'s
`AdljXModel` types.** The printer (`printPartialApplicationModelAsAdl`) reads
`PartialApplicationModel`, and both front ends — `.adl` text via
`compile-adl.ts`'s AST-to-partial conversion, `.adlj` via
`compile-adlj.ts`'s JSON-to-partial conversion — already funnel into that one
shared type before the printer or `resolveApplicationModel` ever sees the
content. Putting `comment` only on `AdljSourceDocument` would have meant the
printer needed a *second* code path to reach it depending on which front end
produced the model, undermining the exact thing `PartialApplicationModel`
exists to be: the single shared shape every producer targets and every
consumer reads, regardless of source format. `comment` is deliberately
**not** added to any `Resolved*Model` interface — it is authoring metadata
consumed only by the printer, not runtime content, so it has no reason to
survive `resolveApplicationModel` any more than a parser's own source ranges
do.

**This is also why `compile-adlj.ts` and `adl-to-adlj.ts` needed zero code
changes.** Every `AdljXModel` type in `adlj-source.ts` is
`Omit<PartialXModel, "expressionField"> & { expressionField: string }` (see
above): adding `comment` to a `Partial*Model` interface makes it appear in
the corresponding `AdljXModel` type automatically, with no `adlj-source.ts`
edit, as long as no mapper's `Omit` list happens to exclude it (none did,
since it is a new field nothing yet destructures). And because every mapper
function in `compile-adlj.ts`/`adl-to-adlj.ts` follows the
destructure-known-fields-then-spread-rest idiom this surface already
established, `comment` — never named, never destructured — rides through
every mapper's `...rest` spread for free in both directions. The only real
code was the parser capturing it, `compile-adl.ts` threading it from the AST,
the `Partial*Model` field declarations themselves, and the printer emitting
it. `npm run generate:adlj-schema` picked up all 24 new `comment` properties
from the type change alone.

**Scope: the node shapes that actually receive a leading comment in real
usage**, found by reading Jointly Care's and Giggle Band's real `.adl`
files rather than adding support speculatively: `app`, the top-level `shell`
block, a `role`, a `context` and a `contextGrant`, an `object`, a `field`,
all three object constraint kinds (`unique`/`ordered`/`protectedRole`), an
object `validation`, a `view`, a `readModel` and its `sources`/`fields`
entries, a `command` and its `steps`, a `policy` and its `rules`, and the
composed-presentation constructs `SECTION` (a `PartialPresentationSectionModel`),
a row/section `ACTION` (`PartialPresentationActionControlModel` — not the
`toggle` control kind, which had no real comment example), and a
`CHILD_COLLECTION`'s `PICKER` (`PartialRelationshipPickerModel`). `ROLE` and
`SHELL` were not named in the originating task's scope list but got comment
support anyway because real content puts a leading comment directly above
each (`domain.adl`'s file-scope comment sits immediately above its first
`ROLE`; `ui.adl`'s file header sits immediately above `SHELL`) — the rule
"add support for a shape you find a real comment attached to, even if it
wasn't named" applied literally. `COMMAND STEP` got support even though
no comment in either corpus attaches directly to a `STEP` line (the
`REQUIRE`-rationale comments found always sit above the enclosing `COMMAND`
instead) — it was added anyway because the originating task named it
explicitly. A `LIFECYCLE`/decision-table/computed-field comment was not
added: neither app uses `LIFECYCLE`, `DECISION_TABLE`, or an object
`COMPUTED` field at all, so there was no real placement to check.

**The attachment rule: a leading comment block, mechanically.** One or more
consecutive whole-line `#`/`//` comments, with no blank line between them and
none between the block and the declaration immediately following, belong to
that declaration — the same leading-doc-comment shape as JSDoc/Python
docstrings/Rust `///`. This was implemented as a pure line-number lookup
(`AdlParser.takeLeadingComment`, called as the very first statement in each
target `parseXxx` method, before that method consumes its own first token):
walk backward from the current token's line, collecting consecutive comment
lines from a `Map<line, text>` the lexer built, stopping at the first gap. No
"consumed" bookkeeping is needed — each call queries a distinct line range by
construction, so the same comment block can never be attached to two
different declarations. A comment **not** immediately followed by a
declaration — a truly freestanding remark, or one separated from what
follows by a blank line — has no attachment point and is dropped, not an
error. The real example found: Giggle Band's `domain.adl` has a comment
directly above `END.OBJECT` inside `Availability` (explaining that
`BandMemberAvailabilityBoard`'s presentation lives in `ui.adl`) with nothing
after it to attach to inside that block — it is simply never queried by any
`takeLeadingComment` call and stays unattached. A second, real,
blank-line-separated case exists too but happens to still attach correctly:
`domain.adl`'s post-`END.APP` comment describing the whole domain sits
directly above `ROLE SystemAdmin` (no blank line between them), so it
attaches to that first `ROLE` — a mechanical consequence of the rule, not a
special case, and worth knowing before assuming every file-scope comment is
freestanding.

**The lexer change is additive and provably safe.** `skipLineComment` always
discarded comment text before this change; it now also records `{ text,
line }` into a side array **only when the comment is the first thing on its
line** (a `contentSeenOnLine` flag, reset on every newline, set by every
other token-producing branch) — a trailing same-line comment after code is
never captured, matching the "whole-line block" attachment rule and avoiding
a wrong attachment from `FIELD X TEXT # note\nFIELD Y TEXT` accidentally
reading "note" as `Y`'s leading comment. The main token stream `lexAdl`
returns is byte-for-byte unchanged — same tokens, same order, same
`ADL_LEX_*`/`ADL_PARSE_*` diagnostics — so every existing parser test passed
unmodified; nothing the parser used to accept or reject changed, only what it
additionally captures. `AdlParser`'s constructor grew an optional second
`comments` parameter defaulting to `[]`, so every other direct construction
site is unaffected.

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
