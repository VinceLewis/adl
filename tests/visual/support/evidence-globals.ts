/**
 * Run-level facts the per-test evidence cannot know, recorded once at the start.
 *
 * The one that matters is server ownership. `playwright.config.ts` sets
 * `reuseExistingServer: true` on every web server and binds fixed ports, so a
 * server started by another checkout — possibly built with a different
 * `VITE_ADL_AUTHORITY_URL` — is adopted silently, and a run can appear to verify
 * something it never touched. `learnings/process/visual-browser-verification.md`
 * records that this has already happened here, and that the way to check is
 * `ss -ltnp` followed by `/proc/<pid>/cwd`.
 *
 * That check is mechanical, so it is done mechanically rather than left as an
 * instruction somebody must remember at the one moment they are least likely to
 * (`learnings/process/instruction-placement.md`: a prose rule that can be
 * enforced should never have been prose). A port served from another working
 * tree fails the run rather than producing confident, wrong screenshots.
 *
 * Playwright starts `webServer` entries before `globalSetup`, so by the time
 * this runs the ports are listening either way — which is why this records the
 * owner's working directory rather than merely whether something answered.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORTS = [5173, 4173, 5273, 5373, 5473];

interface PortOwner {
  port: number;
  pid: number | undefined;
  cwd: string | undefined;
  foreign: boolean;
}

function listeningPids(): Map<number, number> {
  const owners = new Map<number, number>();
  let output = "";
  try {
    output = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
  } catch {
    return owners;
  }
  for (const line of output.split("\n")) {
    const address = /:(\d+)\s/u.exec(line);
    const pid = /pid=(\d+)/u.exec(line);
    if (address === null || pid === null) continue;
    const port = Number(address[1]);
    if (PORTS.includes(port)) owners.set(port, Number(pid[1]));
  }
  return owners;
}

export default async function recordServerOwnership(): Promise<void> {
  const root = resolve(process.cwd(), "test-results", "visual");
  const owners = listeningPids();
  const observations: PortOwner[] = PORTS.map((port) => {
    const pid = owners.get(port);
    let cwd: string | undefined;
    if (pid !== undefined) {
      try {
        cwd = readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        cwd = undefined;
      }
    }
    return {
      port,
      pid,
      cwd,
      foreign: cwd !== undefined && cwd !== process.cwd(),
    };
  });

  mkdirSync(root, { recursive: true });
  writeFileSync(
    resolve(root, "servers.json"),
    JSON.stringify(
      { observedAt: new Date().toISOString(), expectedCwd: process.cwd(), ports: observations },
      null,
      2,
    ),
  );

  const foreign = observations.filter((entry) => entry.foreign);
  if (foreign.length > 0) {
    throw new Error(
      `A web server on ${foreign.map((entry) => entry.port).join(", ")} is served from another working tree ` +
        `(${foreign.map((entry) => `${entry.port}: ${entry.cwd}`).join("; ")}), and reuseExistingServer would adopt it. ` +
        `This run would screenshot somebody else's checkout. Stop that server, or run from ${process.cwd()}.`,
    );
  }
}
