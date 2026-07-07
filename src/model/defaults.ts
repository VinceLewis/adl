import type {
  AuditOperation,
  FieldType,
  ResolvedAuditModel,
  ResolvedMetadataField,
  ResolvedModelDefaults,
  ResolvedObjectAuditPolicy,
  ResolvedObjectSyncPolicy,
  ResolvedOperationLogModel,
  ResolvedPolicy,
  ResolvedPrincipalSelector,
  ResolvedTheme,
  ResolvedThemeTokens,
} from "./resolved-model.js";

export const ADL_MODEL_VERSION = "0.1.0";
export const DEFAULT_OBJECT_SCHEMA_VERSION = 1;
export const SYSTEM_ID_FIELD = "_guid";
export const DEFAULT_LIFECYCLE_STATE_FIELD = "_state";
export const DEFAULT_THEME_NAME = "CorporateLight";
export const DEFAULT_SYNC_MODE = "localFirst";
export const DEFAULT_SYNC_SCOPE = "all";
export const DEFAULT_CONFLICT_STRATEGY = "manual";

export const DEFAULT_AUDIT_OPERATIONS = [
  "create",
  "update",
  "delete",
  "transition",
] as const satisfies readonly AuditOperation[];

export const DEFAULT_OPERATION_LOG_OPERATIONS = [
  "create",
  "update",
  "delete",
  "transition",
] as const;

export const LOCAL_OPERATION_STATUSES = [
  "pending",
  "sent",
  "accepted",
  "rejected",
  "conflict",
] as const;

export const DEFAULT_THEME_TOKENS: ResolvedThemeTokens = {
  colorPrimary: "#155EEF",
  colorAccent: "#12B76A",
  colorBackground: "#F8FAFC",
  colorSurface: "#FFFFFF",
  colorText: "#101828",
  radius: "medium",
  density: "comfortable",
  nav: "side",
  fontFamily: "system-ui, sans-serif",
};

const METADATA_FIELD_DEFINITIONS = [
  {
    name: "_guid",
    type: "text",
    required: true,
    description: "Immutable system identity for the record.",
  },
  {
    name: "_object",
    type: "text",
    required: true,
    description: "Resolved object name for the record.",
  },
  {
    name: "_schemaVersion",
    type: "number",
    required: true,
    description: "Object schema version used when the record was written.",
  },
  {
    name: "_revision",
    type: "text",
    required: true,
    description: "Optimistic concurrency revision.",
  },
  {
    name: "_state",
    type: "text",
    required: false,
    description: "Current lifecycle state when the object uses metadata-backed state.",
  },
  {
    name: "_createdAt",
    type: "datetime",
    required: true,
    description: "Creation timestamp.",
  },
  {
    name: "_createdBy",
    type: "text",
    required: true,
    description: "Principal that created the record.",
  },
  {
    name: "_updatedAt",
    type: "datetime",
    required: true,
    description: "Last update timestamp.",
  },
  {
    name: "_updatedBy",
    type: "text",
    required: true,
    description: "Principal that last updated the record.",
  },
  {
    name: "_deletedAt",
    type: "datetime",
    required: false,
    description: "Tombstone timestamp when the record is deleted.",
  },
  {
    name: "_deletedBy",
    type: "text",
    required: false,
    description: "Principal that tombstoned the record.",
  },
  {
    name: "_syncStatus",
    type: "text",
    required: true,
    description: "Local synchronisation state for the record.",
  },
] as const satisfies readonly {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
}[];

export function createMetadataFields(): ResolvedMetadataField[] {
  return METADATA_FIELD_DEFINITIONS.map((field) => ({
    name: field.name,
    storageName: field.name,
    type: field.type,
    required: field.required,
    readonly: true,
    hidden: true,
    systemManaged: true,
    description: field.description,
  }));
}

export function createDefaultModelDefaults(): ResolvedModelDefaults {
  return {
    systemIdField: SYSTEM_ID_FIELD,
    objectSchemaVersion: DEFAULT_OBJECT_SCHEMA_VERSION,
    metadataFields: createMetadataFields().map((field) => field.name),
    syncMode: DEFAULT_SYNC_MODE,
    policyEffect: "deny",
    theme: DEFAULT_THEME_NAME,
    tableNaming: "snakeCaseObjectName",
    fieldStorageNaming: "snakeCaseFieldName",
  };
}

export function createDefaultTheme(): ResolvedTheme {
  return {
    name: DEFAULT_THEME_NAME,
    tokens: { ...DEFAULT_THEME_TOKENS },
  };
}

export function createDefaultObjectSyncPolicy(): ResolvedObjectSyncPolicy {
  return {
    mode: DEFAULT_SYNC_MODE,
    scope: DEFAULT_SYNC_SCOPE,
    conflict: DEFAULT_CONFLICT_STRATEGY,
  };
}

export function createDefaultObjectAuditPolicy(): ResolvedObjectAuditPolicy {
  return {
    enabled: true,
    operations: [...DEFAULT_AUDIT_OPERATIONS],
  };
}

export function createDefaultAuditModel(): ResolvedAuditModel {
  return {
    enabled: true,
    operations: [...DEFAULT_AUDIT_OPERATIONS],
    metadataFields: createMetadataFields().map((field) => field.name),
  };
}

export function createDefaultOperationLogModel(): ResolvedOperationLogModel {
  return {
    enabled: true,
    operations: [...DEFAULT_OPERATION_LOG_OPERATIONS],
    statuses: [...LOCAL_OPERATION_STATUSES],
  };
}

export function createEveryonePrincipal(): ResolvedPrincipalSelector {
  return {
    match: "everyone",
    roles: [],
    groupRoles: [],
    users: [],
    owner: false,
  };
}

export function createDefaultDenyPolicy(objectName: string): ResolvedPolicy {
  return {
    name: `${objectName}DefaultDeny`,
    object: objectName,
    defaultEffect: "deny",
    rules: [],
  };
}

export function toStorageName(name: string): string {
  const normalised = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  const safeName = normalised.length > 0 ? normalised : "unnamed";
  return /^[0-9]/.test(safeName) ? `_${safeName}` : safeName;
}

export function toTableName(objectName: string): string {
  return toStorageName(objectName);
}
