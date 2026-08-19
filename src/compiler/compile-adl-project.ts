import { compileAdl } from "./compile-adl.js";
import type { CompileAdlResult } from "./compile-adl.js";

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
