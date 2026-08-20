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
 * `COMMAND`, `POLICY`, `THEME`, top-level `SYNC`, `SHELL`) and every
 * expression-bearing field (`ResolvedExpression`/`PartialPolicyConditionModel`
 * printed back to infix syntax). Composed view presentation
 * (`PartialViewModel.presentation`) and edit surfaces
 * (`editContainer`/`editSections`) are printed too (Phase 78), with a small,
 * named set of exceptions for constructs that have no ADL *text* syntax at
 * all today (only a resolved-model/JSON shape) — see the "NO TEXT SYNTAX"
 * comments below and `docs/spec/adlj.md`. Those throw a clear, named error
 * rather than silently dropping content.
 */
import type {
  JsonValue,
  PartialApplicationModel,
  PartialBusinessContextModel,
  PartialCommandInputModel,
  PartialCommandModel,
  PartialCommandStepModel,
  PartialContextGrantModel,
  PartialDecisionTableModel,
  PartialEditChildCollectionSectionModel,
  PartialEditFieldsSectionModel,
  PartialEditSectionModel,
  PartialFieldModel,
  PartialLifecycleActionModel,
  PartialLifecycleModel,
  PartialObjectConstraintModel,
  PartialObjectModel,
  PartialPolicyConditionModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPresentationActionControlModel,
  PartialPresentationCalendarModel,
  PartialPresentationControlModel,
  PartialPresentationIconMapModel,
  PartialPresentationIconRefModel,
  PartialPresentationLegendModel,
  PartialPresentationListModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  PartialPresentationSectionModel,
  PartialPresentationStateModel,
  PartialPresentationStatusCandidateModel,
  PartialPresentationStatusMapModel,
  PartialPresentationStatusModel,
  PartialPresentationToggleControlModel,
  PartialReadModelModel,
  PartialRelationshipPickerModel,
  PartialRoleModel,
  PartialShellControlModel,
  PartialShellModel,
  PartialShellNavDrawerModel,
  PartialShellNavItemModel,
  PartialShellTopBarModel,
  PartialShellVisibilityModel,
  PartialSyncPolicyModel,
  PartialThemeModel,
  PartialValidatorModel,
  PartialViewModel,
  PartialViewPresentationModel,
  ResolvedCommandValueExpression,
  ResolvedExpression,
  ResolvedPolicyCondition,
  ResolvedSort,
} from "../model/resolved-model.js";

export function printPartialApplicationModelAsAdl(model: PartialApplicationModel): string {
  const blocks: string[] = [printApp(model)];

  if (model.shell !== undefined) {
    blocks.push(printShell(model.shell));
  }
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

/**
 * Renders a `comment` field as `# <line>` prose immediately before a
 * construct, one line per `\n`-separated original line — the same leading
 * comment-block convention every real `.adl` file in this repository already
 * writes by hand. Pass `indent` for a construct printed as one
 * manually-indented line by its caller (`FIELD`, `CONSTRAINT`, a `POLICY
 * RULE`, a `READ_MODEL SOURCE`/`FIELD`); leave it `""` (the default) for a
 * construct whose own returned block is embedded through `indentBlock`,
 * since that wrapping cascades the comment lines the same as every other
 * line of the block. Returns `""` when there is no comment, so every call
 * site can prepend the result unconditionally. A blank comment line (a bare
 * `#`, from an original blank `#` line) prints as a bare `#`, not `# `
 * followed by trailing whitespace.
 */
function printLeadingComment(comment: string | undefined, indent = ""): string {
  if (comment === undefined) {
    return "";
  }
  return (
    comment
      .split("\n")
      .map((line) => (line.length === 0 ? `${indent}#` : `${indent}# ${line}`))
      .join("\n") + "\n"
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
  // The app name is a display string, not a referenced identifier (unlike
  // role/object/view names), so it may contain spaces — `APP 'Giggle Band
  // ADL Example'`. `consumeName` accepts a quoted string token exactly like
  // a bare identifier, so quoting unconditionally is always safe.
  const lines = [`APP ${printStringLiteral(model.app.name)}`];
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
  return printLeadingComment(model.app.comment) + lines.join("\n");
}

function printRole(role: PartialRoleModel): string {
  let line = `ROLE ${role.name}`;
  if (role.inherits !== undefined && role.inherits.length > 0) {
    line += ` INHERITS ${role.inherits.join(", ")}`;
  }
  if (role.description !== undefined) {
    line += ` DESCRIPTION ${printStringLiteral(role.description)}`;
  }
  return printLeadingComment(role.comment) + line;
}

/**
 * `CONTEXT` is a single-line declaration: `parseBusinessContext` reads every
 * directive (`OBJECT`, `SELECTION`, `AUTO_SELECT`, `PERSISTENCE`, `SOURCE`,
 * `ROUTE_PARAM`, `MEMBERSHIP` and its own sub-options) in one
 * `while (!isLineEnd())` loop and never calls `parseEnd` — there is no
 * `END.CONTEXT`. `SELECTION`, `AUTO_SELECT`, and `PERSISTENCE` are also
 * independent directives (not one grouped under `SELECTION`), so each is
 * printed as its own space-separated `KEYWORD value` pair on that one line.
 */
function printContext(context: PartialBusinessContextModel): string {
  let line = `CONTEXT ${context.name}`;
  if (context.object !== undefined) {
    line += ` OBJECT ${context.object}`;
  }
  if (context.selection !== undefined) {
    if (context.selection.mode !== undefined) {
      line += ` SELECTION ${context.selection.mode.toUpperCase()}`;
    }
    if (context.selection.autoSelect !== undefined) {
      line += ` AUTO_SELECT ${printLiteralValue(context.selection.autoSelect)}`;
    }
    if (context.selection.persistence !== undefined) {
      line += ` PERSISTENCE ${context.selection.persistence.toUpperCase()}`;
    }
    if (context.selection.source !== undefined) {
      line += ` SOURCE ${context.selection.source.toUpperCase()}`;
    }
    if (context.selection.routeParam !== undefined) {
      line += ` ROUTE_PARAM ${context.selection.routeParam}`;
    }
  }
  if (context.membership !== undefined) {
    const membership = context.membership;
    line += ` MEMBERSHIP ${membership.object} USER ${membership.userField} CONTEXT_FIELD ${membership.contextField} ROLE_FIELD ${membership.roleField}`;
    if (membership.roles !== undefined && membership.roles.length > 0) {
      line += ` ROLES ${membership.roles.join(" ")}`;
    }
  }
  return printLeadingComment(context.comment) + line;
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
  return printLeadingComment(grant.comment) + line;
}

// --- SHELL -------------------------------------------------------------------

function printShell(shell: PartialShellModel): string {
  const lines = ["SHELL"];
  if (shell.nav?.mode !== undefined) {
    lines.push(`  NAV_MODE ${camelToUpperSnake(shell.nav.mode)}`);
  }
  for (const item of shell.nav?.items ?? []) {
    lines.push(`  ${printShellNavItem(item)}`);
  }
  for (const control of shell.controls ?? []) {
    lines.push(`  ${printShellControl(control)}`);
  }
  if (shell.topBar !== undefined) {
    lines.push(`  ${printShellTopBar(shell.topBar)}`);
  }
  if (shell.navDrawer !== undefined) {
    lines.push(`  ${printShellNavDrawer(shell.navDrawer)}`);
  }
  lines.push("END.SHELL");
  return printLeadingComment(shell.comment) + lines.join("\n");
}

function printShellNavItem(item: PartialShellNavItemModel): string {
  let line = `NAV ${item.view}`;
  if (item.name !== undefined) {
    line += ` AS ${item.name}`;
  }
  if (item.label !== undefined) {
    line += ` LABEL ${printStringLiteral(item.label)}`;
  }
  if (item.icon !== undefined) {
    line += ` ICON ${item.icon}`;
  }
  if (item.group !== undefined) {
    line += ` GROUP ${item.group}`;
  }
  if (item.order !== undefined) {
    line += ` ORDER ${item.order}`;
  }
  if (item.visibility !== undefined) {
    line += ` VISIBLE ${printShellVisibility(item.visibility)}`;
  }
  // `ACTIVE_WHEN` must be the last directive on the line: the parser's
  // SHELL NAV loop breaks out of directive parsing as soon as it reads the
  // name list that follows this keyword.
  if (item.activeWhen !== undefined && item.activeWhen.length > 0) {
    line += ` ACTIVE_WHEN ${item.activeWhen.join(" ")}`;
  }
  return line;
}

function printShellVisibility(visibility: PartialShellVisibilityModel): string {
  const kind = visibility.kind ?? "always";
  switch (kind) {
    case "always":
      return "ALWAYS";
    case "online":
      return "ONLINE";
    case "offline":
      return "OFFLINE";
    case "contextAvailable":
      if (visibility.context === undefined) {
        throw new Error(
          "printPartialApplicationModelAsAdl: a 'contextAvailable' shell visibility must declare context.",
        );
      }
      return `WHEN CONTEXT ${visibility.context} AVAILABLE`;
    case "contextSelected":
      if (visibility.context === undefined) {
        throw new Error(
          "printPartialApplicationModelAsAdl: a 'contextSelected' shell visibility must declare context.",
        );
      }
      return `WHEN CONTEXT ${visibility.context} SELECTED`;
    default:
      throw new Error(`printPartialApplicationModelAsAdl: unsupported shell visibility '${kind}'.`);
  }
}

function printShellControl(control: PartialShellControlModel): string {
  let line = `CONTROL ${control.name} KIND ${camelToUpperSnake(control.kind)}`;
  if (control.label !== undefined) {
    line += ` LABEL ${printStringLiteral(control.label)}`;
  }
  if (control.icon !== undefined) {
    line += ` ICON ${control.icon}`;
  }
  if (control.placement !== undefined) {
    line += ` PLACEMENT ${camelToUpperSnake(control.placement)}`;
  }
  if (control.visibility !== undefined) {
    line += ` VISIBLE ${printShellVisibility(control.visibility)}`;
  }
  if (control.context !== undefined) {
    line += ` CONTEXT ${control.context}`;
  }
  return line;
}

function printShellTopBar(topBar: PartialShellTopBarModel): string {
  let line = "TOP_BAR";
  if (topBar.contextSelector !== undefined) {
    line += ` CONTEXT_SELECTOR ${camelToUpperSnake(topBar.contextSelector)}`;
  }
  if (topBar.mobileContextSelector !== undefined) {
    line += ` MOBILE_CONTEXT_SELECTOR ${camelToUpperSnake(topBar.mobileContextSelector)}`;
  }
  // `CONTROLS` must be last: the parser's SHELL TOP_BAR loop breaks after it.
  if (topBar.controls !== undefined && topBar.controls.length > 0) {
    line += ` CONTROLS ${topBar.controls.join(" ")}`;
  }
  return line;
}

function printShellNavDrawer(navDrawer: PartialShellNavDrawerModel): string {
  let line = "NAV_DRAWER";
  if (navDrawer.title !== undefined) {
    line += ` TITLE ${printStringLiteral(navDrawer.title)}`;
  }
  // `CONTROLS` must be last: the parser's SHELL NAV_DRAWER loop breaks after it.
  if (navDrawer.controls !== undefined && navDrawer.controls.length > 0) {
    line += ` CONTROLS ${navDrawer.controls.join(" ")}`;
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
    lines.push(
      `${printLeadingComment(constraint.comment, "  ")}  ${printObjectConstraint(constraint)}`,
    );
  }
  for (const field of object.fields ?? []) {
    lines.push(`${printLeadingComment(field.comment, "  ")}  ${printField(field)}`);
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
    lines.push(`${printLeadingComment(validation.comment, "  ")}${line}`);
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
  return printLeadingComment(object.comment) + lines.join("\n");
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

// --- VIEW: fields, composed presentation, edit surfaces ----------------------

function printView(view: PartialViewModel): string {
  const lines = [`VIEW ${view.name} ${camelToUpperSnake(view.kind)}`];
  if (view.context !== undefined) {
    lines.push(
      `  CONTEXT ${view.context.mode.toUpperCase()}${view.context.context === undefined ? "" : ` ${view.context.context}`}`,
    );
  }
  if (view.readModel !== undefined) {
    lines.push(`  READ_MODEL ${view.readModel}`);
  }
  if (view.editContainer !== undefined) {
    lines.push(`  EDIT_CONTAINER ${camelToUpperSnake(view.editContainer)}`);
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

  const presentation = view.presentation;
  if (presentation !== undefined) {
    lines.push(...printViewPresentationDirectives(view.name, presentation));
  }

  for (const section of view.editSections ?? []) {
    lines.push(indentBlock(printEditSection(section), "  "));
  }

  lines.push("END.VIEW");
  return printLeadingComment(view.comment) + lines.join("\n");
}

function printViewPresentationDirectives(
  viewName: string,
  presentation: PartialViewPresentationModel,
): string[] {
  const lines: string[] = [];
  if (presentation.layout !== undefined) {
    lines.push(`  LAYOUT ${camelToUpperSnake(presentation.layout)}`);
  }
  if (presentation.density !== undefined) {
    lines.push(`  DENSITY ${camelToUpperSnake(presentation.density)}`);
  }
  for (const state of presentation.state ?? []) {
    lines.push(`  ${printPresentationState(state)}`);
  }
  for (const iconMap of presentation.iconMaps ?? []) {
    lines.push(indentBlock(printPresentationIconMap(iconMap), "  "));
  }
  for (const status of presentation.statuses ?? []) {
    lines.push(`  ${printPresentationStatus(status)}`);
  }
  for (const statusMap of presentation.statusMaps ?? []) {
    lines.push(indentBlock(printPresentationStatusMap(statusMap), "  "));
  }
  for (const legend of presentation.legends ?? []) {
    lines.push(`  ${printPresentationLegend(legend)}`);
  }
  // NO TEXT SYNTAX: per-view shell regions (`presentation.shell.regions`) are
  // a JSON/TypeScript-only construct — `docs/spec/ui-language-addendum.md`
  // ("Per-view `presentation.shell.regions` remains available in
  // JSON/TypeScript partial models... but source syntax for view-declared
  // shell regions is not implemented") — and the parser has no ADL directive
  // that ever populates it. Global `SHELL ... END.SHELL` (printed above, at
  // the top level) is the only shell surface ADL text can author.
  if (presentation.shell !== undefined && (presentation.shell.regions?.length ?? 0) > 0) {
    throw new Error(
      `printPartialApplicationModelAsAdl: view '${viewName}' declares per-view presentation.shell.regions, which has no ADL text syntax (only the global SHELL block can be authored). See docs/spec/adlj.md.`,
    );
  }
  for (const section of presentation.sections ?? []) {
    lines.push(indentBlock(printPresentationSection(section), "  "));
  }
  return lines;
}

function printPresentationState(state: PartialPresentationStateModel): string {
  let line = `STATE ${state.name}`;
  if (state.type !== undefined) {
    line += ` ${camelToUpperSnake(state.type)}`;
  }
  if (state.defaultValue !== undefined) {
    line += ` DEFAULT(${printLiteralValue(state.defaultValue)})`;
  }
  if (state.persistence !== undefined) {
    line += ` PERSISTENCE ${camelToUpperSnake(state.persistence)}`;
  }
  return line;
}

function printPresentationIconMap(iconMap: PartialPresentationIconMapModel): string {
  let header = `ICON_MAP ${iconMap.name} FOR ${iconMap.field}`;
  if (iconMap.defaultIcon !== undefined) {
    header += ` DEFAULT ${iconMap.defaultIcon}`;
  }
  const lines = [header];
  for (const value of iconMap.values ?? []) {
    lines.push(`  ${printLiteralValue(value.value)} -> ${value.icon}`);
  }
  lines.push("END.ICON_MAP");
  return lines.join("\n");
}

function printPresentationStatus(status: PartialPresentationStatusModel): string {
  let line = `STATUS ${status.name}`;
  if (status.label !== undefined) {
    line += ` LABEL ${printStringLiteral(status.label)}`;
  }
  if (status.accessibleLabel !== undefined) {
    line += ` ARIA_LABEL ${printStringLiteral(status.accessibleLabel)}`;
  }
  if (status.icon !== undefined) {
    line += ` ICON ${printPresentationIconRef(status.icon)}`;
  }
  if (status.themeToken !== undefined) {
    line += ` THEME ${camelToUpperSnake(status.themeToken)}`;
  }
  if (status.precedence !== undefined) {
    line += ` PRECEDENCE ${status.precedence}`;
  }
  return line;
}

function printPresentationStatusMap(statusMap: PartialPresentationStatusMapModel): string {
  let header = `STATUS_MAP ${statusMap.name} FOR ${statusMap.field}`;
  if (statusMap.defaultStatus !== undefined) {
    header += ` DEFAULT ${statusMap.defaultStatus}`;
  }
  const lines = [header];
  for (const value of statusMap.values ?? []) {
    lines.push(`  ${printLiteralValue(value.value)} -> ${value.status}`);
  }
  lines.push("END.STATUS_MAP");
  return lines.join("\n");
}

function printPresentationLegend(legend: PartialPresentationLegendModel): string {
  let line = `LEGEND ${legend.name}`;
  if (legend.title !== undefined) {
    line += ` TITLE ${printStringLiteral(legend.title)}`;
  }
  if (legend.include !== undefined) {
    line += ` INCLUDE ${camelToUpperSnake(legend.include)}`;
  }
  // `STATUSES` must be last: the parser's LEGEND loop breaks after it.
  if (legend.statuses !== undefined && legend.statuses.length > 0) {
    line += ` STATUSES ${legend.statuses.join(" ")}`;
  }
  return line;
}

/**
 * Prints an icon reference with an explicit `FIELD`/`VALUE` keyword rather
 * than relying on the bare-identifier-vs-literal inference the parser also
 * accepts. The parser's inference depends on which call site is parsing
 * (`ROW ICON` reads a bare identifier as a field; `STATUS`/`TOGGLE ICON`
 * read it as a literal value instead) — printing the explicit keyword always
 * reparses correctly regardless of which context embeds it.
 */
function printPresentationIconRef(icon: PartialPresentationIconRefModel): string {
  if (icon.kind === "named") {
    return icon.name;
  }
  if (icon.field !== undefined) {
    return `${icon.map}(FIELD ${icon.field})`;
  }
  if (icon.value !== undefined) {
    return `${icon.map}(VALUE ${printLiteralValue(icon.value)})`;
  }
  throw new Error(
    `printPartialApplicationModelAsAdl: icon map reference '${icon.map}' must declare field or value.`,
  );
}

function printPresentationSection(section: PartialPresentationSectionModel): string {
  const lines = [`SECTION ${section.name}`];
  if (section.heading !== undefined) {
    lines.push(`  HEADING ${printStringLiteral(section.heading)}`);
  }
  if (section.layout !== undefined) {
    lines.push(`  LAYOUT ${camelToUpperSnake(section.layout)}`);
  }
  if (section.density !== undefined) {
    lines.push(`  DENSITY ${camelToUpperSnake(section.density)}`);
  }
  for (const control of section.controls ?? []) {
    lines.push(indentBlock(printPresentationControl(section.name, control), "  "));
  }
  for (const list of section.lists ?? []) {
    lines.push(indentBlock(printPresentationList(list), "  "));
  }
  // NO TEXT SYNTAX: MATRIX has a full resolved-model/JSON shape
  // (`PartialPresentationMatrixModel`) but the parser has no `MATRIX`
  // construct at all — `docs/spec/ui-language-addendum.md` documents it as
  // "intended language direction" only ("parser support remains future
  // work"). Author it as a PartialApplicationModel/.adlj document instead.
  if (section.matrices !== undefined && section.matrices.length > 0) {
    throw new Error(
      `printPartialApplicationModelAsAdl: section '${section.name}' declares a MATRIX, which has no ADL text syntax yet. See docs/spec/adlj.md.`,
    );
  }
  for (const calendar of section.calendars ?? []) {
    lines.push(indentBlock(printPresentationCalendar(calendar), "  "));
  }
  lines.push("END.SECTION");
  return printLeadingComment(section.comment) + lines.join("\n");
}

function printPresentationControl(
  sectionName: string,
  control: PartialPresentationControlModel,
): string {
  if (control.kind === "toggle") {
    return printPresentationToggle(control);
  }
  if (control.kind === "action") {
    return printPresentationAction(control);
  }
  // NO TEXT SYNTAX: `select` and `contextSelector` controls have a resolved
  // model shape but no ADL directive produces them —
  // `docs/spec/ui-language-addendum.md` ("The resolved model also has
  // generic `select` and `contextSelector` control shapes for
  // JSON/TypeScript partial models, but ADL source syntax for those
  // controls is not implemented yet").
  throw new Error(
    `printPartialApplicationModelAsAdl: section '${sectionName}' declares a '${control.kind}' control, which has no ADL text syntax yet (only 'toggle' and 'action' controls can be authored). See docs/spec/adlj.md.`,
  );
}

function printPresentationToggle(toggle: PartialPresentationToggleControlModel): string {
  const lines = [`TOGGLE ${toggle.name}`];
  if (toggle.state !== toggle.name) {
    lines.push(`  STATE ${toggle.state}`);
  }
  if (toggle.label !== undefined) {
    lines.push(`  LABEL ${printStringLiteral(toggle.label)}`);
  }
  if (toggle.icon !== undefined) {
    lines.push(`  ICON ${printPresentationIconRef(toggle.icon)}`);
  }
  lines.push("END.TOGGLE");
  return lines.join("\n");
}

function printPresentationAction(action: PartialPresentationActionControlModel): string {
  const lines = [`ACTION ${action.name}`];
  if (action.command !== undefined) {
    lines.push(`  COMMAND ${action.command}`);
  }
  if (action.view !== undefined) {
    lines.push(`  VIEW ${action.view}`);
  }
  if (action.create?.object !== undefined) {
    lines.push(`  CREATE ${action.create.object}`);
  }
  if (action.create?.view !== undefined) {
    lines.push(`  FORM ${action.create.view}`);
  }
  if (action.label !== undefined) {
    lines.push(`  LABEL ${printStringLiteral(action.label)}`);
  }
  if (action.icon !== undefined) {
    lines.push(`  ICON ${printPresentationIconRef(action.icon)}`);
  }
  if (action.placement !== undefined) {
    lines.push(`  PLACEMENT ${camelToUpperSnake(action.placement)}`);
  }
  if (action.visibleWhen !== undefined) {
    lines.push(`  WHEN ${printCondition(action.visibleWhen, true)}`);
  }
  for (const [name, expression] of Object.entries(action.input ?? {})) {
    lines.push(`  INPUT ${name} FROM ${printExpression(expression, true)}`);
  }
  lines.push("END.ACTION");
  return printLeadingComment(action.comment) + lines.join("\n");
}

function printPresentationSourceRef(
  sourceKind: "readModel" | "object" | undefined,
  source: string,
): string {
  const prefix = sourceKind === undefined ? "" : `${camelToUpperSnake(sourceKind)} `;
  return `${prefix}${source}`;
}

function printPresentationList(list: PartialPresentationListModel): string {
  // NO TEXT SYNTAX: the parser's `LIST ... END.LIST` body has no `FIELDS`
  // directive (only `ORDER BY`, `WHERE`, `RENDER_AS`, `DENSITY`,
  // `EMPTY_TEXT`, `STATUS`, `ACTION`, `ROW`).
  if (list.fields !== undefined && list.fields.length > 0) {
    throw new Error(
      `printPartialApplicationModelAsAdl: list '${list.name}' declares 'fields', which has no ADL LIST directive. See docs/spec/adlj.md.`,
    );
  }
  const lines = [
    `LIST ${list.name} FROM ${printPresentationSourceRef(list.sourceKind, list.source)}`,
  ];
  if (list.sort !== undefined && list.sort.length > 0) {
    lines.push(`  ORDER BY ${printSortList(list.sort)}`);
  }
  if (list.filter !== undefined) {
    lines.push(`  WHERE ${printCondition(list.filter, true)}`);
  }
  if (list.renderAs !== undefined) {
    lines.push(`  RENDER_AS ${camelToUpperSnake(list.renderAs)}`);
  }
  if (list.density !== undefined) {
    lines.push(`  DENSITY ${camelToUpperSnake(list.density)}`);
  }
  if (list.emptyState?.text !== undefined) {
    lines.push(`  EMPTY_TEXT ${printStringLiteral(list.emptyState.text)}`);
  }
  // NO TEXT SYNTAX: `EMPTY_TEXT` only ever takes a literal string; there is
  // no directive for an empty-state icon.
  if (list.emptyState?.icon !== undefined) {
    throw new Error(
      `printPartialApplicationModelAsAdl: list '${list.name}' declares an empty-state icon, which has no ADL EMPTY_TEXT directive. See docs/spec/adlj.md.`,
    );
  }
  for (const candidate of list.status?.candidates ?? []) {
    lines.push(`  ${printPresentationStatusCandidate(candidate)}`);
  }
  for (const action of list.actions ?? []) {
    lines.push(indentBlock(printPresentationAction(action), "  "));
  }
  if (list.row !== undefined) {
    lines.push(indentBlock(printPresentationRowTemplate(list.row), "  "));
  }
  lines.push("END.LIST");
  return lines.join("\n");
}

function printPresentationCalendar(calendar: PartialPresentationCalendarModel): string {
  // NO TEXT SYNTAX: `calendar.month.labelFormat` has no `CALENDAR` directive
  // (the parser's `MONTH`/`MONTH_STATE`/`WEEK_START`/`RANGE` directives never
  // set it; `compile-adl.ts`'s calendar-to-partial mapping never populates it
  // either).
  if (calendar.month?.labelFormat !== undefined) {
    throw new Error(
      `printPartialApplicationModelAsAdl: calendar '${calendar.name}' declares month.labelFormat, which has no ADL CALENDAR directive. See docs/spec/adlj.md.`,
    );
  }
  // NO TEXT SYNTAX: `calendar.conflictOverlay` has a full resolved-model/JSON
  // shape (`ResolvedPresentationCalendarConflictOverlay`) but the parser has
  // no `CONFLICT_OVERLAY`/equivalent `CALENDAR` directive -- same treatment
  // as `MATRIX` above.
  if (calendar.conflictOverlay !== undefined) {
    throw new Error(
      `printPartialApplicationModelAsAdl: calendar '${calendar.name}' declares a conflictOverlay, which has no ADL text syntax yet. See docs/spec/adlj.md.`,
    );
  }
  const lines = [
    `CALENDAR ${calendar.name} FROM ${printPresentationSourceRef(calendar.sourceKind, calendar.source)}`,
  ];
  lines.push(`  DATE_FIELD ${calendar.dateField}`);
  if (calendar.titleField !== undefined) {
    lines.push(`  TITLE_FIELD ${calendar.titleField}`);
  }
  if (calendar.summaryFields !== undefined && calendar.summaryFields.length > 0) {
    lines.push(`  SUMMARY_FIELDS ${calendar.summaryFields.join(" ")}`);
  }
  if (calendar.fields !== undefined && calendar.fields.length > 0) {
    lines.push(`  FIELDS ${calendar.fields.join(" ")}`);
  }
  if (calendar.sort !== undefined && calendar.sort.length > 0) {
    lines.push(`  ORDER BY ${printSortList(calendar.sort)}`);
  }
  if (calendar.density !== undefined) {
    lines.push(`  DENSITY ${camelToUpperSnake(calendar.density)}`);
  }
  if (calendar.month?.value !== undefined) {
    lines.push(`  MONTH ${printStringLiteral(calendar.month.value)}`);
  }
  if (calendar.month?.state !== undefined) {
    lines.push(`  MONTH_STATE ${calendar.month.state}`);
  }
  if (calendar.month?.weekStart !== undefined) {
    lines.push(`  WEEK_START ${camelToUpperSnake(calendar.month.weekStart)}`);
  }
  if (calendar.month?.minDate !== undefined || calendar.month?.maxDate !== undefined) {
    if (calendar.month?.minDate === undefined || calendar.month?.maxDate === undefined) {
      throw new Error(
        `printPartialApplicationModelAsAdl: calendar '${calendar.name}' declares only one end of month.minDate/maxDate; ADL RANGE requires both.`,
      );
    }
    lines.push(
      `  RANGE ${printStringLiteral(calendar.month.minDate)} TO ${printStringLiteral(calendar.month.maxDate)}`,
    );
  }
  if (calendar.emptyState?.text !== undefined) {
    lines.push(`  EMPTY_TEXT ${printStringLiteral(calendar.emptyState.text)}`);
  }
  if (calendar.emptyState?.icon !== undefined) {
    throw new Error(
      `printPartialApplicationModelAsAdl: calendar '${calendar.name}' declares an empty-state icon, which has no ADL EMPTY_TEXT directive. See docs/spec/adlj.md.`,
    );
  }
  for (const candidate of calendar.status?.candidates ?? []) {
    lines.push(`  ${printPresentationStatusCandidate(candidate)}`);
  }
  for (const action of calendar.actions ?? []) {
    lines.push(indentBlock(printPresentationAction(action), "  "));
  }
  lines.push("END.CALENDAR");
  return lines.join("\n");
}

function printPresentationStatusCandidate(
  candidate: PartialPresentationStatusCandidateModel,
): string {
  if (candidate.kind === "status") {
    return `STATUS ${candidate.status}`;
  }
  if (candidate.field !== undefined) {
    return `STATUS ${candidate.map}(FIELD ${candidate.field})`;
  }
  if (candidate.value !== undefined) {
    return `STATUS ${candidate.map}(VALUE ${printLiteralValue(candidate.value)})`;
  }
  throw new Error(
    `printPartialApplicationModelAsAdl: STATUS map reference '${candidate.map}' must declare field or value.`,
  );
}

function printPresentationRowTemplate(row: PartialPresentationRowTemplateModel): string {
  let header = "ROW";
  if (row.layout !== undefined) {
    header += ` LAYOUT ${camelToUpperSnake(row.layout)}`;
  }
  if (row.density !== undefined) {
    header += ` DENSITY ${camelToUpperSnake(row.density)}`;
  }
  const lines = [header];
  for (const fragment of row.fragments ?? []) {
    lines.push(`  ${printPresentationRowFragment(fragment)}`);
  }
  lines.push("END.ROW");
  return lines.join("\n");
}

function printPresentationRowFragment(fragment: PartialPresentationRowFragmentModel): string {
  if (fragment.kind === "text") {
    let text = `TEXT ${printStringLiteral(fragment.text)}`;
    if (fragment.style !== undefined) {
      text += ` STYLE ${camelToUpperSnake(fragment.style)}`;
    }
    return text;
  }
  if (fragment.kind === "field") {
    // NO TEXT SYNTAX: `fallback` has no `TEXT` directive (only `FORMAT` and
    // `STYLE` are parsed for a field text fragment).
    if (fragment.fallback !== undefined) {
      throw new Error(
        `printPartialApplicationModelAsAdl: field text fragment '${fragment.field}' declares 'fallback', which has no ADL TEXT directive. See docs/spec/adlj.md.`,
      );
    }
    let text = `TEXT ${fragment.field}`;
    if (fragment.format !== undefined) {
      text += ` FORMAT ${camelToUpperSnake(fragment.format.kind)}`;
      if (fragment.format.pattern !== undefined) {
        text += ` ${printStringLiteral(fragment.format.pattern)}`;
      }
    }
    if (fragment.style !== undefined) {
      text += ` STYLE ${camelToUpperSnake(fragment.style)}`;
    }
    return text;
  }
  if (fragment.kind === "icon") {
    let text = `ICON ${printPresentationIconRef(fragment.icon)}`;
    if (fragment.label !== undefined) {
      text += ` LABEL ${printStringLiteral(fragment.label)}`;
    }
    return text;
  }
  // NO TEXT SYNTAX: conditional row fragments (`kind: "conditional"`) have a
  // resolved-model shape but the parser's `ROW` body only ever produces
  // `TEXT`/`ICON` fragments — there is no ADL construct that yields a
  // `PartialPresentationConditionalFragmentModel`.
  throw new Error(
    "printPartialApplicationModelAsAdl: a conditional row fragment has no ADL text syntax. See docs/spec/adlj.md.",
  );
}

// --- Edit surfaces -------------------------------------------------------

function printEditSection(section: PartialEditSectionModel): string {
  if (section.kind === "fields") {
    return printEditFieldsSection(section);
  }
  return printEditChildCollection(section);
}

function printEditFieldsSection(section: PartialEditFieldsSectionModel): string {
  let header = `EDIT_SECTION ${section.name}`;
  if (section.heading !== undefined) {
    header += ` HEADING ${printStringLiteral(section.heading)}`;
  }
  const lines = [header];
  if (section.fields !== undefined && section.fields.length > 0) {
    lines.push(`  FIELDS ${section.fields.join(" ")}`);
  }
  lines.push("END.EDIT_SECTION");
  return lines.join("\n");
}

function printEditChildCollection(section: PartialEditChildCollectionSectionModel): string {
  // NO TEXT SYNTAX: `projectedFields` and `summary` have a full
  // resolved-model/JSON shape (`ResolvedProjectedField`,
  // `ResolvedEditChildCollectionSummary`) but the parser has no
  // `PROJECTED_FIELD`/`SUMMARY`-equivalent `CHILD_COLLECTION` directive --
  // same treatment as `MATRIX` and `conflictOverlay` above. See Phase 87.
  if (section.projectedFields !== undefined && section.projectedFields.length > 0) {
    throw new Error(
      `printPartialApplicationModelAsAdl: child collection '${section.name}' declares projectedFields, which has no ADL text syntax yet. See docs/spec/adlj.md.`,
    );
  }
  if (section.summary !== undefined) {
    throw new Error(
      `printPartialApplicationModelAsAdl: child collection '${section.name}' declares a summary, which has no ADL text syntax yet. See docs/spec/adlj.md.`,
    );
  }
  let header = `CHILD_COLLECTION ${section.name}`;
  if (section.heading !== undefined) {
    header += ` HEADING ${printStringLiteral(section.heading)}`;
  }
  const lines = [header];
  lines.push(`  CHILD ${section.childObject} PARENT_FIELD ${section.parentField}`);
  if (section.childView !== undefined) {
    lines.push(`  CHILD_VIEW ${section.childView}`);
  }
  if (section.operations !== undefined && section.operations.length > 0) {
    lines.push(`  OPERATIONS ${section.operations.map(camelToUpperSnake).join(" ")}`);
  }
  if (section.staged !== undefined) {
    lines.push(section.staged ? "  STAGED" : `  STAGED ${printLiteralValue(false)}`);
  }
  if (section.orderField !== undefined) {
    lines.push(`  ORDER_FIELD ${section.orderField}`);
  }
  if (section.emptyState?.text !== undefined) {
    lines.push(`  EMPTY_TEXT ${printStringLiteral(section.emptyState.text)}`);
  }
  if (section.picker !== undefined) {
    lines.push(indentBlock(printRelationshipPicker(section.picker), "  "));
  }
  lines.push("END.CHILD_COLLECTION");
  return lines.join("\n");
}

function printRelationshipPicker(picker: PartialRelationshipPickerModel): string {
  if (picker.name === undefined) {
    throw new Error("printPartialApplicationModelAsAdl: a PICKER must declare a name.");
  }
  const lines = [`PICKER ${picker.name}`];
  if (picker.source !== undefined) {
    const kind = picker.sourceKind === "readModel" ? "READ_MODEL" : "OBJECT";
    lines.push(`  SOURCE ${kind} ${picker.source}`);
  }
  if (picker.candidateField !== undefined) {
    lines.push(`  CANDIDATE_FIELD ${picker.candidateField}`);
  }
  if (picker.selection !== undefined) {
    lines.push(`  SELECTION ${camelToUpperSnake(picker.selection)}`);
  }
  if (picker.displayFields !== undefined && picker.displayFields.length > 0) {
    lines.push(`  DISPLAY ${picker.displayFields.join(" ")}`);
  }
  if (picker.searchFields !== undefined && picker.searchFields.length > 0) {
    lines.push(`  SEARCH ${picker.searchFields.join(" ")}`);
  }
  if (picker.sort !== undefined && picker.sort.length > 0) {
    lines.push(`  SORT ${printSortList(picker.sort)}`);
  }
  if (picker.excludeAlreadyLinked !== undefined) {
    lines.push(
      picker.excludeAlreadyLinked
        ? "  EXCLUDE_LINKED"
        : `  EXCLUDE_LINKED ${printLiteralValue(false)}`,
    );
  }
  if (picker.emptyState?.text !== undefined) {
    lines.push(`  EMPTY_TEXT ${printStringLiteral(picker.emptyState.text)}`);
  }
  lines.push("END.PICKER");
  return printLeadingComment(picker.comment) + lines.join("\n");
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
  // The parser has no `STRATEGY` keyword at all: `union` is authored as a
  // bare `UNION` directive, and `join` (the default) has no keyword of its
  // own — it is simply the absence of `UNION`.
  if (readModel.strategy === "union") {
    lines.push("  UNION");
  }
  for (const source of readModel.sources) {
    let line = `  SOURCE ${source.name ?? source.object} OBJECT ${source.object}`;
    if (source.scope !== undefined) {
      line += ` SCOPE ${source.scope}`;
    }
    if (source.join !== undefined) {
      // `sourceField` is stored unqualified (the parser strips the
      // `<joinSource>.` prefix it requires on the way in); it must be
      // re-qualified here or the printed `ON` clause reparses as a bare
      // field name, which `READ_MODEL SOURCE JOIN` always rejects.
      line += ` JOIN ${source.join.source} ON ${source.join.localField} == ${source.join.source}.${source.join.sourceField}`;
      if (source.join.cardinality !== undefined) {
        line += ` CARDINALITY ${source.join.cardinality}`;
      }
    }
    lines.push(`${printLeadingComment(source.comment, "  ")}${line}`);
  }
  for (const field of readModel.fields) {
    const typeSuffix = field.type === undefined ? "" : ` ${field.type.toUpperCase()}`;
    let line: string;
    if (field.expression !== undefined) {
      line = `  FIELD ${field.name}${typeSuffix} = ${printCondition(field.expression, true)}`;
    } else if (field.source !== undefined && field.field !== undefined) {
      line = `  FIELD ${field.name}${typeSuffix} FROM ${field.source}.${field.field}`;
    } else {
      throw new Error(
        `printPartialApplicationModelAsAdl: read model '${readModel.name}' field '${field.name}' has neither a source.field reference nor an expression.`,
      );
    }
    lines.push(`${printLeadingComment(field.comment, "  ")}${line}`);
  }
  if (readModel.sort !== undefined && readModel.sort.length > 0) {
    lines.push(`  SORT ${printSortList(readModel.sort)}`);
  }
  lines.push("END.READ_MODEL");
  return printLeadingComment(readModel.comment) + lines.join("\n");
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
    lines.push(indentBlock(printCommandInput(input), "  "));
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
  return printLeadingComment(command.comment) + lines.join("\n");
}

/**
 * `INPUT ... LIST` may declare each list item as a record rather than a
 * scalar of the header's own `type` (which the parser defaults to `text`
 * and effectively ignores whenever item fields are declared) via a nested
 * `FIELD` block terminated by `END.INPUT`. The block only exists in the
 * parsed AST when at least one item field is present — a scalar input has
 * no `END.INPUT` at all.
 */
function printCommandInput(input: PartialCommandInputModel): string {
  let header = `INPUT ${input.name}`;
  if (input.repeated === true) {
    header += " LIST";
  }
  if (input.type !== undefined) {
    header += ` ${input.type.toUpperCase()}`;
  }
  header += input.required === false ? " OPTIONAL" : " REQUIRED";
  if (input.defaultValue !== undefined) {
    header += ` DEFAULT(${printLiteralValue(input.defaultValue)})`;
  }
  if (input.itemFields === undefined || input.itemFields.length === 0) {
    return header;
  }
  const lines = [header];
  for (const field of input.itemFields) {
    let fieldLine = `  FIELD ${field.name} ${(field.type ?? "text").toUpperCase()}`;
    if (field.required === true) {
      fieldLine += " REQUIRED";
    }
    lines.push(fieldLine);
  }
  lines.push("END.INPUT");
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
  return printLeadingComment(step.comment) + lines.join("\n");
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
    lines.push(`${printLeadingComment(rule.comment, "  ")}  ${printPolicyRule(rule)}`);
  }
  lines.push("END.POLICY");
  return printLeadingComment(policy.comment) + lines.join("\n");
}

/**
 * `POLICY RULE` packs `FIELDS`/`STATE`/the principal selector/`ACTION`/
 * `WHEN`/`CHANNELS` onto one line with no separating scope, so the parser
 * recognises a fixed set of reserved words (`FIELD_LIST_STOP_WORDS` in
 * parser.ts) to know where one name list ends and the next directive
 * begins. A field or state literally named one of those words (Giggle
 * Band's `BandInvitation` has a field called `Role`) is genuinely ambiguous
 * as a bare identifier there — `consumeNameListUntilWords` stops the list
 * the moment it sees a token matching one of these words. The original
 * `.adl` source works around this by quoting (`'Role'`), which `consumeName`
 * accepts identically to a bare identifier; the printer must do the same.
 */
const POLICY_RULE_LIST_STOP_WORDS = new Set([
  "ROLE",
  "ROLES",
  "GROUP_ROLE",
  "GROUP_ROLES",
  "USER",
  "USERS",
  "OWNER",
  "EVERYONE",
  "AUTHENTICATED",
  "ANONYMOUS",
  "CONTEXT_MEMBER",
  "STATE",
  "ACTION",
  "CHANNEL",
  "CHANNELS",
  "WHEN",
]);

function printPolicyRuleListName(name: string): string {
  return POLICY_RULE_LIST_STOP_WORDS.has(name.toUpperCase()) ? printStringLiteral(name) : name;
}

function printPolicyRuleListNames(names: string[]): string {
  return names.map(printPolicyRuleListName).join(" ");
}

function printPolicyRule(rule: PartialPolicyRuleModel): string {
  const parts = [
    `RULE ${rule.name} ${rule.effect.toUpperCase()} ${rule.action === "*" ? "ALL" : rule.action.toUpperCase()}`,
  ];
  parts.push(printPrincipal(rule.principal));
  if (rule.state !== undefined && (Array.isArray(rule.state) ? rule.state.length > 0 : true)) {
    const states = Array.isArray(rule.state)
      ? printPolicyRuleListNames(rule.state)
      : printPolicyRuleListName(rule.state);
    parts.push(`STATE ${states}`);
  }
  if (rule.fields !== undefined && rule.fields.length > 0) {
    parts.push(`FIELDS ${printPolicyRuleListNames(rule.fields)}`);
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
        parts.push(`ROLE ${printPolicyRuleListNames(principal.roles)}`);
      }
      if (principal.groupRoles !== undefined && principal.groupRoles.length > 0) {
        parts.push(`GROUP_ROLE ${printPolicyRuleListNames(principal.groupRoles)}`);
      }
      if (principal.users !== undefined && principal.users.length > 0) {
        parts.push(`USER ${printPolicyRuleListNames(principal.users)}`);
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
