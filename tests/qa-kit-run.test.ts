import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

function portIsListening(port: number): boolean {
  const probe = [
    "const net = require('node:net');",
    "const socket = net.connect({host: '127.0.0.1', port: Number(process.argv[1])});",
    "socket.once('connect', () => { socket.destroy(); process.exit(0); });",
    "socket.once('error', () => process.exit(1));",
    "socket.setTimeout(500, () => { socket.destroy(); process.exit(1); });",
  ].join("");
  return spawnSync(process.execPath, ["-e", probe, String(port)]).status === 0;
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

  it("passes a mutation test-name pattern to Vitest as one literal argument", async () => {
    const directory = await mkdtemp(`${tmpdir()}/adl-qa-kit-pattern-`);
    const bin = join(directory, "bin");
    const capture = join(directory, "arguments.txt");
    const sentinel = join(directory, "must-not-exist");
    await mkdir(bin);
    const npx = join(bin, "npx");
    await writeFile(
      npx,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$@" > "$QA_KIT_CAPTURE"\n',
    );
    await chmod(npx, 0o755);
    const pattern = `REQ-7 literal spaces;$(touch ${sentinel}) [punctuation]`;
    const result = spawnSync(runner, ["unit"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        QA_KIT_CAPTURE: capture,
        QA_KIT_TEST_PATTERN: pattern,
      },
    });
    expect(result.status).toBe(0);
    expect((await readFile(capture, "utf8")).split("\n").filter(Boolean)).toEqual([
      "vitest",
      "run",
      "--testNamePattern",
      pattern,
    ]);
    await expect(access(sentinel)).rejects.toThrow();
  });

  it("runs both ordinary unit suites", async () => {
    const directory = await mkdtemp(`${tmpdir()}/adl-qa-kit-unit-suites-`);
    const bin = join(directory, "bin");
    const capture = join(directory, "arguments.txt");
    await mkdir(bin);
    const npm = join(bin, "npm");
    await writeFile(
      npm,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$*" >> "$QA_KIT_CAPTURE"\n',
    );
    await chmod(npm, 0o755);

    const result = spawnSync(runner, ["unit"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, QA_KIT_CAPTURE: capture },
    });

    expect(result.status).toBe(0);
    expect((await readFile(capture, "utf8")).split("\n").filter(Boolean)).toEqual([
      "test",
      "run test:gherkin",
    ]);
  });

  it("does not run Gherkin when the ordinary unit suite fails", async () => {
    const directory = await mkdtemp(`${tmpdir()}/adl-qa-kit-unit-failure-`);
    const bin = join(directory, "bin");
    const capture = join(directory, "arguments.txt");
    await mkdir(bin);
    const npm = join(bin, "npm");
    await writeFile(
      npm,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$*" >> "$QA_KIT_CAPTURE"\nif [[ "$1" == "test" ]]; then exit 23; fi\n',
    );
    await chmod(npm, 0o755);

    const result = spawnSync(runner, ["unit"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, QA_KIT_CAPTURE: capture },
    });

    expect(result.status).toBe(23);
    expect((await readFile(capture, "utf8")).split("\n").filter(Boolean)).toEqual(["test"]);
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
    expect(portIsListening(4173), "the test needs an unused production-preview port").toBe(false);
    const directory = await mkdtemp(`${tmpdir()}/adl-qa-kit-interrupt-`);
    const descriptor = join(directory, "environment.json");
    const state = `${descriptor}.qa-kit-environment.json`;
    const child = spawn(runner, ["env:up", "ui", descriptor], {
      cwd: root,
      detached: true,
      // Keep the pre-publication window open long enough for the portable TCP
      // probe to observe it even while the full suite saturates a mobile host.
      env: { ...process.env, QA_KIT_TEST_ENV_UP_DELAY_SECONDS: "30" },
      stdio: "ignore",
    });
    try {
      // env:up performs the production build before it starts Vite. Slower
      // supported hosts (including Termux) can legitimately spend more than
      // the generic 15-second polling default in that build.
      await waitFor(() => portIsListening(4173), "preview never began listening", 90_000);
      await expect(access(state)).rejects.toThrow();
      process.kill(-child.pid!, "SIGTERM");
      await new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
      await waitFor(
        () => !portIsListening(4173),
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
  }, 120_000);
});
