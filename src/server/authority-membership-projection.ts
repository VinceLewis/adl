import type {
  ResolvedApplicationModel,
  ResolvedContextMembership,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import type {
  ContextMembershipCandidate,
  ContextMembershipIndex,
} from "../runtime/context-membership-index.js";
import { readMembershipFields } from "../runtime/context-membership-index.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

/** A business context's declared membership object, as the projection sees it. */
export interface ContextMembershipDescriptor {
  contextName: string;
  objectName: string;
  membership: ResolvedContextMembership;
}

/**
 * The model's declared context memberships, indexed both ways.
 *
 * The projection is derived entirely from these declarations. It never invents a
 * membership object, a role, or a context: if the model does not declare an
 * object as a context membership, no row is ever written for it.
 */
export class ContextMembershipDescriptors {
  private readonly byObject = new Map<string, ContextMembershipDescriptor>();
  private readonly byContext = new Map<string, ContextMembershipDescriptor>();

  constructor(model: ResolvedApplicationModel) {
    for (const context of model.contexts ?? []) {
      if (context.membership === undefined) continue;
      const descriptor: ContextMembershipDescriptor = {
        contextName: context.name,
        objectName: context.membership.object,
        membership: context.membership,
      };
      this.byObject.set(descriptor.objectName, descriptor);
      this.byContext.set(descriptor.contextName, descriptor);
    }
  }

  get empty(): boolean {
    return this.byObject.size === 0;
  }
  forObject(objectName: string): ContextMembershipDescriptor | undefined {
    return this.byObject.get(objectName);
  }
  forContext(contextName: string): ContextMembershipDescriptor | undefined {
    return this.byContext.get(contextName);
  }
  all(): ContextMembershipDescriptor[] {
    return [...this.byObject.values()];
  }
}

const UPSERT_ROW = `insert into adl_authority_context_memberships
   (application_id, membership_record_id, object_name, context_name, context_id, user_id, role, revoked_at)
 values ($1, $2, $3, $4, $5, $6, $7, $8)
 on conflict (application_id, membership_record_id) do update set
   object_name = excluded.object_name,
   context_name = excluded.context_name,
   context_id = excluded.context_id,
   user_id = excluded.user_id,
   role = excluded.role,
   revoked_at = excluded.revoked_at`;

/**
 * Writes the derived context-membership projection.
 *
 * Every method issues its statements on the `database` it was given, and never
 * opens a transaction of its own. That is deliberate: the caller is always
 * already inside the commit boundary that changed the accepted membership
 * record (the authority unit-of-work, an object-storage transaction, or an
 * access-lifecycle store transaction), so the projection row and the record it
 * derives from commit or roll back together.
 */
export class ContextMembershipProjectionWriter {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
    private readonly descriptors: ContextMembershipDescriptors,
  ) {}

  /**
   * Bring one accepted record's projection row in line with the record.
   *
   * A record of an object the model does not declare as a context membership is
   * ignored. A membership record whose declared user/context/role fields are not
   * all present as non-empty strings cannot be indexed, and any row it previously
   * had is removed rather than left half-populated — the same "index it fully or
   * not at all" rule Phase 45 applied to runtime-audit context scope. Such a
   * record is exactly one that membership resolution already skips, so nothing
   * becomes resolvable or unresolvable by being indexed.
   */
  async sync(objectName: string, record: StoredObjectRecord): Promise<void> {
    const descriptor = this.descriptors.forObject(objectName);
    if (descriptor === undefined) return;
    const fields = readMembershipFields(descriptor.membership, record.values);
    if (fields === undefined) {
      await this.database.query(
        "delete from adl_authority_context_memberships where application_id = $1 and membership_record_id = $2",
        [this.applicationId, record.meta.guid],
      );
      return;
    }
    await this.database.query(UPSERT_ROW, [
      this.applicationId,
      record.meta.guid,
      objectName,
      descriptor.contextName,
      fields.contextId,
      fields.userId,
      fields.role,
      record.meta.deletedAt ?? null,
    ]);
  }

  /**
   * Rebuild the whole projection from the accepted records.
   *
   * Used at startup so a projection that predates its writer — or one left
   * behind by an out-of-band restore or a model migration that rewrote
   * membership values — comes up consistent instead of reporting an
   * inconsistency the operator cannot act on. It is idempotent and derives
   * everything from accepted records, so it can never invent a membership.
   *
   * The caller owns the transaction and the advisory lock.
   */
  async rebuild(): Promise<void> {
    await this.database.query(
      "delete from adl_authority_context_memberships where application_id = $1",
      [this.applicationId],
    );
    for (const descriptor of this.descriptors.all()) {
      await this.database.query(
        `insert into adl_authority_context_memberships
           (application_id, membership_record_id, object_name, context_name, context_id, user_id, role, revoked_at)
         select $1, r.record_id, r.object_name, $2, fields.context_id, fields.user_id, fields.role, r.deleted_at
         from adl_authority_records r
         cross join lateral (
           select nullif(r.record->'values'->>$3, '') as user_id,
                  nullif(r.record->'values'->>$4, '') as context_id,
                  nullif(r.record->'values'->>$5, '') as role
         ) as fields
         where r.application_id = $1
           and r.object_name = $6
           and fields.user_id is not null
           and fields.context_id is not null
           and fields.role is not null
         on conflict (application_id, membership_record_id) do nothing`,
        [
          this.applicationId,
          descriptor.contextName,
          descriptor.membership.userField,
          descriptor.membership.contextField,
          descriptor.membership.roleField,
          descriptor.objectName,
        ],
      );
    }
  }
}

/**
 * Scope-indexed reads over the context-membership projection.
 *
 * These narrow the candidate set; they never authorise. Each caller still reads
 * the named membership record through storage and applies the runtime's read
 * policy, which stays the disclosure boundary exactly as it did when the same
 * candidates were produced by an in-memory scan.
 */
export class PostgresContextMembershipIndex implements ContextMembershipIndex {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}

  /** Live memberships for one user in one business context. */
  async listForUser(request: {
    contextName: string;
    userId: string;
  }): Promise<ContextMembershipCandidate[]> {
    const result = await this.database.query<MembershipRow>(
      `select membership_record_id, context_id, user_id, role, revoked_at
       from adl_authority_context_memberships
       where application_id = $1 and context_name = $2 and user_id = $3 and revoked_at is null
       order by membership_record_id`,
      [this.applicationId, request.contextName, request.userId],
    );
    return result.rows.map(toCandidate);
  }

  /**
   * Memberships in one context instance, revoked ones included: membership
   * review reports a revoked membership as `revoked` rather than omitting it.
   */
  async listForContext(request: {
    contextName: string;
    contextId: string;
    limit?: number;
  }): Promise<ContextMembershipCandidate[]> {
    const result = await this.database.query<MembershipRow>(
      `select membership_record_id, context_id, user_id, role, revoked_at
       from adl_authority_context_memberships
       where application_id = $1 and context_name = $2 and context_id = $3
       order by membership_record_id
       limit $4`,
      [this.applicationId, request.contextName, request.contextId, boundedLimit(request.limit)],
    );
    return result.rows.map(toCandidate);
  }
}

interface MembershipRow extends Record<string, unknown> {
  membership_record_id: string;
  context_id: string;
  user_id: string;
  role: string;
  revoked_at: Date | string | null;
}

function toCandidate(row: MembershipRow): ContextMembershipCandidate {
  return {
    membershipRecordId: row.membership_record_id,
    userId: row.user_id,
    contextId: row.context_id,
    role: row.role,
    revoked: row.revoked_at !== null,
  };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 250;
  return Math.min(Math.max(Math.trunc(limit), 1), 1000);
}
