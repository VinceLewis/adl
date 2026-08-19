/**
 * `PartialApplicationModel`-level source merging (Phase 76). This is the
 * `PartialApplicationModel`-value equivalent of `mergeViewOnlyObjectDeclarations`
 * in `compile-adl.ts`, which does the same job at the AST level over a single
 * string-concatenated `.adl` parse. This module exists so a source that never
 * goes through the AST (a `.adlj` document, or a `.adl` run kept separate from
 * others in the same project) can still merge with the rest of a project.
 *
 * `compileAdlProject` — string-concatenate-then-parse-once for an all-`.adl`
 * `sources` list — is unchanged and does not call this. See
 * `compileAdlProjectV2` in `compile-adl-project.ts` for the caller that does,
 * and `docs/spec/adlj.md` for the user-facing contract these rules implement.
 */
import type {
  PartialApplicationModel,
  PartialApplicationModelFragment,
  PartialObjectModel,
} from "../model/resolved-model.js";

/**
 * Merges an ordered array of source fragments into one `PartialApplicationModel`,
 * ready for `resolveApplicationModel`. Order matters for every rule below —
 * pass fragments in the same relative order their source files appear in the
 * project manifest.
 *
 * - `app`: the FIRST fragment that declares one wins.
 * - `modelVersion`: same rule — first fragment that declares one wins.
 * - `shell`: the LAST fragment that declares one wins. This mirrors what
 *   `.adl` text concatenation already does today: `parseDocument`'s main loop
 *   just overwrites `shell = this.parseShell()` every time it sees a `SHELL`
 *   block, with no merging, so whichever block is textually last survives.
 * - `roles`, `contexts`, `readModels`, `decisionTables`, `commands`,
 *   `policies`, `themes`, `sync`, `migrations`: concatenated across all
 *   fragments in fragment order, each fragment's own internal order preserved.
 * - `objects`: concatenated the same way, then the view-only-object merge
 *   rule runs over the concatenated sequence (see `mergeViewOnlyObjects`
 *   below) — the same rule `mergeViewOnlyObjectDeclarations` applies to `.adl`
 *   AST nodes, replicated here at the `PartialObjectModel` level.
 */
export function mergePartialApplicationModelFragments(
  fragments: PartialApplicationModelFragment[],
): PartialApplicationModel {
  const app = fragments.find((fragment) => fragment.app !== undefined)?.app;
  if (app === undefined) {
    throw new Error("at least one source must declare APP");
  }

  const modelVersion = fragments.find(
    (fragment) => fragment.modelVersion !== undefined,
  )?.modelVersion;

  const shellFragments = fragments.filter((fragment) => fragment.shell !== undefined);
  const shell = shellFragments[shellFragments.length - 1]?.shell;

  return {
    ...(modelVersion === undefined ? {} : { modelVersion }),
    app,
    ...(shell === undefined ? {} : { shell }),
    roles: fragments.flatMap((fragment) => fragment.roles ?? []),
    contexts: fragments.flatMap((fragment) => fragment.contexts ?? []),
    objects: mergeViewOnlyObjects(fragments.flatMap((fragment) => fragment.objects)),
    readModels: fragments.flatMap((fragment) => fragment.readModels ?? []),
    decisionTables: fragments.flatMap((fragment) => fragment.decisionTables ?? []),
    commands: fragments.flatMap((fragment) => fragment.commands ?? []),
    policies: fragments.flatMap((fragment) => fragment.policies ?? []),
    themes: fragments.flatMap((fragment) => fragment.themes ?? []),
    sync: fragments.flatMap((fragment) => fragment.sync ?? []),
    migrations: fragments.flatMap((fragment) => fragment.migrations ?? []),
  };
}

/**
 * The `PartialObjectModel`-level equivalent of `compile-adl.ts`'s
 * `isViewOnlyObjectDeclaration`/`mergeViewOnlyObjectDeclarations`: a later
 * object entry that declares nothing but a `name` and `views` extends the
 * first earlier entry of the same name (its `views` appended to the end of
 * the earlier entry's own), rather than starting a second `Object` entry.
 * Any other same-named collision — one that isn't view-only — is left alone,
 * both entries kept in the array, so `validateApplicationModel`'s existing
 * `OBJECT_DUPLICATE` check can correctly refuse it downstream. That refusal
 * is the right outcome for a genuine naming conflict; this function must not
 * paper over it.
 */
function mergeViewOnlyObjects(objects: PartialObjectModel[]): PartialObjectModel[] {
  const merged: PartialObjectModel[] = [];

  for (const object of objects) {
    const existingIndex = merged.findIndex((candidate) => candidate.name === object.name);
    const existing = existingIndex === -1 ? undefined : merged[existingIndex];
    if (existing !== undefined && isViewOnlyObject(object)) {
      merged[existingIndex] = {
        ...existing,
        views: [...(existing.views ?? []), ...(object.views ?? [])],
      };
      continue;
    }

    merged.push(object);
  }

  return merged;
}

/**
 * Mirrors `compile-adl.ts`'s `isViewOnlyObjectDeclaration` field-for-field,
 * at the `PartialObjectModel` level: `businessKey`, `displayField`, `fields`,
 * `computedFields`, `scope`, `constraints`, `validations`, `lifecycle`, and
 * `sync` must ALL be undefined, and `views` must be non-empty. Unlike the AST
 * version (whose `ObjectDeclarationAst` arrays are never `undefined`, only
 * possibly empty), a `PartialObjectModel`'s array fields are genuinely
 * optional, so this checks `undefined` rather than `.length === 0` —
 * "declares nothing but a name and views" means the fragment never mentioned
 * the field at all, not that it mentioned it with an empty list.
 */
function isViewOnlyObject(object: PartialObjectModel): boolean {
  return (
    object.businessKey === undefined &&
    object.displayField === undefined &&
    object.fields === undefined &&
    object.computedFields === undefined &&
    object.scope === undefined &&
    object.constraints === undefined &&
    object.validations === undefined &&
    object.lifecycle === undefined &&
    object.sync === undefined &&
    object.views !== undefined &&
    object.views.length > 0
  );
}
