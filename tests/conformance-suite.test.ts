import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runConformanceSuite } from "../src/index.js";
import type { ConformanceSuite } from "../src/index.js";

const suiteFiles = [
  "../conformance/expressions/basic.json",
  "../conformance/runtime/core.json",
  "../conformance/presentation/ui.json",
];

describe("ADL conformance corpus", () => {
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

      it("passes against the TypeScript semantic reference runtime", async () => {
        const results = await runConformanceSuite(suite);
        const failures = results.filter((result) => !result.pass);

        expect(failures).toEqual([]);
      });
    });
  }
});

function readSuite(relativePath: string): ConformanceSuite {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as ConformanceSuite;
}
