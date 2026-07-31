import type { ResolvedApplicationModel } from "../model/resolved-model.js";
import { ContextMembershipDescriptors } from "./authority-membership-projection.js";
import type { AuthorityRecoveryStatus } from "./authoritative-reporting.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

/**
 * Metadata-only projection integrity report. It intentionally contains counts
 * and consistency flags, never accepted record values, audit payloads, tokens,
 * or outcome bodies, so it is safe to return from a recovery/status surface.
 */
export interface AuthorityProjectionIntegrityReport {
  applicationPresent: boolean;
  consistent: boolean;
  counts: {
    records: number;
    runtimeAudit: number;
    outcomes: number;
    accessAudit: number;
    administrationAudit: number;
    contextMemberships: number;
  };
  /** Accepted-outcome record references with no matching row in the record projection. */
  acceptedOutcomeRecordsMissing: number;
  /** Record rows whose application metadata row is missing (a broken restore set). */
  orphanRecords: number;
  /** Runtime-audit rows whose context scope is half-populated (one column null, the other set). */
  auditScopeInconsistent: number;
  /** Indexable accepted membership records with no row in the membership projection. */
  membershipProjectionMissing: number;
  /** Membership projection rows with no backing accepted membership record. */
  membershipProjectionOrphaned: number;
  /** Membership projection rows whose revoked state disagrees with their record. */
  membershipProjectionStale: number;
}

/**
 * Restore-verification for the authority projections. After a restore, this
 * confirms the transactional projection set is internally consistent — every
 * accepted outcome still points at a persisted record, and no record is missing
 * its application metadata — without exposing any protected JSON.
 */
export class AuthorityProjectionIntegrity {
  private readonly memberships: ContextMembershipDescriptors;

  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
    /**
     * The model is required because membership consistency is only checkable
     * against the declared membership objects and their user/context/role field
     * names. Only those names are ever used in a query — no accepted value is
     * read back into this report.
     */
    model: ResolvedApplicationModel,
  ) {
    this.memberships = new ContextMembershipDescriptors(model);
  }

  async verify(): Promise<AuthorityProjectionIntegrityReport> {
    const applicationPresent = await this.count(
      "select 1 from adl_authority_models where application_id = $1",
    );
    const counts = {
      records: await this.count("select 1 from adl_authority_records where application_id = $1"),
      runtimeAudit: await this.count(
        "select 1 from adl_authority_audit_events where application_id = $1",
      ),
      outcomes: await this.countOutcomes(),
      accessAudit: await this.count(
        "select 1 from adl_authority_access_audit_events where application_id = $1",
      ),
      administrationAudit: await this.count(
        "select 1 from adl_authority_administration_audit_events where application_id = $1",
      ),
      contextMemberships: await this.count(
        "select 1 from adl_authority_context_memberships where application_id = $1",
      ),
    };
    const acceptedOutcomeRecordsMissing = await this.count(
      `select 1
       from adl_authority_operation_outcomes o
       cross join lateral jsonb_array_elements(o.outcome->'records') as reference
       left join adl_authority_records r
         on r.application_id = $1
         and r.object_name = reference->'meta'->>'object'
         and r.record_id = reference->'meta'->>'guid'
       where o.application_id = $1 and o.outcome->>'status' = 'accepted' and r.record_id is null`,
    );
    const orphanRecords = await this.count(
      `select 1
       from adl_authority_records r
       left join adl_authority_models m on m.application_id = r.application_id
       where r.application_id = $1 and m.application_id is null`,
    );
    const auditScopeInconsistent = await this.count(
      `select 1
       from adl_authority_audit_events
       where application_id = $1
         and (context_name is null) <> (context_id is null)`,
    );
    const membershipProjectionMissing = await this.countMembershipProjectionMissing();
    const membershipProjectionOrphaned = await this.count(
      `select 1
       from adl_authority_context_memberships m
       left join adl_authority_records r
         on r.application_id = m.application_id
         and r.object_name = m.object_name
         and r.record_id = m.membership_record_id
       where m.application_id = $1 and r.record_id is null`,
    );
    const membershipProjectionStale = await this.count(
      `select 1
       from adl_authority_context_memberships m
       join adl_authority_records r
         on r.application_id = m.application_id
         and r.object_name = m.object_name
         and r.record_id = m.membership_record_id
       where m.application_id = $1 and (r.deleted_at is null) <> (m.revoked_at is null)`,
    );
    return {
      applicationPresent: applicationPresent > 0,
      consistent:
        applicationPresent > 0 &&
        acceptedOutcomeRecordsMissing === 0 &&
        orphanRecords === 0 &&
        auditScopeInconsistent === 0 &&
        membershipProjectionMissing === 0 &&
        membershipProjectionOrphaned === 0 &&
        membershipProjectionStale === 0,
      counts,
      acceptedOutcomeRecordsMissing,
      orphanRecords,
      auditScopeInconsistent,
      membershipProjectionMissing,
      membershipProjectionOrphaned,
      membershipProjectionStale,
    };
  }

  /**
   * Accepted membership records that should have a projection row but do not.
   *
   * "Should" means indexable: all three declared membership fields present as
   * non-empty strings. A record missing one of them is one that membership
   * resolution already skips, so requiring a row for it would report an
   * inconsistency no operator could ever clear.
   */
  private async countMembershipProjectionMissing(): Promise<number> {
    let missing = 0;
    for (const descriptor of this.memberships.all()) {
      missing += await this.count(
        `select 1
         from adl_authority_records r
         left join adl_authority_context_memberships m
           on m.application_id = r.application_id
           and m.object_name = r.object_name
           and m.membership_record_id = r.record_id
         where r.application_id = $1
           and r.object_name = $2
           and nullif(r.record->'values'->>$3, '') is not null
           and nullif(r.record->'values'->>$4, '') is not null
           and nullif(r.record->'values'->>$5, '') is not null
           and m.membership_record_id is null`,
        [
          descriptor.objectName,
          descriptor.membership.userField,
          descriptor.membership.contextField,
          descriptor.membership.roleField,
        ],
      );
    }
    return missing;
  }

  /** Map integrity to the administration recovery-status surface. */
  async recoveryStatus(lastRestoreAt?: string): Promise<AuthorityRecoveryStatus> {
    const report = await this.verify();
    return {
      ready: report.consistent,
      recoveryRequired: !report.consistent,
      ...(lastRestoreAt === undefined ? {} : { lastRestoreAt }),
    };
  }

  /**
   * `$1` is always the application id; any further values bind `$2` onward.
   * Model-derived object and field names are bound as parameters rather than
   * interpolated, so a declared name can never become SQL.
   */
  private async count(sql: string, extra: unknown[] = []): Promise<number> {
    const result = await this.database.query<{ total: string | number }>(
      `select count(*)::int as total from (${sql}) as scoped`,
      [this.applicationId, ...extra],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private async countOutcomes(): Promise<number> {
    // Since Phase 45 outcomes carry application_id, so they are counted for this
    // application. Legacy pre-Phase-45 rows have a null application_id and are
    // intentionally excluded from an application-scoped count.
    return this.count("select 1 from adl_authority_operation_outcomes where application_id = $1");
  }
}
