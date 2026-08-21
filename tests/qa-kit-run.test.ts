import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runner = join(root, "qa-kit-run.sh");

describe("qa-kit project runner contract", () => {
  it("rejects missing, unknown, and extra capability arguments", () => {
    for (const args of [[], ["unknown"], ["unit", "--watch"]]) {
      const result = spawnSync(runner, args, { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(64);
      expect(result.stderr).toContain("usage: ./qa-kit-run.sh");
    }
  });

  it("declares both reset scope and state that survives it", () => {
    const output = execFileSync(runner, ["env:reset"], { cwd: root, encoding: "utf8" });
    const scope = JSON.parse(output) as { reset: string[]; survives: string[] };
    expect(scope.reset).not.toEqual([]);
    expect(scope.survives).not.toEqual([]);
    expect(scope.reset.join(" ")).toMatch(/qa-kit/i);
    expect(scope.survives.join(" ")).toMatch(/PostgreSQL/i);
  });

  it("requires an absolute descriptor for browser environments", () => {
    const result = spawnSync(runner, ["env:up", "ui", "relative.json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("absolute path");
  });
});
