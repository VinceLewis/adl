import { RECORD_ID_JOIN_FIELD } from "../../model/resolved-model.js";
import type {
  ReadModelJoinCardinality,
  ReadModelSourceScope,
  ReadModelStrategy,
  ResolvedReadModel,
  ResolvedReadModelSource,
  ResolvedViewContext,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  FIELD_TYPES,
  VIEW_CONTEXT_MODES,
  diagnostic,
  expressionTypeField,
  expressionTypeToFieldType,
  indexByName,
  indexObjectExpressionFields,
  reportDuplicateNames,
} from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";

const READ_MODEL_SOURCE_SCOPES = new Set<ReadModelSourceScope>([
  "all",
  "currentContext",
  "allAvailableContexts",
  "currentUser",
]);
const READ_MODEL_STRATEGIES = new Set<ReadModelStrategy>(["join", "union"]);
const READ_MODEL_JOIN_CARDINALITIES = new Set<ReadModelJoinCardinality>(["one", "many"]);
export function validateReadModel(
  readModel: ResolvedReadModel,
  readModelIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const readModelPath = `readModels[${readModelIndex}]`;
  const sourcesByName = indexByName(readModel.sources);

  validateReadModelContext(readModel.context, `${readModelPath}.context`, indexes, diagnostics);
  if (!READ_MODEL_STRATEGIES.has(readModel.strategy)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_STRATEGY_INVALID,
        `Read model '${readModel.name}' has invalid strategy '${String(readModel.strategy)}'.`,
        `${readModelPath}.strategy`,
      ),
    );
  }
  reportDuplicateNames(
    readModel.sources,
    `${readModelPath}.sources`,
    MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_DUPLICATE,
    diagnostics,
    `Source names must be unique within read model '${readModel.name}'.`,
  );
  reportDuplicateNames(
    readModel.fields,
    `${readModelPath}.fields`,
    MODEL_VALIDATION_CODES.READ_MODEL_FIELD_DUPLICATE,
    diagnostics,
    `Output field names must be unique within read model '${readModel.name}'.`,
  );

  const earlierSourcesByName = new Map<string, ResolvedReadModelSource>();
  for (let sourceIndex = 0; sourceIndex < readModel.sources.length; sourceIndex += 1) {
    const source = readModel.sources[sourceIndex];
    if (source === undefined) {
      continue;
    }

    if (!READ_MODEL_SOURCE_SCOPES.has(source.scope)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_SCOPE_INVALID,
          `Read model '${readModel.name}' source '${source.name}' has invalid scope '${String(source.scope)}'.`,
          `${readModelPath}.sources[${sourceIndex}].scope`,
        ),
      );
    }

    const sourceObject = indexes.objectsByName.get(source.object)?.item;
    if (sourceObject === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_OBJECT_UNKNOWN,
          `Read model '${readModel.name}' source '${source.name}' references unknown object '${source.object}'.`,
          `${readModelPath}.sources[${sourceIndex}].object`,
        ),
      );
    }

    validateReadModelSourceJoin(
      source,
      sourceIndex === 0,
      readModel,
      `${readModelPath}.sources[${sourceIndex}]`,
      earlierSourcesByName,
      indexes,
      diagnostics,
    );

    earlierSourcesByName.set(source.name, source);
  }

  const fieldNames = new Set(readModel.fields.map((field) => field.name));
  for (let sortIndex = 0; sortIndex < readModel.sort.length; sortIndex += 1) {
    const sortItem = readModel.sort[sortIndex];
    if (sortItem === undefined) {
      continue;
    }
    if (!fieldNames.has(sortItem.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SORT_FIELD_UNKNOWN,
          `Read model '${readModel.name}' sorts by unknown output field '${sortItem.field}'.`,
          `${readModelPath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }

  const projectedFieldsByName = new Map<string, NamedReference<ExpressionFieldReference>>();
  for (let fieldIndex = 0; fieldIndex < readModel.fields.length; fieldIndex += 1) {
    const field = readModel.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    const fieldPath = `${readModelPath}.fields[${fieldIndex}]`;

    if (field.type !== undefined && !FIELD_TYPES.has(field.type)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_TYPE_INVALID,
          `Read model '${readModel.name}' output field '${field.name}' has invalid type '${String(field.type)}'.`,
          `${fieldPath}.type`,
        ),
      );
    }

    if (field.expression !== undefined) {
      if (field.source !== undefined || field.field !== undefined) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SHAPE_INVALID,
            `Read model '${readModel.name}' expression field '${field.name}' cannot also project a source field.`,
            fieldPath,
          ),
        );
      }

      const expressionType = validateExpression(
        field.expression,
        `${fieldPath}.expression`,
        projectedFieldsByName,
        {
          invalid: MODEL_VALIDATION_CODES.READ_MODEL_FIELD_EXPRESSION_INVALID,
          field: MODEL_VALIDATION_CODES.READ_MODEL_FIELD_EXPRESSION_FIELD_UNKNOWN,
          runtime: MODEL_VALIDATION_CODES.READ_MODEL_FIELD_EXPRESSION_RUNTIME_PROPERTY_INVALID,
          type: MODEL_VALIDATION_CODES.READ_MODEL_FIELD_EXPRESSION_TYPE,
        },
        diagnostics,
      );

      if (
        field.type !== undefined &&
        expressionType !== "unknown" &&
        expressionType !== "null" &&
        expressionTypeToFieldType(expressionType) !== field.type
      ) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.READ_MODEL_FIELD_EXPRESSION_TYPE,
            `Read model '${readModel.name}' expression field '${field.name}' declares ${field.type} but expression resolves to ${expressionType}.`,
            `${fieldPath}.expression`,
          ),
        );
      }

      projectedFieldsByName.set(field.name, {
        item: expressionTypeField(field.name, field.type ?? expressionType),
        index: fieldIndex,
      });
      continue;
    }

    if (field.field !== undefined && field.source === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SOURCE_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' must name a source before referencing field '${field.field}'.`,
          `${fieldPath}.source`,
        ),
      );
      continue;
    }

    if (field.source === undefined) {
      projectedFieldsByName.set(field.name, {
        item: expressionTypeField(field.name, field.type ?? "text"),
        index: fieldIndex,
      });
      continue;
    }

    const source = sourcesByName.get(field.source)?.item;
    if (source === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SOURCE_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' references unknown source '${field.source}'.`,
          `${fieldPath}.source`,
        ),
      );
      continue;
    }

    const sourceObject = indexes.objectsByName.get(source.object)?.item;
    if (sourceObject === undefined || field.field === undefined) {
      projectedFieldsByName.set(field.name, {
        item: expressionTypeField(field.name, field.type ?? "text"),
        index: fieldIndex,
      });
      continue;
    }

    const sourceFieldsByName = indexObjectExpressionFields(sourceObject);
    const sourceField = sourceFieldsByName.get(field.field)?.item;
    if (sourceField === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' references unknown field '${field.field}' on source '${source.name}'.`,
          `${fieldPath}.field`,
        ),
      );
    }

    projectedFieldsByName.set(field.name, {
      item: expressionTypeField(field.name, field.type ?? sourceField?.type ?? "text"),
      index: fieldIndex,
    });
  }
}
/**
 * A join is only evaluable in one direction: the runtime walks the sources in
 * declaration order, so a source may only reach one it already has. Naming
 * itself or a later source would ask the runtime to key on rows it has not read,
 * which is the same forward-reference ban command steps carry, for the same
 * reason.
 */
function validateReadModelSourceJoin(
  source: ResolvedReadModelSource,
  isPrimarySource: boolean,
  readModel: ResolvedReadModel,
  sourcePath: string,
  earlierSourcesByName: Map<string, ResolvedReadModelSource>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const join = source.join;
  if (join === undefined) {
    return;
  }

  if (isPrimarySource) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_PRIMARY_SOURCE_INVALID,
        `Read model '${readModel.name}' source '${source.name}' is the first source and has nothing to join onto.`,
        `${sourcePath}.join`,
      ),
    );
  }

  if (readModel.strategy === "union") {
    /*
     * A union interleaves independent feeds rather than widening one row, so
     * there is no upstream row for a join to key against. Accepting the
     * declaration would leave two plausible readings of the same model.
     */
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_STRATEGY_INVALID,
        `Read model '${readModel.name}' uses the union strategy, so source '${source.name}' must not declare a join.`,
        `${sourcePath}.join`,
      ),
    );
  }

  if (!READ_MODEL_JOIN_CARDINALITIES.has(join.cardinality)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_CARDINALITY_INVALID,
        `Read model '${readModel.name}' source '${source.name}' has invalid join cardinality '${String(join.cardinality)}'.`,
        `${sourcePath}.join.cardinality`,
      ),
    );
  }

  const joinedSource = earlierSourcesByName.get(join.source);
  if (joinedSource === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_JOIN_SOURCE_UNKNOWN,
        `Read model '${readModel.name}' source '${source.name}' joins unknown or later source '${join.source}'.`,
        `${sourcePath}.join.source`,
      ),
    );
  }

  validateReadModelJoinField(
    join.localField,
    source,
    readModel,
    `${sourcePath}.join.localField`,
    indexes,
    diagnostics,
  );

  if (joinedSource !== undefined) {
    validateReadModelJoinField(
      join.sourceField,
      joinedSource,
      readModel,
      `${sourcePath}.join.sourceField`,
      indexes,
      diagnostics,
    );
  }
}
function validateReadModelJoinField(
  fieldName: string,
  source: ResolvedReadModelSource,
  readModel: ResolvedReadModel,
  fieldPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  // The record's own id is not a declared field, and requiring an object to
  // carry a duplicate of it would make every junction join say the same thing
  // twice.
  if (fieldName === RECORD_ID_JOIN_FIELD) {
    return;
  }

  const object = indexes.objectsByName.get(source.object)?.item;
  if (object === undefined) {
    // Already reported against the source itself.
    return;
  }

  if (indexObjectExpressionFields(object).has(fieldName)) {
    return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.READ_MODEL_JOIN_FIELD_UNKNOWN,
      `Read model '${readModel.name}' join references unknown field '${fieldName}' on source '${source.name}' object '${object.name}'.`,
      fieldPath,
    ),
  );
}
function validateReadModelContext(
  context: ResolvedViewContext | undefined,
  contextPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (context === undefined) {
    return;
  }

  if (!VIEW_CONTEXT_MODES.has(context.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_MODE_INVALID,
        `Read model has invalid context mode '${String(context.mode)}'.`,
        `${contextPath}.mode`,
      ),
    );
  }

  if (context.mode !== "none" && context.context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_REQUIRED,
        `Read model context mode '${String(context.mode)}' must reference a business context.`,
        `${contextPath}.context`,
      ),
    );
    return;
  }

  if (context.context !== undefined && !indexes.contextsByName.has(context.context)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_UNKNOWN,
        `Read model references unknown context '${context.context}'.`,
        `${contextPath}.context`,
      ),
    );
  }
}
