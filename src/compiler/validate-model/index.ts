import type { ResolvedApplicationModel } from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { indexByName, reportDuplicateNames } from "./shared.js";
import type { ModelIndexes } from "./shared.js";
import { validateApplicationReferences, validateModelMigrations } from "./core.js";
import { validateShell } from "./shell.js";
import { validateBusinessContext } from "./context.js";
import { validateObject } from "./object-field.js";
import { validatePolicy } from "./policy.js";
import { validateReadModel } from "./read-model.js";
import { validateDecisionTable } from "./decision-table.js";
import { validateCommand } from "./command.js";
import { validateTheme } from "./theme.js";
import { validateSyncPolicy } from "./sync.js";

export * from "./codes.js";

export function validateApplicationModel(model: ResolvedApplicationModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const indexes: ModelIndexes = {
    contextsByName: indexByName(model.contexts ?? []),
    rolesByName: indexByName(model.roles),
    commandsByName: indexByName(model.commands ?? []),
    decisionTablesByName: indexByName(model.decisionTables ?? []),
    objectsByName: indexByName(model.objects),
    policiesByName: indexByName(model.policies),
    readModelsByName: indexByName(model.readModels ?? []),
    themesByName: indexByName(model.themes),
    viewNames: new Set(model.objects.flatMap((object) => object.views.map((view) => view.name))),
  };

  reportDuplicateNames(
    model.contexts ?? [],
    "contexts",
    MODEL_VALIDATION_CODES.CONTEXT_DUPLICATE,
    diagnostics,
    "Business context names must be unique.",
  );
  reportDuplicateNames(
    model.objects,
    "objects",
    MODEL_VALIDATION_CODES.OBJECT_DUPLICATE,
    diagnostics,
    "Object names must be unique.",
  );
  reportDuplicateNames(
    model.policies,
    "policies",
    MODEL_VALIDATION_CODES.POLICY_DUPLICATE,
    diagnostics,
    "Policy names must be unique.",
  );
  reportDuplicateNames(
    model.readModels ?? [],
    "readModels",
    MODEL_VALIDATION_CODES.READ_MODEL_DUPLICATE,
    diagnostics,
    "Read model names must be unique.",
  );
  reportDuplicateNames(
    model.commands ?? [],
    "commands",
    MODEL_VALIDATION_CODES.COMMAND_DUPLICATE,
    diagnostics,
    "Command names must be unique.",
  );
  reportDuplicateNames(
    model.decisionTables ?? [],
    "decisionTables",
    MODEL_VALIDATION_CODES.DECISION_TABLE_DUPLICATE,
    diagnostics,
    "Decision table names must be unique.",
  );
  reportDuplicateNames(
    model.themes,
    "themes",
    MODEL_VALIDATION_CODES.THEME_DUPLICATE,
    diagnostics,
    "Theme names must be unique.",
  );

  validateApplicationReferences(model, indexes, diagnostics);
  validateModelMigrations(model, indexes, diagnostics);
  validateShell(model.shell, indexes, diagnostics);

  for (let contextIndex = 0; contextIndex < (model.contexts ?? []).length; contextIndex += 1) {
    const context = model.contexts?.[contextIndex];
    if (context === undefined) {
      continue;
    }
    validateBusinessContext(context, contextIndex, indexes, diagnostics);
  }

  for (let objectIndex = 0; objectIndex < model.objects.length; objectIndex += 1) {
    const object = model.objects[objectIndex];
    if (object === undefined) {
      continue;
    }
    validateObject(object, objectIndex, indexes, diagnostics);
  }

  for (let policyIndex = 0; policyIndex < model.policies.length; policyIndex += 1) {
    const policy = model.policies[policyIndex];
    if (policy === undefined) {
      continue;
    }
    validatePolicy(policy, policyIndex, indexes, diagnostics);
  }

  for (
    let readModelIndex = 0;
    readModelIndex < (model.readModels ?? []).length;
    readModelIndex += 1
  ) {
    const readModel = model.readModels?.[readModelIndex];
    if (readModel === undefined) {
      continue;
    }
    validateReadModel(readModel, readModelIndex, indexes, diagnostics);
  }

  for (let commandIndex = 0; commandIndex < (model.commands ?? []).length; commandIndex += 1) {
    const command = model.commands?.[commandIndex];
    if (command === undefined) {
      continue;
    }
    validateCommand(command, commandIndex, indexes, diagnostics);
  }

  for (let tableIndex = 0; tableIndex < (model.decisionTables ?? []).length; tableIndex += 1) {
    const table = model.decisionTables?.[tableIndex];
    if (table === undefined) {
      continue;
    }
    validateDecisionTable(table, tableIndex, indexes, diagnostics);
  }

  for (let themeIndex = 0; themeIndex < model.themes.length; themeIndex += 1) {
    const theme = model.themes[themeIndex];
    if (theme === undefined) {
      continue;
    }
    validateTheme(theme, themeIndex, indexes, diagnostics);
  }

  for (let syncIndex = 0; syncIndex < model.sync.length; syncIndex += 1) {
    const sync = model.sync[syncIndex];
    if (sync === undefined) {
      continue;
    }
    validateSyncPolicy(sync, `sync[${syncIndex}]`, indexes, diagnostics);
  }

  return diagnostics;
}
