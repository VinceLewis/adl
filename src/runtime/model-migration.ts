/**
 * Model migration: how persisted state reaches the model the process is running.
 *
 * Two things had to become true for this to exist at all. A model *content*
 * change had to become a model *version* change — that is `modelFingerprint`,
 * computed during resolution. And a version change had to have somewhere to say
 * what it means for a record, which is a declared `MIGRATION` block.
 *
 * Everything here is pure. Planning reads a model and a persisted version;
 * applying transforms records in memory. Nothing in this module touches
 * storage, which is what lets the server run the identical transform inside its
 * own atomic commit boundary and the browser run it inside an IndexedDB
 * transaction, without either one reimplementing the semantics.
 *
 * Two rules shape the whole design:
 *
 * - **Fail closed, never destroy.** A version the model cannot reach is a
 *   refusal to serve or read, not a wipe. Persisted data outlives the process
 *   that could not read it.
 * - **Records only.** A migration transforms records and the pending operations
 *   that describe changes to them. It never fabricates an audit event, an
 *   operation-log entry or a queue entry, and it never touches the cached
 *   browser identity, which is not a record and has no schema of its own.
 */

import { compareModelVersions, normaliseModelVersion } from "../model/defaults.js";
import type {
  JsonValue,
  LocalOperation,
  ResolvedApplicationModel,
  ResolvedModelMigration,
  ResolvedModelMigrationObject,
  ResolvedModelMigrationStep,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import type { PersistedObjectRecord } from "./object-storage-backend.js";
import type { PersistedSyncState } from "./sync-state-storage.js";
import type { RuntimeStartupDiagnostic } from "./runtime-types.js";

export const MODEL_MIGRATION_CODES = {
  /** The declared version is unchanged but the model's content is not. */
  FINGERPRINT_STALE: "ADL_PERSISTED_MODEL_FINGERPRINT_STALE",
  /**
   * Persisted state is at a version no declared chain of migrations reaches.
   * This deliberately reuses the guard's established incompatibility code rather
   * than minting a new one: the fact being reported — this data cannot be read
   * by this model — is the same fact the guard has always reported, and a
   * conforming runtime should not have to learn a second code for it. What
   * changed is the remediation, which the message carries.
   */
  VERSION_UNREACHABLE: "ADL_PERSISTED_MODEL_VERSION_MISMATCH",
  /** Persisted state is ahead of this model: an older process reading newer data. */
  PERSISTED_AHEAD: "ADL_MIGRATION_PERSISTED_VERSION_AHEAD",
  /** Applying the plan failed; the caller must leave persisted state untouched. */
  FAILED: "ADL_MIGRATION_FAILED",
} as const;

export interface ModelMigrationPlan {
  from: string;
  to: string;
  /** The hops to apply, already ordered from `from` to `to`. */
  steps: ResolvedModelMigration[];
}

export type ModelMigrationPlanResult =
  | { status: "current" }
  | { status: "migrate"; plan: ModelMigrationPlan }
  | { status: "refused"; diagnostic: RuntimeStartupDiagnostic };

/**
 * Decides what has to happen to persisted state at `persistedVersion` before
 * this model may read it.
 *
 * Refusal is deliberately the default for anything unrecognised. A missing hop
 * is a refusal, and so is persisted state from a *newer* model, because an older
 * process silently reading newer records is how a downgrade destroys data it
 * does not understand.
 */
export function planModelMigration(
  model: ResolvedApplicationModel,
  persistedVersion: string,
): ModelMigrationPlanResult {
  // Component-wise, not string equality. `1.1` and `1.1.0` are the same version
  // — `compareModelVersions` says so and the language spec says so — and testing
  // identity here made that pair an unreachable install: the guard refused,
  // telling the author to declare a migration from '1.1', and declaring one was
  // itself a validation error because the two versions do not move forward
  // relative to each other. "Your data is safe and permanently unreadable" is
  // the outcome this whole path exists to avoid.
  if (compareModelVersions(persistedVersion, model.modelVersion) === 0) {
    return { status: "current" };
  }

  if (compareModelVersions(persistedVersion, model.modelVersion) > 0) {
    return {
      status: "refused",
      diagnostic: {
        severity: "error",
        code: MODEL_MIGRATION_CODES.PERSISTED_AHEAD,
        message: `Persisted data is at model version '${persistedVersion}', which is later than this application's version '${model.modelVersion}'. Run a build at or after the persisted version; this one will not read it.`,
        path: "metadata.modelVersion",
        expected: model.modelVersion,
        actual: persistedVersion,
      },
    };
  }

  const chain = findMigrationChain(model, persistedVersion);

  if (chain === undefined) {
    return {
      status: "refused",
      diagnostic: {
        severity: "error",
        code: MODEL_MIGRATION_CODES.VERSION_UNREACHABLE,
        message: `Persisted application model version '${persistedVersion}' is incompatible with current model version '${model.modelVersion}': no declared migration reaches it. Declare a MIGRATION from '${persistedVersion}'; persisted data has been left untouched.`,
        path: "metadata.modelVersion",
        expected: model.modelVersion,
        actual: persistedVersion,
      },
    };
  }

  return {
    status: "migrate",
    plan: { from: persistedVersion, to: model.modelVersion, steps: chain },
  };
}

/**
 * Shortest hop sequence from `persistedVersion` to the model's version, by
 * breadth-first search over declared migrations.
 *
 * Breadth-first rather than "apply every migration in declaration order"
 * because a model may declare more than one route forward — a long-way-round
 * chain kept for old installs alongside a direct hop for recent ones — and
 * applying both would apply the same field change twice.
 */
function findMigrationChain(
  model: ResolvedApplicationModel,
  persistedVersion: string,
): ResolvedModelMigration[] | undefined {
  // Every version used as a key or set member is normalised first. Comparing
  // component-wise while keying on raw text is what made `1.1` and `1.1.0`
  // different versions here and the same version everywhere else.
  const target = normaliseModelVersion(model.modelVersion);
  const byFrom = new Map<string, ResolvedModelMigration[]>();
  for (const migration of model.migrations) {
    const from = normaliseModelVersion(migration.from);
    byFrom.set(from, [...(byFrom.get(from) ?? []), migration]);
  }

  const queue: Array<{ version: string; path: ResolvedModelMigration[] }> = [
    { version: normaliseModelVersion(persistedVersion), path: [] },
  ];
  const visited = new Set<string>([normaliseModelVersion(persistedVersion)]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }

    for (const migration of byFrom.get(current.version) ?? []) {
      const to = normaliseModelVersion(migration.to);
      if (visited.has(to)) {
        continue;
      }
      const path = [...current.path, migration];
      if (to === target) {
        return path;
      }
      visited.add(to);
      queue.push({ version: to, path });
    }
  }

  return undefined;
}

export interface MigratedRecord {
  objectName: string;
  record: StoredObjectRecord;
}

/**
 * Applies a plan to persisted records and returns only those it changed.
 *
 * Returning just the changes keeps the write set minimal, which matters on the
 * server: the whole migration commits as one transaction, so an install with
 * one changed object does not rewrite every record it holds.
 */
export function migratePersistedRecords(
  records: PersistedObjectRecord[],
  plan: ModelMigrationPlan,
): MigratedRecord[] {
  const changed: MigratedRecord[] = [];

  for (const persisted of records) {
    const objectName = recordObjectName(persisted);
    const migrated = migrateStoredRecord(persisted.record, objectName, plan);
    if (migrated !== undefined) {
      changed.push({ objectName: persisted.objectName, record: migrated });
    }
  }

  return changed;
}

/**
 * One record through every hop of the plan, or `undefined` when no hop touches
 * it. A record of an object no migration mentions is left byte-identical rather
 * than rewritten, so an untouched object cannot acquire a new `revision` or a
 * reordered value map as a side effect of an unrelated migration.
 */
export function migrateStoredRecord(
  record: StoredObjectRecord,
  objectName: string,
  plan: ModelMigrationPlan,
): StoredObjectRecord | undefined {
  let values = record.values;
  let schemaVersion = record.meta.schemaVersion;
  let touched = false;

  for (const migration of plan.steps) {
    const migrationObject = findMigrationObject(migration, objectName);
    if (migrationObject === undefined) {
      continue;
    }

    const next = applySteps(values, migrationObject.steps);
    if (next !== values) {
      values = next;
      touched = true;
    }

    if (
      migrationObject.schemaVersion !== undefined &&
      migrationObject.schemaVersion !== schemaVersion
    ) {
      schemaVersion = migrationObject.schemaVersion;
      touched = true;
    }
  }

  if (!touched) {
    return undefined;
  }

  // `revision`, actor and timestamps are deliberately preserved. A migration is
  // not an edit by anyone: rewriting them would make a schema change look like a
  // user's change in every audit surface, and would break optimistic
  // concurrency for a client holding the pre-migration revision.
  return { meta: { ...record.meta, schemaVersion }, values };
}

/**
 * Applies a plan to persisted sync state.
 *
 * Pending local operations carry field-keyed patches and value maps that
 * describe intent the user expressed before the migration existed. Leaving them
 * at the old field names would send the authority a patch naming a field the
 * model no longer has; discarding them would destroy work the user has not
 * synced. So they are transformed by exactly the same steps as the records they
 * describe. Nothing is added: an operation that no step touches is returned
 * unchanged, and no operation, audit event or queue entry is ever created here.
 *
 * The queue is migrated as well as the log, and not because it is tidier. A
 * queue entry embeds its **own copy** of the `LocalOperation`, and the queue is
 * what is actually replayed to the authority — migrating only the log would
 * leave the replayed patch naming a field the model no longer has, which is the
 * precise failure this function exists to prevent.
 */
export function migrateSyncState(
  state: PersistedSyncState,
  plan: ModelMigrationPlan,
): PersistedSyncState {
  return {
    modelVersion: plan.to,
    queue: state.queue.map((entry) => {
      const operation = migrateLocalOperation(entry.operation, plan);
      return operation === entry.operation ? entry : { ...entry, operation };
    }),
    operations: state.operations.map((operation) => migrateLocalOperation(operation, plan)),
  };
}

function migrateLocalOperation(
  operation: LocalOperation,
  plan: ModelMigrationPlan,
): LocalOperation {
  if (operation.patch === undefined) {
    return operation;
  }

  const patch = plan.steps.reduce<Record<string, JsonValue>>((values, migration) => {
    const migrationObject = findMigrationObject(migration, operation.object);
    // `addField` is skipped for a patch: a patch is a set of changes, not a
    // whole record, and backfilling a default into it would assert a change the
    // user never made.
    return migrationObject === undefined
      ? values
      : applySteps(
          values,
          migrationObject.steps.filter((step) => step.kind !== "addField"),
        );
  }, operation.patch);

  return patch === operation.patch ? operation : { ...operation, patch };
}

/**
 * Applies one object's steps to a value map, returning the input itself when
 * nothing changed so callers can use identity to detect a no-op.
 */
function applySteps(
  values: Record<string, JsonValue>,
  steps: ResolvedModelMigrationStep[],
): Record<string, JsonValue> {
  let current = values;
  let changed = false;

  for (const step of steps) {
    if (step.kind === "renameField") {
      if (!(step.from in current)) {
        continue;
      }
      const next: Record<string, JsonValue> = {};
      // Rebuilt in order rather than deleted and re-added, so the renamed field
      // keeps its position and the canonical form of a record stays stable.
      for (const [key, value] of Object.entries(current)) {
        if (key === step.from) {
          next[step.to] = value;
        } else if (key !== step.to) {
          next[key] = value;
        }
      }
      current = next;
      changed = true;
      continue;
    }

    if (step.kind === "addField") {
      if (step.field in current) {
        continue;
      }
      current = { ...current, [step.field]: cloneJsonValue(step.defaultValue) };
      changed = true;
      continue;
    }

    if (!(step.field in current)) {
      continue;
    }
    const { [step.field]: _dropped, ...rest } = current;
    current = rest;
    changed = true;
  }

  return changed ? current : values;
}

function findMigrationObject(
  migration: ResolvedModelMigration,
  objectName: string,
): ResolvedModelMigrationObject | undefined {
  return migration.objects.find((entry) => entry.object === objectName);
}

/**
 * The object a persisted record belongs to. Record metadata wins over the store
 * it was found in, matching the startup guard, which reports a disagreement
 * between the two as its own error.
 */
function recordObjectName(persisted: PersistedObjectRecord): string {
  const declared = persisted.record.meta.object;
  return typeof declared === "string" && declared.length > 0 ? declared : persisted.objectName;
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return (
    value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value))
  ) as T;
}
