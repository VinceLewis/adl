import { runAuthorityRetentionOnce } from "./authority-retention-entrypoint.js";

/**
 * `node dist-server/src/server/authority-retention-main.js [--dry-run]`
 *
 * One retention run, then exit. This is what a `cron` line, a Kubernetes
 * `CronJob` or a systemd timer invokes. Nothing is printed but the run's own
 * metadata-only summary, which the runner has already written to the structured
 * security log and the run log; a failure prints its reduced fault name only,
 * because a stack, cause, or configuration dump here could carry a connection
 * string.
 *
 * The exit code is the contract for the scheduler: 0 for a completed, dry or
 * held run, 1 for a failure, so a cron wrapper can alert without parsing text.
 */
const dryRun = process.argv.slice(2).includes("--dry-run");

void runAuthorityRetentionOnce({ ...(dryRun ? { dryRun: true } : {}) })
  .then((record) => {
    console.info(JSON.stringify(record));
    if (record.outcome === "failed") process.exitCode = 1;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : "Error: retention run failed",
    );
    process.exitCode = 1;
  });
