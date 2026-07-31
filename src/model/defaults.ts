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

/**
 * The version a model resolves to when it declares none. It is a default, not a
 * platform constant: `APP ... MODEL_VERSION "1.1.0"` overrides it, and a model
 * that declares nothing and then changes content is caught by its fingerprint
 * rather than passing unnoticed.
 */
export const ADL_MODEL_VERSION = "0.1.0";
/**
 * Declared versions are ordered dotted numbers (`1`, `1.2`, `1.2.3`, up to four
 * components). Ordering matters because migrations chain, and a free-form string
 * would leave "is this persisted version older or newer?" unanswerable.
 */
export const MODEL_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/u;

/** True when `value` is a well-formed declared model version. */
export function isValidModelVersion(value: unknown): value is string {
  return typeof value === "string" && MODEL_VERSION_PATTERN.test(value);
}

/**
 * The canonical spelling of a declared version: trailing zero components are
 * dropped, so `1.2.0`, `1.2` and `1.2.0.0` all become `1.2`.
 *
 * Anywhere a version is used as a map key or set member it must go through this
 * first. Comparing component-wise but *keying* on the raw text is how `1.1` and
 * `1.1.0` became different versions to the migration planner while being the
 * same version to everything else.
 */
export function normaliseModelVersion(value: string): string {
  const parts = value.split(".");
  while (parts.length > 1 && parts[parts.length - 1] === "0") {
    parts.pop();
  }
  return parts.join(".");
}

/**
 * Orders two declared versions component-wise, treating missing components as
 * zero, so `1.2` and `1.2.0` compare equal. Returns a negative number when
 * `left` precedes `right`.
 */
export function compareModelVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export const DEFAULT_OBJECT_SCHEMA_VERSION = 1;
export const SYSTEM_ID_FIELD = "_guid";
export const DEFAULT_LIFECYCLE_STATE_FIELD = "_state";
export const DEFAULT_THEME_NAME = "CorporateLight";
/**
 * How long a device may keep syncing since its last successful authentication
 * before a fresh logon is required. It gates sync only: local reads and
 * local-first writes work offline indefinitely, inside the grace and outside it.
 */
export const DEFAULT_OFFLINE_GRACE_DAYS = 30;
/**
 * An upper bound, not a recommendation. The grace is also the authority's
 * session lifetime, so an unbounded value would mint sessions that outlive any
 * plausible revocation window.
 */
export const MAX_OFFLINE_GRACE_DAYS = 365;
export const DEFAULT_SYNC_MODE = "localFirst";
export const DEFAULT_SYNC_SCOPE = "all";
export const DEFAULT_CONFLICT_STRATEGY = "manual";
export const BUILT_IN_THEME_NAMES = ["CorporateLight", "CorporateDark", "MinimalLight"] as const;

export type BuiltInThemeName = (typeof BUILT_IN_THEME_NAMES)[number];

export const DEFAULT_AUDIT_OPERATIONS = [
  "create",
  "update",
  "delete",
  "transition",
] as const satisfies readonly AuditOperation[];

/**
 * `command` is here because the operation log is what feeds the sync queue: an
 * operation kind that is not logged is never queued and so never reaches the
 * authority. A command that was not logged would execute locally, write its
 * records, and have no delivery path at all — while its per-step writes are
 * deliberately not queued separately, because the authority must be told about
 * the transaction rather than about its pieces.
 *
 * `batch` is here for exactly that reason, one kind later: an edit surface's
 * staged child changes are also queued as one entry standing for a transaction,
 * and would also have had no delivery path at all if the log did not carry them.
 */
export const DEFAULT_OPERATION_LOG_OPERATIONS = [
  "create",
  "update",
  "delete",
  "transition",
  "command",
  "batch",
] as const;

export const LOCAL_OPERATION_STATUSES = [
  "pending",
  "sent",
  "accepted",
  "rejected",
  "conflict",
] as const;

export const CORPORATE_LIGHT_THEME_TOKENS: ResolvedThemeTokens = {
  colorPrimary: "#155EEF",
  colorAccent: "#12B76A",
  colorBackground: "#F8FAFC",
  colorSurface: "#FFFFFF",
  colorSurfaceAlt: "#F1F5F9",
  colorText: "#101828",
  colorTextMuted: "#667085",
  colorTextInverted: "#FFFFFF",
  colorBorder: "#D9E1EC",
  colorDanger: "#D92D20",
  colorSuccess: "#039855",
  colorInfo: "#155EEF",
  colorStatusEvent: "#155EEF",
  colorStatusAlternate: "#7A5AF8",
  colorStatusAvailable: "#039855",
  colorStatusUnavailable: "#D92D20",
  colorStatusBusyElsewhere: "#DC6803",
  colorStatusConflict: "#B42318",
  colorStatusUnset: "#667085",
  radius: "medium",
  density: "comfortable",
  nav: "side",
  fontFamily: "system-ui, sans-serif",
};

export const CORPORATE_DARK_THEME_TOKENS: ResolvedThemeTokens = {
  colorPrimary: "#84ADFF",
  colorAccent: "#32D583",
  colorBackground: "#111827",
  colorSurface: "#1F2937",
  colorSurfaceAlt: "#374151",
  colorText: "#F9FAFB",
  colorTextMuted: "#CBD5E1",
  colorTextInverted: "#111827",
  colorBorder: "#4B5563",
  colorDanger: "#FDA29B",
  colorSuccess: "#75E0A7",
  colorInfo: "#B2CCFF",
  colorStatusEvent: "#84ADFF",
  colorStatusAlternate: "#BDB4FE",
  colorStatusAvailable: "#75E0A7",
  colorStatusUnavailable: "#FDA29B",
  colorStatusBusyElsewhere: "#FDB022",
  colorStatusConflict: "#F97066",
  colorStatusUnset: "#CBD5E1",
  radius: "medium",
  density: "comfortable",
  nav: "side",
  fontFamily: "system-ui, sans-serif",
};

export const MINIMAL_LIGHT_THEME_TOKENS: ResolvedThemeTokens = {
  colorPrimary: "#1F2937",
  colorAccent: "#0E9384",
  colorBackground: "#FAFAFA",
  colorSurface: "#FFFFFF",
  colorSurfaceAlt: "#F4F4F5",
  colorText: "#18181B",
  colorTextMuted: "#71717A",
  colorTextInverted: "#FFFFFF",
  colorBorder: "#D4D4D8",
  colorDanger: "#DC2626",
  colorSuccess: "#16A34A",
  colorInfo: "#2563EB",
  colorStatusEvent: "#2563EB",
  colorStatusAlternate: "#7C3AED",
  colorStatusAvailable: "#16A34A",
  colorStatusUnavailable: "#DC2626",
  colorStatusBusyElsewhere: "#D97706",
  colorStatusConflict: "#B91C1C",
  colorStatusUnset: "#71717A",
  radius: "small",
  density: "compact",
  nav: "top",
  fontFamily: "system-ui, sans-serif",
};

export const DEFAULT_THEME_TOKENS: ResolvedThemeTokens = {
  ...CORPORATE_LIGHT_THEME_TOKENS,
};

const BUILT_IN_THEME_DEFINITIONS = [
  {
    name: "CorporateLight",
    tokens: CORPORATE_LIGHT_THEME_TOKENS,
  },
  {
    name: "CorporateDark",
    tokens: CORPORATE_DARK_THEME_TOKENS,
  },
  {
    name: "MinimalLight",
    tokens: MINIMAL_LIGHT_THEME_TOKENS,
  },
] as const satisfies readonly { name: BuiltInThemeName; tokens: ResolvedThemeTokens }[];

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
  return cloneTheme(getBuiltInTheme(DEFAULT_THEME_NAME) ?? failMissingDefaultTheme());
}

export function createBuiltInThemes(): ResolvedTheme[] {
  return BUILT_IN_THEME_DEFINITIONS.map((theme) => cloneTheme(theme));
}

export function getBuiltInTheme(name: string): ResolvedTheme | undefined {
  const theme = BUILT_IN_THEME_DEFINITIONS.find((candidate) => candidate.name === name);
  return theme === undefined ? undefined : cloneTheme(theme);
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

function cloneTheme(theme: {
  name: string;
  base?: string;
  tokens: ResolvedThemeTokens;
}): ResolvedTheme {
  return {
    name: theme.name,
    ...(theme.base === undefined ? {} : { base: theme.base }),
    tokens: { ...theme.tokens },
  };
}

function failMissingDefaultTheme(): never {
  throw new Error(`Built-in default theme '${DEFAULT_THEME_NAME}' is not defined.`);
}
