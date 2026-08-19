/**
 * Prints canonical `.adl` text from a `PartialApplicationModel` (Phase 73).
 * Operates on `PartialApplicationModel` rather than `ResolvedApplicationModel`
 * because that is the stage `.adl` text itself parses down to — printing from
 * the fully resolved model would restate every platform default the author
 * never wrote (every object's `THEME` spelled out, for example), which is
 * not what a human would plausibly have typed.
 *
 * Generation is one-directional: this prints canonical `.adl` text, it does
 * not read `.adl` text back into a `PartialApplicationModel` (that is
 * `parseAdl` + `adlAstToPartialApplicationModel`, unchanged and reused
 * as-is). A generated `.adl` file is not meant to be hand-edited afterward;
 * see `docs/spec/adlj.md`.
 *
 * Coverage: the full declarative skeleton (`APP`, `ROLE`, `CONTEXT`,
 * `CONTEXT_GRANT`, `OBJECT` — fields, computed fields, validations,
 * lifecycle, constraints, scope, sync — `READ_MODEL`, `DECISION_TABLE`,
 * `COMMAND`, `POLICY`, `THEME`, top-level `SYNC`, `MIGRATION`) and every
 * expression-bearing field (`ResolvedExpression`/`PartialPolicyConditionModel`
 * printed back to infix syntax). Composed view presentation
 * (`PartialViewModel.presentation`) and edit surfaces
 * (`editContainer`/`editSections`) are not printed — `printView` throws a
 * clear error naming the gap rather than silently dropping that content.
 * Named as a candidate for a future phase, not attempted here.
 */
import type {
  JsonValue,
  PartialApplicationModel,
  PartialBusinessContextModel,
  PartialCommandModel,
  PartialCommandStepModel,
  PartialContextGrantModel,
  PartialDecisionTableModel,
  PartialFieldModel,
  PartialLifecycleActionModel,
  PartialLifecycleModel,
  PartialObjectConstraintModel,
  PartialObjectModel,
  PartialPolicyConditionModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialReadModelModel,
  PartialRoleModel,
  PartialSyncPolicyModel,
  PartialThemeModel,
  PartialValidatorModel,
  PartialViewModel,
  ResolvedCommandValueExpression,
  ResolvedExpression,
  ResolvedPolicyCondition,
  ResolvedSort,
} from "../model/resolved-model.js";

export function printPartialApplicationModelAsAdl(model: PartialApplicationModel): string {
  const blocks: string[] = [printApp(model)];

  for (const role of model.roles ?? []) {
    blocks.push(printRole(role));
  }
  for (const context of model.contexts ?? []) {
    blocks.push(printContext(context));
  }
  blocks.push(...printContextGrants(model.contexts ?? []));
  for (const object of model.objects) {
    blocks.push(printObject(object));
  }
  for (const readModel of model.readModels ?? []) {
    blocks.push(printReadModel(readModel));
  }
  for (const table of model.decisionTables ?? []) {
    blocks.push(printDecisionTable(table));
  }
  for (const command of model.commands ?? []) {
    blocks.push(printCommand(command));
  }
  for (const policy of model.policies ?? []) {
    blocks.push(printPolicy(policy));
  }
  for (const theme of model.themes ?? []) {
    blocks.push(printTheme(theme));
  }
  for (const sync of model.sync ?? []) {
    blocks.push(printTopLevelSync(sync));
  }

  return blocks.join("\n\n") + "\n";
}

// --- literals and expressions -----------------------------------------------

function printLiteralValue(value: JsonValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return printStringLiteral(value);
  }
  throw new Error(
    `printPartialApplicationModelAsAdl: cannot print a ${Array.isArray(value) ? "list" : "object"} literal value directly; only text/number/boolean/null are supported.`,
  );
}

function printStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `'${escaped}'`;
}

const BINARY_OPERATOR_TEXT: Record<string, string> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "==": "==",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  and: "AND",
  or: "OR",
  in: "IN",
  "??": "??",
};

/**
 * Prints a `ResolvedExpression` back to infix `.adl` syntax. Every compound
 * sub-expression (binary, unary) is wrapped in parentheses unconditionally
 * rather than replicating the parser's precedence table — this costs some
 * readability but guarantees the printed text reparses to the identical
 * tree, which is the printer's actual contract.
 */
export function printExpression(expression: ResolvedExpression, topLevel = false): string {
  switch (expression.kind) {
    case "literal":
      return printLiteralValue(expression.value);
    case "field":
      return expression.field;
    case "runtime":
      return `RUNTIME.${expression.property}`;
    case "unary": {
      const operand = printExpression(expression.operand);
      const text = expression.operator === "not" ? `NOT ${operand}` : `-${operand}`;
      return topLevel ? text : `(${text})`;
    }
    case "binary": {
      const left = printExpression(expression.left);
      const right = printExpression(expression.right);
      const operator = BINARY_OPERATOR_TEXT[expression.operator] ?? expression.operator;
      const text = `${left} ${operator} ${right}`;
      return topLevel ? text : `(${text})`;
    }
  }
}

/**
 * `PartialPolicyConditionModel` also legally carries the pre-Phase-20
 * `ResolvedPolicyCondition` (`equals`/`all`/`any`/`not`) shape as
 * partial-model compatibility input. The printer refuses it rather than
 * translating it: nothing in this codebase authors that shape any more
 * (`resolveApplicationModel` normalises it away), so a model carrying one is
 * either hand-built test input or already-stale content, not something a
 * printed `.adl` file should silently launder into the modern form.
 */
export function printCondition(condition: PartialPolicyConditionModel, topLevel = false): string {
  if (isResolvedExpression(condition)) {
    return printExpression(condition, topLevel);
  }
  throw new Error(
    "printPartialApplicationModelAsAdl: the legacy ResolvedPolicyCondition shape (equals/all/any/not) is not supported. Use a ResolvedExpression.",
  );
}

function isResolvedExpression(
  condition: ResolvedExpression | ResolvedPolicyCondition,
): condition is ResolvedExpression {
  return (
    condition.kind === "literal" ||
    condition.kind === "field" ||
    condition.kind === "runtime" ||
    condition.kind === "unary" ||
    condition.kind === "binary"
  );
}

// --- APP / ROLE / CONTEXT ---------------------------------------------------

function printApp(model: PartialApplicationModel): string {
  const lines = [`APP ${model.app.name}`];
  if (model.app.theme !== undefined) {
    lines.push(`  THEME ${model.app.theme}`);
  }
  if (model.app.startView !== undefined) {
    lines.push(`  START_VIEW ${model.app.startView}`);
  }
  if (model.app.offlineGraceDays !== undefined) {
    lines.push(`  OFFLINE_GRACE ${model.app.offlineGraceDays} DAYS`);
  }
  if (model.modelVersion !== undefined) {
    lines.push(`  MODEL_VERSION ${printStringLiteral(model.modelVersion)}`);
  }
  lines.push("END.APP");
  return lines.join("\n");
}

function printRole(role: PartialRoleModel): string {
  let line = `ROLE ${role.name}`;
  if (role.inherits !== undefined && role.inherits.length > 0) {
    line += ` INHERITS ${role.inherits.join(", ")}`;
  }
  if (role.description !== undefined) {
    line += ` DESCRIPTION ${printStringLiteral(role.description)}`;
  }
  return line;
}

function printContext(context: PartialBusinessContextModel): string {
  const lines = [`CONTEXT ${context.name}`];
  if (context.object !== undefined) {
    lines.push(`  OBJECT ${context.object}`);
  }
  if (context.selection !== undefined) {
    const parts: string[] = [];
    if (context.selection.mode !== undefined) {
      parts.push(context.selection.mode.toUpperCase());
    }
    if (context.selection.autoSelect === true) {
      parts.push("AUTO_SELECT");
    }
    if (context.selection.persistence !== undefined) {
      parts.push(`PERSISTENCE ${context.selection.persistence.toUpperCase()}`);
    }
    if (context.selection.source !== undefined) {
      parts.push(`SOURCE ${context.selection.source.toUpperCase()}`);
    }
    if (context.selection.routeParam !== undefined) {
      parts.push(`ROUTE_PARAM ${context.selection.routeParam}`);
    }
    lines.push(`  SELECTION ${parts.join(" ")}`);
  }
  if (context.membership !== undefined) {
    const membership = context.membership;
    lines.push(
      `  MEMBERSHIP ${membership.object} USER ${membership.userField} CONTEXT_FIELD ${membership.contextField} ROLE_FIELD ${membership.roleField}` +
        (membership.roles !== undefined && membership.roles.length > 0
          ? ` ROLES ${membership.roles.join(" ")}`
          : ""),
    );
  }
  lines.push("END.CONTEXT");
  return lines.join("\n");
}

function printContextGrants(contexts: PartialBusinessContextModel[]): string[] {
  const blocks: string[] = [];
  for (const context of contexts) {
    for (const grant of context.grants ?? []) {
      blocks.push(printContextGrant(context.name, grant));
    }
  }
  return blocks;
}

function printContextGrant(contextName: string, grant: PartialContextGrantModel): string {
  let line = `CONTEXT_GRANT ${grant.name} ON ${contextName} OBJECT ${grant.object} USER ${grant.userField} CONTEXT_FIELD ${grant.contextField}`;
  if (grant.condition !== undefined) {
    line += ` WHEN ${printCondition(grant.condition, true)}`;
  }
  return line;
}

// --- OBJECT ------------------------------------------------------------------

function printObject(object: PartialObjectModel): string {
  const lines = [`OBJECT ${object.name}`];
  if (object.schemaVersion !== undefined) {
    lines.push(`  SCHEMA_VERSION ${object.schemaVersion}`);
  }
  if (object.businessKey !== undefined) {
    lines.push(`  KEY ${object.businessKey}`);
  }
  if (object.displayField !== undefined) {
    lines.push(`  DISPLAY ${object.displayField}`);
  }
  if (object.scope !== undefined) {
    lines.push(`  SCOPE ${object.scope.context} FIELD ${object.scope.field}`);
  }
  for (const constraint of object.constraints ?? []) {
    lines.push(`  ${printObjectConstraint(constraint)}`);
  }
  for (const field of object.fields ?? []) {
    lines.push(`  ${printField(field)}`);
  }
  for (const computed of object.computedFields ?? []) {
    lines.push(
      `  COMPUTED FIELD ${computed.name} ${computed.type.toUpperCase()} = ${printExpression(computed.expression, true)}`,
    );
  }
  for (const validation of object.validations ?? []) {
    let line = `  VALIDATE ${validation.name} ${printCondition(validation.expression, true)}`;
    if (validation.message !== undefined) {
      line += ` MESSAGE ${printStringLiteral(validation.message)}`;
    }
    lines.push(line);
  }
  if (object.lifecycle !== undefined) {
    lines.push(indentBlock(printLifecycle(object.lifecycle), "  "));
  }
  for (const view of object.views ?? []) {
    lines.push(indentBlock(printView(view), "  "));
  }
  if (object.sync !== undefined) {
    lines.push(`  ${printSyncClause(object.sync)}`);
  }
  lines.push("END.OBJECT");
  return lines.join("\n");
}

function printObjectConstraint(constraint: PartialObjectConstraintModel): string {
  if (constraint.kind === "unique") {
    let line = `CONSTRAINT ${constraint.name} UNIQUE`;
    if (constraint.scopeFields !== undefined && constraint.scopeFields.length > 0) {
      line += ` SCOPE ${constraint.scopeFields.join(" ")}`;
    }
    line += ` FIELDS ${constraint.fields.join(" ")}`;
    return line;
  }
  if (constraint.kind === "ordered") {
    let line = `CONSTRAINT ${constraint.name} ORDERED`;
    if (constraint.scopeFields !== undefined && constraint.scopeFields.length > 0) {
      line += ` SCOPE ${constraint.scopeFields.join(" ")}`;
    }
    line += ` PARENT ${constraint.parentField} POSITION ${constraint.positionField}`;
    if (constraint.reorder !== undefined) {
      line += ` REORDER ${constraint.reorder}`;
    }
    if (constraint.compaction !== undefined) {
      line += ` COMPACT ${constraint.compaction}`;
    }
    if (constraint.minPosition !== undefined) {
      line += ` MIN_POSITION(${constraint.minPosition})`;
    }
    return line;
  }
  let line = `CONSTRAINT ${constraint.name} PROTECTED_ROLE`;
  if (constraint.scopeFields !== undefined && constraint.scopeFields.length > 0) {
    line += ` SCOPE ${constraint.scopeFields.join(" ")}`;
  }
  line += ` FIELD ${constraint.roleField} VALUES (${constraint.roleValues.map((value) => printLiteralValue(value)).join(", ")})`;
  if (constraint.minCount !== undefined) {
    line += ` MIN(${constraint.minCount})`;
  }
  return line;
}

function printField(field: PartialFieldModel): string {
  const parts = [`FIELD ${field.name}`, printFieldType(field)];
  if (field.required === true) {
    parts.push("REQUIRED");
  }
  if (field.defaultValue !== undefined) {
    parts.push(`DEFAULT(${printLiteralValue(field.defaultValue)})`);
  }
  for (const validator of field.validators ?? []) {
    parts.push(printValidator(validator));
  }
  if (field.readonly === true) {
    parts.push("READONLY");
  }
  if (field.hidden === true) {
    parts.push("HIDDEN");
  }
  if (field.lookup !== undefined) {
    let lookup = `LOOKUP ${field.lookup.targetObject}`;
    if (field.lookup.targetField !== undefined) {
      lookup += ` TARGET_FIELD ${field.lookup.targetField}`;
    }
    lookup += ` DISPLAY ${field.lookup.displayField}`;
    parts.push(lookup);
  }
  if (field.autoId !== undefined) {
    parts.push("AUTO_ID");
    if (field.autoId.prefix !== undefined) {
      parts.push(`PREFIX(${printStringLiteral(field.autoId.prefix)})`);
    }
    if (field.autoId.pad !== undefined) {
      parts.push(`PAD(${field.autoId.pad})`);
    }
    if (field.autoId.scopeField !== undefined) {
      parts.push(`SCOPE ${field.autoId.scopeField}`);
    }
  }
  return parts.join(" ");
}

function printFieldType(field: PartialFieldModel): string {
  const type = (field.type ?? "text").toUpperCase();
  return type;
}

function printValidator(validator: PartialValidatorModel): string {
  if (validator.kind === "predicate") {
    let text = `VALIDATE ${printCondition(validator.expression, true)}`;
    if (validator.message !== undefined) {
      text += ` MESSAGE ${printStringLiteral(validator.message)}`;
    }
    return text;
  }

  const keyword = NAMED_VALIDATOR_KEYWORDS[validator.kind] ?? validator.kind.toUpperCase();
  if (validator.value === undefined) {
    return keyword;
  }
  if (Array.isArray(validator.value)) {
    return `${keyword} (${validator.value.map((value) => printLiteralValue(value)).join(", ")})`;
  }
  return `${keyword}(${printLiteralValue(validator.value)})`;
}

const NAMED_VALIDATOR_KEYWORDS: Record<string, string> = {
  email: "EMAIL",
  min: "MIN",
  max: "MAX",
  minLength: "MIN_LENGTH",
  maxLength: "MAX_LENGTH",
  in: "IN",
  regexp: "REGEXP",
  currencyCode: "CURRENCY_CODE",
  maxSize: "MAX_SIZE",
  mimeType: "MIME_TYPE",
};

function printLifecycle(lifecycle: PartialLifecycleModel): string {
  const lines = [`LIFECYCLE ${lifecycle.name}`];
  if (lifecycle.stateField !== undefined) {
    lines[0] += ` FIELD ${lifecycle.stateField}`;
  }
  if (lifecycle.initialState !== undefined) {
    lines[0] += ` INITIAL ${lifecycle.initialState}`;
  }
  for (const state of lifecycle.states) {
    lines.push(`  STATE ${state.name}${state.terminal === true ? " TERMINAL" : ""}`);
  }
  for (const action of lifecycle.actions ?? []) {
    lines.push(indentBlock(printLifecycleAction(action), "  "));
  }
  lines.push("END.LIFECYCLE");
  return lines.join("\n");
}

function printLifecycleAction(action: PartialLifecycleActionModel): string {
  const from = Array.isArray(action.from) ? `(${action.from.join(", ")})` : `(${action.from})`;
  let header = `ACTION ${action.name} FROM ${from} TO ${action.to}`;
  if (action.label !== undefined) {
    header += ` LABEL ${printStringLiteral(action.label)}`;
  }
  const lines = [header];
  for (const guard of action.guards ?? []) {
    let line = `  WHEN ${printCondition(guard.expression, true)}`;
    if (guard.message !== undefined) {
      line += ` MESSAGE ${printStringLiteral(guard.message)}`;
    }
    lines.push(line);
  }
  for (const ref of action.policyRefs ?? []) {
    lines.push(`  POLICY ${ref}`);
  }
  if (action.hooks !== undefined) {
    if (action.hooks.before !== undefined && action.hooks.before.length > 0) {
      lines.push(`  BEFORE ${action.hooks.before.join(", ")}`);
    }
    if (action.hooks.after !== undefined && action.hooks.after.length > 0) {
      lines.push(`  AFTER ${action.hooks.after.join(", ")}`);
    }
    if (action.hooks.onError !== undefined && action.hooks.onError.length > 0) {
      lines.push(`  ON_ERROR ${action.hooks.onError.join(", ")}`);
    }
  }
  lines.push("END.ACTION");
  return lines.join("\n");
}

/**
 * A view with composed presentation or an edit surface has no printer yet
 * (see the module doc comment). Every other view shape — plain field
 * lists, search fields, sort, actions, context, and a `READ_MODEL`
 * binding — prints normally.
 */
function printView(view: PartialViewModel): string {
  if (
    view.presentation !== undefined ||
    view.editSections !== undefined ||
    view.editContainer !== undefined
  ) {
    throw new Error(
      `printPartialApplicationModelAsAdl: view '${view.name}' declares composed presentation or an edit surface, which this printer does not yet support.`,
    );
  }

  const lines = [`VIEW ${view.name} ${camelToUpperSnake(view.kind)}`];
  if (view.context !== undefined) {
    lines.push(
      `  CONTEXT ${view.context.mode.toUpperCase()}${view.context.context === undefined ? "" : ` ${view.context.context}`}`,
    );
  }
  if (view.readModel !== undefined) {
    lines.push(`  READ_MODEL ${view.readModel}`);
  }
  if (view.fields !== undefined && view.fields.length > 0) {
    lines.push(`  FIELDS ${view.fields.join(" ")}`);
  }
  if (view.searchFields !== undefined && view.searchFields.length > 0) {
    lines.push(`  SEARCH ${view.searchFields.join(" ")}`);
  }
  if (view.sort !== undefined && view.sort.length > 0) {
    lines.push(`  SORT ${printSortList(view.sort)}`);
  }
  if (view.actions !== undefined && view.actions.length > 0) {
    lines.push(`  ACTIONS ${view.actions.join(" ")}`);
  }
  lines.push("END.VIEW");
  return lines.join("\n");
}

function printSortList(sort: ResolvedSort[]): string {
  return sort.map((entry) => `${entry.field} ${entry.direction.toUpperCase()}`).join(", ");
}

function printSyncClause(sync: {
  mode?: string;
  scope?: string;
  window?: { field?: string; days?: number; limit?: number };
  predicate?: ResolvedExpression;
  conflict?: string;
}): string {
  const parts = ["SYNC"];
  if (sync.mode !== undefined) {
    parts.push(camelToUpperSnake(sync.mode));
  }
  if (sync.scope !== undefined) {
    parts.push(`SCOPE ${sync.scope}`);
  }
  if (sync.window !== undefined) {
    const windowParts = ["WINDOW"];
    if (sync.window.field !== undefined) {
      windowParts.push(sync.window.field);
    }
    if (sync.window.days !== undefined) {
      windowParts.push(`${sync.window.days} DAYS`);
    }
    if (sync.window.limit !== undefined) {
      windowParts.push(`LIMIT ${sync.window.limit}`);
    }
    parts.push(windowParts.join(" "));
  }
  if (sync.predicate !== undefined) {
    parts.push(`WHERE ${printExpression(sync.predicate, true)}`);
  }
  if (sync.conflict !== undefined) {
    parts.push(`CONFLICT ${sync.conflict}`);
  }
  return parts.join(" ");
}

function printTopLevelSync(sync: PartialSyncPolicyModel): string {
  const { object, ...rest } = sync;
  return printSyncClause(rest).replace(/^SYNC /, `SYNC ${object} `);
}

// --- READ_MODEL ----------------------------------------------------------

function printReadModel(readModel: PartialReadModelModel): string {
  const lines = [`READ_MODEL ${readModel.name}`];
  if (readModel.context !== undefined) {
    lines.push(
      `  CONTEXT ${readModel.context.mode.toUpperCase()}${readModel.context.context === undefined ? "" : ` ${readModel.context.context}`}`,
    );
  }
  if (readModel.strategy !== undefined) {
    lines.push(`  STRATEGY ${readModel.strategy.toUpperCase()}`);
  }
  for (const source of readModel.sources) {
    let line = `  SOURCE ${source.name ?? source.object} OBJECT ${source.object}`;
    if (source.scope !== undefined) {
      line += ` SCOPE ${source.scope}`;
    }
    if (source.join !== undefined) {
      line += ` JOIN ${source.join.source} ON ${source.join.localField} == ${source.join.sourceField}`;
      if (source.join.cardinality !== undefined) {
        line += ` CARDINALITY ${source.join.cardinality}`;
      }
    }
    lines.push(line);
  }
  for (const field of readModel.fields) {
    if (field.expression !== undefined) {
      lines.push(`  FIELD ${field.name} = ${printCondition(field.expression, true)}`);
    } else if (field.source !== undefined && field.field !== undefined) {
      lines.push(`  FIELD ${field.name} FROM ${field.source}.${field.field}`);
    } else {
      throw new Error(
        `printPartialApplicationModelAsAdl: read model '${readModel.name}' field '${field.name}' has neither a source.field reference nor an expression.`,
      );
    }
  }
  if (readModel.sort !== undefined && readModel.sort.length > 0) {
    lines.push(`  SORT ${printSortList(readModel.sort)}`);
  }
  lines.push("END.READ_MODEL");
  return lines.join("\n");
}

// --- DECISION_TABLE ------------------------------------------------------

function printDecisionTable(table: PartialDecisionTableModel): string {
  const lines = [
    `DECISION_TABLE ${table.name} ON ${table.object} MATCH ${(table.match ?? "first").toUpperCase()}`,
  ];
  for (const input of table.inputs ?? []) {
    lines.push(`  INPUT ${input.name} = ${printCondition(input.expression, true)}`);
  }
  for (const row of table.rows ?? []) {
    lines.push(
      `  ROW ${row.name} WHEN ${printCondition(row.condition, true)} OUTPUT ${printOutputMap(row.outputs ?? {})}`,
    );
  }
  if (table.defaultOutputs !== undefined) {
    lines.push(`  DEFAULT OUTPUT ${printOutputMap(table.defaultOutputs)}`);
  }
  lines.push("END.DECISION_TABLE");
  return lines.join("\n");
}

function printOutputMap(outputs: Record<string, JsonValue>): string {
  return Object.entries(outputs)
    .map(([key, value]) => `${key} ${printLiteralValue(value)}`)
    .join(", ");
}

// --- COMMAND ---------------------------------------------------------------

function printCommand(command: PartialCommandModel): string {
  const lines = [
    `COMMAND ${command.name}${command.label === undefined ? "" : ` LABEL ${printStringLiteral(command.label)}`}`,
  ];
  for (const input of command.inputs ?? []) {
    let line = `  INPUT ${input.name}`;
    if (input.repeated === true) {
      line += " LIST";
    }
    if (input.type !== undefined) {
      line += ` ${input.type.toUpperCase()}`;
    }
    line += input.required === false ? " OPTIONAL" : " REQUIRED";
    if (input.defaultValue !== undefined) {
      line += ` DEFAULT(${printLiteralValue(input.defaultValue)})`;
    }
    lines.push(line);
  }
  for (const precondition of command.preconditions ?? []) {
    let line = `  REQUIRE ${printCondition(precondition.expression, true)}`;
    if (precondition.message !== undefined) {
      line += ` MESSAGE ${printStringLiteral(precondition.message)}`;
    }
    lines.push(line);
  }
  for (const step of command.steps ?? []) {
    lines.push(indentBlock(printCommandStep(step), "  "));
  }
  lines.push("END.COMMAND");
  return lines.join("\n");
}

function printCommandStep(step: PartialCommandStepModel): string {
  let header = `STEP ${step.name} ${step.action.toUpperCase()} ${step.object}`;
  if (step.action !== "read" && step.authority !== undefined) {
    header += ` AUTHORITY ${step.authority}`;
  }
  if (step.action === "read" || step.action === "update") {
    header += ` ID ${printCommandValueExpression(step.recordId)}`;
  }
  if (step.action !== "read" && step.forEach !== undefined) {
    header += ` FOR EACH ${step.forEach}`;
  }
  if (step.action === "create" && step.establishesContext !== undefined) {
    header += ` ESTABLISHES CONTEXT ${step.establishesContext}`;
  }
  const lines = [header];

  if (step.action === "create" && step.values !== undefined) {
    for (const [field, value] of Object.entries(step.values)) {
      lines.push(`  VALUE ${field} ${printCommandValueExpression(value)}`);
    }
  }
  if (step.action === "update" && step.patch !== undefined) {
    for (const [field, value] of Object.entries(step.patch)) {
      lines.push(`  VALUE ${field} ${printCommandValueExpression(value)}`);
    }
  }
  for (const precondition of step.preconditions ?? []) {
    lines.push(`  REQUIRE ${printCondition(precondition, true)}`);
  }
  lines.push("END.STEP");
  return lines.join("\n");
}

function printCommandValueExpression(value: ResolvedCommandValueExpression): string {
  switch (value.kind) {
    case "literal":
      return `LITERAL ${printLiteralValue(value.value)}`;
    case "input":
      return `INPUT ${value.name}`;
    case "runtime":
      return `RUNTIME ${value.property}`;
    case "stepField":
      return `STEP ${value.step} FIELD ${value.field}`;
    case "stepMeta":
      return `STEP ${value.step} META ${value.property}`;
    case "item":
      return value.field === undefined ? "ITEM" : `ITEM ${value.field}`;
    case "itemIndex":
      return "ITEM_INDEX";
  }
}

// --- POLICY ------------------------------------------------------------------

function printPolicy(policy: PartialPolicyModel): string {
  const lines = [`POLICY ${policy.name} ON ${policy.object}`];
  if (policy.defaultEffect !== undefined) {
    lines.push(`  DEFAULT_EFFECT ${policy.defaultEffect.toUpperCase()}`);
  }
  for (const rule of policy.rules ?? []) {
    lines.push(`  ${printPolicyRule(rule)}`);
  }
  lines.push("END.POLICY");
  return lines.join("\n");
}

function printPolicyRule(rule: PartialPolicyRuleModel): string {
  const parts = [
    `RULE ${rule.name} ${rule.effect.toUpperCase()} ${rule.action === "*" ? "ALL" : rule.action.toUpperCase()}`,
  ];
  parts.push(printPrincipal(rule.principal));
  if (rule.state !== undefined && (Array.isArray(rule.state) ? rule.state.length > 0 : true)) {
    const states = Array.isArray(rule.state) ? rule.state.join(" ") : rule.state;
    parts.push(`STATE ${states}`);
  }
  if (rule.fields !== undefined && rule.fields.length > 0) {
    parts.push(`FIELDS ${rule.fields.join(" ")}`);
  }
  if (rule.lifecycleAction !== undefined) {
    parts.push(`ACTION ${rule.lifecycleAction}`);
  }
  if (rule.condition !== undefined) {
    parts.push(`WHEN ${printCondition(rule.condition, true)}`);
  }
  if (rule.channels !== undefined && rule.channels.length > 0) {
    parts.push(`CHANNELS ${rule.channels.join(" ")}`);
  }
  return parts.join(" ");
}

function printPrincipal(principal: PartialPolicyRuleModel["principal"]): string {
  if (principal === undefined || principal.match === undefined || principal.match === "everyone") {
    return "EVERYONE";
  }
  switch (principal.match) {
    case "authenticated":
      return "AUTHENTICATED";
    case "anonymous":
      return "ANONYMOUS";
    case "owner":
      return "OWNER";
    case "contextMember": {
      if (principal.contextMember === undefined) {
        throw new Error(
          "printPartialApplicationModelAsAdl: a contextMember principal must declare contextMember.",
        );
      }
      return `CONTEXT_MEMBER ${principal.contextMember.context} FIELD ${principal.contextMember.field}`;
    }
    case "specific": {
      const parts: string[] = [];
      if (principal.roles !== undefined && principal.roles.length > 0) {
        parts.push(`ROLE ${principal.roles.join(" ")}`);
      }
      if (principal.groupRoles !== undefined && principal.groupRoles.length > 0) {
        parts.push(`GROUP_ROLE ${principal.groupRoles.join(" ")}`);
      }
      if (principal.users !== undefined && principal.users.length > 0) {
        parts.push(`USER ${principal.users.join(" ")}`);
      }
      if (principal.owner === true) {
        parts.push("OWNER");
      }
      if (parts.length === 0) {
        throw new Error(
          "printPartialApplicationModelAsAdl: a 'specific' principal must declare roles, groupRoles, users, or owner.",
        );
      }
      return parts.join(" ");
    }
  }
}

// --- THEME -------------------------------------------------------------------

function printTheme(theme: PartialThemeModel): string {
  const lines = [`THEME ${theme.name}${theme.base === undefined ? "" : ` BASE ${theme.base}`}`];
  for (const [token, value] of Object.entries(theme.tokens ?? {})) {
    if (typeof value === "string") {
      lines.push(`  ${printThemeTokenName(token)} ${printThemeTokenValue(token, value)}`);
    }
  }
  lines.push("END.THEME");
  return lines.join("\n");
}

const THEME_TOKEN_KEYWORDS: Record<string, string> = {
  colorPrimary: "PRIMARY",
  colorAccent: "ACCENT",
  colorBackground: "BACKGROUND",
  colorSurface: "SURFACE",
  colorSurfaceAlt: "SURFACE_ALT",
  colorText: "TEXT",
  colorTextMuted: "TEXT_MUTED",
  colorTextInverted: "TEXT_INVERTED",
  colorBorder: "BORDER",
  colorDanger: "DANGER",
  colorSuccess: "SUCCESS",
  colorInfo: "INFO",
  colorStatusEvent: "STATUS_EVENT",
  colorStatusAlternate: "STATUS_ALTERNATE",
  colorStatusAvailable: "STATUS_AVAILABLE",
  colorStatusUnavailable: "STATUS_UNAVAILABLE",
  colorStatusBusyElsewhere: "STATUS_BUSY_ELSEWHERE",
  colorStatusConflict: "STATUS_CONFLICT",
  colorStatusUnset: "STATUS_UNSET",
  radius: "RADIUS",
  density: "DENSITY",
  nav: "NAV",
  fontFamily: "FONT",
  logoUrl: "LOGO_URL",
};

function printThemeTokenName(token: string): string {
  return THEME_TOKEN_KEYWORDS[token] ?? token.toUpperCase();
}

function printThemeTokenValue(token: string, value: string): string {
  if (token === "radius" || token === "density" || token === "nav") {
    return value;
  }
  return printStringLiteral(value);
}

// --- helpers -----------------------------------------------------------------

function camelToUpperSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function indentBlock(block: string, indent: string): string {
  return block
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${indent}${line}`))
    .join("\n");
}
