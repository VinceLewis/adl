import type {
  EditChildOperationKind,
  JsonValue,
  ResolvedApplicationModel,
  ResolvedEditChildCollectionSection,
  ResolvedEditFieldsSection,
  ResolvedEditSection,
  ResolvedField,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { RuntimeModelError, RuntimeValidationError, cloneJson } from "./runtime-types.js";
import type { PolicyDecision, RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface RuntimeEditSurfaceDataSource {
  read(objectName: string, id: string, context: RuntimeContext): Promise<StoredObjectRecord | null>;
  search(objectName: string, context: RuntimeContext): Promise<StoredObjectRecord[]>;
  create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord>;
  update(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord>;
  delete(objectName: string, id: string, context: RuntimeContext): Promise<StoredObjectRecord>;
  evaluatePolicy(
    objectName: string,
    action: "create" | "update" | "delete",
    context: RuntimeContext,
    options?: {
      record?: StoredObjectRecord;
      patch?: Record<string, JsonValue>;
    },
  ): PolicyDecision;
  canWrite(
    objectName: string,
    operation: "create" | "update" | "delete",
    context: RuntimeContext,
  ): { allowed: boolean; reason?: string };
}

export type RuntimeEditMode = "create" | "edit";

export interface RuntimeEditSurfaceEvaluationInput {
  objectName: string;
  viewName: string;
  mode: RuntimeEditMode;
  context: RuntimeContext;
  recordId?: string;
  stagedChanges?: RuntimeStagedChildOperation[];
}

export interface RuntimeEditSurface {
  object: string;
  view: string;
  mode: RuntimeEditMode;
  record?: StoredObjectRecord;
  sections: RuntimeEditSection[];
  stagedChanges: RuntimeStagedChildOperation[];
  diagnostics: RuntimeEditSurfaceDiagnostic[];
}

export type RuntimeEditSection = RuntimeEditFieldsSection | RuntimeEditChildCollectionSection;

export interface RuntimeEditFieldsSection {
  name: string;
  kind: "fields";
  heading?: string;
  fields: ResolvedField[];
}

export interface RuntimeEditChildCollectionSection {
  name: string;
  kind: "childCollection";
  heading?: string;
  childObject: string;
  parentField: string;
  childView?: string;
  fields: ResolvedField[];
  operations: EditChildOperationKind[];
  staged: boolean;
  orderField?: string;
  emptyState: { text: string };
  rows: RuntimeEditChildRow[];
  actions: RuntimeEditChildAction[];
}

export interface RuntimeEditChildRow {
  id: string;
  source: "persisted" | "staged";
  values: Record<string, JsonValue>;
  record?: StoredObjectRecord;
  stagedOperationId?: string;
  actions: RuntimeEditChildAction[];
}

export interface RuntimeEditChildAction {
  operation: EditChildOperationKind;
  visible: boolean;
  enabled: boolean;
  reasons: string[];
}

export interface RuntimeStagedChildOperation {
  id: string;
  section: string;
  operation: EditChildOperationKind | "updateChild";
  childObject: string;
  childId?: string;
  values?: Record<string, JsonValue>;
  position?: number;
}

export interface RuntimeApplyStagedChildInput {
  objectName: string;
  viewName: string;
  parentRecordId: string;
  context: RuntimeContext;
  stagedChanges: RuntimeStagedChildOperation[];
}

export interface RuntimeApplyStagedChildResult {
  parentRecordId: string;
  applied: RuntimeAppliedChildOperation[];
}

export interface RuntimeAppliedChildOperation {
  operationId: string;
  operation: RuntimeStagedChildOperation["operation"];
  childObject: string;
  recordId?: string;
}

export interface RuntimeEditSurfaceDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  section?: string;
  operationId?: string;
}

export class EditSurfaceRuntime {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly dataSource: RuntimeEditSurfaceDataSource,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger,
  ) {}

  async evaluate(input: RuntimeEditSurfaceEvaluationInput): Promise<RuntimeEditSurface> {
    this.logger.debug("ENTER EditSurfaceRuntime.evaluate", {
      objectName: input.objectName,
      viewName: input.viewName,
      mode: input.mode,
    });
    const object = this.index.getObject(input.objectName);
    const view = getView(object, input.viewName);
    const record =
      input.recordId === undefined
        ? undefined
        : ((await this.dataSource.read(input.objectName, input.recordId, input.context)) ??
          undefined);
    const stagedChanges = (input.stagedChanges ?? []).map(cloneStagedOperation);
    const diagnostics: RuntimeEditSurfaceDiagnostic[] = [];
    const sections: RuntimeEditSection[] = [];

    for (const section of view.editSections) {
      if (section.kind === "fields") {
        sections.push(evaluateFieldsSection(object, section));
        continue;
      }

      sections.push(
        await this.evaluateChildCollectionSection({
          section,
          parentObject: object,
          view,
          mode: input.mode,
          context: input.context,
          stagedChanges,
          diagnostics,
          ...(record === undefined ? {} : { record }),
        }),
      );
    }

    this.logger.debug("EXIT EditSurfaceRuntime.evaluate", {
      objectName: input.objectName,
      viewName: input.viewName,
      sections: sections.length,
    });

    return {
      object: object.name,
      view: view.name,
      mode: input.mode,
      ...(record === undefined ? {} : { record }),
      sections,
      stagedChanges,
      diagnostics,
    };
  }

  async applyStagedChanges(
    input: RuntimeApplyStagedChildInput,
  ): Promise<RuntimeApplyStagedChildResult> {
    const object = this.index.getObject(input.objectName);
    const view = getView(object, input.viewName);
    const parent = await this.dataSource.read(
      input.objectName,
      input.parentRecordId,
      input.context,
    );
    if (parent === null) {
      throw new RuntimeModelError(
        `Cannot apply staged child changes because parent record '${input.parentRecordId}' does not exist.`,
        { objectName: input.objectName, recordId: input.parentRecordId },
      );
    }

    const sectionsByName = new Map(
      view.editSections
        .filter((section): section is ResolvedEditChildCollectionSection => {
          return section.kind === "childCollection";
        })
        .map((section) => [section.name, section]),
    );
    const applied: RuntimeAppliedChildOperation[] = [];

    for (const operation of input.stagedChanges.map(cloneStagedOperation)) {
      const section = sectionsByName.get(operation.section);
      if (section === undefined) {
        throw unsupportedOperation(
          operation,
          `Unknown edit child collection '${operation.section}'.`,
        );
      }

      if (section.childObject !== operation.childObject) {
        throw unsupportedOperation(
          operation,
          `Staged operation '${operation.id}' targets child object '${operation.childObject}', but section '${section.name}' manages '${section.childObject}'.`,
        );
      }

      if (!section.operations.includes(operation.operation as EditChildOperationKind)) {
        throw unsupportedOperation(
          operation,
          `Edit child collection '${section.name}' does not support operation '${operation.operation}'.`,
        );
      }

      const result = await this.applyStagedOperation(section, parent, operation, input.context);
      applied.push(result);
    }

    return {
      parentRecordId: parent.meta.guid,
      applied,
    };
  }

  private async evaluateChildCollectionSection(input: {
    section: ResolvedEditChildCollectionSection;
    parentObject: ResolvedObject;
    view: ResolvedView;
    mode: RuntimeEditMode;
    context: RuntimeContext;
    record?: StoredObjectRecord;
    stagedChanges: RuntimeStagedChildOperation[];
    diagnostics: RuntimeEditSurfaceDiagnostic[];
  }): Promise<RuntimeEditChildCollectionSection> {
    const childObject = this.index.getObject(input.section.childObject);
    const fields = getChildSectionFields(childObject, input.section);
    const persistedRows =
      input.record === undefined
        ? []
        : (await this.dataSource.search(childObject.name, input.context))
            .filter(
              (record) => record.values[input.section.parentField] === input.record?.meta.guid,
            )
            .map((record) => this.toPersistedChildRow(record, input.section, input.context));
    const stagedRows = input.stagedChanges
      .filter((operation) => operation.section === input.section.name)
      .filter((operation) => operation.operation === "createChild")
      .map((operation) => ({
        id: operation.id,
        source: "staged" as const,
        values: cloneJson(operation.values ?? {}),
        stagedOperationId: operation.id,
        actions: [
          {
            operation: "remove" as const,
            visible: true,
            enabled: true,
            reasons: [],
          },
        ],
      }));

    return {
      name: input.section.name,
      kind: "childCollection",
      ...(input.section.heading === undefined ? {} : { heading: input.section.heading }),
      childObject: childObject.name,
      parentField: input.section.parentField,
      ...(input.section.childView === undefined ? {} : { childView: input.section.childView }),
      fields,
      operations: [...input.section.operations],
      staged: input.section.staged,
      ...(input.section.orderField === undefined ? {} : { orderField: input.section.orderField }),
      emptyState: { ...input.section.emptyState },
      rows: [...persistedRows, ...stagedRows],
      actions: input.section.operations.map((operation) =>
        this.evaluateCollectionAction(
          operation,
          childObject,
          input.section,
          input.context,
          input.record,
        ),
      ),
    };
  }

  private toPersistedChildRow(
    record: StoredObjectRecord,
    section: ResolvedEditChildCollectionSection,
    context: RuntimeContext,
  ): RuntimeEditChildRow {
    const childObject = this.index.getObject(section.childObject);
    return {
      id: record.meta.guid,
      source: "persisted",
      record,
      values: cloneJson(record.values),
      actions: section.operations
        .filter((operation) => operation !== "createChild" && operation !== "linkExisting")
        .map((operation) =>
          this.evaluateRowAction(operation, childObject, section, context, record),
        ),
    };
  }

  private evaluateCollectionAction(
    operation: EditChildOperationKind,
    childObject: ResolvedObject,
    section: ResolvedEditChildCollectionSection,
    context: RuntimeContext,
    parentRecord: StoredObjectRecord | undefined,
  ): RuntimeEditChildAction {
    if (operation !== "createChild" && operation !== "linkExisting") {
      return { operation, visible: false, enabled: false, reasons: [] };
    }

    if (parentRecord === undefined && !section.staged) {
      return {
        operation,
        visible: true,
        enabled: false,
        reasons: ["Parent record must be saved before child changes can be applied."],
      };
    }

    const action = operation === "createChild" ? "create" : "update";
    const patch =
      parentRecord === undefined ? {} : { [section.parentField]: parentRecord.meta.guid };
    const decision = this.dataSource.evaluatePolicy(childObject.name, action, context, { patch });
    const sync = this.dataSource.canWrite(childObject.name, action, context);
    return {
      operation,
      visible: decision.effect === "allow",
      enabled: decision.effect === "allow" && sync.allowed,
      reasons: [
        ...decision.reasons.map((reason) => reason.message),
        ...(sync.allowed ? [] : [sync.reason ?? "Write is not allowed."]),
      ],
    };
  }

  private evaluateRowAction(
    operation: EditChildOperationKind,
    childObject: ResolvedObject,
    section: ResolvedEditChildCollectionSection,
    context: RuntimeContext,
    record: StoredObjectRecord,
  ): RuntimeEditChildAction {
    const action = operation === "remove" ? "delete" : "update";
    const patch =
      operation === "unlink"
        ? { [section.parentField]: null }
        : operation === "reorder" && section.orderField !== undefined
          ? { [section.orderField]: record.values[section.orderField] ?? null }
          : {};
    const decision = this.dataSource.evaluatePolicy(childObject.name, action, context, {
      record,
      patch,
    });
    const sync = this.dataSource.canWrite(childObject.name, action, context);

    return {
      operation,
      visible: decision.effect === "allow",
      enabled: decision.effect === "allow" && sync.allowed,
      reasons: [
        ...decision.reasons.map((reason) => reason.message),
        ...(sync.allowed ? [] : [sync.reason ?? "Write is not allowed."]),
      ],
    };
  }

  private async applyStagedOperation(
    section: ResolvedEditChildCollectionSection,
    parent: StoredObjectRecord,
    operation: RuntimeStagedChildOperation,
    context: RuntimeContext,
  ): Promise<RuntimeAppliedChildOperation> {
    if (operation.operation === "createChild") {
      const created = await this.dataSource.create(
        section.childObject,
        {
          ...(operation.values ?? {}),
          [section.parentField]: parent.meta.guid,
        },
        context,
      );
      return appliedOperation(operation, created.meta.guid);
    }

    if (operation.childId === undefined) {
      throw unsupportedOperation(operation, `Staged operation '${operation.id}' requires childId.`);
    }

    if (operation.operation === "linkExisting") {
      const linked = await this.dataSource.update(
        section.childObject,
        operation.childId,
        { [section.parentField]: parent.meta.guid },
        context,
      );
      return appliedOperation(operation, linked.meta.guid);
    }

    if (operation.operation === "unlink") {
      const unlinked = await this.dataSource.update(
        section.childObject,
        operation.childId,
        { [section.parentField]: null },
        context,
      );
      return appliedOperation(operation, unlinked.meta.guid);
    }

    if (operation.operation === "remove") {
      const removed = await this.dataSource.delete(section.childObject, operation.childId, context);
      return appliedOperation(operation, removed.meta.guid);
    }

    if (operation.operation === "updateChild") {
      const updated = await this.dataSource.update(
        section.childObject,
        operation.childId,
        operation.values ?? {},
        context,
      );
      return appliedOperation(operation, updated.meta.guid);
    }

    if (operation.operation === "reorder") {
      if (section.orderField === undefined || operation.position === undefined) {
        throw unsupportedOperation(
          operation,
          `Staged reorder operation '${operation.id}' requires orderField and position.`,
        );
      }
      const reordered = await this.dataSource.update(
        section.childObject,
        operation.childId,
        { [section.orderField]: operation.position },
        context,
      );
      return appliedOperation(operation, reordered.meta.guid);
    }

    throw unsupportedOperation(
      operation,
      `Staged child operation '${operation.operation}' is not supported.`,
    );
  }
}

function evaluateFieldsSection(
  object: ResolvedObject,
  section: ResolvedEditFieldsSection,
): RuntimeEditFieldsSection {
  const fields = section.fields
    .map((fieldName) => object.fields.find((field) => field.name === fieldName))
    .filter((field): field is ResolvedField => field !== undefined);

  return {
    name: section.name,
    kind: "fields",
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    fields,
  };
}

function getChildSectionFields(
  childObject: ResolvedObject,
  section: ResolvedEditChildCollectionSection,
): ResolvedField[] {
  const childView =
    section.childView === undefined
      ? undefined
      : childObject.views.find((view) => view.name === section.childView);
  const fieldNames = childView?.fields ?? childObject.fields.map((field) => field.name);
  return fieldNames
    .filter((fieldName) => fieldName !== section.parentField)
    .map((fieldName) => childObject.fields.find((field) => field.name === fieldName))
    .filter((field): field is ResolvedField => field !== undefined && !field.hidden);
}

function getView(object: ResolvedObject, viewName: string): ResolvedView {
  const view = object.views.find((candidate) => candidate.name === viewName);
  if (view === undefined) {
    throw new RuntimeModelError(`View '${viewName}' does not exist on object '${object.name}'.`, {
      objectName: object.name,
      viewName,
    });
  }
  return view;
}

function cloneStagedOperation(operation: RuntimeStagedChildOperation): RuntimeStagedChildOperation {
  return {
    ...operation,
    ...(operation.values === undefined ? {} : { values: cloneJson(operation.values) }),
  };
}

function appliedOperation(
  operation: RuntimeStagedChildOperation,
  recordId: string,
): RuntimeAppliedChildOperation {
  return {
    operationId: operation.id,
    operation: operation.operation,
    childObject: operation.childObject,
    recordId,
  };
}

function unsupportedOperation(operation: RuntimeStagedChildOperation, message: string): never {
  throw new RuntimeValidationError("Staged child changes could not be applied.", [
    {
      code: "ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED",
      message,
      path: `stagedChanges.${operation.id}`,
    },
  ]);
}
