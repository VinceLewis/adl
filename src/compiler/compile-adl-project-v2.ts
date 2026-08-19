import { parseAdl } from "../parser/parser.js";
import { adlAstToPartialApplicationModel } from "./compile-adl.js";
import { adljSourceToPartialApplicationModel, parseAdljDocument } from "./compile-adlj.js";
import { mergePartialApplicationModelFragments } from "./merge-partial-model.js";
import { resolveApplicationModel } from "./resolve-model.js";
import { validateApplicationModel } from "./validate-model.js";
import type { Diagnostic } from "./validate-model.js";
import type { AdlProjectManifest, CompileAdlProjectInput } from "./compile-adl-project.js";
import { parseAdlProjectManifest } from "./compile-adl-project.js";
import type {
  PartialApplicationModel,
  PartialApplicationModelFragment,
  ResolvedApplicationModel,
} from "../model/resolved-model.js";

/**
 * Result shape for `compileAdlProjectV2`. Deliberately not `CompileAdlProjectResult`:
 * that type's `ast`/`source` fields presume one `.adl` text parse, which does
 * not exist when a project mixes `.adl` and `.adlj` sources or is `.adlj`-only.
 */
export interface CompileAdlProjectV2Result {
  manifest: AdlProjectManifest;
  partialModel: PartialApplicationModel;
  model: ResolvedApplicationModel;
  diagnostics: Diagnostic[];
}

/**
 * Compiles a project manifest whose `sources` list may mix `.adl` and
 * `.adlj` files, and may list more than one `.adlj` file. Unlike
 * `compileAdlProject`, which string-concatenates every listed `.adl` source
 * and parses the concatenation once, this walks the manifest and builds one
 * `PartialApplicationModelFragment` per logical source, then merges them with
 * `mergePartialApplicationModelFragments` before resolving and validating
 * once. `compileAdlProject` itself is unchanged and untouched by this
 * function — see `docs/spec/adlj.md` for when to reach for which.
 *
 * Fragment ordering: every consecutive-or-not `.adl`-extension entry in
 * `sources` (a source is `.adlj` only if its path ends in `.adlj`) is
 * concatenated together, in their relative manifest order, into ONE text
 * blob and parsed once — exactly as `compileAdlProject` does today for an
 * all-`.adl` list — producing a single fragment. That fragment is placed at
 * the position of the FIRST `.adl` entry in the manifest's overall source
 * order. Each `.adlj` entry compiles independently into its own fragment,
 * placed at its own manifest position. This lets `.adl` entries interleave
 * with `.adlj` entries in the manifest (e.g. `domain.adl`, `extra.adlj`,
 * `ui.adl`) while keeping the one non-trivial `.adl` merge rule
 * (`mergeViewOnlyObjectDeclarations`, which needs to see all `.adl` text as a
 * single parse) working exactly as it does today.
 *
 * Deliberately kept in its own module, separate from `compile-adl-project.ts`:
 * this function's only reason to exist is `.adlj` support, and `.adlj`
 * compilation pulls in `ajv` and the generated `adlj-schema.json` (~3600
 * lines) — dead weight for the browser UI runtime, which only ever calls
 * `compileAdlProject` (via `src/reference/band-app.ts`). Keeping the .adlj
 * imports out of `compile-adl-project.ts` means that file, and everything
 * that imports only it, stays free of `ajv`. See `src/index.ts`'s barrel
 * comment for the full history of this bundle-size trap.
 */
export function compileAdlProjectV2(input: CompileAdlProjectInput): CompileAdlProjectV2Result {
  const manifest = parseAdlProjectManifest(input.manifestSource);

  const adlSourcePaths = manifest.sources.filter((sourcePath) => !isAdljSourcePath(sourcePath));
  const adlFragment =
    adlSourcePaths.length === 0 ? undefined : buildAdlFragment(adlSourcePaths, input.sources);

  const fragments: PartialApplicationModelFragment[] = [];
  let adlFragmentPlaced = false;

  for (const sourcePath of manifest.sources) {
    if (isAdljSourcePath(sourcePath)) {
      fragments.push(buildAdljFragment(sourcePath, input.sources));
      continue;
    }

    if (adlFragmentPlaced) {
      continue;
    }

    adlFragmentPlaced = true;
    if (adlFragment !== undefined) {
      fragments.push(adlFragment);
    }
  }

  const partialModel = mergePartialApplicationModelFragments(fragments);
  const model = resolveApplicationModel(partialModel);
  const diagnostics = validateApplicationModel(model);

  return { manifest, partialModel, model, diagnostics };
}

function isAdljSourcePath(sourcePath: string): boolean {
  return sourcePath.endsWith(".adlj");
}

function getProjectSource(sourcePath: string, sources: Record<string, string>): string {
  const source = sources[sourcePath];
  if (source === undefined) {
    throw new Error(
      `ADL project source '${sourcePath}' is listed in app.yaml but was not provided.`,
    );
  }

  return source;
}

function buildAdlFragment(
  sourcePaths: string[],
  sources: Record<string, string>,
): PartialApplicationModelFragment {
  const combinedSource = sourcePaths
    .map((sourcePath) => getProjectSource(sourcePath, sources))
    .join("\n\n");
  const ast = parseAdl(combinedSource);
  return adlAstToPartialApplicationModel(ast);
}

function buildAdljFragment(
  sourcePath: string,
  sources: Record<string, string>,
): PartialApplicationModelFragment {
  const jsonText = getProjectSource(sourcePath, sources);
  const document = parseAdljDocument(jsonText);
  return adljSourceToPartialApplicationModel(document);
}
