import { parseAdl } from "../parser/parser.js";
import { adlAstToPartialApplicationModel, compileAdl } from "./compile-adl.js";
import type { CompileAdlResult } from "./compile-adl.js";
import { adljSourceToPartialApplicationModel, parseAdljDocument } from "./compile-adlj.js";
import { mergePartialApplicationModelFragments } from "./merge-partial-model.js";
import { resolveApplicationModel } from "./resolve-model.js";
import { validateApplicationModel } from "./validate-model.js";
import type { Diagnostic } from "./validate-model.js";
import type {
  PartialApplicationModel,
  PartialApplicationModelFragment,
  ResolvedApplicationModel,
} from "../model/resolved-model.js";

export interface AdlProjectManifest {
  name?: string;
  id?: string;
  version?: string;
  startView?: string;
  sources: string[];
  demo?: {
    route?: string;
  };
}

export interface CompileAdlProjectInput {
  manifestSource: string;
  sources: Record<string, string>;
}

export interface CompileAdlProjectResult extends CompileAdlResult {
  manifest: AdlProjectManifest;
  source: string;
}

export function compileAdlProject(input: CompileAdlProjectInput): CompileAdlProjectResult {
  const manifest = parseAdlProjectManifest(input.manifestSource);
  const source = manifest.sources
    .map((sourcePath) => {
      const source = input.sources[sourcePath];
      if (source === undefined) {
        throw new Error(
          `ADL project source '${sourcePath}' is listed in app.yaml but was not provided.`,
        );
      }

      return source;
    })
    .join("\n\n");
  const result = compileAdl(source);

  return {
    ...result,
    manifest,
    source,
  };
}

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

export function parseAdlProjectManifest(source: string): AdlProjectManifest {
  const manifest: AdlProjectManifest = { sources: [] };
  let activeList: "sources" | undefined;
  let activeMap: "demo" | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const withoutComment = stripYamlComment(rawLine);
    if (withoutComment.trim().length === 0) {
      continue;
    }

    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const line = withoutComment.trim();

    if (indent === 0) {
      activeList = undefined;
      activeMap = undefined;
    }

    if (activeList === "sources" && line.startsWith("- ")) {
      manifest.sources.push(parseYamlScalar(line.slice(2)));
      continue;
    }

    if (activeMap === "demo" && indent > 0) {
      const entry = parseYamlKeyValue(line);
      if (entry?.key === "route") {
        manifest.demo = { ...(manifest.demo ?? {}), route: entry.value };
        continue;
      }
    }

    const entry = parseYamlKeyValue(line);
    if (entry === undefined) {
      throw new Error(`Unsupported app.yaml line: ${rawLine}`);
    }

    switch (entry.key) {
      case "name":
      case "id":
      case "version":
      case "startView":
        manifest[entry.key] = entry.value;
        break;
      case "sources":
        if (entry.value.length > 0) {
          throw new Error("app.yaml 'sources' must be a list.");
        }
        activeList = "sources";
        break;
      case "demo":
        if (entry.value.length > 0) {
          throw new Error("app.yaml 'demo' must be a mapping.");
        }
        manifest.demo = {};
        activeMap = "demo";
        break;
      default:
        throw new Error(`Unsupported app.yaml key '${entry.key}'.`);
    }
  }

  if (manifest.sources.length === 0) {
    throw new Error("app.yaml must list at least one ADL source.");
  }

  return manifest;
}

function parseYamlKeyValue(line: string): { key: string; value: string } | undefined {
  const separator = line.indexOf(":");
  if (separator < 0) {
    return undefined;
  }

  return {
    key: line.slice(0, separator).trim(),
    value: parseYamlScalar(line.slice(separator + 1).trim()),
  };
}

function parseYamlScalar(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function stripYamlComment(line: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === "'" || character === '"') && quote === undefined) {
      quote = character;
      continue;
    }

    if (character === quote) {
      quote = undefined;
      continue;
    }

    if (character === "#" && quote === undefined) {
      return line.slice(0, index);
    }
  }

  return line;
}
