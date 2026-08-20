import type {
  PartialReadModelFieldModel,
  PartialReadModelModel,
  PartialReadModelSourceModel,
  PartialViewContextModel,
  ReadModelSourceScope,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedReadModelField,
  ResolvedReadModelSource,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";
import { resolveSort, resolveViewContext } from "./view.js";

export function resolveReadModels(
  input: PartialReadModelModel[],
  objects: ResolvedObject[],
): ResolvedReadModel[] {
  const objectsByName = new Map(objects.map((object) => [object.name, object]));
  return input.map((readModel) => resolveReadModel(readModel, objectsByName));
}
function resolveReadModel(
  input: PartialReadModelModel,
  objectsByName: Map<string, ResolvedObject>,
): ResolvedReadModel {
  const defaultScope = defaultReadModelSourceScope(input.context);
  const sources = input.sources.map((source) => resolveReadModelSource(source, defaultScope));
  const sourcesByName = new Map(sources.map((source) => [source.name, source]));

  return {
    name: input.name,
    ...(input.context === undefined ? {} : { context: resolveViewContext(input.context) }),
    strategy: input.strategy ?? "join",
    sources,
    fields: input.fields.map((field) =>
      resolveReadModelField(field, sources, sourcesByName, objectsByName),
    ),
    sort: [...(input.sort ?? [])].map(resolveSort),
  };
}
function resolveReadModelSource(
  input: PartialReadModelSourceModel,
  defaultScope: ReadModelSourceScope,
): ResolvedReadModelSource {
  return {
    name: input.name ?? input.object,
    object: input.object,
    scope: input.scope ?? defaultScope,
    ...(input.join === undefined
      ? {}
      : {
          join: {
            source: input.join.source,
            localField: input.join.localField,
            sourceField: input.join.sourceField,
            // `one` keeps a declared join row-count-neutral, matching what the
            // implicit lookup join always did; fanning out is opt-in.
            cardinality: input.join.cardinality ?? "one",
          },
        }),
  };
}
export function titleCaseIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
export function normaliseIdentifier(value: string): string {
  return value.replace(/[_-\s]+/g, "").toLowerCase();
}
function defaultReadModelSourceScope(
  context: PartialViewContextModel | undefined,
): ReadModelSourceScope {
  if (context?.mode === "all") {
    return "allAvailableContexts";
  }

  if (context?.mode === "required" || context?.mode === "optional") {
    return "currentContext";
  }

  return "all";
}
function resolveReadModelField(
  input: PartialReadModelFieldModel,
  sources: ResolvedReadModelSource[],
  sourcesByName: Map<string, ResolvedReadModelSource>,
  objectsByName: Map<string, ResolvedObject>,
): ResolvedReadModelField {
  const sourceName =
    input.expression === undefined
      ? (input.source ?? (sources.length === 1 ? sources[0]?.name : undefined))
      : input.source;
  const source = sourceName === undefined ? undefined : sourcesByName.get(sourceName);
  const sourceObject = source === undefined ? undefined : objectsByName.get(source.object);
  const sourceField =
    input.field === undefined
      ? undefined
      : [...(sourceObject?.fields ?? []), ...(sourceObject?.computedFields ?? [])].find(
          (field) => field.name === input.field,
        );
  const fieldType = input.type ?? (input.expression === undefined ? sourceField?.type : undefined);
  // A projected field inherits its source field's `LOOKUP` for the same reason
  // it already inherits that field's type: the projection is the *same* value,
  // and dropping what the value means leaves every read-model-backed surface
  // rendering a stored record id where the object-backed ones render the
  // target's display value. Expression fields compute a new value rather than
  // projecting one, so they never inherit a lookup.
  const sourceLookup =
    input.expression === undefined && sourceField !== undefined && "lookup" in sourceField
      ? sourceField.lookup
      : undefined;

  return {
    name: input.name,
    ...(fieldType === undefined ? {} : { type: fieldType }),
    ...(sourceName === undefined ? {} : { source: sourceName }),
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.expression === undefined ? {} : { expression: resolveExpression(input.expression) }),
    ...(sourceLookup === undefined ? {} : { lookup: sourceLookup }),
  };
}
