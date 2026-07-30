import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runConformanceSuite } from "../src/index.js";
import type { ConformanceSuite } from "../src/index.js";

/**
 * Discovered rather than listed. A corpus file that exists but is not run is
 * indistinguishable from one that passes, and the suite is the cross-runtime
 * contract — adding a case must not also require remembering to register it.
 */
const suiteFiles = discoverSuiteFiles();

/**
 * Every heading anchor that actually exists under `docs/spec/`, keyed
 * `<document>#<anchor>`. A `specRef` is the only thing tying a case to the prose
 * it pins, and checking merely that it *looks* like a reference let four dangling
 * anchors accumulate unnoticed — `runtime-semantics#expression-errors`,
 * `resolved-model#validation` and `runtime-semantics#lifecycle` among them. A
 * contract whose references rot is a contract nobody can follow back.
 */
const specAnchors = readSpecAnchors();

describe("ADL conformance corpus", () => {
  it("discovers every corpus file", () => {
    expect(suiteFiles.length).toBeGreaterThan(0);
  });

  it("reads spec anchors to check references against", () => {
    expect(specAnchors.size).toBeGreaterThan(0);
  });

  for (const suiteFile of suiteFiles) {
    const suite = readSuite(suiteFile);

    describe(suiteFile, () => {
      it("has stable ids and spec references", () => {
        const ids = new Set<string>();

        for (const conformanceCase of suite.cases) {
          expect(conformanceCase.id).toMatch(/^[a-z0-9.-]+$/);
          expect(ids.has(conformanceCase.id)).toBe(false);
          ids.add(conformanceCase.id);
          expect(conformanceCase.specRef).toMatch(/^[a-z0-9-]+#[a-z0-9-]+$/);
        }
      });

      it("references only spec sections that exist", () => {
        const dangling = suite.cases
          .filter((conformanceCase) => !specAnchors.has(conformanceCase.specRef))
          .map((conformanceCase) => `${conformanceCase.id} -> ${conformanceCase.specRef}`);

        expect(dangling).toEqual([]);
      });

      it("passes against the TypeScript semantic reference runtime", async () => {
        const results = await runConformanceSuite(suite);
        const failures = results.filter((result) => !result.pass);

        expect(failures).toEqual([]);
      });
    });
  }
});

function discoverSuiteFiles(): string[] {
  const root = fileURLToPath(new URL("../conformance/", import.meta.url));

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((directory) =>
      readdirSync(new URL(`../conformance/${directory.name}/`, import.meta.url))
        .filter((file) => file.endsWith(".json"))
        .map((file) => `../conformance/${directory.name}/${file}`),
    )
    .sort();
}

/**
 * Collects `<document>#<anchor>` for every heading in every spec document,
 * deriving each anchor the way GitHub and most Markdown renderers do: lowercase,
 * non-word characters dropped, spaces to hyphens.
 */
function readSpecAnchors(): Set<string> {
  const root = fileURLToPath(new URL("../docs/spec/", import.meta.url));
  const anchors = new Set<string>();

  for (const file of readdirSync(root).filter((entry) => entry.endsWith(".md"))) {
    const document = file.replace(/\.md$/, "");
    const markdown = readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8");

    for (const line of markdown.split("\n")) {
      const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
      if (heading === null) {
        continue;
      }
      anchors.add(`${document}#${slugifyHeading(heading[1] ?? "")}`);
    }
  }

  return anchors;
}

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function readSuite(relativePath: string): ConformanceSuite {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as ConformanceSuite;
}
