import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { applyMigrations } from "./pg-harness.js";

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

interface GlobalSetupContext {
  provide: <K extends "pgUrl">(key: K, value: string) => void;
}

const IMAGE = "postgres:16-alpine";

/**
 * Provision a throwaway PostgreSQL container for the integration suite. If an
 * external database is supplied via ADL_TEST_DATABASE_URL, use it as-is and skip
 * Docker (useful in CI that already provides a Postgres service).
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => void> {
  const external = process.env.ADL_TEST_DATABASE_URL;
  if (external !== undefined && external.length > 0) {
    await waitForReady(external);
    provide("pgUrl", external);
    return () => undefined;
  }

  const name = `adl-it-pg-${process.pid}-${Date.now().toString(36)}`;
  try {
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "--name",
        name,
        "-e",
        "POSTGRES_PASSWORD=adl",
        "-e",
        "POSTGRES_USER=adl",
        "-e",
        "POSTGRES_DB=adl",
        "-p",
        "127.0.0.1:0:5432",
        IMAGE,
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    throw new Error(
      `Could not start the integration Postgres container. Ensure Docker is running, or set ADL_TEST_DATABASE_URL to a reachable database. Cause: ${describe(error)}`,
    );
  }

  const stop = (): void => {
    try {
      execFileSync("docker", ["rm", "-f", name], { stdio: "pipe" });
    } catch {
      // Best-effort teardown; the container was started with --rm.
    }
  };

  try {
    const mapping = execFileSync("docker", ["port", name, "5432/tcp"], { stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")[0];
    const port = Number(mapping?.split(":").pop());
    if (!Number.isInteger(port) || port <= 0)
      throw new Error(`Unexpected port mapping '${mapping}'.`);
    const url = `postgres://adl:adl@127.0.0.1:${port}/adl`;
    await waitForReady(url);
    provide("pgUrl", url);
  } catch (error) {
    stop();
    throw error instanceof Error ? error : new Error(String(error));
  }

  return stop;
}

async function waitForReady(connectionString: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("select 1");
      await applyMigrations(client);
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
      await delay(500);
    }
  }
  throw new Error(`PostgreSQL did not become ready in time: ${describe(lastError)}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
