import type { PostgresQueryable } from "./postgres-authority-store.js";

/**
 * The projections retention may prune. Every one of them is derived, transient,
 * or already terminated: no accepted record, identity, invite, membership, or
 * membership projection row is ever in this list.
 *
 * `contextMemberships` is deliberately absent and must stay absent. It holds one
 * row per accepted membership record, so it is bounded by the record set rather
 * than by time, and deleting a row there would remove a live membership from
 * resolution without removing the membership itself.
 */
export const AUTHORITY_RETENTION_PROJECTIONS = [
  "runtimeAudit",
  "outcomes",
  "sessions",
  "webauthnChallenges",
] as const;

export type AuthorityRetentionProjection = (typeof AUTHORITY_RETENTION_PROJECTIONS)[number];

/**
 * Retention policy for the prunable authority projections. Retention is a
 * persistence concern only; the runtime remains the semantic authority and this
 * service never touches accepted records, identities, invites, or memberships.
 */
export interface AuthorityRetentionPolicy {
  /**
   * The minimum retention window for the runtime-audit and outcome projections.
   * Rows more recent than `now - minimumRetentionMs` are in-retention and are
   * never pruned, even if an operator requests an earlier cutoff. Must be a
   * positive duration.
   */
  minimumRetentionMs: number;
  /**
   * How long a **terminated** session row is kept after it ended. Omit to leave
   * the session projection alone entirely. A session that is still active — not
   * revoked and not yet expired — is never eligible whatever this is set to,
   * because pruning one would sign somebody out mid-grace with no way to tell
   * them why.
   */
  sessionRetentionMs?: number;
  /**
   * How long a **finished** WebAuthn challenge row is kept after it was consumed
   * or expired. Omit to leave the challenge projection alone. A challenge that
   * is still answerable is never eligible: pruning one would fail a ceremony
   * already in flight.
   */
  challengeRetentionMs?: number;
  /** When true, pruning is refused entirely (legal hold). */
  legalHold?: boolean;
}

export interface AuthorityRetentionRequest {
  /** Rows strictly older than this are eligible, subject to the per-projection guards. */
  before: Date;
  /**
   * Report what would be pruned and delete nothing. A dry run reads the same
   * predicates the real run deletes with, so its counts are the counts — not an
   * estimate produced by a second, differently-shaped query.
   */
  dryRun?: boolean;
}

/** Metadata-only per-projection result. Counts and a cutoff, never a row. */
export interface AuthorityRetentionProjectionResult {
  projection: AuthorityRetentionProjection;
  /** False when the policy declares no window for this projection, so nothing was considered. */
  configured: boolean;
  /** The cutoff actually applied (ISO), or null when unconfigured or held. */
  effectiveCutoff: string | null;
  /** Rows deleted, or — in a dry run — the rows that would have been deleted. */
  pruned: number;
}

/**
 * Metadata-only result. It reports counts and the effective cutoff, never any
 * accepted record, audit payload, token, verifier, or outcome body.
 */
export interface AuthorityRetentionStatus {
  /** True when legal hold prevented any deletion. */
  held: boolean;
  /** True when nothing was deleted because this was a dry run. */
  dryRun: boolean;
  /**
   * The cutoff applied to the runtime-audit and outcome projections (ISO), or
   * null when held. Never more recent than the minimum window.
   */
  effectiveCutoff: string | null;
  prunedRuntimeAudit: number;
  prunedOutcomes: number;
  prunedSessions: number;
  prunedChallenges: number;
  /** Sum across every projection, so an operator has one number to read. */
  prunedTotal: number;
  projections: AuthorityRetentionProjectionResult[];
}

/**
 * Safeguarded retention/pruning for the four authority projections that grow
 * with time rather than with the accepted-record set.
 *
 * Each projection carries its own guard, and each guard is a floor rather than a
 * filter an operator can argue with:
 *
 * - **Runtime audit and outcomes** are clamped to no later than
 *   `now - minimumRetentionMs`, so an in-retention row cannot be deleted by
 *   asking for a more recent cutoff. Pruning an ancient outcome only means that
 *   long-past operation id is no longer idempotency-cached; accepted state and
 *   Phase 44 atomicity are unaffected.
 * - **Sessions** are eligible only once they have already ended — revoked, or
 *   past their expiry — and only once that ending is itself older than the
 *   session window. An active session, including one deep inside its offline
 *   grace, is unreachable by this code.
 * - **WebAuthn challenges** are eligible only once consumed or expired, and only
 *   once that is older than the challenge window, so a ceremony in flight cannot
 *   be broken by a run that happens to overlap it.
 *
 * Nothing here controls transactions: a caller that needs the four deletes to
 * commit together supplies a pinned client as the queryable and owns the
 * begin/commit boundary itself. See `AuthorityRetentionRunner`, which does.
 */
export class AuthorityRetentionService {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prune(
    policy: AuthorityRetentionPolicy,
    request: AuthorityRetentionRequest,
  ): Promise<AuthorityRetentionStatus> {
    if (!(policy.minimumRetentionMs > 0))
      throw new Error("A positive minimum retention window is required.");
    if (policy.sessionRetentionMs !== undefined && !(policy.sessionRetentionMs > 0))
      throw new Error("A positive session retention window is required.");
    if (policy.challengeRetentionMs !== undefined && !(policy.challengeRetentionMs > 0))
      throw new Error("A positive challenge retention window is required.");
    const dryRun = request.dryRun === true;
    if (policy.legalHold === true) return held(dryRun);

    const now = this.now().getTime();
    // Never delete inside a minimum-retention window: clamp the requested cutoff
    // to no later than (now - window) for each projection independently.
    const auditCutoff = new Date(
      Math.min(request.before.getTime(), now - policy.minimumRetentionMs),
    );
    const sessionCutoff =
      policy.sessionRetentionMs === undefined
        ? undefined
        : new Date(Math.min(request.before.getTime(), now - policy.sessionRetentionMs));
    const challengeCutoff =
      policy.challengeRetentionMs === undefined
        ? undefined
        : new Date(Math.min(request.before.getTime(), now - policy.challengeRetentionMs));

    const projections: AuthorityRetentionProjectionResult[] = [
      await this.apply("runtimeAudit", auditCutoff, dryRun, RUNTIME_AUDIT_PREDICATE),
      await this.apply("outcomes", auditCutoff, dryRun, OUTCOME_PREDICATE),
      await this.apply("sessions", sessionCutoff, dryRun, SESSION_PREDICATE),
      await this.apply("webauthnChallenges", challengeCutoff, dryRun, CHALLENGE_PREDICATE),
    ];
    return summarise(dryRun, auditCutoff.toISOString(), projections);
  }

  /**
   * One projection's prune (or, in a dry run, its count). The predicate is a
   * fixed fragment chosen from the table above — never anything derived from a
   * request — and both the application id and the cutoff are bound parameters.
   */
  private async apply(
    projection: AuthorityRetentionProjection,
    cutoff: Date | undefined,
    dryRun: boolean,
    predicate: { table: string; where: string },
  ): Promise<AuthorityRetentionProjectionResult> {
    if (cutoff === undefined)
      return { projection, configured: false, effectiveCutoff: null, pruned: 0 };
    const parameters = [this.applicationId, cutoff.toISOString()];
    const pruned = dryRun
      ? Number(
          (
            await this.database.query<{ total: string | number }>(
              `select count(*)::int as total from ${predicate.table} where ${predicate.where}`,
              parameters,
            )
          ).rows[0]?.total ?? 0,
        )
      : (
          await this.database.query(
            `delete from ${predicate.table} where ${predicate.where} returning 1`,
            parameters,
          )
        ).rows.length;
    return { projection, configured: true, effectiveCutoff: cutoff.toISOString(), pruned };
  }
}

const RUNTIME_AUDIT_PREDICATE = {
  table: "adl_authority_audit_events",
  where: "application_id = $1 and occurred_at < $2",
};

const OUTCOME_PREDICATE = {
  table: "adl_authority_operation_outcomes",
  where: "application_id = $1 and accepted_at < $2",
};

/*
 * A session's ending instant is whichever came first: the moment it was revoked,
 * or the moment it expired. `least(coalesce(revoked_at, expires_at), expires_at)`
 * states exactly that, and it is what makes an active session unreachable: for
 * one that is neither revoked nor expired the expression is `expires_at`, which
 * is in the future, while the cutoff is always in the past.
 */
const SESSION_PREDICATE = {
  table: "adl_authority_sessions",
  where: "application_id = $1 and least(coalesce(revoked_at, expires_at), expires_at) < $2",
};

/** Same shape for a challenge: consumed, or expired, whichever came first. */
const CHALLENGE_PREDICATE = {
  table: "adl_authority_webauthn_challenges",
  where: "application_id = $1 and least(coalesce(consumed_at, expires_at), expires_at) < $2",
};

function held(dryRun: boolean): AuthorityRetentionStatus {
  return summarise(
    dryRun,
    null,
    AUTHORITY_RETENTION_PROJECTIONS.map((projection) => ({
      projection,
      configured: false,
      effectiveCutoff: null,
      pruned: 0,
    })),
    true,
  );
}

function summarise(
  dryRun: boolean,
  effectiveCutoff: string | null,
  projections: AuthorityRetentionProjectionResult[],
  isHeld = false,
): AuthorityRetentionStatus {
  const count = (projection: AuthorityRetentionProjection): number =>
    projections.find((entry) => entry.projection === projection)?.pruned ?? 0;
  return {
    held: isHeld,
    dryRun,
    effectiveCutoff,
    prunedRuntimeAudit: count("runtimeAudit"),
    prunedOutcomes: count("outcomes"),
    prunedSessions: count("sessions"),
    prunedChallenges: count("webauthnChallenges"),
    prunedTotal: projections.reduce((total, entry) => total + entry.pruned, 0),
    projections,
  };
}
