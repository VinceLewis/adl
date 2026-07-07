import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedField,
  ResolvedObject,
  ResolvedPolicy,
  ResolvedReadModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RuntimeModelError, cloneJson } from "./runtime-types.js";

export class RuntimeModelIndex {
  private readonly objectsByName: Map<string, ResolvedObject>;
  private readonly policiesByObject: Map<string, ResolvedPolicy[]>;
  private readonly readModelsByName: Map<string, ResolvedReadModel>;
  private readonly rolesByName: Map<string, string[]>;
  private readonly contextsByName: Map<string, ResolvedBusinessContext>;
  private readonly contextsByObject: Map<string, ResolvedBusinessContext[]>;

  constructor(readonly model: ResolvedApplicationModel) {
    this.objectsByName = new Map(model.objects.map((object) => [object.name, object]));
    this.policiesByObject = groupPoliciesByObject(model.policies);
    this.readModelsByName = new Map(
      (model.readModels ?? []).map((readModel) => [readModel.name, readModel]),
    );
    this.rolesByName = new Map(model.roles.map((role) => [role.name, role.inherits]));
    this.contextsByName = new Map((model.contexts ?? []).map((context) => [context.name, context]));
    this.contextsByObject = groupContextsByObject(model.contexts ?? []);
  }

  getObject(objectName: string): ResolvedObject {
    const object = this.objectsByName.get(objectName);

    if (object === undefined) {
      throw new RuntimeModelError(`Object '${objectName}' does not exist in the resolved model.`, {
        objectName,
      });
    }

    return object;
  }

  getPoliciesForObject(objectName: string): ResolvedPolicy[] {
    this.getObject(objectName);
    return [...(this.policiesByObject.get(objectName) ?? [])];
  }

  getReadModel(readModelName: string): ResolvedReadModel {
    const readModel = this.readModelsByName.get(readModelName);

    if (readModel === undefined) {
      throw new RuntimeModelError(
        `Read model '${readModelName}' does not exist in the resolved model.`,
        { readModelName },
      );
    }

    return readModel;
  }

  getBusinessContext(contextName: string): ResolvedBusinessContext {
    const context = this.contextsByName.get(contextName);

    if (context === undefined) {
      throw new RuntimeModelError(
        `Business context '${contextName}' does not exist in the resolved model.`,
        { contextName },
      );
    }

    return context;
  }

  getBusinessContextsForObject(objectName: string): ResolvedBusinessContext[] {
    this.getObject(objectName);
    return [...(this.contextsByObject.get(objectName) ?? [])];
  }

  getBusinessField(object: ResolvedObject, fieldName: string): ResolvedField | undefined {
    return object.fields.find((field) => field.name === fieldName);
  }

  hasBusinessField(object: ResolvedObject, fieldName: string): boolean {
    return this.getBusinessField(object, fieldName) !== undefined;
  }

  hasMetadataField(object: ResolvedObject, fieldName: string): boolean {
    return object.metadataFields.some((field) => field.name === fieldName);
  }

  expandRoles(roles: string[]): string[] {
    const expanded = new Set(roles);
    let changed = true;

    while (changed) {
      changed = false;

      for (const role of [...expanded]) {
        for (const inherited of this.rolesByName.get(role) ?? []) {
          if (!expanded.has(inherited)) {
            expanded.add(inherited);
            changed = true;
          }
        }
      }
    }

    return [...expanded];
  }
}

export function getInitialLifecycleState(object: ResolvedObject): string | undefined {
  return object.lifecycle?.initialState ?? object.lifecycle?.states[0]?.name;
}

export function isLifecycleStateBusinessField(object: ResolvedObject): boolean {
  const stateField = object.lifecycle?.stateField;
  return stateField !== undefined && object.fields.some((field) => field.name === stateField);
}

export function getRecordState(
  object: ResolvedObject,
  record: StoredObjectRecord,
): string | undefined {
  if (object.lifecycle === undefined) {
    return undefined;
  }

  if (isLifecycleStateBusinessField(object)) {
    const value = record.values[object.lifecycle.stateField];
    return typeof value === "string"
      ? value
      : (record.meta.state ?? getInitialLifecycleState(object));
  }

  return record.meta.state ?? getInitialLifecycleState(object);
}

export function getValuesState(
  object: ResolvedObject,
  values: Record<string, JsonValue>,
): string | undefined {
  if (object.lifecycle === undefined) {
    return undefined;
  }

  if (isLifecycleStateBusinessField(object)) {
    const value = values[object.lifecycle.stateField];
    return typeof value === "string" ? value : getInitialLifecycleState(object);
  }

  return getInitialLifecycleState(object);
}

export function setValuesState(
  object: ResolvedObject,
  values: Record<string, JsonValue>,
  state: string,
): Record<string, JsonValue> {
  const nextValues = cloneJson(values);

  if (object.lifecycle !== undefined && isLifecycleStateBusinessField(object)) {
    nextValues[object.lifecycle.stateField] = state;
  }

  return nextValues;
}

function groupPoliciesByObject(policies: ResolvedPolicy[]): Map<string, ResolvedPolicy[]> {
  const grouped = new Map<string, ResolvedPolicy[]>();

  for (const policy of policies) {
    grouped.set(policy.object, [...(grouped.get(policy.object) ?? []), policy]);
  }

  return grouped;
}

function groupContextsByObject(
  contexts: ResolvedBusinessContext[],
): Map<string, ResolvedBusinessContext[]> {
  const grouped = new Map<string, ResolvedBusinessContext[]>();

  for (const context of contexts) {
    grouped.set(context.object, [...(grouped.get(context.object) ?? []), context]);
  }

  return grouped;
}
