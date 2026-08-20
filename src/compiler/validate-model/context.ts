import type {
  ContextSelectionMode,
  ContextSelectionPersistence,
  ContextSelectionSource,
  ResolvedBusinessContext,
  ResolvedContextGrant,
  ResolvedContextMembership,
  ResolvedField,
  ResolvedObject,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, indexByName, reportDuplicateNames } from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";

const CONTEXT_SELECTION_MODES = new Set<ContextSelectionMode>(["required", "optional"]);
const CONTEXT_SELECTION_PERSISTENCE = new Set<ContextSelectionPersistence>([
  "none",
  "session",
  "local",
]);
const CONTEXT_SELECTION_SOURCES = new Set<ContextSelectionSource>(["runtime", "route"]);
export function validateBusinessContext(
  context: ResolvedBusinessContext,
  contextIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const contextPath = `contexts[${contextIndex}]`;

  if (!indexes.objectsByName.has(context.object)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_OBJECT_UNKNOWN,
        `Business context '${context.name}' references unknown object '${context.object}'.`,
        `${contextPath}.object`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_MODES.has(context.selection.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_MODE_INVALID,
        `Business context '${context.name}' has invalid selection mode '${String(context.selection.mode)}'.`,
        `${contextPath}.selection.mode`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_PERSISTENCE.has(context.selection.persistence)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_PERSISTENCE_INVALID,
        `Business context '${context.name}' has invalid selection persistence '${String(context.selection.persistence)}'.`,
        `${contextPath}.selection.persistence`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_SOURCES.has(context.selection.source)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_SOURCE_INVALID,
        `Business context '${context.name}' has invalid selection source '${String(context.selection.source)}'.`,
        `${contextPath}.selection.source`,
      ),
    );
  }

  if (
    context.selection.routeParam !== undefined &&
    (typeof context.selection.routeParam !== "string" || context.selection.routeParam.trim() === "")
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_ROUTE_PARAM_INVALID,
        `Business context '${context.name}' route parameter must not be empty.`,
        `${contextPath}.selection.routeParam`,
      ),
    );
  }

  if (context.membership !== undefined) {
    validateContextMembership(
      context.membership,
      context,
      `${contextPath}.membership`,
      indexes,
      diagnostics,
    );
  }

  reportDuplicateNames(
    context.grants,
    `${contextPath}.grants`,
    MODEL_VALIDATION_CODES.CONTEXT_GRANT_DUPLICATE,
    diagnostics,
    `Grant names must be unique within business context '${context.name}'.`,
  );

  for (let grantIndex = 0; grantIndex < context.grants.length; grantIndex += 1) {
    const grant = context.grants[grantIndex];
    if (grant === undefined) {
      continue;
    }
    validateContextGrant(
      grant,
      context,
      `${contextPath}.grants[${grantIndex}]`,
      indexes,
      diagnostics,
    );
  }
}
/**
 * A grant is the one route into a context that is not membership, so what it
 * names has to be checkable here: an unknown object, a field that is not on it,
 * or a context field that reaches somewhere other than this context's own object
 * would each leave the scope gate accepting records for the wrong instance, or
 * for none at all, with nothing reported until a person could not read their own
 * invitation.
 */
function validateContextGrant(
  grant: ResolvedContextGrant,
  context: ResolvedBusinessContext,
  grantPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const grantObject = indexes.objectsByName.get(grant.object)?.item;

  if (grantObject === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_OBJECT_UNKNOWN,
        `Business context '${context.name}' grant '${grant.name}' references unknown object '${grant.object}'.`,
        `${grantPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(grantObject.fields);

  if (!fieldsByName.has(grant.userField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_FIELD_UNKNOWN,
        `Business context '${context.name}' grant '${grant.name}' user field '${grant.userField}' does not exist on object '${grantObject.name}'.`,
        `${grantPath}.userField`,
      ),
    );
  }

  const contextField = fieldsByName.get(grant.contextField)?.item;
  if (contextField === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_FIELD_UNKNOWN,
        `Business context '${context.name}' grant '${grant.name}' context field '${grant.contextField}' does not exist on object '${grantObject.name}'.`,
        `${grantPath}.contextField`,
      ),
    );
  } else if (
    // An unknown context object is already reported once against the context
    // itself; repeating it per grant would say nothing new and would be wrong
    // about which declaration is at fault.
    indexes.objectsByName.has(context.object) &&
    contextField.lookup?.targetObject !== context.object
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONTEXT_FIELD_INVALID,
        `Business context '${context.name}' grant '${grant.name}' context field '${grant.contextField}' must look up '${context.object}'.`,
        `${grantPath}.contextField`,
      ),
    );
  }

  if (grant.condition === undefined) {
    return;
  }

  const conditionType = validateExpression(
    grant.condition,
    `${grantPath}.condition`,
    fieldsByName,
    {
      invalid: MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_INVALID,
      field: MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_FIELD_UNKNOWN,
      runtime: MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_RUNTIME_PROPERTY_INVALID,
      type: MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_TYPE,
    },
    diagnostics,
  );

  if (conditionType !== "boolean" && conditionType !== "unknown") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_GRANT_CONDITION_TYPE,
        `Business context '${context.name}' grant '${grant.name}' condition must resolve to boolean, not ${conditionType}.`,
        `${grantPath}.condition`,
      ),
    );
  }
}
function validateContextMembership(
  membership: ResolvedContextMembership,
  context: ResolvedBusinessContext,
  membershipPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const membershipObject = indexes.objectsByName.get(membership.object)?.item;

  if (membershipObject === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_OBJECT_UNKNOWN,
        `Business context '${context.name}' membership references unknown object '${membership.object}'.`,
        `${membershipPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(membershipObject.fields);
  validateMembershipField(
    membership.userField,
    "userField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );
  const contextField = validateMembershipField(
    membership.contextField,
    "contextField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );
  const roleField = validateMembershipField(
    membership.roleField,
    "roleField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );

  if (contextField !== undefined && contextField.lookup?.targetObject !== context.object) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_CONTEXT_FIELD_INVALID,
        `Business context '${context.name}' membership context field '${membership.contextField}' must look up '${context.object}'.`,
        `${membershipPath}.contextField`,
      ),
    );
  }

  if (roleField !== undefined && roleField.type !== "text") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_ROLE_FIELD_INVALID,
        `Business context '${context.name}' membership role field '${membership.roleField}' must be a text field.`,
        `${membershipPath}.roleField`,
      ),
    );
  }
}
function validateMembershipField(
  fieldName: string,
  propertyName: "userField" | "contextField" | "roleField",
  context: ResolvedBusinessContext,
  membershipObject: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  membershipPath: string,
  diagnostics: Diagnostic[],
): ResolvedField | undefined {
  const field = fieldsByName.get(fieldName)?.item;

  if (field === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_FIELD_UNKNOWN,
        `Business context '${context.name}' membership field '${fieldName}' does not exist on object '${membershipObject.name}'.`,
        `${membershipPath}.${propertyName}`,
      ),
    );
  }

  return field;
}
