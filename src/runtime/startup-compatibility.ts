import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import { RuntimeStartupError } from "./runtime-types.js";
import type { RuntimeLogger, RuntimeStartupDiagnostic } from "./runtime-types.js";

export const RUNTIME_STARTUP_COMPATIBILITY_CODES = {
  MODEL_VERSION_MISMATCH: "ADL_PERSISTED_MODEL_VERSION_MISMATCH",
  MODEL_VERSION_MISSING: "ADL_PERSISTED_MODEL_VERSION_MISSING",
  RECORD_OBJECT_METADATA_MISMATCH: "ADL_PERSISTED_RECORD_OBJECT_METADATA_MISMATCH",
  RECORD_OBJECT_UNKNOWN: "ADL_PERSISTED_RECORD_OBJECT_UNKNOWN",
  RECORD_SCHEMA_VERSION_MISSING: "ADL_PERSISTED_RECORD_SCHEMA_VERSION_MISSING",
  RECORD_SCHEMA_VERSION_MISMATCH: "ADL_PERSISTED_RECORD_SCHEMA_VERSION_MISMATCH",
} as const;

export async function runRuntimeStartupCompatibilityChecks(
  model: ResolvedApplicationModel,
  storage: ObjectStorageBackend,
  logger: RuntimeLogger,
): Promise<RuntimeStartupDiagnostic[]> {
  logger.debug("ENTER RuntimeStartupCompatibilityChecks.run", {
    modelVersion: model.modelVersion,
  });

  const [metadata, persistedRecords] = await Promise.all([
    storage.readApplicationMetadata(),
    storage.listRecords(),
  ]);
  const objectsByName = new Map(model.objects.map((object) => [object.name, object]));
  const diagnostics: RuntimeStartupDiagnostic[] = [];

  if (metadata !== null && metadata.modelVersion !== model.modelVersion) {
    diagnostics.push({
      severity: "error",
      code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISMATCH,
      message: `Persisted application model version '${metadata.modelVersion}' is incompatible with current model version '${model.modelVersion}'.`,
      path: "metadata.modelVersion",
      expected: model.modelVersion,
      actual: metadata.modelVersion,
    });
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

  if (metadata === null) {
    await storage.writeApplicationMetadata({ modelVersion: model.modelVersion });
  }

  logger.debug("EXIT RuntimeStartupCompatibilityChecks.run", {
    status: "passed",
    diagnostics,
  });

  return diagnostics;
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
