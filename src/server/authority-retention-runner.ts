import { AuthorityConfigurationError } from "./authority-config.js";
import {
  AuthorityRetentionService,
  type AuthorityRetentionPolicy,
  type AuthorityRetentionStatus,
} from "./authority-retention.js";
import type { PostgresPool, PostgresPoolClient } from "./authority-unit-of-work.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";
import {
  AuthorityMetrics,
  StructuredSecurityLogger,
  type SecurityLogger,
} from "./security-operations.js";

/**
 * How a completed retention run finished. `held` and `dryRun` both mean nothing
 * was deleted; they are distinguished because one is a policy state an operator
 * has to clear and the other is a rehearsal they asked for.
 */
export type AuthorityRetentionRunOutcome = "completed" | "dryRun" | "held" | "failed";

/**
 * The durable, metadata-only record of one run. It carries counts, a cutoff and
 * an outcome — no accepted record, audit payload, token, verifier, outcome body,
 * or driver message. `failureCode` is a reduced fault name, never a message.
 */
export interface AuthorityRetentionRunRecord {
  runId: string;
  applicationId: string;
  startedAt: string;
  finishedAt: string;
  outcome: AuthorityRetentionRunOutcome;
  dryRun: boolean;
  held: boolean;
  effectiveCutoff: string | null;
  prunedRuntimeAudit: number;
  prunedOutcomes: number;
  prunedSessions: number;
  prunedChallenges: number;
  prunedTotal: number;
  failureCode?: string;
}

export interface AuthorityRetentionRunStore {
  record(run: AuthorityRetentionRunRecord): Promise<void>;
  latest(): Promise<AuthorityRetentionRunRecord | null>;
}

/** How many runs are kept per application, so the run log cannot itself grow forever. */
export const AUTHORITY_RETENTION_RUN_HISTORY = 200;

/**
 * PostgreSQL run log. Writing a run also trims the application's history to the
 * most recent {@link AUTHORITY_RETENTION_RUN_HISTORY} entries, so the table that
 * exists to prove retention happened does not become a fifth thing needing it.
 */
export class PostgresAuthorityRetentionRunStore implements AuthorityRetentionRunStore {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}

  async record(run: AuthorityRetentionRunRecord): Promise<void> {
    await this.database.query(
      `insert into adl_authority_retention_runs (
         run_id, application_id, started_at, finished_at, outcome, dry_run, held,
         effective_cutoff, pruned_runtime_audit, pruned_outcomes, pruned_sessions,
         pruned_challenges, failure_code
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (run_id) do nothing`,
      [
        run.runId,
        this.applicationId,
        run.startedAt,
        run.finishedAt,
        run.outcome,
        run.dryRun,
        run.held,
        run.effectiveCutoff,
        run.prunedRuntimeAudit,
        run.prunedOutcomes,
        run.prunedSessions,
        run.prunedChallenges,
        run.failureCode ?? null,
      ],
    );
    await this.database.query(
      `delete from adl_authority_retention_runs
       where application_id = $1
         and run_id not in (
           select run_id from adl_authority_retention_runs
           where application_id = $1
           order by finished_at desc, run_id desc
           limit $2
         )`,
      [this.applicationId, AUTHORITY_RETENTION_RUN_HISTORY],
    );
  }

  async latest(): Promise<AuthorityRetentionRunRecord | null> {
    const result = await this.database.query<{
      run_id: string;
      started_at: Date | string;
      finished_at: Date | string;
      outcome: string;
      dry_run: boolean;
      held: boolean;
      effective_cutoff: Date | string | null;
      pruned_runtime_audit: number;
      pruned_outcomes: number;
      pruned_sessions: number;
      pruned_challenges: number;
      failure_code: string | null;
    }>(
      `select run_id, started_at, finished_at, outcome, dry_run, held, effective_cutoff,
              pruned_runtime_audit, pruned_outcomes, pruned_sessions, pruned_challenges, failure_code
       from adl_authority_retention_runs
       where application_id = $1
       order by finished_at desc, run_id desc
       limit 1`,
      [this.applicationId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const counts = {
      prunedRuntimeAudit: Number(row.pruned_runtime_audit),
      prunedOutcomes: Number(row.pruned_outcomes),
      prunedSessions: Number(row.pruned_sessions),
      prunedChallenges: Number(row.pruned_challenges),
    };
    return {
      runId: row.run_id,
      applicationId: this.applicationId,
      startedAt: new Date(row.started_at).toISOString(),
      finishedAt: new Date(row.finished_at).toISOString(),
      outcome: isRunOutcome(row.outcome) ? row.outcome : "failed",
      dryRun: row.dry_run,
      held: row.held,
      effectiveCutoff:
        row.effective_cutoff === null ? null : new Date(row.effective_cutoff).toISOString(),
      ...counts,
      prunedTotal:
        counts.prunedRuntimeAudit +
        counts.prunedOutcomes +
        counts.prunedSessions +
        counts.prunedChallenges,
      ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    };
  }
}

/** Test/development run log. Production wiring uses the PostgreSQL store above. */
export class InMemoryAuthorityRetentionRunStore implements AuthorityRetentionRunStore {
  readonly runs: AuthorityRetentionRunRecord[] = [];
  async record(run: AuthorityRetentionRunRecord): Promise<void> {
    this.runs.push({ ...run });
    if (this.runs.length > AUTHORITY_RETENTION_RUN_HISTORY)
      this.runs.splice(0, this.runs.length - AUTHORITY_RETENTION_RUN_HISTORY);
  }
  async latest(): Promise<AuthorityRetentionRunRecord | null> {
    return this.runs.at(-1) ?? null;
  }
}

export interface AuthorityRetentionRunnerOptions {
  policy: AuthorityRetentionPolicy;
  runs?: AuthorityRetentionRunStore;
  logger?: SecurityLogger;
  metrics?: AuthorityMetrics;
  now?: () => Date;
  newRunId?: () => string;
}

export interface AuthorityRetentionRunRequest {
  /** Rows strictly older than this are eligible, subject to the policy guards. Defaults to now. */
  before?: Date;
  /** Report what would be pruned and delete nothing. */
  dryRun?: boolean;
}

/**
 * Runs retention once, under mutual exclusion, and records what happened.
 *
 * The advisory lock is the mechanism for overlap safety, keyed per application
 * with `hashtext` so unrelated applications sharing one database never serialise
 * against each other. It is taken for the duration of the run and released in a
 * `finally`, and a contender **waits** rather than skipping: two schedulers, or
 * a scheduler and an operator's manual run, can overlap freely and the second
 * simply proceeds once the first has committed. A crashed process releases the
 * lock when its backend ends, so it can never be held by nobody.
 *
 * The four deletes and the run record commit together on one pinned client, so a
 * failure part-way through leaves every projection exactly as it was rather than
 * half-pruned with no record of it.
 */
export class AuthorityRetentionRunner {
  private readonly logger: SecurityLogger;
  private readonly metrics: AuthorityMetrics;
  private readonly runs: AuthorityRetentionRunStore | undefined;
  private readonly now: () => Date;
  private readonly newRunId: () => string;

  constructor(
    private readonly pool: PostgresPool & PostgresQueryable,
    private readonly applicationId: string,
    private readonly options: AuthorityRetentionRunnerOptions,
  ) {
    this.logger = options.logger ?? new StructuredSecurityLogger();
    this.metrics = options.metrics ?? new AuthorityMetrics();
    this.runs = options.runs;
    this.now = options.now ?? (() => new Date());
    this.newRunId = options.newRunId ?? secureRunId;
  }

  /** The most recent recorded run, or null when retention has never run here. */
  async latest(): Promise<AuthorityRetentionRunRecord | null> {
    return (await this.runs?.latest()) ?? null;
  }

  async run(request: AuthorityRetentionRunRequest = {}): Promise<AuthorityRetentionRunRecord> {
    const runId = `retention-${this.newRunId()}`;
    const startedAt = this.now().toISOString();
    const dryRun = request.dryRun === true;
    this.logger.write({
      event: "retention_run_started",
      outcome: "allowed",
      runId,
      applicationId: this.applicationId,
      dryRun,
      occurredAt: startedAt,
    });

    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query("select pg_advisory_lock(hashtext($1))", [this.lockKey]);
      locked = true;
      const record = await this.execute(client, runId, startedAt, request, dryRun);
      this.report(record);
      return record;
    } catch (error) {
      const record: AuthorityRetentionRunRecord = {
        runId,
        applicationId: this.applicationId,
        startedAt,
        finishedAt: this.now().toISOString(),
        outcome: "failed",
        dryRun,
        held: false,
        effectiveCutoff: null,
        prunedRuntimeAudit: 0,
        prunedOutcomes: 0,
        prunedSessions: 0,
        prunedChallenges: 0,
        prunedTotal: 0,
        failureCode: faultCode(error),
      };
      // Recorded after the rollback, on the same pinned client, so an operator
      // can see that a run failed and when. A failure to record the failure is
      // swallowed: the run already failed, and the log line below is the report
      // that matters.
      if (this.runs !== undefined)
        try {
          await new PostgresAuthorityRetentionRunStore(client, this.applicationId).record(record);
        } catch {
          // Nothing further to do; the structured log still states the failure.
        }
      this.report(record);
      return record;
    } finally {
      // Releasing an unlocked session-level lock logs a PostgreSQL warning, so
      // only unlock what was actually taken.
      if (locked)
        await client
          .query("select pg_advisory_unlock(hashtext($1))", [this.lockKey])
          .catch(() => undefined);
      client.release();
    }
  }

  /**
   * The transactional body. The application row is checked first: retention that
   * cannot name its application would delete nothing anyway, and saying so is
   * better than recording a run against an id nobody deployed.
   */
  private async execute(
    client: PostgresPoolClient,
    runId: string,
    startedAt: string,
    request: AuthorityRetentionRunRequest,
    dryRun: boolean,
  ): Promise<AuthorityRetentionRunRecord> {
    const known = await client.query(
      "select 1 from adl_authority_models where application_id = $1",
      [this.applicationId],
    );
    if (known.rows.length === 0)
      throw new AuthorityConfigurationError(
        "The application is unknown to this authority database; retention pruned nothing.",
      );

    await client.query("begin");
    try {
      const service = new AuthorityRetentionService(client, this.applicationId, this.now);
      const status = await service.prune(this.options.policy, {
        before: request.before ?? this.now(),
        dryRun,
      });
      const record = this.summarise(runId, startedAt, status);
      if (this.runs !== undefined)
        await new PostgresAuthorityRetentionRunStore(client, this.applicationId).record(record);
      await client.query("commit");
      return record;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }

  private summarise(
    runId: string,
    startedAt: string,
    status: AuthorityRetentionStatus,
  ): AuthorityRetentionRunRecord {
    return {
      runId,
      applicationId: this.applicationId,
      startedAt,
      finishedAt: this.now().toISOString(),
      outcome: status.held ? "held" : status.dryRun ? "dryRun" : "completed",
      dryRun: status.dryRun,
      held: status.held,
      effectiveCutoff: status.effectiveCutoff,
      prunedRuntimeAudit: status.prunedRuntimeAudit,
      prunedOutcomes: status.prunedOutcomes,
      prunedSessions: status.prunedSessions,
      prunedChallenges: status.prunedChallenges,
      prunedTotal: status.prunedTotal,
    };
  }

  /** Metrics and one structured line. Counts only — never a row, payload or message. */
  private report(record: AuthorityRetentionRunRecord): void {
    this.metrics.incrementRetentionRun(record.outcome);
    if (record.outcome === "completed") {
      this.metrics.incrementRetentionDeleted("runtimeAudit", record.prunedRuntimeAudit);
      this.metrics.incrementRetentionDeleted("outcomes", record.prunedOutcomes);
      this.metrics.incrementRetentionDeleted("sessions", record.prunedSessions);
      this.metrics.incrementRetentionDeleted("webauthnChallenges", record.prunedChallenges);
    }
    this.logger.write({
      event:
        record.outcome === "failed"
          ? "retention_run_failed"
          : record.outcome === "held"
            ? "retention_run_held"
            : "retention_run_completed",
      outcome: record.outcome === "failed" ? "failed" : record.held ? "denied" : "allowed",
      runId: record.runId,
      applicationId: record.applicationId,
      dryRun: record.dryRun,
      held: record.held,
      effectiveCutoff: record.effectiveCutoff,
      prunedRuntimeAudit: record.prunedRuntimeAudit,
      prunedOutcomes: record.prunedOutcomes,
      prunedSessions: record.prunedSessions,
      prunedChallenges: record.prunedChallenges,
      prunedTotal: record.prunedTotal,
      ...(record.failureCode === undefined ? {} : { reason: record.failureCode }),
      occurredAt: record.finishedAt,
    });
  }

  /** hashtext gives a stable per-application key; other applications never serialise on it. */
  private get lockKey(): string {
    return `adl_authority_retention:${this.applicationId}`;
  }
}

/**
 * Drives {@link AuthorityRetentionRunner} on an interval inside the authority
 * process. This is deliberately not a job runner: there is no queue, no
 * distribution and no persistence of intent. A deployment that prefers `cron` or
 * a scheduled container simply leaves the interval unset and runs the one-shot
 * entry point instead; the advisory lock makes both safe at once.
 */
export class AuthorityRetentionScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly runner: AuthorityRetentionRunner,
    private readonly intervalMs: number,
    private readonly options: { runAtStart?: boolean } = {},
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // Never hold the process open just to wait for the next prune.
    (this.timer as { unref?: () => void }).unref?.();
    if (this.options.runAtStart === true) void this.tick();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One tick. Overlap is prevented twice over: locally by this flag, so a slow
   * run does not stack up ticks behind it, and globally by the advisory lock.
   * A failure is already logged and recorded by the runner, so nothing is
   * rethrown into the timer, where it would be an unhandled rejection.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runner.run();
    } catch {
      // `run` reports its own failures; a throw here would kill the interval.
    } finally {
      this.running = false;
    }
  }
}

/**
 * Retention's deployment configuration. It is process placement and operational
 * policy, not application semantics, so — like `AuthorityProcessConfiguration` —
 * it is deliberately separate from `AuthorityConfiguration` and is never modelled
 * in ADL source.
 */
export interface AuthorityRetentionProcessConfiguration {
  minimumRetentionDays: number;
  /** Terminated sessions are kept this long after they ended. */
  sessionRetentionDays: number;
  /** Finished ceremony challenges are kept this long after they finished. */
  challengeRetentionDays: number;
  legalHold: boolean;
  /** Absent means no in-process schedule; an operator drives retention out of band. */
  intervalMinutes?: number;
}

/**
 * Defaults are deliberately conservative: a year of audit and outcomes, a month
 * of ended sessions, a day of finished challenges, and **no** in-process
 * schedule at all. A deployment that has not thought about retention therefore
 * deletes nothing until an operator asks it to.
 */
export function loadAuthorityRetentionConfiguration(
  environment: Record<string, string | undefined>,
): AuthorityRetentionProcessConfiguration {
  return {
    minimumRetentionDays: positiveInteger(environment.ADL_RETENTION_MINIMUM_DAYS, 365),
    sessionRetentionDays: positiveInteger(environment.ADL_RETENTION_SESSION_DAYS, 30),
    challengeRetentionDays: positiveInteger(environment.ADL_RETENTION_CHALLENGE_DAYS, 1),
    legalHold: environment.ADL_RETENTION_LEGAL_HOLD?.trim() === "true",
    ...(environment.ADL_RETENTION_INTERVAL_MINUTES === undefined
      ? {}
      : { intervalMinutes: positiveInteger(environment.ADL_RETENTION_INTERVAL_MINUTES, 0) }),
  };
}

export function retentionPolicy(
  configuration: AuthorityRetentionProcessConfiguration,
): AuthorityRetentionPolicy {
  return {
    minimumRetentionMs: configuration.minimumRetentionDays * DAY_MS,
    sessionRetentionMs: configuration.sessionRetentionDays * DAY_MS,
    challengeRetentionMs: configuration.challengeRetentionDays * DAY_MS,
    legalHold: configuration.legalHold,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isRunOutcome(value: string): value is AuthorityRetentionRunOutcome {
  return value === "completed" || value === "dryRun" || value === "held" || value === "failed";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AuthorityConfigurationError(
      "Authority retention configuration must be a positive integer number of days or minutes.",
    );
  return parsed;
}

/**
 * A fault reduced to its name and, when present, its short symbolic code. The
 * driver's own message is dropped: it can name hosts, roles and statement text.
 */
function faultCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/u.test(code)
    ? `${error.name} ${code}`
    : error.name;
}

function secureRunId(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
