import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import {
  MODEL_MIGRATION_CODES,
  migratePersistedRecords,
  planModelMigration,
  type ModelMigrationPlan,
} from "./model-migration.js";
import type {
  ObjectStorageBackend,
  ObjectStorageTransactionWrite,
  PersistedObjectRecord,
} from "./object-storage-backend.js";
import { RuntimeStartupError } from "./runtime-types.js";
import type { RuntimeLogger, RuntimeStartupDiagnostic } from "./runtime-types.js";

export const RUNTIME_STARTUP_COMPATIBILITY_CODES = {
  MODEL_VERSION_MISMATCH: "ADL_PERSISTED_MODEL_VERSION_MISMATCH",
  MODEL_VERSION_MISSING: "ADL_PERSISTED_MODEL_VERSION_MISSING",
  MODEL_FINGERPRINT_MISSING: "ADL_PERSISTED_MODEL_FINGERPRINT_MISSING",
  MODEL_FINGERPRINT_STALE: MODEL_MIGRATION_CODES.FINGERPRINT_STALE,
  MIGRATION_APPLIED: "ADL_MODEL_MIGRATION_APPLIED",
  MIGRATION_FAILED: MODEL_MIGRATION_CODES.FAILED,
  RECORD_OBJECT_METADATA_MISMATCH: "ADL_PERSISTED_RECORD_OBJECT_METADATA_MISMATCH",
  RECORD_OBJECT_UNKNOWN: "ADL_PERSISTED_RECORD_OBJECT_UNKNOWN",
  RECORD_SCHEMA_VERSION_MISSING: "ADL_PERSISTED_RECORD_SCHEMA_VERSION_MISSING",
  RECORD_SCHEMA_VERSION_MISMATCH: "ADL_PERSISTED_RECORD_SCHEMA_VERSION_MISMATCH",
} as const;

export interface RuntimeStartupCompatibilityOptions {
  /**
   * Whether a declared migration may be applied to persisted state, rather than
   * only planned. Off by default so a caller that merely wants to know whether
   * state is readable — a conformance case, an inspection tool — never rewrites
   * anything as a side effect of asking.
   */
  applyMigrations?: boolean;
}

/**
 * The single place persisted state is checked against the running model, and
 * now the single place it is migrated to it.
 *
 * The order matters and is not arbitrary. Records are migrated *before* their
 * schema versions are checked, because the whole point of a migration is to
 * make records that would otherwise fail that check pass it. And the metadata
 * row is written in the same commit as the record rewrites, so a crash between
 * them cannot leave migrated records under the old version, or the new version
 * over unmigrated records.
 *
 * Every failure path is a refusal. Nothing here deletes a record, clears a
 * store, or resets state to make the process start: persisted data outlives a
 * process that cannot read it.
 */
export async function runRuntimeStartupCompatibilityChecks(
  model: ResolvedApplicationModel,
  storage: ObjectStorageBackend,
  logger: RuntimeLogger,
  options: RuntimeStartupCompatibilityOptions = {},
): Promise<RuntimeStartupDiagnostic[]> {
  logger.debug("ENTER RuntimeStartupCompatibilityChecks.run", {
    modelVersion: model.modelVersion,
  });

  const [metadata, initialRecords] = await Promise.all([
    storage.readApplicationMetadata(),
    storage.listRecords(),
  ]);
  const objectsByName = new Map(model.objects.map((object) => [object.name, object]));
  const diagnostics: RuntimeStartupDiagnostic[] = [];
  let persistedRecords = initialRecords;
  let appliedPlan: ModelMigrationPlan | undefined;

  if (metadata !== null) {
    const planned = planModelMigration(model, metadata.modelVersion);

    if (planned.status === "refused") {
      diagnostics.push(planned.diagnostic);
    } else if (planned.status === "migrate") {
      if (options.applyMigrations !== true) {
        // A migration exists but this caller only asked whether the state was
        // readable, so it is not read. The message says so rather than claiming
        // an incompatibility, which would be untrue.
        diagnostics.push({
          severity: "error",
          code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISMATCH,
          message: `Persisted application model version '${metadata.modelVersion}' does not match current model version '${model.modelVersion}'. A declared migration reaches it, but this caller did not enable migration, so persisted data was left untouched.`,
          path: "metadata.modelVersion",
          expected: model.modelVersion,
          actual: metadata.modelVersion,
        });
      } else {
        const outcome = await applyMigration(model, storage, planned.plan, persistedRecords);
        if (outcome.status === "failed") {
          diagnostics.push(outcome.diagnostic);
        } else {
          persistedRecords = outcome.records;
          appliedPlan = planned.plan;
          diagnostics.push({
            severity: "info",
            code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_APPLIED,
            message: `Migrated persisted data from model version '${planned.plan.from}' to '${planned.plan.to}'; ${outcome.migratedRecordCount} record(s) changed.`,
            path: "metadata.modelVersion",
            expected: model.modelVersion,
            actual: planned.plan.from,
          });
        }
      }
    } else if (metadata.modelFingerprint === undefined) {
      // State written before fingerprints existed. Warn and backfill rather
      // than refuse: the version matches, and refusing here would make adopting
      // this guard itself a breaking change.
      diagnostics.push({
        severity: "warning",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_MISSING,
        message:
          "Persisted application metadata predates model fingerprints; the current model fingerprint will be stored after compatibility checks pass.",
        path: "metadata.modelFingerprint",
        expected: model.modelFingerprint,
        actual: null,
      });
    } else if (metadata.modelFingerprint !== model.modelFingerprint) {
      // The declared version is unchanged but the content is not. This is the
      // case that used to pass in silence, and the one with teeth: the model
      // that persisted this state is not the model now running, so no migration
      // can be selected and none can be assumed unnecessary.
      diagnostics.push({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_STALE,
        message: `The model declares version '${model.modelVersion}', which persisted data already carries, but its content has changed. Declare a new MODEL_VERSION and a MIGRATION to it; persisted data has been left untouched.`,
        path: "metadata.modelFingerprint",
        expected: model.modelFingerprint,
        actual: metadata.modelFingerprint,
      });
    }
  }

  if (metadata === null && persistedRecords.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISSING,
      message:
        "Persisted records did not include application model metadata; current model version metadata will be stored after compatibility checks pass.",
      path: "metadata.modelVersion",
      expected: model.modelVersion,
      actual: null,
    });
  }

  for (const persisted of persistedRecords) {
    const record = persisted.record;
    const recordObjectName = getRecordObjectName(record);
    const objectName = recordObjectName ?? persisted.objectName;
    const object = objectsByName.get(objectName);

    if (recordObjectName !== undefined && recordObjectName !== persisted.objectName) {
      diagnostics.push({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.RECORD_OBJECT_METADATA_MISMATCH,
        message: `Persisted record '${record.meta.guid}' is stored under object '${persisted.objectName}' but its metadata says '${recordObjectName}'.`,
        path: `records.${persisted.objectName}.${record.meta.guid}.meta.object`,
        objectName: persisted.objectName,
        recordId: record.meta.guid,
        expected: persisted.objectName,
        actual: recordObjectName,
      });
    }

    if (object === undefined) {
      diagnostics.push({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.RECORD_OBJECT_UNKNOWN,
        message: `Persisted record '${record.meta.guid}' references object '${objectName}', which does not exist in the current model.`,
        path: `records.${persisted.objectName}.${record.meta.guid}.meta.object`,
        objectName,
        recordId: record.meta.guid,
        actual: objectName,
      });
      continue;
    }

    if (!isValidSchemaVersion(record.meta.schemaVersion)) {
      diagnostics.push({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.RECORD_SCHEMA_VERSION_MISSING,
        message: `Persisted record '${record.meta.guid}' for object '${object.name}' is missing a valid schema version.`,
        path: `records.${persisted.objectName}.${record.meta.guid}.meta.schemaVersion`,
        objectName: object.name,
        recordId: record.meta.guid,
        expected: object.schemaVersion,
        actual: invalidSchemaVersionValue(record.meta.schemaVersion),
      });
      continue;
    }

    if (record.meta.schemaVersion !== object.schemaVersion) {
      diagnostics.push({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.RECORD_SCHEMA_VERSION_MISMATCH,
        message: `Persisted record '${record.meta.guid}' for object '${object.name}' has schema version ${record.meta.schemaVersion}, but the current model expects ${object.schemaVersion}.`,
        path: `records.${persisted.objectName}.${record.meta.guid}.meta.schemaVersion`,
        objectName: object.name,
        recordId: record.meta.guid,
        expected: object.schemaVersion,
        actual: record.meta.schemaVersion,
      });
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    logger.debug("EXIT RuntimeStartupCompatibilityChecks.run", {
      status: "failed",
      diagnostics,
    });
    throw new RuntimeStartupError(diagnostics);
  }

  // A successful migration already wrote the metadata inside its own commit;
  // writing again here would be harmless but would claim a second time that
  // state matches the model, which is exactly the claim that must only be made
  // once the records back it up.
  if (appliedPlan === undefined && needsMetadataWrite(metadata, model)) {
    await storage.writeApplicationMetadata({
      modelVersion: model.modelVersion,
      modelFingerprint: model.modelFingerprint,
    });
  }

  logger.debug("EXIT RuntimeStartupCompatibilityChecks.run", {
    status: "passed",
    diagnostics,
  });

  return diagnostics;
}

type MigrationOutcome =
  | { status: "applied"; records: PersistedObjectRecord[]; migratedRecordCount: number }
  | { status: "failed"; diagnostic: RuntimeStartupDiagnostic };

/**
 * Transforms records in memory, then commits the rewrites and the metadata row
 * together. A backend without transactions is refused rather than migrated
 * write-by-write: a half-applied migration is the one outcome no diagnostic can
 * describe honestly afterwards.
 */
async function applyMigration(
  model: ResolvedApplicationModel,
  storage: ObjectStorageBackend,
  plan: ModelMigrationPlan,
  records: PersistedObjectRecord[],
): Promise<MigrationOutcome> {
  if (storage.supportsTransactions !== true || storage.commitTransaction === undefined) {
    return {
      status: "failed",
      diagnostic: {
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_FAILED,
        message: `Migrating from model version '${plan.from}' to '${plan.to}' needs a transactional storage backend, and this one cannot commit atomically. Persisted data has been left untouched.`,
        path: "metadata.modelVersion",
        expected: plan.to,
        actual: plan.from,
      },
    };
  }

  const migrated = migratePersistedRecords(records, plan);
  const writes: ObjectStorageTransactionWrite[] = [
    ...migrated.map(
      (entry): ObjectStorageTransactionWrite => ({
        operation: "update",
        objectName: entry.objectName,
        record: entry.record,
      }),
    ),
    {
      operation: "applicationMetadata",
      metadata: {
        modelVersion: model.modelVersion,
        modelFingerprint: model.modelFingerprint,
      },
    },
  ];

  try {
    await storage.commitTransaction(writes);
  } catch (error) {
    return {
      status: "failed",
      diagnostic: {
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_FAILED,
        // The fault is reduced to its name: a storage driver's message can name
        // hosts, statements and record values, and a startup diagnostic is read
        // by anyone who can see a log line.
        message: `Migrating from model version '${plan.from}' to '${plan.to}' failed (${faultName(error)}) and was rolled back. Persisted data is unchanged and still at '${plan.from}'.`,
        path: "metadata.modelVersion",
        expected: plan.to,
        actual: plan.from,
      },
    };
  }

  const migratedById = new Map(
    migrated.map((entry) => [`${entry.objectName}\0${entry.record.meta.guid}`, entry.record]),
  );

  return {
    status: "applied",
    migratedRecordCount: migrated.length,
    records: records.map((persisted) => {
      const replacement = migratedById.get(
        `${persisted.objectName}\0${persisted.record.meta.guid}`,
      );
      return replacement === undefined ? persisted : { ...persisted, record: replacement };
    }),
  };
}

function needsMetadataWrite(
  metadata: { modelVersion: string; modelFingerprint?: string } | null,
  model: ResolvedApplicationModel,
): boolean {
  return (
    metadata === null ||
    metadata.modelVersion !== model.modelVersion ||
    metadata.modelFingerprint !== model.modelFingerprint
  );
}

function faultName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function getRecordObjectName(record: StoredObjectRecord): string | undefined {
  return typeof record.meta.object === "string" && record.meta.object.length > 0
    ? record.meta.object
    : undefined;
}

function isValidSchemaVersion(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function invalidSchemaVersionValue(value: number): number | null {
  return typeof value === "number" ? value : null;
}
