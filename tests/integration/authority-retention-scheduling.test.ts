import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AUTHORITY_RETENTION_RUN_HISTORY,
  AuthorityMetrics,
  AuthorityRetentionRunner,
  PostgresAuthorityRetentionRunStore,
} from "../../src/index.js";
import type {
  AuthorityRetentionPolicy,
  AuthorityRetentionRunRecord,
  AuthorityRetentionRunStore,
  PostgresPool,
  PostgresQueryable,
  SecurityLogEvent,
  SecurityLogger,
} from "../../src/index.js";
import {
  loadRetentionProcessConfiguration,
  runAuthorityRetentionOnce,
} from "../../src/server/authority-retention-entrypoint.js";
import { authorityPool, faultyPool, resetProjections, seedApplication } from "./pg-harness.js";

const app = "retention-schedule-app";
const modelVersion = "1.0.0";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A fixed clock, so every cutoff in this file is arithmetic rather than a guess. */
const NOW = new Date("2026-07-31T12:00:00.000Z");
const now = (): Date => NOW;

/** Comfortably outside every window used here. */
const ANCIENT = "2026-01-01T00:00:00.000Z";
/** Six hours before NOW: inside a 24h window, outside a 1h one. */
const RECENT = "2026-07-31T06:00:00.000Z";
/** Ten minutes before NOW: inside every window used here. */
const JUST_NOW = "2026-07-31T11:50:00.000Z";
/** After NOW: an unexpired session or challenge. */
const FUTURE = "2026-08-05T00:00:00.000Z";
/** Just after NOW: a session deep inside its offline grace. */
const IN_GRACE = "2026-07-31T12:30:00.000Z";

/**
 * Distinctive values seeded into every protected column, so "the log discloses
 * nothing protected" can be asserted by searching for them rather than by
 * reading the implementation and trusting it.
 */
const SENTINELS = {
  auditPayload: "sentinel-audit-payload",
  outcomeBody: "sentinel-outcome-body",
  sessionToken: "sentinel-session-token-hash",
  challengeVerifier: "sentinel-challenge-verifier",
  recordValue: "sentinel-accepted-record-value",
  inviteToken: "sentinel-invite-token-hash",
};

const FULL_POLICY: AuthorityRetentionPolicy = {
  minimumRetentionMs: DAY,
  sessionRetentionMs: DAY,
  challengeRetentionMs: HOUR,
};

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, app, modelVersion);
  await insertIdentity("user-1");
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Every projection's row count in one shot, so "nothing else moved" is a single
 * assertion rather than eight that can each be forgotten.
 */
interface ProjectionCounts {
  audit: number;
  outcomes: number;
  sessions: number;
  challenges: number;
  records: number;
  memberships: number;
  identities: number;
  invites: number;
}

async function projectionCounts(): Promise<ProjectionCounts> {
  const result = await pool.query<Record<keyof ProjectionCounts, number>>(
    `select
       (select count(*)::int from adl_authority_audit_events where application_id=$1) as audit,
       (select count(*)::int from adl_authority_operation_outcomes where application_id=$1) as outcomes,
       (select count(*)::int from adl_authority_sessions where application_id=$1) as sessions,
       (select count(*)::int from adl_authority_webauthn_challenges where application_id=$1) as challenges,
       (select count(*)::int from adl_authority_records where application_id=$1) as records,
       (select count(*)::int from adl_authority_context_memberships where application_id=$1) as memberships,
       (select count(*)::int from adl_authority_identities where application_id=$1) as identities,
       (select count(*)::int from adl_authority_invites where application_id=$1) as invites`,
    [app],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("The projection count query returned no row.");
  return {
    audit: Number(row.audit),
    outcomes: Number(row.outcomes),
    sessions: Number(row.sessions),
    challenges: Number(row.challenges),
    records: Number(row.records),
    memberships: Number(row.memberships),
    identities: Number(row.identities),
    invites: Number(row.invites),
  };
}

async function insertIdentity(userId: string): Promise<void> {
  await pool.query(
    "insert into adl_authority_identities (application_id, user_id, created_at) values ($1,$2,$3) on conflict do nothing",
    [app, userId, ANCIENT],
  );
}

async function insertAudit(id: string, occurredAt: string): Promise<void> {
  await pool.query(
    "insert into adl_authority_audit_events (audit_id, application_id, event, occurred_at) values ($1,$2,$3::jsonb,$4)",
    [
      id,
      app,
      JSON.stringify({ object: "Task", recordId: id, after: SENTINELS.auditPayload }),
      occurredAt,
    ],
  );
}

async function insertOutcome(operationId: string, acceptedAt: string): Promise<void> {
  await pool.query(
    "insert into adl_authority_operation_outcomes (operation_id, actor_id, application_id, outcome, accepted_at) values ($1,'user-1',$2,$3::jsonb,$4)",
    [
      operationId,
      app,
      JSON.stringify({ status: "accepted", operationId, body: SENTINELS.outcomeBody }),
      acceptedAt,
    ],
  );
}

async function insertSession(
  sessionId: string,
  expiresAt: string,
  revokedAt: string | null = null,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_sessions (session_id, application_id, user_id, token_hash, issued_at, expires_at, revoked_at) values ($1,$2,'user-1',$3,$4,$5,$6)",
    [sessionId, app, `${SENTINELS.sessionToken}-${sessionId}`, ANCIENT, expiresAt, revokedAt],
  );
}

async function insertChallenge(
  challengeId: string,
  expiresAt: string,
  consumedAt: string | null = null,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_webauthn_challenges (challenge_id, application_id, ceremony, challenge, created_at, expires_at, consumed_at) values ($1,$2,'authenticate',$3,$4,$5,$6)",
    [
      challengeId,
      app,
      `${SENTINELS.challengeVerifier}-${challengeId}`,
      ANCIENT,
      expiresAt,
      consumedAt,
    ],
  );
}

/** An accepted record, its membership projection row, and an invite: never retention targets. */
async function insertProtectedState(): Promise<void> {
  await pool.query(
    "insert into adl_authority_records (application_id, object_name, record_id, revision, record) values ($1,'BandMember','membership-1','rev-1',$2::jsonb), ($1,'Gig','gig-1','rev-2',$3::jsonb)",
    [
      app,
      JSON.stringify({ meta: { guid: "membership-1" }, values: { User: SENTINELS.recordValue } }),
      JSON.stringify({ meta: { guid: "gig-1" }, values: { Title: SENTINELS.recordValue } }),
    ],
  );
  await pool.query(
    "insert into adl_authority_context_memberships (application_id, membership_record_id, object_name, context_name, context_id, user_id, role, revoked_at) values ($1,'membership-1','BandMember','Band','band-1','user-1','BandAdmin',null), ($1,'membership-2','BandMember','Band','band-1','user-2','BandMember',$2)",
    [app, ANCIENT],
  );
  await pool.query(
    "insert into adl_authority_invites (invite_id, application_id, token_hash, context_name, context_id, role, created_by, created_at, expires_at) values ($1,$2,$3,'Band','band-1','BandMember','user-1',$4,$4)",
    ["invite-1", app, SENTINELS.inviteToken, ANCIENT],
  );
}

/** A capturing logger. Deliberately unredacted, so the runner's own event is asserted. */
class CapturingLogger implements SecurityLogger {
  readonly events: SecurityLogEvent[] = [];
  write(event: SecurityLogEvent): void {
    this.events.push(event);
  }
  eventNames(): string[] {
    return this.events.map((event) => event.event);
  }
}

interface RunnerOptions {
  policy?: AuthorityRetentionPolicy;
  target?: PostgresPool & PostgresQueryable;
  applicationId?: string;
  logger?: SecurityLogger;
  metrics?: AuthorityMetrics;
  runs?: AuthorityRetentionRunStore | null;
}

let runIdCounter = 0;
function retentionRunner(options: RunnerOptions = {}): AuthorityRetentionRunner {
  const applicationId = options.applicationId ?? app;
  const target = options.target ?? authorityPool(pool);
  const runs =
    options.runs === null
      ? undefined
      : (options.runs ?? new PostgresAuthorityRetentionRunStore(target, applicationId));
  return new AuthorityRetentionRunner(target, applicationId, {
    policy: options.policy ?? FULL_POLICY,
    ...(runs === undefined ? {} : { runs }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    now,
    newRunId: () => `fixed-${(runIdCounter += 1)}`,
  });
}

describe("scheduled retention against real PostgreSQL", () => {
  it("prunes only out-of-retention audit and outcome rows and leaves every other projection alone", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertAudit("audit-recent", RECENT);
    await insertOutcome("op-old", ANCIENT);
    await insertOutcome("op-recent", RECENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    await insertProtectedState();
    const before = await projectionCounts();

    // Only the audit/outcome window is configured, so the session and challenge
    // projections are not even considered.
    const record = await retentionRunner({ policy: { minimumRetentionMs: DAY } }).run({
      before: NOW,
    });

    expect(record.outcome).toBe("completed");
    expect(record.effectiveCutoff).toBe("2026-07-30T12:00:00.000Z");
    expect(record.prunedRuntimeAudit).toBe(1);
    expect(record.prunedOutcomes).toBe(1);
    expect(record.prunedSessions).toBe(0);
    expect(record.prunedChallenges).toBe(0);
    expect(record.prunedTotal).toBe(2);

    expect(await projectionCounts()).toEqual({
      ...before,
      audit: before.audit - 1,
      outcomes: before.outcomes - 1,
    });
    // The rows that survived are the in-retention ones, not an arbitrary pair.
    expect(
      await count("select count(*)::int n from adl_authority_audit_events where audit_id=$1", [
        "audit-recent",
      ]),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_operation_outcomes where operation_id=$1",
        ["op-recent"],
      ),
    ).toBe(1);
  });

  it("never prunes the membership projection, even on a run that prunes every prunable projection", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    await insertProtectedState();

    const record = await retentionRunner().run({ before: NOW });

    expect(record.prunedTotal).toBe(4);
    expect({
      audit: record.prunedRuntimeAudit,
      outcomes: record.prunedOutcomes,
      sessions: record.prunedSessions,
      challenges: record.prunedChallenges,
    }).toEqual({ audit: 1, outcomes: 1, sessions: 1, challenges: 1 });

    const after = await projectionCounts();
    // Derived from accepted records and bounded by them: retention must not touch it.
    expect(after.memberships).toBe(2);
    expect(after.records).toBe(2);
    expect(after.identities).toBe(1);
    expect(after.invites).toBe(1);
    expect({ audit: after.audit, outcomes: after.outcomes }).toEqual({ audit: 0, outcomes: 0 });
  });

  it("reports in a dry run exactly what the following real run then deletes, and deletes nothing", async () => {
    await insertAudit("audit-old-a", ANCIENT);
    await insertAudit("audit-old-b", ANCIENT);
    await insertAudit("audit-recent", RECENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    const before = await projectionCounts();

    const dry = await retentionRunner().run({ before: NOW, dryRun: true });
    expect(dry.outcome).toBe("dryRun");
    expect(dry.dryRun).toBe(true);
    expect(dry.held).toBe(false);
    expect(dry.prunedTotal).toBe(5);
    // A dry run deletes nothing at all.
    expect(await projectionCounts()).toEqual(before);

    const real = await retentionRunner().run({ before: NOW });
    expect(real.outcome).toBe("completed");
    expect({
      audit: real.prunedRuntimeAudit,
      outcomes: real.prunedOutcomes,
      sessions: real.prunedSessions,
      challenges: real.prunedChallenges,
      total: real.prunedTotal,
    }).toEqual({
      audit: dry.prunedRuntimeAudit,
      outcomes: dry.prunedOutcomes,
      sessions: dry.prunedSessions,
      challenges: dry.prunedChallenges,
      total: dry.prunedTotal,
    });
    expect(real.effectiveCutoff).toBe(dry.effectiveCutoff);
    expect(await projectionCounts()).toEqual({
      ...before,
      audit: before.audit - 2,
      outcomes: before.outcomes - 1,
      sessions: before.sessions - 1,
      challenges: before.challenges - 1,
    });
  });

  it("refuses under legal hold, deletes nothing and records the run as held", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    const before = await projectionCounts();

    const runner = retentionRunner({ policy: { ...FULL_POLICY, legalHold: true } });
    const record = await runner.run({ before: NOW });

    expect(record.held).toBe(true);
    expect(record.outcome).toBe("held");
    expect(record.effectiveCutoff).toBeNull();
    expect(record.prunedTotal).toBe(0);
    expect(await projectionCounts()).toEqual(before);

    // The durable run log states the hold, so an operator can see why nothing shrank.
    const latest = await runner.latest();
    expect(latest?.outcome).toBe("held");
    expect(latest?.held).toBe(true);
    expect(latest?.prunedTotal).toBe(0);
  });

  it("clamps a cutoff of now to the minimum retention window", async () => {
    await insertAudit("audit-inside", RECENT);
    await insertOutcome("op-inside", RECENT);
    const before = await projectionCounts();

    // The operator asks for everything up to this instant; the window still wins.
    const record = await retentionRunner({ policy: { minimumRetentionMs: DAY } }).run({
      before: NOW,
    });

    expect(record.effectiveCutoff).toBe("2026-07-30T12:00:00.000Z");
    expect(record.prunedTotal).toBe(0);
    expect(await projectionCounts()).toEqual(before);
  });
});

describe("session and challenge retention safeguards against real PostgreSQL", () => {
  async function seedSessions(): Promise<void> {
    await insertSession("session-active", FUTURE);
    await insertSession("session-in-grace", IN_GRACE);
    await insertSession("session-revoked-long-ago", FUTURE, ANCIENT);
    await insertSession("session-expired-long-ago", ANCIENT);
    await insertSession("session-revoked-recently", FUTURE, JUST_NOW);
  }

  async function survivingSessions(): Promise<string[]> {
    const result = await pool.query<{ session_id: string }>(
      "select session_id from adl_authority_sessions where application_id=$1 order by session_id",
      [app],
    );
    return result.rows.map((row) => row.session_id);
  }

  it("never deletes an active session or one inside its offline grace, whatever cutoff is asked for", async () => {
    await seedSessions();

    // A cutoff years in the future: the clamp, not the request, decides.
    const record = await retentionRunner().run({ before: new Date("2030-01-01T00:00:00.000Z") });

    expect(record.prunedSessions).toBe(2);
    expect(await survivingSessions()).toEqual([
      "session-active",
      "session-in-grace",
      "session-revoked-recently",
    ]);
  });

  it("deletes only sessions whose ending is itself older than the session window", async () => {
    await seedSessions();
    const record = await retentionRunner().run({ before: NOW });
    expect(record.prunedSessions).toBe(2);
    // Revoked six hours ago is still inside the 24h window.
    expect(await survivingSessions()).toContain("session-revoked-recently");
    expect(await survivingSessions()).not.toContain("session-revoked-long-ago");
    expect(await survivingSessions()).not.toContain("session-expired-long-ago");
  });

  it("never deletes a live challenge and deletes consumed or expired ones past the window", async () => {
    await insertChallenge("challenge-live", FUTURE);
    await insertChallenge("challenge-consumed-old", ANCIENT, ANCIENT);
    await insertChallenge("challenge-expired-old", ANCIENT);
    await insertChallenge("challenge-consumed-recently", FUTURE, JUST_NOW);

    const record = await retentionRunner().run({ before: new Date("2030-01-01T00:00:00.000Z") });

    expect(record.prunedChallenges).toBe(2);
    const result = await pool.query<{ challenge_id: string }>(
      "select challenge_id from adl_authority_webauthn_challenges where application_id=$1 order by challenge_id",
      [app],
    );
    expect(result.rows.map((row) => row.challenge_id)).toEqual([
      "challenge-consumed-recently",
      "challenge-live",
    ]);
  });
});

describe("retention mutual exclusion and overlap safety against real PostgreSQL", () => {
  const lockKey = `adl_authority_retention:${app}`;

  async function advisoryLocksHeld(): Promise<number> {
    return count("select count(*)::int n from pg_locks where locktype = 'advisory'");
  }

  it("does not proceed while the per-application advisory lock is held elsewhere", async () => {
    await insertAudit("audit-old", ANCIENT);
    const blocker = await pool.connect();
    let settled = false;
    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
      const pending = retentionRunner()
        .run({ before: NOW })
        .then((record) => {
          settled = true;
          return record;
        });

      // Race the run against a generous timer: the timer must win. This fails
      // immediately if the lock is removed from the runner.
      const winner = await Promise.race([
        pending.then(() => "run" as const),
        new Promise<"timer">((resolve) => setTimeout(() => resolve("timer"), 500)),
      ]);
      expect(winner).toBe("timer");
      expect(settled).toBe(false);
      // Nothing was pruned while the contender waited.
      expect(await count("select count(*)::int n from adl_authority_audit_events")).toBe(1);

      await blocker.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
      const record = await pending;
      expect(settled).toBe(true);
      expect(record.outcome).toBe("completed");
      expect(record.prunedRuntimeAudit).toBe(1);
      expect(await count("select count(*)::int n from adl_authority_audit_events")).toBe(0);
    } finally {
      blocker.release();
    }
  });

  it("is safe to repeat: the second run deletes nothing, raises nothing and releases the lock", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);

    const first = await retentionRunner().run({ before: NOW });
    expect(first.prunedTotal).toBe(4);

    const second = await retentionRunner().run({ before: NOW });
    expect(second.outcome).toBe("completed");
    expect(second.prunedTotal).toBe(0);

    expect(await projectionCounts()).toMatchObject({
      audit: 0,
      outcomes: 0,
      sessions: 0,
      challenges: 0,
    });
    // Both runs released what they took.
    expect(await advisoryLocksHeld()).toBe(0);
    // Two runs were recorded, not one and a lost one.
    expect(await count("select count(*)::int n from adl_authority_retention_runs")).toBe(2);
  });

  it("rolls every projection delete back together when one of them faults mid-run", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    await insertProtectedState();
    const before = await projectionCounts();

    // The outcome delete is the second of four, so the audit delete has already
    // executed inside the transaction when the fault lands.
    const faulty = faultyPool(pool, (sql) =>
      sql.startsWith("delete from adl_authority_operation_outcomes"),
    );
    const record = await retentionRunner({ target: faulty }).run({ before: NOW });

    expect(record.outcome).toBe("failed");
    expect(record.prunedTotal).toBe(0);
    expect(record.failureCode).toBeDefined();
    // A reduced fault name, never the driver's own message.
    expect(record.failureCode).toMatch(/^[A-Za-z0-9_]+( [A-Za-z0-9_]{1,32})?$/u);
    expect(record.failureCode).not.toMatch(/injected infrastructure failure/u);
    // The injected fault is a plain Error, so the reduced name is exactly "Error".
    expect(record.failureCode).toBe("Error");

    // Every projection is exactly as it was: the first delete rolled back too.
    expect(await projectionCounts()).toEqual(before);
    // The failure itself is durably recorded, outside the rolled-back transaction.
    const latest = await new PostgresAuthorityRetentionRunStore(authorityPool(pool), app).latest();
    expect(latest?.outcome).toBe("failed");
    expect(latest?.failureCode).toBe(record.failureCode);
  });

  it("prunes nothing and reports a failure for an application this database does not know", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    const before = await projectionCounts();

    const record = await retentionRunner({ applicationId: "no-such-application" }).run({
      before: NOW,
    });

    expect(record.outcome).toBe("failed");
    expect(record.prunedTotal).toBe(0);
    // A reduced fault name, never a driver message — and a name that tells an
    // operator which kind of fault it was, so a misconfigured application id
    // does not read like an infrastructure failure they should go chasing.
    expect(record.failureCode).toBe("AuthorityConfigurationError");
    expect(await projectionCounts()).toEqual(before);
    // No run row could be written for an unknown application, and none was.
    expect(await count("select count(*)::int n from adl_authority_retention_runs")).toBe(0);
  });
});

describe("retention observability against real PostgreSQL", () => {
  it("logs and counts a completed run without disclosing anything protected", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);
    await insertSession("session-stale", ANCIENT, ANCIENT);
    await insertChallenge("challenge-stale", ANCIENT, ANCIENT);
    await insertProtectedState();

    const logger = new CapturingLogger();
    const metrics = new AuthorityMetrics();
    const record = await retentionRunner({ logger, metrics }).run({ before: NOW });

    expect(record.outcome).toBe("completed");
    expect(logger.eventNames()).toEqual(["retention_run_started", "retention_run_completed"]);
    const [started, completed] = logger.events;
    expect(started).toMatchObject({ outcome: "allowed", runId: record.runId, applicationId: app });
    expect(completed).toMatchObject({
      outcome: "allowed",
      runId: record.runId,
      held: false,
      dryRun: false,
      prunedRuntimeAudit: 1,
      prunedOutcomes: 1,
      prunedSessions: 1,
      prunedChallenges: 1,
      prunedTotal: 4,
      effectiveCutoff: "2026-07-30T12:00:00.000Z",
    });

    const snapshot = metrics.snapshot();
    expect(snapshot.retentionRuns).toEqual({ completed: 1 });
    expect(snapshot.retentionDeleted).toEqual({
      runtimeAudit: 1,
      outcomes: 1,
      sessions: 1,
      webauthnChallenges: 1,
    });
    // Both dimensions are also reachable through the scrape surface.
    expect(metrics.prometheus()).toContain(
      'adl_authority_retention_runs_total{outcome="completed"} 1',
    );
    expect(metrics.prometheus()).toContain(
      'adl_authority_retention_deleted_total{projection="runtimeAudit"} 1',
    );

    // Nothing protected reaches the log, before any redaction is applied.
    const serialised = JSON.stringify(logger.events);
    for (const sentinel of Object.values(SENTINELS)) expect(serialised).not.toContain(sentinel);
    expect(serialised).not.toMatch(/audit-old|op-old|session-stale|challenge-stale|membership-1/u);
  });

  it("logs a held run and a failed run under their own event names", async () => {
    await insertAudit("audit-old", ANCIENT);
    await insertOutcome("op-old", ANCIENT);

    const heldLogger = new CapturingLogger();
    const heldMetrics = new AuthorityMetrics();
    await retentionRunner({
      policy: { ...FULL_POLICY, legalHold: true },
      logger: heldLogger,
      metrics: heldMetrics,
    }).run({ before: NOW });
    expect(heldLogger.eventNames()).toEqual(["retention_run_started", "retention_run_held"]);
    expect(heldLogger.events[1]).toMatchObject({ outcome: "denied", held: true, prunedTotal: 0 });
    expect(heldMetrics.snapshot().retentionRuns).toEqual({ held: 1 });
    // A held run deletes nothing, so it contributes no deletion counters at all.
    expect(heldMetrics.snapshot().retentionDeleted).toEqual({});

    const failedLogger = new CapturingLogger();
    const failedMetrics = new AuthorityMetrics();
    const faulty = faultyPool(pool, (sql) =>
      sql.startsWith("delete from adl_authority_audit_events"),
    );
    await retentionRunner({ target: faulty, logger: failedLogger, metrics: failedMetrics }).run({
      before: NOW,
    });
    expect(failedLogger.eventNames()).toEqual(["retention_run_started", "retention_run_failed"]);
    expect(failedLogger.events[1]).toMatchObject({ outcome: "failed", prunedTotal: 0 });
    expect(failedMetrics.snapshot().retentionRuns).toEqual({ failed: 1 });
    expect(failedMetrics.snapshot().retentionDeleted).toEqual({});

    // Neither path leaks a driver message or a protected value.
    const serialised = JSON.stringify([...heldLogger.events, ...failedLogger.events]);
    for (const sentinel of Object.values(SENTINELS)) expect(serialised).not.toContain(sentinel);
    expect(serialised).not.toContain("injected infrastructure failure");
  });

  it("records a dry run distinctly from a completed one", async () => {
    await insertAudit("audit-old", ANCIENT);
    const logger = new CapturingLogger();
    const metrics = new AuthorityMetrics();
    await retentionRunner({ logger, metrics }).run({ before: NOW, dryRun: true });

    expect(logger.eventNames()).toEqual(["retention_run_started", "retention_run_completed"]);
    expect(logger.events[0]).toMatchObject({ dryRun: true });
    expect(logger.events[1]).toMatchObject({ dryRun: true, prunedRuntimeAudit: 1 });
    expect(metrics.snapshot().retentionRuns).toEqual({ dryRun: 1 });
    // A rehearsal must not be counted as rows actually deleted.
    expect(metrics.snapshot().retentionDeleted).toEqual({});
  });
});

describe("retention run log bounding against real PostgreSQL", () => {
  it("trims the run history to the configured bound as it records", async () => {
    const store = new PostgresAuthorityRetentionRunStore(authorityPool(pool), app);
    const overflow = 6;
    // Seed the log directly, so the trim can be proven without driving hundreds
    // of real runs. `generate_series` gives strictly increasing finish times.
    await pool.query(
      `insert into adl_authority_retention_runs (
         run_id, application_id, started_at, finished_at, outcome, dry_run, held,
         effective_cutoff, pruned_runtime_audit, pruned_outcomes, pruned_sessions, pruned_challenges
       )
       select 'bulk-' || lpad(i::text, 5, '0'), $1,
              timestamptz '2026-01-01T00:00:00Z' + (i || ' minutes')::interval,
              timestamptz '2026-01-01T00:00:00Z' + (i || ' minutes')::interval,
              'completed', false, false, null, 0, 0, 0, 0
       from generate_series(1, $2) as i`,
      [app, AUTHORITY_RETENTION_RUN_HISTORY + overflow],
    );
    expect(await count("select count(*)::int n from adl_authority_retention_runs")).toBe(
      AUTHORITY_RETENTION_RUN_HISTORY + overflow,
    );

    const newest: AuthorityRetentionRunRecord = {
      runId: "retention-newest",
      applicationId: app,
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
      outcome: "completed",
      dryRun: false,
      held: false,
      effectiveCutoff: null,
      prunedRuntimeAudit: 0,
      prunedOutcomes: 0,
      prunedSessions: 0,
      prunedChallenges: 0,
      prunedTotal: 0,
    };
    await store.record(newest);

    expect(await count("select count(*)::int n from adl_authority_retention_runs")).toBe(
      AUTHORITY_RETENTION_RUN_HISTORY,
    );
    // The most recent run survives and the oldest ones were the ones dropped.
    expect(
      await count("select count(*)::int n from adl_authority_retention_runs where run_id=$1", [
        "retention-newest",
      ]),
    ).toBe(1);
    expect(
      await count("select count(*)::int n from adl_authority_retention_runs where run_id=$1", [
        "bulk-00001",
      ]),
    ).toBe(0);
    expect((await store.latest())?.runId).toBe("retention-newest");
  });

  it("leaves another application's run log alone when it trims", async () => {
    const other = "retention-other-app";
    await seedApplication(pool, other, modelVersion);
    await pool.query(
      `insert into adl_authority_retention_runs (
         run_id, application_id, started_at, finished_at, outcome, dry_run, held,
         effective_cutoff, pruned_runtime_audit, pruned_outcomes, pruned_sessions, pruned_challenges
       )
       select 'other-' || lpad(i::text, 5, '0'), $1,
              timestamptz '2026-01-01T00:00:00Z' + (i || ' minutes')::interval,
              timestamptz '2026-01-01T00:00:00Z' + (i || ' minutes')::interval,
              'completed', false, false, null, 0, 0, 0, 0
       from generate_series(1, 5) as i`,
      [other],
    );

    await retentionRunner().run({ before: NOW });

    expect(
      await count(
        "select count(*)::int n from adl_authority_retention_runs where application_id=$1",
        [other],
      ),
    ).toBe(5);
  });
});

describe("the one-shot retention entry point against real PostgreSQL", () => {
  function environment(
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> {
    return {
      ADL_APPLICATION_ID: app,
      ADL_DATABASE_URL: inject("pgUrl"),
      ADL_RETENTION_MINIMUM_DAYS: "1",
      ADL_RETENTION_SESSION_DAYS: "1",
      ADL_RETENTION_CHALLENGE_DAYS: "1",
      ...overrides,
    };
  }

  /**
   * The entry point composes its own real clock, so these rows are seeded
   * relative to the database's `now()` rather than to this file's fixed instant.
   */
  async function seedRelativeToNow(): Promise<void> {
    await pool.query(
      "insert into adl_authority_audit_events (audit_id, application_id, event, occurred_at) values ('entry-old',$1,$2::jsonb, now() - interval '400 days'), ('entry-recent',$1,$2::jsonb, now() - interval '1 hour')",
      [app, JSON.stringify({ object: "Task", after: SENTINELS.auditPayload })],
    );
    await pool.query(
      "insert into adl_authority_operation_outcomes (operation_id, actor_id, application_id, outcome, accepted_at) values ('entry-op-old','user-1',$1,$2::jsonb, now() - interval '400 days')",
      [app, JSON.stringify({ status: "accepted", body: SENTINELS.outcomeBody })],
    );
  }

  it("loads a valid configuration and applies the retention environment", () => {
    const configuration = loadRetentionProcessConfiguration(
      environment({ ADL_RETENTION_INTERVAL_MINUTES: "30", ADL_RETENTION_LEGAL_HOLD: "true" }),
    );
    expect(configuration.applicationId).toBe(app);
    expect(configuration.retention).toEqual({
      minimumRetentionDays: 1,
      sessionRetentionDays: 1,
      challengeRetentionDays: 1,
      legalHold: true,
      intervalMinutes: 30,
    });
  });

  it("refuses a missing or invalid application id and a non-PostgreSQL database url", () => {
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_APPLICATION_ID: undefined })),
    ).toThrow("ADL_APPLICATION_ID is required.");
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_APPLICATION_ID: "   " })),
    ).toThrow("ADL_APPLICATION_ID is required.");
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_APPLICATION_ID: `bad\u0000id` })),
    ).toThrow("ADL_APPLICATION_ID is invalid.");
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_DATABASE_URL: undefined })),
    ).toThrow("ADL_DATABASE_URL is required.");
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_DATABASE_URL: "mysql://db/adl" })),
    ).toThrow("ADL_DATABASE_URL must be a PostgreSQL URL.");
    expect(() =>
      loadRetentionProcessConfiguration(environment({ ADL_RETENTION_MINIMUM_DAYS: "0" })),
    ).toThrow("positive integer");
  });

  it("runs once against a real database with an injected pool, dry first then for real", async () => {
    await seedRelativeToNow();
    const before = await projectionCounts();

    const dry = await runAuthorityRetentionOnce({
      environment: environment(),
      dryRun: true,
      pool: authorityPool(pool),
    });
    expect(dry.outcome).toBe("dryRun");
    expect(dry.dryRun).toBe(true);
    expect(dry.prunedRuntimeAudit).toBe(1);
    expect(dry.prunedOutcomes).toBe(1);
    expect(await projectionCounts()).toEqual(before);

    const real = await runAuthorityRetentionOnce({
      environment: environment(),
      pool: authorityPool(pool),
    });
    expect(real.outcome).toBe("completed");
    expect(real.prunedRuntimeAudit).toBe(1);
    expect(real.prunedOutcomes).toBe(1);
    expect(await projectionCounts()).toEqual({
      ...before,
      audit: before.audit - 1,
      outcomes: before.outcomes - 1,
    });
    // The in-retention row survived a real one-shot run.
    expect(
      await count("select count(*)::int n from adl_authority_audit_events where audit_id=$1", [
        "entry-recent",
      ]),
    ).toBe(1);
    // Both invocations left durable evidence in the run log.
    expect(await count("select count(*)::int n from adl_authority_retention_runs")).toBe(2);
    // The injected pool is still usable: the entry point closed only pools it owns.
    expect(await count("select 1::int n")).toBe(1);
  });

  it("honours legal hold from the environment", async () => {
    await seedRelativeToNow();
    const before = await projectionCounts();
    const record = await runAuthorityRetentionOnce({
      environment: environment({ ADL_RETENTION_LEGAL_HOLD: "true" }),
      pool: authorityPool(pool),
    });
    expect(record.outcome).toBe("held");
    expect(await projectionCounts()).toEqual(before);
  });
});
