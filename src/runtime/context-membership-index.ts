import type { ResolvedContextMembership } from "../model/resolved-model.js";

/**
 * One candidate membership row from a scope-indexed read model.
 *
 * A candidate is a *pointer*, not a decision: it names a membership record the
 * caller should then read through normal storage and policy. It carries only the
 * three declared membership fields plus the record id, so an index can never
 * disclose more of a membership record than the model already declares as its
 * user, context and role.
 */
export interface ContextMembershipCandidate {
  membershipRecordId: string;
  userId: string;
  contextId: string;
  role: string;
  /** True when the backing membership record is a tombstone. */
  revoked: boolean;
}

/**
 * A scope-indexed read model over context membership records.
 *
 * It exists so membership resolution, access checks and membership review can
 * narrow to one user or one context instead of scanning every accepted record.
 * It is deliberately *not* an authority: it never says whether an actor may do
 * something, it never re-derives roles, and every caller still reads the named
 * record through storage and applies the runtime's read policy. An
 * implementation that returned extra candidates would be slow, never
 * permissive.
 *
 * It is optional everywhere. The browser and the in-memory test backends have no
 * index and keep their existing full scan, which is correct for a device-sized
 * dataset; only the PostgreSQL authority projection implements it.
 */
export interface ContextMembershipIndex {
  /** Candidates in one business context for one user, for access checks. */
  listForUser(request: {
    contextName: string;
    userId: string;
  }): Promise<ContextMembershipCandidate[]>;
  /** Candidates in one context instance, for membership review. */
  listForContext(request: {
    contextName: string;
    contextId: string;
    limit?: number;
  }): Promise<ContextMembershipCandidate[]>;
}

/**
 * Read the three declared membership fields off a stored record's values.
 * Returns undefined when any of them is absent or is not a non-empty string, so
 * a half-shaped record never becomes a half-populated projection row — the same
 * "scope both columns or neither" rule Phase 45 applies to runtime-audit scope.
 */
export function readMembershipFields(
  membership: ResolvedContextMembership,
  values: Record<string, unknown>,
): { userId: string; contextId: string; role: string } | undefined {
  const userId = readString(values[membership.userField]);
  const contextId = readString(values[membership.contextField]);
  const role = readString(values[membership.roleField]);
  return userId === undefined || contextId === undefined || role === undefined
    ? undefined
    : { userId, contextId, role };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
