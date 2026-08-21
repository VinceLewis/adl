import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const runner = join(root, "qa-kit-run.sh");

const wait = (milliseconds: number) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function listeningPid(port: number): number | undefined {
  const result = spawnSync("ss", ["-ltnp", `sport = :${port}`], { encoding: "utf8" });
  const match = /pid=(\d+)/u.exec(result.stdout);
  return match === null ? undefined : Number(match[1]);
}

async function waitFor(
  predicate: () => boolean,
  because: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(because);
}

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

  it("keeps a preview inside env:up's interruptible group before state publication", async () => {
    expect(listeningPid(4173), "the test needs an unused production-preview port").toBeUndefined();
    const directory = await mkdtemp(`${tmpdir()}/adl-qa-kit-interrupt-`);
    const descriptor = join(directory, "environment.json");
    const state = `${descriptor}.qa-kit-environment.json`;
    const child = spawn(runner, ["env:up", "ui", descriptor], {
      cwd: root,
      detached: true,
      env: { ...process.env, QA_KIT_TEST_ENV_UP_DELAY_SECONDS: "5" },
      stdio: "ignore",
    });
    try {
      await waitFor(() => listeningPid(4173) !== undefined, "preview never began listening");
      await expect(access(state)).rejects.toThrow();
      process.kill(-child.pid!, "SIGTERM");
      await new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
      await waitFor(
        () => listeningPid(4173) === undefined,
        "interrupted env:up orphaned its production preview",
        5_000,
      );
      await expect(access(state)).rejects.toThrow();
      await expect(access(descriptor)).rejects.toThrow();
    } finally {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // The expected path has already removed the whole process group.
      }
      const leftover = listeningPid(4173);
      if (leftover !== undefined) {
        const group = spawnSync("ps", ["-o", "pgid=", "-p", String(leftover)], {
          encoding: "utf8",
        }).stdout.trim();
        if (group !== "") process.kill(-Number(group), "SIGKILL");
      }
    }
  }, 30_000);
});
