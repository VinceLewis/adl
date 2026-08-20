import type {
  PartialModelMigrationModel,
  PartialModelMigrationObjectModel,
  ResolvedModelMigration,
  ResolvedModelMigrationObject,
  ResolvedModelMigrationStep,
} from "../../model/resolved-model.js";
import { cloneJsonValue } from "./command.js";

export function resolveModelMigrations(
  input: PartialModelMigrationModel[],
): ResolvedModelMigration[] {
  return input.map((migration) => ({
    from: migration.from,
    to: migration.to,
    objects: (migration.objects ?? []).map(resolveModelMigrationObject),
  }));
}
function resolveModelMigrationObject(
  input: PartialModelMigrationObjectModel,
): ResolvedModelMigrationObject {
  return {
    object: input.object,
    ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
    steps: (input.steps ?? []).map(resolveModelMigrationStep),
  };
}
function resolveModelMigrationStep(input: ResolvedModelMigrationStep): ResolvedModelMigrationStep {
  if (input.kind === "renameField") {
    return { kind: "renameField", from: input.from, to: input.to };
  }

  if (input.kind === "addField") {
    return {
      kind: "addField",
      field: input.field,
      defaultValue: cloneJsonValue(input.defaultValue),
    };
  }

  return { kind: "dropField", field: input.field };
}
