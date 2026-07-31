import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedContextMembership,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import type { ContextMembershipIndex } from "./context-membership-index.js";
import { getSelectedContextId } from "./context-scope.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { InMemoryObjectStorageBackend } from "./object-storage-backend.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import {
  RuntimeContextError,
  cloneJson,
  noopRuntimeLogger,
  safeContextLog,
} from "./runtime-types.js";
import type {
  RuntimeAvailableContext,
  RuntimeContext,
  RuntimeContextRole,
  RuntimeLogger,
} from "./runtime-types.js";

export class RuntimeContextService {
  constructor(
    model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly storage: ObjectStorageBackend = new InMemoryObjectStorageBackend(),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
    /**
     * Optional scope-indexed read model over membership records. When present it
     * names which membership records to read for this user instead of the whole
     * accepted-record set being scanned; the records themselves are still read
     * through storage and filtered here, so it changes cost, never semantics.
     * Absent on a device, where the local dataset is already device-sized.
     */
    private readonly membershipIndex: ContextMembershipIndex | undefined = undefined,
  ) {}

  async listAvailableContexts(
    contextName: string,
    context: RuntimeContext,
  ): Promise<RuntimeAvailableContext[]> {
    await this.startupGuard();
    this.logger.debug("ENTER RuntimeContextService.listAvailableContexts", {
      contextName,
      context: safeContextLog(context),
    });

    const businessContext = this.index.getBusinessContext(contextName);
    const available =
      businessContext.membership === undefined
        ? await this.listSelectedContextWithoutMembership(businessContext, context)
        : await this.listMembershipContexts(businessContext, businessContext.membership, context);

    this.logger.debug("EXIT RuntimeContextService.listAvailableContexts", {
      contextName,
      count: available.length,
    });
    return available;
  }

  async validateSelectedContext(
    contextName: string,
    contextId: string,
    context: RuntimeContext,
  ): Promise<RuntimeAvailableContext> {
    const available = await this.listAvailableContexts(contextName, context);
    const selected = available.find((candidate) => candidate.id === contextId);

    if (selected === undefined) {
      throw new RuntimeContextError(
        `Context '${contextName}' instance '${contextId}' is not available to user '${context.userId}'.`,
        { contextName, contextId, userId: context.userId },
      );
    }

    return selected;
  }

  async resolveContextRoles(
    contextName: string,
    context: RuntimeContext,
    contextId?: string,
  ): Promise<RuntimeContextRole[]> {
    const available =
      contextId === undefined
        ? await this.listAvailableContexts(contextName, context)
        : [await this.validateSelectedContext(contextName, contextId, context)];

    return available.flatMap((candidate) => cloneJson(candidate.roleEntries));
  }

  async withSelectedContext(
    contextName: string,
    contextId: string,
    context: RuntimeContext,
  ): Promise<RuntimeContext> {
    const selected = await this.validateSelectedContext(contextName, contextId, context);

    return {
      ...context,
      roles: [...context.roles],
      ...(context.groups === undefined ? {} : { groups: cloneJson(context.groups) }),
      selectedContexts: {
        ...(context.selectedContexts ?? {}),
        [contextName]: contextId,
      },
      contextRoles: [
        ...(context.contextRoles ?? []).filter((entry) => entry.context !== contextName),
        ...cloneJson(selected.roleEntries),
      ],
    };
  }

  private async listSelectedContextWithoutMembership(
    businessContext: ResolvedBusinessContext,
    context: RuntimeContext,
  ): Promise<RuntimeAvailableContext[]> {
    const selectedId =
      getSelectedContextId(context, businessContext.name) ??
      (businessContext.object === "User" ? context.userId : undefined);

    if (selectedId === undefined) {
      return [];
    }

    const record = await this.storage.read(businessContext.object, selectedId);
    if (record === null || record.meta.deletedAt !== undefined) {
      return [];
    }

    return [
      {
        context: businessContext.name,
        id: record.meta.guid,
        label: this.getContextLabel(businessContext, record),
        roles: [],
        roleEntries: [],
      },
    ];
  }

  private async listMembershipContexts(
    businessContext: ResolvedBusinessContext,
    membership: ResolvedContextMembership,
    context: RuntimeContext,
  ): Promise<RuntimeAvailableContext[]> {
    const memberships = await this.getMembershipRecords(businessContext, membership, context);
    const entriesByContext = new Map<string, RuntimeContextRole[]>();

    for (const record of memberships) {
      if (record.values[membership.userField] !== context.userId) {
        continue;
      }

      const contextId = getStringValue(record.values[membership.contextField]);
      const role = getStringValue(record.values[membership.roleField]);
      if (contextId === undefined || role === undefined) {
        continue;
      }

      if (membership.roles.length > 0 && !membership.roles.includes(role)) {
        continue;
      }

      entriesByContext.set(contextId, [
        ...(entriesByContext.get(contextId) ?? []),
        {
          context: businessContext.name,
          contextId,
          role,
          membershipRecordId: record.meta.guid,
        },
      ]);
    }

    const available: RuntimeAvailableContext[] = [];
    for (const [contextId, roleEntries] of entriesByContext) {
      const record = await this.storage.read(businessContext.object, contextId);
      if (record === null || record.meta.deletedAt !== undefined) {
        continue;
      }

      const uniqueRoleEntries = uniqueContextRoleEntries(roleEntries);
      available.push({
        context: businessContext.name,
        id: contextId,
        label: this.getContextLabel(businessContext, record),
        roles: uniqueStrings(uniqueRoleEntries.map((entry) => entry.role)),
        roleEntries: uniqueRoleEntries,
      });
    }

    return available.sort(compareAvailableContexts);
  }

  /**
   * The live membership records this user could hold in one business context.
   *
   * With an index, the projection names the candidates and each one is read
   * back through storage; the record's own values are then filtered by the same
   * rules as the scan below, so the record — not the index — remains the
   * semantic authority. An index that returned a stale or extra candidate would
   * cost an extra read, never grant a membership. Without an index the whole
   * accepted-record set is scanned, which is what a device does.
   */
  private async getMembershipRecords(
    businessContext: ResolvedBusinessContext,
    membership: ResolvedContextMembership,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    if (this.membershipIndex === undefined) return this.getActiveRecords(membership.object);
    const candidates = await this.membershipIndex.listForUser({
      contextName: businessContext.name,
      userId: context.userId,
    });
    const records: StoredObjectRecord[] = [];
    for (const candidate of candidates) {
      const record = await this.storage.read(membership.object, candidate.membershipRecordId);
      if (record === null || record.meta.deletedAt !== undefined) continue;
      records.push(cloneJson(record));
    }
    return records;
  }

  private async getActiveRecords(objectName: string): Promise<StoredObjectRecord[]> {
    return (await this.storage.listRecords())
      .filter(
        (entry) => entry.objectName === objectName && entry.record.meta.deletedAt === undefined,
      )
      .map((entry) => cloneJson(entry.record));
  }

  private getContextLabel(
    businessContext: ResolvedBusinessContext,
    record: StoredObjectRecord,
  ): string {
    const object = this.index.getObject(businessContext.object);
    const labelField = object.displayField ?? object.businessKey;
    const label = labelField === undefined ? undefined : getStringValue(record.values[labelField]);

    return label ?? record.meta.guid;
  }
}

function compareAvailableContexts(
  left: RuntimeAvailableContext,
  right: RuntimeAvailableContext,
): number {
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueContextRoleEntries(entries: RuntimeContextRole[]): RuntimeContextRole[] {
  const unique = new Map<string, RuntimeContextRole>();

  for (const entry of entries) {
    unique.set(
      `${entry.context}\0${entry.contextId}\0${entry.role}\0${entry.membershipRecordId ?? ""}`,
      entry,
    );
  }

  return [...unique.values()].map((entry) => cloneJson(entry));
}
