import type { PostgresQueryable } from "./postgres-authority-store.js";

/**
 * Retention policy for the two prunable authority projections. Retention is a
 * persistence concern only; the runtime remains the semantic authority and this
 * service never touches accepted records, sessions, invites, or identities.
 */
export interface AuthorityRetentionPolicy {
  /**
   * The minimum retention window. Rows more recent than `now - minimumRetentionMs`
   * are in-retention and are never pruned, even if an operator requests an
   * earlier cutoff. Must be a positive duration.
   */
  minimumRetentionMs: number;
  /** When true, pruning is refused entirely (legal hold). */
  legalHold?: boolean;
}

export interface AuthorityRetentionRequest {
  /** Rows strictly older than this are eligible, subject to the minimum-retention guard. */
  before: Date;
}

/**
 * Metadata-only result. It reports counts and the effective cutoff, never any
 * accepted record, audit payload, token, or outcome body.
 */
export interface AuthorityRetentionStatus {
  /** True when legal hold prevented any deletion. */
  held: boolean;
  /** The cutoff actually applied (ISO), or null when held. Never more recent than the minimum window. */
  effectiveCutoff: string | null;
  prunedRuntimeAudit: number;
  prunedOutcomes: number;
}

/**
 * Safeguarded retention/pruning for the runtime-audit and operation-outcome
 * projections, scoped to one application. It deletes only rows older than the
 * minimum retention window, never accepted records or any in-retention row, and
 * refuses to act under legal hold. Pruning an ancient outcome only means that
 * long-past operation id is no longer idempotency-cached; accepted state and
 * Phase 44 atomicity are unaffected.
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
    if (policy.legalHold === true)
      return { held: true, effectiveCutoff: null, prunedRuntimeAudit: 0, prunedOutcomes: 0 };

    // Never delete inside the minimum-retention window: clamp the requested
    // cutoff to no later than (now - minimumRetentionMs).
    const guard = this.now().getTime() - policy.minimumRetentionMs;
    const effective = new Date(Math.min(request.before.getTime(), guard));

    const prunedRuntimeAudit = await this.deleteOlderThan(
      "delete from adl_authority_audit_events where application_id = $1 and occurred_at < $2 returning 1",
      effective,
    );
    const prunedOutcomes = await this.deleteOlderThan(
      "delete from adl_authority_operation_outcomes where application_id = $1 and accepted_at < $2 returning 1",
      effective,
    );
    return {
      held: false,
      effectiveCutoff: effective.toISOString(),
      prunedRuntimeAudit,
      prunedOutcomes,
    };
  }

  private async deleteOlderThan(sql: string, cutoff: Date): Promise<number> {
    const result = await this.database.query(sql, [this.applicationId, cutoff.toISOString()]);
    return result.rows.length;
  }
}
