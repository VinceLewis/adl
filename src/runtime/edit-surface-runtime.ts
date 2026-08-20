import type {
  EditChildOperationKind,
  JsonValue,
  ResolvedApplicationModel,
  ResolvedEditChildCollectionSection,
  ResolvedEditChildCollectionSummary,
  ResolvedEditFieldsSection,
  ResolvedProjectedField,
  ResolvedRelationshipPicker,
  ResolvedEditSection,
  ResolvedField,
  ResolvedObject,
  ResolvedSort,
  ResolvedView,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import type { PlannedObjectWrite } from "./object-store.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import {
  PolicyDeniedError,
  RuntimeModelError,
  RuntimeValidationError,
  cloneJson,
} from "./runtime-types.js";
import type { PolicyDecision, RuntimeContext, RuntimeLogger } from "./runtime-types.js";
import type { RuntimeReadModelResult, RuntimeReadModelRow } from "./runtime-types.js";
import { formatPresentationValue } from "./presentation-runtime.js";
import type { RuntimePresentationDiagnostic } from "./presentation-runtime.js";

export interface RuntimeEditSurfaceDataSource {
  read(objectName: string, id: string, context: RuntimeContext): Promise<StoredObjectRecord | null>;
  search(objectName: string, context: RuntimeContext): Promise<StoredObjectRecord[]>;
  searchWithQuery(
    objectName: string,
    query: { text?: string; fields?: string[]; sort?: ResolvedSort[]; limit?: number },
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]>;
  executeReadModel(
    readModelName: string,
    context: RuntimeContext,
    query: { sort?: ResolvedSort[]; limit?: number },
  ): Promise<RuntimeReadModelResult>;
  /**
   * A staged batch plans every write and commits them together, rather than
   * executing them one at a time.
   *
   * Executing them one at a time is what it used to do, and it meant a batch of
   * child changes was never a transaction: it could fail halfway and leave the
   * parent's children half-changed, and it reached the authority as one intent
   * per child, which could land partially there too. The planning calls below
   * run exactly the same policy, validation, scope and sync checks the direct
   * write APIs run — they simply stop short of committing.
   */
  planCreate(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<PlannedObjectWrite>;
  planUpdate(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<PlannedObjectWrite>;
  planDelete(objectName: string, id: string, context: RuntimeContext): Promise<PlannedObjectWrite>;
  /** Commits planned writes as one storage transaction and one queued operation. */
  commitBatch(
    writes: PlannedObjectWrite[],
    context: RuntimeContext,
    options: { label?: string },
  ): Promise<StoredObjectRecord[]>;
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
  /**
   * Names of row values sourced from a related object rather than stored
   * directly on the child record -- present in `RuntimeEditChildRow.values`
   * alongside the child object's own fields once resolved. See
   * `ResolvedProjectedField` and Phase 87.
   */
  projectedFields: string[];
  operations: EditChildOperationKind[];
  staged: boolean;
  orderField?: string;
  emptyState: { text: string };
  picker?: RuntimeRelationshipPickerSummary;
  rows: RuntimeEditChildRow[];
  actions: RuntimeEditChildAction[];
  /**
   * A single aggregated value over `rows` (persisted and staged together),
   * present only when the section declares one. Computed fresh on every
   * evaluation, so it is live against unsaved edits. See Phase 87.
   */
  summary?: RuntimeEditChildCollectionSummary;
}

export interface RuntimeEditChildCollectionSummary {
  label?: string;
  text: string;
  placement: "header" | "footer";
}

export interface RuntimeRelationshipPickerSummary {
  name: string;
  sourceKind: ResolvedRelationshipPicker["sourceKind"];
  source: string;
  /**
   * Present when choosing a candidate *creates* a child naming it, rather than
   * re-parenting an existing child. A renderer must dispatch `createChild`
   * carrying this field, not `linkExisting`.
   */
  candidateField?: string;
  selection: ResolvedRelationshipPicker["selection"];
  displayFields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  excludeAlreadyLinked: boolean;
  emptyState: { text: string };
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

export interface RuntimeRelationshipPickerEvaluationInput {
  objectName: string;
  viewName: string;
  sectionName: string;
  context: RuntimeContext;
  recordId?: string;
  stagedChanges?: RuntimeStagedChildOperation[];
  query?: RuntimeRelationshipPickerQuery;
}

export interface RuntimeRelationshipPickerQuery {
  text?: string;
  limit?: number;
}

export interface RuntimeRelationshipPickerResult {
  object: string;
  view: string;
  section: string;
  picker: RuntimeRelationshipPickerSummary;
  candidates: RuntimeRelationshipPickerCandidate[];
  diagnostics: RuntimeEditSurfaceDiagnostic[];
}

export interface RuntimeRelationshipPickerCandidate {
  id: string;
  label: string;
  values: Record<string, JsonValue>;
  source:
    | { kind: "object"; objectName: string; recordId: string }
    | { kind: "readModel"; readModel: string; rowId: string; objectName: string; recordId: string };
  alreadyLinked: boolean;
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
    this.requireNoDuplicateLinkOperations(input.stagedChanges, sectionsByName);

    const operations = input.stagedChanges.map(cloneStagedOperation);
    const writes: PlannedObjectWrite[] = [];
    // The last position handed out per ordered section, so several children
    // added in one batch land after the existing ones and after each other
    // rather than all claiming the same slot.
    const appendPositions = new Map<string, number>();
    for (const operation of operations) {
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

      writes.push(
        await this.planStagedOperation(section, parent, operation, input.context, appendPositions),
      );
    }

    // One commit for the whole staged batch: either every child change lands and
    // one entry is queued for all of them, or a refusal at any single write
    // leaves nothing written and nothing queued. Planning above has already run
    // each write's policy, validation, scope and sync checks, so a refusal here
    // is the same refusal the one-at-a-time path produced — it simply now takes
    // the rest of the batch down with it, which is the point.
    // The label names the *parent*, because that is the change the person made.
    // The queue entry is filed under a representative child record, so without a
    // label a refused set-list edit would be presented to them as a rejection
    // against a set-list item row they never touched directly.
    const committed = await this.dataSource.commitBatch(writes, input.context, {
      label: `Changes to ${object.name}`,
    });

    return {
      parentRecordId: parent.meta.guid,
      applied: operations.map((operation, index) =>
        appliedOperation(operation, committed[index]?.meta.guid ?? ""),
      ),
    };
  }

  async evaluateRelationshipPicker(
    input: RuntimeRelationshipPickerEvaluationInput,
  ): Promise<RuntimeRelationshipPickerResult> {
    const parentObject = this.index.getObject(input.objectName);
    const view = getView(parentObject, input.viewName);
    const section = view.editSections.find(
      (candidate): candidate is ResolvedEditChildCollectionSection =>
        candidate.kind === "childCollection" && candidate.name === input.sectionName,
    );
    if (section === undefined) {
      throw new RuntimeModelError(
        `Edit child collection '${input.sectionName}' does not exist on view '${view.name}'.`,
        { objectName: parentObject.name, viewName: view.name, sectionName: input.sectionName },
      );
    }

    if (section.picker === undefined) {
      throw new RuntimeModelError(
        `Edit child collection '${section.name}' does not declare a relationship picker.`,
        { objectName: parentObject.name, viewName: view.name, sectionName: section.name },
      );
    }

    const parent =
      input.recordId === undefined
        ? undefined
        : ((await this.dataSource.read(parentObject.name, input.recordId, input.context)) ??
          undefined);
    const childObject = this.index.getObject(section.childObject);
    // A minting picker offers the candidate field's *target*; a linking one
    // offers the child object itself. Derived from the model rather than from
    // `picker.source`, so an object source and a read-model source agree about
    // what is being chosen.
    const candidateObject = this.index.getObject(candidateObjectName(childObject, section.picker));
    const stagedChanges = input.stagedChanges ?? [];
    const diagnostics: RuntimeEditSurfaceDiagnostic[] = [];
    const linkedIds = await this.getAlreadyLinkedChildIds(section, input.context, parent);
    const candidateField = section.picker.candidateField;
    for (const staged of stagedChanges) {
      if (staged.section !== section.name) {
        continue;
      }
      // "Already taken" means a different thing for each mode. For a minting
      // picker it is the candidate a staged child already names, not the staged
      // child's own id — offering the same song twice in one editing session is
      // exactly what the exclusion exists to prevent.
      if (candidateField !== undefined) {
        const chosen =
          staged.operation === "createChild" ? staged.values?.[candidateField] : undefined;
        if (typeof chosen === "string") {
          linkedIds.add(chosen);
        }
        continue;
      }
      if (staged.operation === "linkExisting" && staged.childId !== undefined) {
        linkedIds.add(staged.childId);
      }
    }

    const candidates = await this.loadPickerCandidates({
      picker: section.picker,
      candidateObject,
      context: input.context,
      query: input.query ?? {},
      linkedIds,
    });

    if (candidates.length === 0) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_RUNTIME_RELATIONSHIP_PICKER_EMPTY",
        message: section.picker.emptyState.text || "No records available to link.",
        section: section.name,
      });
    }

    return {
      object: parentObject.name,
      view: view.name,
      section: section.name,
      picker: summarizePicker(section.picker),
      candidates,
      diagnostics,
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
    /*
     * Scoped to this one evaluation, not shared across calls: caching a
     * fetched related record across requests would mean a projected field
     * could show a value staler than the record it was read from, for a
     * feature whose whole point is being live against unsaved edits. See
     * Phase 87 (Constraints: no cross-request cache).
     */
    const projectedFieldCache = new Map<string, StoredObjectRecord | null>();
    const persistedRecords =
      input.record === undefined
        ? []
        : (await this.dataSource.search(childObject.name, input.context)).filter(
            (record) => record.values[input.section.parentField] === input.record?.meta.guid,
          );
    const persistedRows = await Promise.all(
      persistedRecords.map((record) =>
        this.toPersistedChildRow(
          record,
          input.section,
          input.context,
          input.stagedChanges,
          input.diagnostics,
          projectedFieldCache,
        ),
      ),
    );
    const stagedRows = await this.evaluateStagedChildRows(
      input.section,
      input.stagedChanges,
      input.context,
      input.diagnostics,
      projectedFieldCache,
    );
    const rows = [...persistedRows, ...stagedRows];

    return {
      name: input.section.name,
      kind: "childCollection",
      ...(input.section.heading === undefined ? {} : { heading: input.section.heading }),
      childObject: childObject.name,
      parentField: input.section.parentField,
      ...(input.section.childView === undefined ? {} : { childView: input.section.childView }),
      fields,
      projectedFields: (input.section.projectedFields ?? []).map((field) => field.name),
      operations: [...input.section.operations],
      staged: input.section.staged,
      ...(input.section.orderField === undefined ? {} : { orderField: input.section.orderField }),
      emptyState: { ...input.section.emptyState },
      ...(input.section.picker === undefined
        ? {}
        : { picker: summarizePicker(input.section.picker) }),
      rows,
      actions: input.section.operations.map((operation) =>
        this.evaluateCollectionAction(
          operation,
          childObject,
          input.section,
          input.context,
          input.record,
        ),
      ),
      ...(input.section.summary === undefined
        ? {}
        : {
            summary: computeChildCollectionSummary(
              input.section.summary,
              rows,
              input.section.name,
              input.diagnostics,
            ),
          }),
    };
  }

  private async toPersistedChildRow(
    record: StoredObjectRecord,
    section: ResolvedEditChildCollectionSection,
    context: RuntimeContext,
    stagedChanges: RuntimeStagedChildOperation[],
    diagnostics: RuntimeEditSurfaceDiagnostic[],
    projectedFieldCache: Map<string, StoredObjectRecord | null>,
  ): Promise<RuntimeEditChildRow> {
    const childObject = this.index.getObject(section.childObject);
    /*
     * A staged edit is shown on the row it changes, not held back until the
     * parent is saved.
     *
     * Every other staged operation in a collection is already visible before the
     * save — a create and a link render as staged rows, a remove drops its row,
     * a reorder moves it — so an edit that left the old value on screen was the
     * one change a person could make and see no trace of. That is the same "the
     * button did nothing" impression inline editing exists to remove. It went
     * unnoticed because `updateChild` carried no values to show until now.
     *
     * The overlay is display only: `record` still holds what storage holds, so
     * nothing downstream mistakes a staged edit for a committed one.
     */
    const staged = stagedChanges.filter(
      (operation) =>
        operation.section === section.name &&
        operation.operation === "updateChild" &&
        operation.childId === record.meta.guid,
    );
    const values = staged.reduce<Record<string, JsonValue>>(
      (values, operation) => ({ ...values, ...cloneJson(operation.values ?? {}) }),
      cloneJson(record.values),
    );
    await this.applyProjectedFields(section, values, context, diagnostics, projectedFieldCache);

    return {
      id: record.meta.guid,
      source: "persisted",
      record,
      values,
      actions: section.operations
        .filter((operation) => operation !== "createChild" && operation !== "linkExisting")
        .map((operation) =>
          this.evaluateRowAction(operation, childObject, section, context, record),
        ),
    };
  }

  /**
   * Resolves `section.projectedFields` onto `values` in place, one related
   * read per distinct `(through, lookup value)` pair per evaluation (see
   * `projectedFieldCache`).
   *
   * Reuses `this.dataSource.read` -- the same policy-respecting method Phase
   * 71's command `READ` step uses via `objectStore.read` -- rather than
   * `ObjectStore.getRecordForRuntime`, which applies no read policy at all.
   * A denied or missing related record degrades the projected field to
   * `null` with a diagnostic (denial) or silently (missing lookup value, or
   * a lookup value naming a record that no longer exists); it never throws
   * and fails the whole section. See Phase 87.
   */
  private async applyProjectedFields(
    section: ResolvedEditChildCollectionSection,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimeEditSurfaceDiagnostic[],
    cache: Map<string, StoredObjectRecord | null>,
  ): Promise<void> {
    const projectedFields = section.projectedFields;
    if (projectedFields === undefined || projectedFields.length === 0) {
      return;
    }

    const childObject = this.index.getObject(section.childObject);
    for (const projected of projectedFields) {
      const lookupValue = values[projected.through];
      if (typeof lookupValue !== "string" || lookupValue.length === 0) {
        values[projected.name] = null;
        continue;
      }

      const throughField = childObject.fields.find((field) => field.name === projected.through);
      const targetObjectName = throughField?.lookup?.targetObject;
      if (targetObjectName === undefined) {
        values[projected.name] = null;
        continue;
      }

      const cacheKey = `${targetObjectName}:${lookupValue}`;
      let related: StoredObjectRecord | null;
      if (cache.has(cacheKey)) {
        related = cache.get(cacheKey) ?? null;
      } else {
        try {
          related = await this.dataSource.read(targetObjectName, lookupValue, context);
        } catch (error) {
          if (!(error instanceof PolicyDeniedError)) {
            throw error;
          }
          related = null;
          diagnostics.push({
            severity: "warning",
            code: "ADL_EDIT_CHILD_PROJECTED_FIELD_DENIED",
            message: `Projected field '${projected.name}' on edit child collection '${section.name}' could not be read: access to '${targetObjectName}' record '${lookupValue}' was denied.`,
            section: section.name,
          });
        }
        cache.set(cacheKey, related);
      }

      values[projected.name] = related === null ? null : (related.values[projected.field] ?? null);
    }
  }

  private async evaluateStagedChildRows(
    section: ResolvedEditChildCollectionSection,
    stagedChanges: RuntimeStagedChildOperation[],
    context: RuntimeContext,
    diagnostics: RuntimeEditSurfaceDiagnostic[],
    projectedFieldCache: Map<string, StoredObjectRecord | null>,
  ): Promise<RuntimeEditChildRow[]> {
    const rows: RuntimeEditChildRow[] = [];
    for (const operation of stagedChanges) {
      if (operation.section !== section.name) {
        continue;
      }

      if (operation.operation === "createChild") {
        const values = cloneJson(operation.values ?? {});
        await this.applyProjectedFields(section, values, context, diagnostics, projectedFieldCache);
        rows.push({
          id: operation.id,
          source: "staged",
          values,
          stagedOperationId: operation.id,
          actions: [removeStagedAction()],
        });
        continue;
      }

      if (operation.operation === "linkExisting" && operation.childId !== undefined) {
        const child = await this.dataSource.read(section.childObject, operation.childId, context);
        const values = cloneJson(child?.values ?? {});
        await this.applyProjectedFields(section, values, context, diagnostics, projectedFieldCache);
        rows.push({
          id: operation.id,
          source: "staged",
          values,
          ...(child === null ? {} : { record: child }),
          stagedOperationId: operation.id,
          actions: [removeStagedAction()],
        });
      }
    }

    return rows;
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
    // The scope value is part of the patch because it is part of the write. A
    // context-scoped child evaluated without it has no context id for the policy
    // engine to resolve context roles against, so a `ROLE BandAdmin` rule cannot
    // match and the collection's Add and Link controls silently do not render —
    // for a model whose author has granted exactly that role. The prediction and
    // the write must agree, which is why `planStagedOperation` seeds the same
    // value rather than this one merely asserting it.
    const patch = {
      ...scopeValues(childObject, context),
      ...(parentRecord === undefined ? {} : { [section.parentField]: parentRecord.meta.guid }),
    };
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

  /**
   * Turns one staged child operation into a planned write.
   *
   * Every branch plans rather than writes, so the whole batch can be handed to
   * one commit. Planning is against pre-transaction state, which is the same
   * contract a command's steps have had since Phase 57: two staged operations
   * that target the same child record would each be planned against the record
   * as it was, and the later one would win. The edit surface never produces such
   * a pair — the browser collapses repeated edits of one row into a single
   * staged operation before submitting — and a caller that constructs one by
   * hand gets last-write-wins, not a silent partial commit.
   */
  private async planStagedOperation(
    section: ResolvedEditChildCollectionSection,
    parent: StoredObjectRecord,
    operation: RuntimeStagedChildOperation,
    context: RuntimeContext,
    appendPositions: Map<string, number>,
  ): Promise<PlannedObjectWrite> {
    if (operation.operation === "createChild") {
      // The same check the `linkExisting` branch makes below, for the mode that
      // creates rather than links: a candidate this parent already holds must not
      // be added again when the model says it should not even be offered.
      const picker = section.picker;
      const candidateField =
        picker?.excludeAlreadyLinked === true ? picker.candidateField : undefined;
      const chosen = candidateField === undefined ? undefined : operation.values?.[candidateField];
      if (typeof chosen === "string") {
        const taken = await this.getAlreadyLinkedChildIds(section, context, parent);
        if (taken.has(chosen)) {
          throw duplicateLinkOperation(
            operation,
            `Candidate '${chosen}' is already held by parent record '${parent.meta.guid}' in section '${section.name}'.`,
          );
        }
      }

      const values = {
        // Seeded first so an explicit staged value still wins. Without it a
        // `SCOPE` child created from inside its parent's form carries no
        // context id at all, and fails its own required-field check and the
        // object-scope gate — the child form has no reason to ask for a
        // context the user has already selected.
        ...scopeValues(this.index.getObject(section.childObject), context),
        ...(operation.values ?? {}),
        [section.parentField]: parent.meta.guid,
      };
      // A new child in an ordered collection goes to the end unless the caller
      // said otherwise. Without this the position is simply missing, and a
      // required order field refuses the write — so "add" would be unusable on
      // exactly the collections that most want it. Appending is also what a
      // person expects: the new row appears last, ready to be moved.
      if (section.orderField !== undefined && values[section.orderField] === undefined) {
        values[section.orderField] = await this.nextAppendPosition(
          section,
          parent,
          context,
          appendPositions,
        );
      }

      return this.dataSource.planCreate(section.childObject, values, context);
    }

    if (operation.childId === undefined) {
      throw unsupportedOperation(operation, `Staged operation '${operation.id}' requires childId.`);
    }

    if (operation.operation === "linkExisting") {
      const existing = await this.dataSource.read(section.childObject, operation.childId, context);
      if (existing !== null && existing.values[section.parentField] === parent.meta.guid) {
        throw duplicateLinkOperation(
          operation,
          `Child record '${operation.childId}' is already linked to parent record '${parent.meta.guid}'.`,
        );
      }

      return this.dataSource.planUpdate(
        section.childObject,
        operation.childId,
        { [section.parentField]: parent.meta.guid },
        context,
      );
    }

    if (operation.operation === "unlink") {
      return this.dataSource.planUpdate(
        section.childObject,
        operation.childId,
        { [section.parentField]: null },
        context,
      );
    }

    if (operation.operation === "remove") {
      return this.dataSource.planDelete(section.childObject, operation.childId, context);
    }

    if (operation.operation === "updateChild") {
      const patch = operation.values ?? {};
      // A patch of nothing is not an edit. The browser's row `Edit` control used
      // to stage exactly this — it carried no values at all — so a button that
      // did nothing a person would recognise still burned a revision and a queue
      // entry on every click. Refused here so no caller can reintroduce it.
      if (Object.keys(patch).length === 0) {
        throw unsupportedOperation(
          operation,
          `Staged update operation '${operation.id}' carries no values to change.`,
        );
      }

      return this.dataSource.planUpdate(section.childObject, operation.childId, patch, context);
    }

    if (operation.operation === "reorder") {
      if (section.orderField === undefined || operation.position === undefined) {
        throw unsupportedOperation(
          operation,
          `Staged reorder operation '${operation.id}' requires orderField and position.`,
        );
      }
      return this.dataSource.planUpdate(
        section.childObject,
        operation.childId,
        { [section.orderField]: operation.position },
        context,
      );
    }

    throw unsupportedOperation(
      operation,
      `Staged child operation '${operation.operation}' is not supported.`,
    );
  }

  /**
   * The next free slot at the end of this parent's ordered collection.
   *
   * Read once per section and then counted forward in memory, because every
   * write in a batch is planned before any is committed: a second read would
   * still see the pre-transaction rows and hand out the same position twice.
   */
  private async nextAppendPosition(
    section: ResolvedEditChildCollectionSection,
    parent: StoredObjectRecord,
    context: RuntimeContext,
    appendPositions: Map<string, number>,
  ): Promise<number> {
    const issued = appendPositions.get(section.name);
    if (issued !== undefined) {
      const next = issued + 1;
      appendPositions.set(section.name, next);
      return next;
    }

    const orderField = section.orderField ?? "";
    const siblings = (await this.dataSource.search(section.childObject, context)).filter(
      (record) => record.values[section.parentField] === parent.meta.guid,
    );
    let highest = 0;
    for (const sibling of siblings) {
      const position = sibling.values[orderField];
      if (typeof position === "number" && position > highest) {
        highest = position;
      }
    }

    const next = highest + 1;
    appendPositions.set(section.name, next);
    return next;
  }

  /**
   * Refuses a batch that names the same thing twice.
   *
   * Both modes need this and for the same reason, but they identify "the same
   * thing" differently: a link is a duplicate when it names a child record
   * already named, and a minting create is one when it names a *candidate*
   * already chosen. The minting half was previously enforced only by the
   * picker's own exclusion — which is a read a renderer performs, so a caller
   * that did not perform it could add the same song to a set list twice. UI
   * behaviour must never be the only enforcement point.
   *
   * It applies to a minting picker only when the model declares
   * `excludeAlreadyLinked`. A picker that explicitly permits already-chosen
   * candidates is saying duplicates are meaningful for that collection, and this
   * must not overrule it.
   */
  private requireNoDuplicateLinkOperations(
    operations: RuntimeStagedChildOperation[],
    sectionsByName: Map<string, ResolvedEditChildCollectionSection>,
  ): void {
    const seen = new Set<string>();
    for (const operation of operations) {
      const section = sectionsByName.get(operation.section);
      const picker = section?.picker;
      const candidateField =
        picker?.excludeAlreadyLinked === true ? picker.candidateField : undefined;
      const chosen =
        candidateField === undefined || operation.operation !== "createChild"
          ? undefined
          : operation.values?.[candidateField];
      const subject =
        typeof chosen === "string"
          ? chosen
          : operation.operation === "linkExisting"
            ? operation.childId
            : undefined;
      if (subject === undefined) {
        continue;
      }

      const key = `${operation.section}\0${section?.childObject ?? operation.childObject}\0${subject}`;
      if (seen.has(key)) {
        throw duplicateLinkOperation(
          operation,
          typeof chosen === "string"
            ? `Staged create operation '${operation.id}' duplicates candidate '${subject}' in section '${operation.section}'.`
            : `Staged link operation '${operation.id}' duplicates child record '${subject}' in section '${operation.section}'.`,
        );
      }
      seen.add(key);
    }
  }

  /**
   * What the picker must not offer again.
   *
   * For a linking picker that is the ids of children already under this parent.
   * For a minting picker it is the *candidates* those children already name — a
   * song already in this set list is what must not be offered, and its set-list
   * item's own id would not identify it.
   */
  private async getAlreadyLinkedChildIds(
    section: ResolvedEditChildCollectionSection,
    context: RuntimeContext,
    parent: StoredObjectRecord | undefined,
  ): Promise<Set<string>> {
    if (parent === undefined) {
      return new Set();
    }

    const candidateField = section.picker?.candidateField;
    const children = (await this.dataSource.search(section.childObject, context)).filter(
      (record) => record.values[section.parentField] === parent.meta.guid,
    );
    if (candidateField === undefined) {
      return new Set(children.map((record) => record.meta.guid));
    }

    const taken = new Set<string>();
    for (const record of children) {
      const chosen = record.values[candidateField];
      if (typeof chosen === "string") {
        taken.add(chosen);
      }
    }
    return taken;
  }

  private async loadPickerCandidates(input: {
    picker: ResolvedRelationshipPicker;
    candidateObject: ResolvedObject;
    context: RuntimeContext;
    query: RuntimeRelationshipPickerQuery;
    linkedIds: Set<string>;
  }): Promise<RuntimeRelationshipPickerCandidate[]> {
    const candidates =
      input.picker.sourceKind === "object"
        ? await this.loadObjectPickerCandidates(input)
        : await this.loadReadModelPickerCandidates(input);
    const filtered = input.picker.excludeAlreadyLinked
      ? candidates.filter((candidate) => !input.linkedIds.has(candidate.id))
      : candidates;
    const sorted = sortPickerCandidates(filtered, input.picker.sort);
    return input.query.limit === undefined || input.query.limit < 0
      ? sorted
      : sorted.slice(0, input.query.limit);
  }

  private async loadObjectPickerCandidates(input: {
    picker: ResolvedRelationshipPicker;
    candidateObject: ResolvedObject;
    context: RuntimeContext;
    query: RuntimeRelationshipPickerQuery;
    linkedIds: Set<string>;
  }): Promise<RuntimeRelationshipPickerCandidate[]> {
    const searchFields = pickerSearchFields(input.picker, input.candidateObject);
    const records = await this.dataSource.searchWithQuery(
      input.candidateObject.name,
      {
        ...(input.query.text === undefined ? {} : { text: input.query.text }),
        fields: searchFields,
        sort: input.picker.sort,
      },
      input.context,
    );

    return records.map((record) => ({
      id: record.meta.guid,
      label: pickerCandidateLabel(
        input.picker,
        input.candidateObject,
        record.values,
        record.meta.guid,
      ),
      values: cloneJson(record.values),
      source: {
        kind: "object",
        objectName: input.candidateObject.name,
        recordId: record.meta.guid,
      },
      alreadyLinked: input.linkedIds.has(record.meta.guid),
    }));
  }

  private async loadReadModelPickerCandidates(input: {
    picker: ResolvedRelationshipPicker;
    candidateObject: ResolvedObject;
    context: RuntimeContext;
    query: RuntimeRelationshipPickerQuery;
    linkedIds: Set<string>;
  }): Promise<RuntimeRelationshipPickerCandidate[]> {
    const result = await this.dataSource.executeReadModel(input.picker.source, input.context, {
      sort: input.picker.sort,
    });
    const rows =
      input.query.text === undefined || input.query.text.trim().length === 0
        ? result.rows
        : filterReadModelPickerRows(result.rows, input.picker, input.query.text);

    return rows
      .map((row) => {
        const source = Object.values(row.sources).find(
          (candidate) => candidate.objectName === input.candidateObject.name,
        );
        if (source === undefined) {
          return undefined;
        }

        const candidate: RuntimeRelationshipPickerCandidate = {
          id: source.recordId,
          label: pickerCandidateLabel(
            input.picker,
            input.candidateObject,
            row.values,
            source.recordId,
          ),
          values: cloneJson(row.values),
          source: {
            kind: "readModel" as const,
            readModel: result.readModel.name,
            rowId: row.id,
            objectName: source.objectName,
            recordId: source.recordId,
          },
          alreadyLinked: input.linkedIds.has(source.recordId),
        };
        return candidate;
      })
      .filter(
        (candidate): candidate is RuntimeRelationshipPickerCandidate => candidate !== undefined,
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

/**
 * The context-scope field a write on this object must carry, taken from the
 * caller's current selection.
 *
 * This is the same rule the browser applies to a top-level create
 * (`applySelectedScopeToCreateValues`), applied where a *child* create is made:
 * inside its parent's form, where nothing has asked the user to name a context
 * because they selected one before opening the form at all. It grants nothing —
 * the value comes from the caller's own selection, and
 * `requireObjectScopeForValues` still refuses a write into a context they are
 * not in.
 *
 * Empty when the object declares no scope, or when nothing is selected for the
 * context it declares; in the second case the write is refused downstream, which
 * is the honest outcome rather than one invented here.
 */
/**
 * The object a picker's candidates are records of.
 *
 * A linking picker offers the child object itself. A minting picker offers
 * whatever its candidate field looks up, which validation has already required
 * the declared source to agree with — so this reads the answer off the model
 * rather than off `picker.source`, and an object source and a read-model source
 * cannot disagree about what is being chosen.
 */
function candidateObjectName(
  childObject: ResolvedObject,
  picker: ResolvedRelationshipPicker,
): string {
  if (picker.candidateField === undefined) {
    return childObject.name;
  }

  const field = childObject.fields.find((candidate) => candidate.name === picker.candidateField);
  return field?.lookup?.targetObject ?? childObject.name;
}

function scopeValues(object: ResolvedObject, context: RuntimeContext): Record<string, JsonValue> {
  const scope = object.scope;
  if (scope === undefined) {
    return {};
  }

  const contextId = context.selectedContexts?.[scope.context];
  return contextId === undefined ? {} : { [scope.field]: contextId };
}

/**
 * Reduces over the *final* assembled row set (persisted rows plus staged,
 * not-yet-saved changes) rather than a fresh read from storage -- the whole
 * reason this lives in `evaluateChildCollectionSection` rather than the
 * generic presentation `LIST` path: this collection already recomputes its
 * full row set on every add/remove/reorder before save, so a summary
 * computed from that same row set updates live as a person edits, with no
 * additional wiring. `null`/`undefined` per-row values are skipped, matching
 * the convention `formatPresentationValue` already uses elsewhere. See
 * Phase 87.
 */
function computeChildCollectionSummary(
  summary: ResolvedEditChildCollectionSummary,
  rows: RuntimeEditChildRow[],
  sectionName: string,
  diagnostics: RuntimeEditSurfaceDiagnostic[],
): RuntimeEditChildCollectionSummary {
  const numericValues: number[] = [];
  let nonNullCount = 0;
  for (const row of rows) {
    const raw = summary.field === undefined ? undefined : row.values[summary.field];
    if (raw === undefined || raw === null) {
      continue;
    }
    nonNullCount += 1;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      numericValues.push(raw);
    }
  }

  let result: number;
  switch (summary.aggregate) {
    case "sum":
      result = numericValues.reduce((total, value) => total + value, 0);
      break;
    case "avg":
      result =
        numericValues.length === 0
          ? 0
          : numericValues.reduce((total, value) => total + value, 0) / numericValues.length;
      break;
    case "min":
      result = numericValues.length === 0 ? 0 : Math.min(...numericValues);
      break;
    case "max":
      result = numericValues.length === 0 ? 0 : Math.max(...numericValues);
      break;
    case "count":
      result = summary.field === undefined ? rows.length : nonNullCount;
      break;
  }

  const formatDiagnostics: RuntimePresentationDiagnostic[] = [];
  const text = formatPresentationValue(result, summary.format, formatDiagnostics, {
    path: `editSections.${sectionName}.summary`,
    section: sectionName,
  });
  for (const formatDiagnostic of formatDiagnostics) {
    diagnostics.push({
      severity: formatDiagnostic.severity,
      code: formatDiagnostic.code,
      message: formatDiagnostic.message,
      section: sectionName,
    });
  }

  return {
    ...(summary.label === undefined ? {} : { label: summary.label }),
    text,
    placement: summary.placement,
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

function removeStagedAction(): RuntimeEditChildAction {
  return {
    operation: "remove",
    visible: true,
    enabled: true,
    reasons: [],
  };
}

function cloneStagedOperation(operation: RuntimeStagedChildOperation): RuntimeStagedChildOperation {
  return {
    ...operation,
    ...(operation.values === undefined ? {} : { values: cloneJson(operation.values) }),
  };
}

function summarizePicker(picker: ResolvedRelationshipPicker): RuntimeRelationshipPickerSummary {
  return {
    name: picker.name,
    sourceKind: picker.sourceKind,
    source: picker.source,
    ...(picker.candidateField === undefined ? {} : { candidateField: picker.candidateField }),
    selection: picker.selection,
    displayFields: [...picker.displayFields],
    searchFields: [...picker.searchFields],
    sort: picker.sort.map((sort) => ({ ...sort })),
    excludeAlreadyLinked: picker.excludeAlreadyLinked,
    emptyState: { ...picker.emptyState },
  };
}

function pickerSearchFields(
  picker: ResolvedRelationshipPicker,
  childObject: ResolvedObject,
): string[] {
  if (picker.searchFields.length > 0) {
    return [...picker.searchFields];
  }

  const defaults = pickerDisplayFields(picker, childObject).filter((fieldName) =>
    childObject.fields.some((field) => field.name === fieldName && field.type === "text"),
  );
  if (defaults.length > 0) {
    return defaults;
  }

  const firstTextField = childObject.fields.find((field) => field.type === "text");
  return firstTextField === undefined ? [] : [firstTextField.name];
}

function pickerDisplayFields(
  picker: ResolvedRelationshipPicker,
  childObject: ResolvedObject,
): string[] {
  if (picker.displayFields.length > 0) {
    return [...picker.displayFields];
  }

  return [childObject.displayField, childObject.businessKey, childObject.fields[0]?.name].filter(
    (field): field is string => field !== undefined,
  );
}

function pickerCandidateLabel(
  picker: ResolvedRelationshipPicker,
  childObject: ResolvedObject,
  values: Record<string, JsonValue>,
  fallback: string,
): string {
  const parts = pickerDisplayFields(picker, childObject)
    .map((field) => values[field])
    .filter((value): value is Exclude<JsonValue, null | undefined> => {
      return (
        value !== undefined && value !== null && !Array.isArray(value) && typeof value !== "object"
      );
    })
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  return parts.length === 0 ? fallback : parts.join(" - ");
}

function filterReadModelPickerRows(
  rows: RuntimeReadModelRow[],
  picker: ResolvedRelationshipPicker,
  text: string,
): RuntimeReadModelRow[] {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) {
    return rows;
  }

  const fields = picker.searchFields.length > 0 ? picker.searchFields : picker.displayFields;
  return rows.filter((row) => {
    const values =
      fields.length === 0 ? Object.values(row.values) : fields.map((field) => row.values[field]);
    return values.some((value) => primitiveText(value).toLowerCase().includes(needle));
  });
}

function sortPickerCandidates(
  candidates: RuntimeRelationshipPickerCandidate[],
  sort: ResolvedSort[],
): RuntimeRelationshipPickerCandidate[] {
  return [...candidates].sort((left, right) => {
    for (const item of sort) {
      const comparison = compareJsonValues(left.values[item.field], right.values[item.field]);
      if (comparison !== 0) {
        return item.direction === "desc" ? -comparison : comparison;
      }
    }

    const labelComparison = left.label.localeCompare(right.label, "en");
    return labelComparison === 0 ? left.id.localeCompare(right.id, "en") : labelComparison;
  });
}

function compareJsonValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const leftText = primitiveText(left);
  const rightText = primitiveText(right);
  const leftNumber = typeof left === "number" ? left : Number.NaN;
  const rightNumber = typeof right === "number" ? right : Number.NaN;
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return leftText.localeCompare(rightText, "en", { numeric: true });
}

function primitiveText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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

function duplicateLinkOperation(operation: RuntimeStagedChildOperation, message: string): never {
  throw new RuntimeValidationError("Staged relationship links could not be applied.", [
    {
      code: "ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE",
      message,
      path: `stagedChanges.${operation.id}`,
    },
  ]);
}
