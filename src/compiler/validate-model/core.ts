import {
  MAX_OFFLINE_GRACE_DAYS,
  compareModelVersions,
  isValidModelVersion,
  normaliseModelVersion,
} from "../../model/defaults.js";
import type {
  ResolvedApplicationModel,
  ResolvedModelMigration,
  ResolvedModelMigrationObject,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic } from "./shared.js";
import type { ModelIndexes } from "./shared.js";

export function validateApplicationReferences(
  model: ResolvedApplicationModel,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (model.app.startView !== "" && !indexes.viewNames.has(model.app.startView)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.APP_START_VIEW_UNKNOWN,
        `Application start view '${model.app.startView}' does not exist.`,
        "app.startView",
      ),
    );
  }

  /*
   * A missing declaration resolves to the documented default, which is not a
   * surprise. A declared value that is not a whole number of days, is
   * non-positive, or exceeds the bound is refused here rather than silently
   * becoming the default or becoming a session lifetime nobody intended: this
   * value is also the authority's session lifetime.
   */
  const grace = model.app.offlineGraceDays;
  if (!Number.isSafeInteger(grace) || grace < 1 || grace > MAX_OFFLINE_GRACE_DAYS) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.APP_OFFLINE_GRACE_INVALID,
        `Application offline grace must be a whole number of days between 1 and ${MAX_OFFLINE_GRACE_DAYS}, but is '${String(grace)}'.`,
        "app.offlineGraceDays",
      ),
    );
  }

  /*
   * An application that admits strangers and grants none of them the ability
   * to create anything of their own is a door into an empty room: every
   * self-registered identity holds no membership and therefore no context
   * role, so unless *some* policy lets an `authenticated` (or `everyone`)
   * principal `create` an object that a business context is bound to, there is
   * nothing a newly admitted person can ever do.
   *
   * Warning, not error. It is not provably dead the way
   * `ADL_POLICY_ROLE_PRINCIPAL_UNREACHABLE` is: an application may legitimately
   * admit self-registered readers of an `everyone`-readable catalogue with no
   * context of their own, and refusing that would be wrong.
   */
  if (model.app.registration === "selfService") {
    const contextObjects = new Set((model.contexts ?? []).map((context) => context.object));
    const reachable = model.policies.some(
      (policy) =>
        contextObjects.has(policy.object) &&
        policy.rules.some(
          (rule) =>
            rule.effect === "allow" &&
            (rule.action === "create" || rule.action === "*") &&
            (rule.principal.match === "authenticated" || rule.principal.match === "everyone") &&
            rule.principal.roles.length === 0 &&
            rule.principal.groupRoles.length === 0 &&
            rule.principal.users.length === 0 &&
            rule.principal.contextMember === undefined,
        ),
    );
    if (!reachable) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.APP_SELF_SERVICE_REGISTRATION_UNREACHABLE,
          "Application declares REGISTRATION SELF_SERVICE, but no policy grants create to an authenticated or everyone principal on any object a business context is bound to, so a self-registered person could never create anything.",
          "app.registration",
          "warning",
        ),
      );
    }
  }

  if (!indexes.themesByName.has(model.app.theme)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.APP_THEME_UNKNOWN,
        `Application theme '${model.app.theme}' does not exist.`,
        "app.theme",
      ),
    );
  }
}
/**
 * Migrations are checked here rather than at execution time because an
 * unappliable migration discovered mid-startup is a refusal to serve, and an
 * author would rather find it at compile time. Everything asserted here is
 * statically decidable from the model alone; nothing here reads persisted data.
 */
export function validateModelMigrations(
  model: ResolvedApplicationModel,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!isValidModelVersion(model.modelVersion)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.MODEL_VERSION_INVALID,
        `Model version must be a dotted number such as '1.2.0', but is '${String(model.modelVersion)}'.`,
        "modelVersion",
      ),
    );
  }

  const seen = new Set<string>();
  // Versions that continue somewhere: the model's own, plus every declared hop's
  // origin. Anything a hop lands on that is outside this set is a dead end.
  const reachesModelVersion = new Set<string>([normaliseModelVersion(model.modelVersion)]);
  for (const migration of model.migrations) {
    reachesModelVersion.add(normaliseModelVersion(migration.from));
  }

  for (let index = 0; index < model.migrations.length; index += 1) {
    const migration = model.migrations[index];
    if (migration === undefined) {
      continue;
    }

    const path = `migrations[${index}]`;
    const versionsValid = isValidModelVersion(migration.from) && isValidModelVersion(migration.to);
    const movesForward = versionsValid && compareModelVersions(migration.from, migration.to) < 0;

    if (!versionsValid) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_VERSION_INVALID,
          `Migration '${migration.from}' to '${migration.to}' declares a version that is not a dotted number.`,
          path,
        ),
      );
    } else if (compareModelVersions(migration.from, migration.to) >= 0) {
      // A hop that does not move forward would either loop or silently undo a
      // later hop when the chain is walked.
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_NOT_FORWARD,
          `Migration '${migration.from}' to '${migration.to}' must move forward to a later version.`,
          path,
        ),
      );
    }

    const key = `${migration.from}\0${migration.to}`;
    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_DUPLICATE,
          `Migration '${migration.from}' to '${migration.to}' is declared more than once, so which one applies is undefined.`,
          path,
        ),
      );
    }
    seen.add(key);

    if (movesForward && compareModelVersions(migration.to, model.modelVersion) > 0) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_UNREACHABLE,
          `Migration '${migration.from}' to '${migration.to}' targets a version later than the model's own version '${model.modelVersion}', so it can never run.`,
          path,
        ),
      );
    } else if (movesForward && !reachesModelVersion.has(normaliseModelVersion(migration.to))) {
      // A hop that lands somewhere no further hop leaves is a chain that dead-ends
      // short of the model. It is exactly as statically decidable as the case
      // above, and it is what happens when an author bumps MODEL_VERSION and
      // forgets the new MIGRATION block — so finding it here rather than at
      // startup, on the one install that still holds the old data, matters.
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_UNREACHABLE,
          `Migration '${migration.from}' to '${migration.to}' leaves persisted data at '${migration.to}', which no further migration continues from and which is not the model's own version '${model.modelVersion}'.`,
          path,
        ),
      );
    }

    for (let objectIndex = 0; objectIndex < migration.objects.length; objectIndex += 1) {
      const migrationObject = migration.objects[objectIndex];
      if (migrationObject === undefined) {
        continue;
      }
      validateModelMigrationObject(
        migration,
        migrationObject,
        `${path}.objects[${objectIndex}]`,
        indexes,
        model,
        diagnostics,
      );
    }
  }
}
function validateModelMigrationObject(
  migration: ResolvedModelMigration,
  migrationObject: ResolvedModelMigrationObject,
  path: string,
  indexes: ModelIndexes,
  model: ResolvedApplicationModel,
  diagnostics: Diagnostic[],
): void {
  const object = indexes.objectsByName.get(migrationObject.object)?.item;

  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.MIGRATION_OBJECT_UNKNOWN,
        `Migration '${migration.from}' to '${migration.to}' migrates object '${migrationObject.object}', which does not exist in this model.`,
        `${path}.object`,
      ),
    );
    return;
  }

  // Only the final hop's schema version has to agree with the model, because
  // intermediate hops describe versions the model no longer is.
  const isFinalHop = migration.to === model.modelVersion;
  if (
    migrationObject.schemaVersion !== undefined &&
    isFinalHop &&
    migrationObject.schemaVersion !== object.schemaVersion
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.MIGRATION_SCHEMA_VERSION_INVALID,
        `Migration '${migration.from}' to '${migration.to}' leaves object '${object.name}' at schema version ${migrationObject.schemaVersion}, but the model expects ${object.schemaVersion}.`,
        `${path}.schemaVersion`,
      ),
    );
  }

  const fieldNames = new Set([
    ...object.fields.map((field) => field.name),
    ...object.computedFields.map((field) => field.name),
  ]);

  for (let stepIndex = 0; stepIndex < migrationObject.steps.length; stepIndex += 1) {
    const step = migrationObject.steps[stepIndex];
    if (step === undefined) {
      continue;
    }
    const stepPath = `${path}.steps[${stepIndex}]`;

    if (step.kind === "renameField") {
      // Only the last hop can be checked against the model's fields: an earlier
      // hop renames into a field a later hop may rename again or drop.
      if (isFinalHop && !fieldNames.has(step.to)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.MIGRATION_STEP_INVALID,
            `Migration '${migration.from}' to '${migration.to}' renames '${object.name}.${step.from}' to '${step.to}', which is not a field of '${object.name}'.`,
            stepPath,
          ),
        );
      }
      if (step.from === step.to) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.MIGRATION_STEP_INVALID,
            `Migration '${migration.from}' to '${migration.to}' renames '${object.name}.${step.from}' to itself.`,
            stepPath,
          ),
        );
      }
      continue;
    }

    if (step.kind === "addField") {
      if (isFinalHop && !fieldNames.has(step.field)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.MIGRATION_STEP_INVALID,
            `Migration '${migration.from}' to '${migration.to}' adds '${object.name}.${step.field}', which is not a field of '${object.name}'.`,
            stepPath,
          ),
        );
      }
      continue;
    }

    // A drop that leaves the field in the model would delete data the model
    // still expects records to carry.
    if (isFinalHop && fieldNames.has(step.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.MIGRATION_STEP_INVALID,
          `Migration '${migration.from}' to '${migration.to}' drops '${object.name}.${step.field}', but '${step.field}' is still a field of '${object.name}'.`,
          stepPath,
        ),
      );
    }
  }
}
