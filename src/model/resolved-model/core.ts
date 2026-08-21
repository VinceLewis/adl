import type { JsonValue } from "./shared.js";
import type { PartialShellModel, ResolvedShell } from "./shell.js";
import type {
  PartialBusinessContextModel,
  PartialRoleModel,
  ResolvedBusinessContext,
  ResolvedRole,
} from "./context.js";
import type { PartialObjectModel, ResolvedObject } from "./object-field.js";
import type { PartialPolicyModel, ResolvedPolicy } from "./policy.js";
import type { PartialReadModelModel, ResolvedReadModel } from "./read-model.js";
import type { PartialDecisionTableModel, ResolvedDecisionTable } from "./decision-table.js";
import type { PartialCommandModel, ResolvedCommand } from "./command.js";
import type { PartialThemeModel, ResolvedTheme } from "./theme.js";
import type {
  PartialSyncPolicyModel,
  ResolvedAuditModel,
  ResolvedSyncPolicy,
  SyncMode,
} from "./sync.js";
import type { ResolvedOperationLogModel } from "./runtime-records.js";

export interface ResolvedApplicationModel {
  /**
   * The version the model declares (`APP ... MODEL_VERSION "1.1.0"`), defaulting
   * to {@link ADL_MODEL_VERSION} when undeclared. It selects migrations; it is
   * not evidence that the content is unchanged, which is what
   * {@link ResolvedApplicationModel.modelFingerprint} is for.
   */
  modelVersion: string;
  /**
   * A deterministic digest of this model's own content, computed during
   * resolution. Two resolutions of the same content always agree, and any
   * content change changes it — including one an author forgot to declare, which
   * is refused at startup rather than absorbed silently.
   */
  modelFingerprint: string;
  generatedAt?: string;
  app: ResolvedApp;
  shell: ResolvedShell;
  roles: ResolvedRole[];
  contexts?: ResolvedBusinessContext[];
  objects: ResolvedObject[];
  readModels?: ResolvedReadModel[];
  decisionTables?: ResolvedDecisionTable[];
  commands?: ResolvedCommand[];
  policies: ResolvedPolicy[];
  themes: ResolvedTheme[];
  sync: ResolvedSyncPolicy[];
  audit: ResolvedAuditModel;
  operationLog: ResolvedOperationLogModel;
  /**
   * How persisted records reach this model's version from an earlier one. Each
   * entry is one hop; the runtime chains them. Declaring a migration is the only
   * thing that makes a model version change appliable rather than fail-closed.
   */
  migrations: ResolvedModelMigration[];
  defaults: ResolvedModelDefaults;
}
/**
 * One version hop. Migrations are a persistence concern expressed declaratively,
 * so the same hop runs identically over the authority's accepted-record
 * projection and a browser's IndexedDB records. They never describe SQL, storage
 * engines or table shape: the projection stores whole records as JSON, and the
 * projection's own tables migrate out of band through ordered SQL files.
 */
export interface ResolvedModelMigration {
  from: string;
  to: string;
  objects: ResolvedModelMigrationObject[];
}
export interface ResolvedModelMigrationObject {
  object: string;
  /**
   * The `meta.schemaVersion` a record of this object carries once the hop has
   * been applied. Undeclared means the hop does not change it.
   */
  schemaVersion?: number;
  steps: ResolvedModelMigrationStep[];
}
/**
 * The whole step vocabulary. It is deliberately small: every step is total (it
 * cannot fail on a well-formed record), reversible to inspect, and expressible
 * against any conforming runtime. Anything an author cannot say with these is a
 * model change that needs a different shape, not a bigger vocabulary.
 */
export type ResolvedModelMigrationStep =
  | ResolvedModelMigrationRenameFieldStep
  | ResolvedModelMigrationAddFieldStep
  | ResolvedModelMigrationDropFieldStep;
export interface ResolvedModelMigrationRenameFieldStep {
  kind: "renameField";
  from: string;
  to: string;
}
export interface ResolvedModelMigrationAddFieldStep {
  kind: "addField";
  field: string;
  /** Written to every record that does not already carry the field. */
  defaultValue: JsonValue;
}
export interface ResolvedModelMigrationDropFieldStep {
  kind: "dropField";
  field: string;
}
export interface ResolvedModelDefaults {
  systemIdField: string;
  objectSchemaVersion: number;
  metadataFields: string[];
  syncMode: SyncMode;
  policyEffect: "deny";
  theme: string;
  tableNaming: "snakeCaseObjectName";
  fieldStorageNaming: "snakeCaseFieldName";
}
export interface ResolvedApp {
  name: string;
  startView: string;
  theme: string;
  /**
   * How long a device may sync since its last successful authentication to the
   * authority before a fresh logon is required. It is a sync-policy property,
   * not an identity one: it never declares how a credential is verified, and it
   * never gates local operation, which works offline indefinitely either side
   * of the grace. The authority loads the same resolved model and remains the
   * enforcement point; the client-side check is only an affordance.
   */
  offlineGraceDays: number;
  /**
   * Whether this application admits people who were not invited.
   *
   * Absent means `inviteOnly`. It is deliberately omitted rather than
   * defaulted, so a model that says nothing has a byte-identical
   * `modelFingerprint` to the one it had before this field existed. There is
   * exactly one consumer — `resolveSelfServiceRegistration` in
   * `src/server/authority-config.ts` — and it treats absence as the
   * restrictive value.
   *
   * The authority is the enforcement point, and a deployment control may only
   * ever *restrict* what this declares: there is no environment value that
   * enables self-service for a model that did not ask for it. See
   * `docs/spec/language.md` and Phase 99.
   */
  registration?: AppRegistrationMode;
}
export type AppRegistrationMode = "selfService" | "inviteOnly";
export interface PartialApplicationModel {
  modelVersion?: string;
  app: PartialAppModel;
  shell?: PartialShellModel;
  roles?: PartialRoleModel[];
  contexts?: PartialBusinessContextModel[];
  objects: PartialObjectModel[];
  readModels?: PartialReadModelModel[];
  decisionTables?: PartialDecisionTableModel[];
  commands?: PartialCommandModel[];
  policies?: PartialPolicyModel[];
  themes?: PartialThemeModel[];
  sync?: PartialSyncPolicyModel[];
  migrations?: PartialModelMigrationModel[];
}
/**
 * One source's contribution to a `PartialApplicationModel` that has not yet
 * been combined with any other source's. Identical to `PartialApplicationModel`
 * except `app` and `shell` are also optional (`modelVersion` already is) — a
 * single `.adl`/`.adlj` source file in a multi-source project may declare
 * neither. `mergePartialApplicationModelFragments`
 * (`src/compiler/merge-partial-model.ts`) combines an ordered array of these
 * into one `PartialApplicationModel` for resolution. See `docs/spec/adlj.md`
 * for the merge rules this type supports.
 */
export type PartialApplicationModelFragment = Omit<PartialApplicationModel, "app" | "shell"> & {
  app?: PartialAppModel;
  shell?: PartialShellModel;
};
export interface PartialModelMigrationModel {
  from: string;
  to: string;
  objects?: PartialModelMigrationObjectModel[];
}
export interface PartialModelMigrationObjectModel {
  object: string;
  schemaVersion?: number;
  steps?: ResolvedModelMigrationStep[];
}
export interface PartialAppModel {
  name: string;
  startView?: string;
  theme?: string;
  offlineGraceDays?: number;
  /** See {@link ResolvedApp.registration}. Absent means `inviteOnly`. */
  registration?: AppRegistrationMode;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
