import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
  EditChildOperationKind,
  JsonValue,
  ResolvedField,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext, RuntimeValidationIssue } from "../../runtime/runtime-types.js";
import type {
  RuntimeEditSurface,
  RuntimeEditChildCollectionSection,
  RuntimeEditChildRow,
  RuntimeRelationshipPickerResult,
} from "../../runtime/edit-surface-runtime.js";
import {
  canRunCommand,
  getAvailableLifecycleActions,
  getInitialLifecycleState,
  resolveFieldPresentation,
} from "../policy-presentation.js";
import type {
  ActionBarItem,
  DraftRecordDetail,
  SaveRecordDetail,
  TransitionRecordDetail,
  UiMode,
  StageChildOperationDetail,
} from "../types.js";
import { AdlActionBarElement } from "./adl-action-bar.js";
import { AdlFieldRendererElement } from "./adl-field-renderer.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

interface ActionEventDetail {
  name: string;
  kind: "command" | "lifecycle";
}

export class AdlFormViewElement extends HTMLElement {
  private _runtime: ApplicationRuntime | undefined;
  private _object: ResolvedObject | undefined;
  private _view: ResolvedView | undefined;
  private _context: RuntimeContext | undefined;
  private _record: StoredObjectRecord | undefined;
  private _mode: UiMode = "edit";
  private _fieldIssues: RuntimeValidationIssue[] = [];
  private _draftValues: Record<string, JsonValue> = {};
  private _editSurface: RuntimeEditSurface | undefined;
  private pickerResult: RuntimeRelationshipPickerResult | undefined;
  private pickerLoadingSection: string | undefined;
  private dragChildId: string | undefined;
  private dragSection: string | undefined;
  /**
   * Resolved display labels for child-row lookup fields, and the loads in
   * flight. A child row holds raw values, so a `LOOKUP` column rendered straight
   * would show a record guid where `adl-list-view` shows a name — the same
   * column, the same model, two different answers. Mirrors that component's
   * cache deliberately: same key, same read-through the policy-enforcing
   * `runtime.read`, same fall back to the id when the target cannot be read.
   */
  private lookupLabels = new Map<string, string>();
  private pendingLookupLabels = new Set<string>();
  /**
   * Rows currently open for inline editing, keyed section-and-row.
   *
   * Held on the element rather than dispatched upward because opening an editor
   * changes nothing about the record: nothing is staged until the row is saved,
   * so a cancelled edit leaves no trace anywhere.
   */
  private editingChildRows = new Set<string>();

  /**
   * Parent-form input becomes parent draft state, and a parent draft change
   * re-renders the whole app — which recreates this element. Anything entered
   * into a surface this element owns must therefore be excluded, or it is wiped
   * as it is entered. The picker was already guarded for exactly this reason;
   * child row editors and the child draft row need the same guard, and the draft
   * row not having had it is why typing into it was lost.
   */
  private readonly handleFormInput = (event: Event): void => {
    if (isChildSurfaceEvent(event)) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<DraftRecordDetail>("adl-draft-record", {
        bubbles: true,
        detail: {
          mode: this._mode,
          values: this.collectValues(),
          ...(this._record === undefined ? {} : { record: this._record }),
        },
      }),
    );
  };

  private readonly handleAction = (event: Event): void => {
    const detail = (event as CustomEvent<ActionEventDetail>).detail;
    if (detail === undefined || this._object === undefined) {
      return;
    }

    event.stopPropagation();

    if (detail.kind === "lifecycle") {
      if (this._record === undefined) {
        return;
      }

      this.dispatchEvent(
        new CustomEvent<TransitionRecordDetail>("adl-transition-record", {
          bubbles: true,
          detail: {
            actionName: detail.name,
            record: this._record,
            values: this.collectValues(),
          },
        }),
      );
      return;
    }

    switch (detail.name) {
      case "save":
        this.dispatchEvent(
          new CustomEvent<SaveRecordDetail>("adl-save-record", {
            bubbles: true,
            detail: {
              mode: this._mode,
              values: this.collectValues(),
              ...(this._record === undefined ? {} : { record: this._record }),
            },
          }),
        );
        break;
      case "delete":
        if (this._record !== undefined) {
          this.dispatchEvent(
            new CustomEvent<{ record: StoredObjectRecord }>("adl-delete-record", {
              bubbles: true,
              detail: { record: this._record },
            }),
          );
        }
        break;
      case "cancel":
        this.dispatchEvent(new CustomEvent("adl-cancel-record", { bubbles: true }));
        break;
    }
  };

  private readonly handleChildClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.closest<HTMLButtonElement>("button[data-child-action]");
    const pickerButton = target.closest<HTMLButtonElement>("button[data-picker-action]");
    if (pickerButton !== null) {
      this.handlePickerButtonClick(event, pickerButton);
      return;
    }

    const editControl = target.closest<HTMLButtonElement>("button[data-child-edit]");
    if (editControl !== null) {
      event.stopPropagation();
      this.handleChildEditControl(editControl);
      return;
    }

    const pickerOpen = target.closest<HTMLButtonElement>("button[data-picker-open]");
    if (pickerOpen !== null) {
      event.stopPropagation();
      void this.openRelationshipPicker(pickerOpen.dataset.pickerOpen ?? "");
      return;
    }

    const reorderButton = target.closest<HTMLButtonElement>("button[data-child-reorder]");
    if (reorderButton !== null) {
      this.handleReorderButtonClick(event, reorderButton);
      return;
    }

    if (action === null) {
      return;
    }

    const sectionName = action.dataset.childSection;
    const childObject = action.dataset.childObject;
    const operation = action.dataset.childAction as StageChildOperationDetail["operation"];
    if (sectionName === undefined || childObject === undefined) {
      return;
    }

    event.stopPropagation();

    if (operation === "createChild") {
      this.dispatchEvent(
        new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
          bubbles: true,
          detail: {
            section: sectionName,
            operation,
            childObject,
            values: this.collectChildDraftValues(sectionName),
          },
        }),
      );
      return;
    }

    if (operation === "linkExisting" && action.dataset.childId === undefined) {
      void this.openRelationshipPicker(sectionName);
      return;
    }

    // Opening an editor, not staging a change. This used to dispatch
    // `updateChild` with no values at all, which planned a patch of nothing: a
    // control that looked enabled, wrote nothing a person would recognise as an
    // edit, and still burned a revision and a queue entry.
    const rowId = action.dataset.childActionRow;
    if (operation === "updateChild" && rowId !== undefined) {
      this.editingChildRows.add(childRowKey(sectionName, rowId));
      this.render();
      return;
    }

    const childId = action.dataset.childId;
    const stagedOperationId = action.dataset.stagedOperationId;
    if (operation === "remove" && stagedOperationId !== undefined) {
      this.dispatchEvent(
        new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
          bubbles: true,
          detail: {
            section: sectionName,
            operation,
            childObject,
            stagedOperationId,
          },
        }),
      );
      return;
    }

    if (childId === undefined) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
        bubbles: true,
        detail: {
          section: sectionName,
          operation,
          childObject,
          childId,
        },
      }),
    );
  };

  /**
   * Drag and drop is the pointer affordance for reorder; the up/down buttons
   * beside every reorderable row are the accessible route and are never hidden
   * when reorder is permitted. Both dispatch exactly the same staged operation,
   * so nothing depends on a pointer being available.
   */
  private readonly handleChildDragStart = (event: Event): void => {
    const row = reorderableRowFromEvent(event);
    if (row === null) {
      return;
    }

    this.dragChildId = row.dataset.childId;
    this.dragSection = row.dataset.childSection;
    row.classList.add("adl-child-row-dragging");
    const transfer = (event as DragEvent).dataTransfer;
    if (transfer !== null && transfer !== undefined) {
      transfer.effectAllowed = "move";
      transfer.setData("text/plain", row.dataset.childId ?? "");
    }
  };

  private readonly handleChildDragOver = (event: Event): void => {
    const row = reorderableRowFromEvent(event);
    if (row === null || this.dragChildId === undefined) {
      return;
    }

    if (row.dataset.childSection !== this.dragSection) {
      return;
    }

    event.preventDefault();
    const transfer = (event as DragEvent).dataTransfer;
    if (transfer !== null && transfer !== undefined) {
      transfer.dropEffect = "move";
    }
    this.markDropTarget(row);
  };

  private readonly handleChildDragLeave = (event: Event): void => {
    const row = reorderableRowFromEvent(event);
    row?.classList.remove("adl-child-row-drop-target");
  };

  private readonly handleChildDrop = (event: Event): void => {
    const row = reorderableRowFromEvent(event);
    const section = this.dragSection;
    const childId = this.dragChildId;
    this.clearDragMarkers();
    this.dragSection = undefined;
    this.dragChildId = undefined;
    if (row === null || section === undefined || childId === undefined) {
      return;
    }

    event.preventDefault();
    if (row.dataset.childSection !== section || row.dataset.childId === childId) {
      return;
    }

    const childObject = row.dataset.childObject;
    const position = Number(row.dataset.childRowPosition);
    if (childObject === undefined || !Number.isInteger(position)) {
      return;
    }

    this.dispatchReorder(section, childObject, childId, position);
  };

  private readonly handleChildDragEnd = (): void => {
    this.clearDragMarkers();
    this.dragSection = undefined;
    this.dragChildId = undefined;
  };

  set runtime(runtime: ApplicationRuntime | undefined) {
    this._runtime = runtime;
    this.render();
  }

  set object(object: ResolvedObject | undefined) {
    this._object = object;
    this.render();
  }

  set view(view: ResolvedView | undefined) {
    this._view = view;
    this.render();
  }

  set context(context: RuntimeContext | undefined) {
    this._context = context;
    this.render();
  }

  set record(record: StoredObjectRecord | undefined) {
    this._record = record;
    this.render();
  }

  set mode(mode: UiMode) {
    this._mode = mode;
    this.render();
  }

  set fieldIssues(fieldIssues: RuntimeValidationIssue[]) {
    this._fieldIssues = [...fieldIssues];
    this.render();
  }

  set draftValues(draftValues: Record<string, JsonValue>) {
    this._draftValues = { ...draftValues };
    this.render();
  }

  set editSurface(editSurface: RuntimeEditSurface | undefined) {
    this._editSurface = editSurface;
    this.render();
  }

  connectedCallback(): void {
    this.addEventListener("adl-action", this.handleAction);
    this.addEventListener("click", this.handleChildClick);
    this.addEventListener("input", this.handleFormInput);
    this.addEventListener("change", this.handleFormInput);
    this.addEventListener("dragstart", this.handleChildDragStart);
    this.addEventListener("dragover", this.handleChildDragOver);
    this.addEventListener("dragleave", this.handleChildDragLeave);
    this.addEventListener("drop", this.handleChildDrop);
    this.addEventListener("dragend", this.handleChildDragEnd);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("adl-action", this.handleAction);
    this.removeEventListener("click", this.handleChildClick);
    this.removeEventListener("input", this.handleFormInput);
    this.removeEventListener("change", this.handleFormInput);
    this.removeEventListener("dragstart", this.handleChildDragStart);
    this.removeEventListener("dragover", this.handleChildDragOver);
    this.removeEventListener("dragleave", this.handleChildDragLeave);
    this.removeEventListener("drop", this.handleChildDrop);
    this.removeEventListener("dragend", this.handleChildDragEnd);
  }

  private render(): void {
    if (
      this._runtime === undefined ||
      this._object === undefined ||
      this._view === undefined ||
      this._context === undefined
    ) {
      this.innerHTML = "";
      return;
    }

    const fields = this.getRenderedFields();
    const title =
      this._mode === "create"
        ? `New ${titleCaseIdentifier(this._object.name)}`
        : getRecordTitle(this._object, this._record);
    const syncState = this._runtime.syncPolicy.getObjectState(this._object.name, this._context);

    this.innerHTML = `
      <section class="adl-panel">
        <header class="adl-panel-header">
          <div class="adl-panel-heading">
            <h2 class="adl-panel-title">${escapeHtml(title)}</h2>
            <span
              class="adl-sync-status ${syncState.readonly ? "adl-sync-status-readonly" : ""}"
              data-sync-mode="${escapeHtml(syncState.mode)}"
              title="${escapeHtml(syncState.detail)}"
            >
              ${escapeHtml(syncState.label)}
            </span>
          </div>
          <adl-action-bar></adl-action-bar>
        </header>
        <div class="adl-form-body">
          ${this.renderEditSections(fields)}
        </div>
      </section>
      ${this.renderRelationshipPicker()}
    `;

    this.configureFields(fields);
    this.configureChildFieldEditors();
    this.configureActions();
    this.queueChildLookupLabelLoads();
  }

  private getRenderedFields(): ResolvedField[] {
    if (this._editSurface !== undefined) {
      return this._editSurface.sections
        .filter((section) => section.kind === "fields")
        .flatMap((section) => section.fields);
    }

    return (
      this._view?.fields
        .map((fieldName) => this._object?.fields.find((field) => field.name === fieldName))
        .filter((field): field is ResolvedField => field !== undefined) ?? []
    );
  }

  private renderEditSections(fields: ResolvedField[]): string {
    if (this._editSurface === undefined) {
      return fields.map((field) => this.renderFieldSlot(field)).join("");
    }

    return this._editSurface.sections
      .map((section) => {
        if (section.kind === "fields") {
          return `
            <section class="adl-edit-section" data-edit-section="${escapeHtml(section.name)}">
              ${section.heading === undefined ? "" : `<h3>${escapeHtml(section.heading)}</h3>`}
              ${section.fields.map((field) => this.renderFieldSlot(field)).join("")}
            </section>
          `;
        }

        return this.renderChildCollection(section);
      })
      .join("");
  }

  private renderFieldSlot(field: ResolvedField): string {
    return `<adl-field-renderer data-field-slot="${escapeHtml(field.name)}"></adl-field-renderer>`;
  }

  private renderChildCollection(section: RuntimeEditChildCollectionSection): string {
    const addAction = section.actions.find(
      (action) => action.operation === "createChild" && action.visible,
    );
    const linkAction = section.actions.find(
      (action) => action.operation === "linkExisting" && action.visible,
    );
    // A picker that names a candidate field creates children from what is chosen,
    // so the operation that must be permitted — and the control that opens it —
    // is `createChild`, not `linkExisting`.
    const mints = section.picker?.candidateField !== undefined;
    const pickerAction = mints ? addAction : linkAction;
    return `
      <section class="adl-edit-section adl-child-section" data-child-section="${escapeHtml(section.name)}">
        <header class="adl-child-section-header">
          <h3>${escapeHtml(section.heading ?? titleCaseIdentifier(section.name))}</h3>
          <div class="adl-child-section-actions">
            ${
              pickerAction === undefined || section.picker === undefined
                ? ""
                : `<button
                    type="button"
                    data-picker-open="${escapeHtml(section.name)}"
                    ${pickerAction.enabled ? "" : "disabled"}
                  >${escapeHtml(mints ? "Add" : "Link")}</button>`
            }
            ${
              // A minting picker *is* the way to add, so the raw draft row's
              // submit button would be a second, worse one beside it.
              mints || addAction === undefined
                ? ""
                : `<button
                  type="button"
                  data-child-action="createChild"
                  data-child-section="${escapeHtml(section.name)}"
                  data-child-object="${escapeHtml(section.childObject)}"
                  ${addAction.enabled ? "" : "disabled"}
                >Add</button>`
            }
          </div>
        </header>
        ${this.renderChildRows(section)}
        ${this.renderChildDraft(section)}
      </section>
    `;
  }

  /**
   * Applies or abandons one open row editor.
   *
   * A save stages `updateChild` carrying only the fields that actually changed,
   * and stages nothing at all when none did — the write of nothing this control
   * used to produce unconditionally. The staged operation then commits inside the
   * same batch as every other child change, so an inline edit is not a second
   * write path.
   */
  private handleChildEditControl(control: HTMLButtonElement): void {
    const sectionName = control.dataset.childSection;
    const rowId = control.dataset.childActionRow;
    if (sectionName === undefined || rowId === undefined) {
      return;
    }

    this.editingChildRows.delete(childRowKey(sectionName, rowId));
    if (control.dataset.childEdit !== "save") {
      this.render();
      return;
    }

    const section = this.childCollectionSection(sectionName);
    const row = section?.rows.find((candidate) => candidate.id === rowId);
    const childId = control.dataset.childId;
    const childObject = control.dataset.childObject;
    const values = this.collectChildEditorValues(sectionName, rowId, row?.values ?? {});
    if (
      row === undefined ||
      childId === undefined ||
      childObject === undefined ||
      Object.keys(values).length === 0
    ) {
      this.render();
      return;
    }

    this.dispatchEvent(
      new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
        bubbles: true,
        detail: { section: sectionName, operation: "updateChild", childObject, childId, values },
      }),
    );
  }

  /** Only what changed, so an untouched field is never written back over itself. */
  private collectChildEditorValues(
    sectionName: string,
    rowId: string,
    current: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    const values: Record<string, JsonValue> = {};
    for (const renderer of this.querySelectorAll<AdlFieldRendererElement>(
      `adl-field-renderer[data-child-editor="${cssEscape(sectionName)}"][data-child-editor-row="${cssEscape(rowId)}"]`,
    )) {
      const field = renderer.field;
      const value = renderer.getValue();
      /*
       * An optional field the record never carried reads back as `null` from an
       * empty control, and the row has no key for it at all. Comparing those
       * raw would make every untouched empty field a change, so an otherwise
       * empty Save staged a patch of nulls over fields nobody touched. Absent
       * and empty are the same state here.
       */
      if (
        field === undefined ||
        value === undefined ||
        jsonEquals(current[field.name] ?? null, value)
      ) {
        continue;
      }
      values[field.name] = value;
    }
    return values;
  }

  /**
   * Points every child editor at the *child* object.
   *
   * This is the whole of what makes a child field behave like a parent field: a
   * lookup becomes a chooser loaded through the policy-enforcing `runtime.search`,
   * a date becomes a date control, an enum a select, and readonly and validators
   * apply. Rendering them as bare text inputs is what made a child's lookup
   * column a box you had to type a record id into.
   */
  private configureChildFieldEditors(): void {
    if (this._runtime === undefined || this._context === undefined) {
      return;
    }

    for (const section of this._editSurface?.sections ?? []) {
      if (section.kind !== "childCollection") {
        continue;
      }

      const childObject = this._runtime.model.objects.find(
        (object) => object.name === section.childObject,
      );
      if (childObject === undefined) {
        continue;
      }

      for (const renderer of this.querySelectorAll<AdlFieldRendererElement>(
        `adl-field-renderer[data-child-editor="${cssEscape(section.name)}"], adl-field-renderer[data-child-draft-section="${cssEscape(section.name)}"]`,
      )) {
        const fieldName = renderer.dataset.childFieldSlot;
        const field = section.fields.find((candidate) => candidate.name === fieldName);
        if (field === undefined) {
          continue;
        }

        const rowId = renderer.dataset.childEditorRow;
        const row = rowId === undefined ? undefined : section.rows.find((row) => row.id === rowId);
        const record = row?.record;
        const mode = rowId === undefined ? "create" : "edit";
        renderer.runtime = this._runtime;
        renderer.object = childObject;
        renderer.context = this._context;
        renderer.field = field;
        renderer.mode = mode;
        // A row editor opens on the row's *displayed* values, which is the record
        // with any staged edit of it already overlaid, and is what
        // `collectChildEditorValues` diffs against. Reading `record.values`
        // instead showed a row that already carried a staged edit at its stored
        // value, so re-opening and saving it staged a second edit undoing the
        // first. A draft row has no row at all, so it opens on the declared
        // default exactly as the parent create form does — without it a field
        // with a `DEFAULT` rendered blank and then wrote a blank over it.
        renderer.value =
          row === undefined ? this.childDraftValue(childObject, field) : row.values[field.name];
        renderer.presentation = resolveFieldPresentation({
          runtime: this._runtime,
          object: childObject,
          field,
          context: this._context,
          mode,
          ...(record === undefined ? {} : { record }),
        });
        renderer.issues = [];
      }
    }
  }

  /** What an unfilled draft field starts at, mirroring `getFieldValue`. */
  private childDraftValue(
    childObject: ResolvedObject,
    field: ResolvedField,
  ): JsonValue | undefined {
    if (childObject.lifecycle?.stateField === field.name) {
      return getInitialLifecycleState(childObject);
    }

    return field.defaultValue;
  }

  private childCollectionSection(
    sectionName: string,
  ): RuntimeEditChildCollectionSection | undefined {
    return this._editSurface?.sections.find(
      (section): section is RuntimeEditChildCollectionSection =>
        section.kind === "childCollection" && section.name === sectionName,
    );
  }

  /** A child cell, with a `LOOKUP` field shown by its display value once loaded. */
  private formatChildCell(field: ResolvedField, value: JsonValue | undefined): string {
    if (field.lookup === undefined || typeof value !== "string" || value.length === 0) {
      return formatChildValue(value);
    }

    return this.lookupLabels.get(childLookupLabelKey(field, value)) ?? value;
  }

  /**
   * Starts a read for every unresolved child-row lookup value on screen.
   *
   * Called after rendering rather than before, so the first paint shows the raw
   * id and is replaced rather than being blocked on a read per row. Each load
   * re-renders exactly once, and the pending set is what stops a re-render
   * queueing the same read again.
   */
  private queueChildLookupLabelLoads(): void {
    if (!this.isConnected || this._runtime === undefined || this._context === undefined) {
      return;
    }

    for (const section of this._editSurface?.sections ?? []) {
      if (section.kind !== "childCollection") {
        continue;
      }

      for (const field of section.fields) {
        if (field.lookup === undefined) {
          continue;
        }
        for (const row of section.rows) {
          const value = row.values[field.name];
          if (typeof value !== "string" || value.length === 0) {
            continue;
          }

          const key = childLookupLabelKey(field, value);
          if (this.lookupLabels.has(key) || this.pendingLookupLabels.has(key)) {
            continue;
          }

          this.pendingLookupLabels.add(key);
          void this.loadChildLookupLabel(field, value, key);
        }
      }
    }
  }

  private async loadChildLookupLabel(
    field: ResolvedField,
    recordId: string,
    key: string,
  ): Promise<void> {
    if (this._runtime === undefined || this._context === undefined || field.lookup === undefined) {
      this.pendingLookupLabels.delete(key);
      return;
    }

    try {
      const record = await this._runtime.read(field.lookup.targetObject, recordId, this._context);
      const label = record?.values[field.lookup.displayField];
      if (label !== undefined && label !== null) {
        this.lookupLabels.set(key, String(label));
      }
    } catch {
      // A target the caller may not read stays as its id rather than as a gap:
      // the row still has to identify itself, and the id is what we have.
      this.lookupLabels.set(key, recordId);
    } finally {
      this.pendingLookupLabels.delete(key);
      this.render();
    }
  }

  private renderChildRows(section: RuntimeEditChildCollectionSection): string {
    if (section.rows.length === 0) {
      return `<div class="adl-empty">${escapeHtml(section.emptyState.text || "No child records.")}</div>`;
    }

    const rows = this.orderedChildRows(section);
    // Only persisted rows carry a position: a staged create has no record for a
    // reorder to name, and a staged link is applied before any ordering matters.
    const ordered = rows.filter((row) => row.source === "persisted");

    return `
      <div class="adl-child-rows" data-child-rows="${escapeHtml(section.name)}">
        ${rows
          .map((row) => this.renderChildRow(section, row, ordered.indexOf(row), ordered.length))
          .join("")}
      </div>
    `;
  }

  private renderChildRow(
    section: RuntimeEditChildCollectionSection,
    row: RuntimeEditChildRow,
    orderIndex: number,
    orderedCount: number,
  ): string {
    const reorderAction = row.actions.find((action) => action.operation === "reorder");
    const reorderable =
      isSectionReorderable(section) && orderIndex >= 0 && reorderAction?.visible === true;
    const childId = row.record?.meta.guid ?? row.id;
    const editing = this.editingChildRows.has(childRowKey(section.name, row.id));

    return `
      <div
        class="adl-child-row${reorderable ? " adl-child-row-reorderable" : ""}${editing ? " adl-child-editor" : ""}"
        data-child-row="${escapeHtml(row.id)}"
        data-child-section="${escapeHtml(section.name)}"
        data-child-object="${escapeHtml(section.childObject)}"
        ${orderIndex >= 0 ? `data-child-row-position="${orderIndex + 1}"` : ""}
        ${row.source === "persisted" ? `data-child-id="${escapeHtml(childId)}"` : ""}
        ${reorderable ? 'draggable="true"' : ""}
      >
        ${reorderable ? this.renderReorderControls(section, row, orderIndex, orderedCount, reorderAction?.enabled === true) : ""}
        <div class="adl-child-row-values">
          ${
            editing
              ? section.fields
                  .filter((field) => field.name !== section.orderField)
                  .map(
                    (field) => `<adl-field-renderer
                        class="adl-child-editor-field"
                        data-child-field-slot="${escapeHtml(field.name)}"
                        data-child-editor="${escapeHtml(section.name)}"
                        data-child-editor-row="${escapeHtml(row.id)}"
                      ></adl-field-renderer>`,
                  )
                  .join("")
              : section.fields
                  .map(
                    (field) =>
                      `<span>${escapeHtml(this.formatChildCell(field, row.values[field.name]))}</span>`,
                  )
                  .join("")
          }
        </div>
        <div class="adl-child-row-actions">
          ${
            editing
              ? `<button type="button" data-child-edit="save" data-child-section="${escapeHtml(section.name)}" data-child-object="${escapeHtml(section.childObject)}" data-child-id="${escapeHtml(childId)}" data-child-action-row="${escapeHtml(row.id)}">Save</button>
                 <button type="button" data-child-edit="cancel" data-child-section="${escapeHtml(section.name)}" data-child-action-row="${escapeHtml(row.id)}">Cancel</button>`
              : ""
          }
          ${row.actions
            // While the row is open its own Edit control is redundant — Save and
            // Cancel are the only moves — but Remove stays available.
            .filter((action) => !(editing && action.operation === "updateChild"))
            // `reorder` has its own controls; rendering it here too would offer a
            // button that carries no target position.
            .filter((action) => action.visible && action.operation !== "reorder")
            .map(
              (action) => `
                <button
                  type="button"
                  data-child-action="${escapeHtml(action.operation)}"
                  data-child-section="${escapeHtml(section.name)}"
                  data-child-object="${escapeHtml(section.childObject)}"
                  data-child-action-row="${escapeHtml(row.id)}"
                  ${
                    row.source === "staged"
                      ? `data-staged-operation-id="${escapeHtml(row.stagedOperationId ?? "")}"`
                      : `data-child-id="${escapeHtml(childId)}"`
                  }
                  ${action.enabled ? "" : "disabled"}
                >${escapeHtml(childActionLabel(action.operation))}</button>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  private renderReorderControls(
    section: RuntimeEditChildCollectionSection,
    row: RuntimeEditChildRow,
    orderIndex: number,
    orderedCount: number,
    enabled: boolean,
  ): string {
    const childId = row.record?.meta.guid ?? row.id;
    const label = childRowLabel(section, row, orderIndex);
    const control = (direction: "up" | "down", position: number, disabled: boolean): string => `
      <button
        type="button"
        class="adl-child-reorder-button"
        data-child-reorder="${direction}"
        data-child-section="${escapeHtml(section.name)}"
        data-child-object="${escapeHtml(section.childObject)}"
        data-child-id="${escapeHtml(childId)}"
        data-child-position="${position}"
        aria-label="Move ${escapeHtml(label)} ${direction}"
        title="Move ${direction}"
        ${disabled ? "disabled" : ""}
      >${direction === "up" ? "&#8593;" : "&#8595;"}</button>
    `;

    return `
      <div
        class="adl-child-row-reorder"
        role="group"
        aria-label="Reorder ${escapeHtml(label)}"
        data-child-reorder-controls="${escapeHtml(section.name)}"
      >
        ${control("up", orderIndex, !enabled || orderIndex === 0)}
        ${control("down", orderIndex + 2, !enabled || orderIndex >= orderedCount - 1)}
      </div>
    `;
  }

  /**
   * Rows render in the order the section's `orderField` declares, with staged
   * reorders applied on top as moves.
   *
   * The move simulation mirrors what `commitPlannedTransaction`'s
   * ordered-collection expansion does when the batch is committed: naming one
   * record's position shifts its siblings to keep the collection contiguous.
   * Re-sorting by the raw field value instead would show two rows sharing a
   * position until the parent is saved.
   */
  private orderedChildRows(section: RuntimeEditChildCollectionSection): RuntimeEditChildRow[] {
    const persisted = section.rows.filter((row) => row.source === "persisted");
    const staged = section.rows.filter((row) => row.source !== "persisted");
    const orderField = section.orderField;
    if (orderField === undefined) {
      return [...persisted, ...staged];
    }

    const ordered = [...persisted].sort((left, right) =>
      compareOrderValues(left.values[orderField], right.values[orderField]),
    );

    for (const operation of this._editSurface?.stagedChanges ?? []) {
      if (
        operation.section !== section.name ||
        operation.operation !== "reorder" ||
        operation.childId === undefined ||
        operation.position === undefined
      ) {
        continue;
      }

      const index = ordered.findIndex(
        (row) => (row.record?.meta.guid ?? row.id) === operation.childId,
      );
      if (index < 0) {
        continue;
      }

      const [moved] = ordered.splice(index, 1);
      if (moved === undefined) {
        continue;
      }
      ordered.splice(clampIndex(operation.position - 1, ordered.length), 0, moved);
    }

    return [...ordered, ...staged];
  }

  private handleReorderButtonClick(event: Event, button: HTMLButtonElement): void {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }

    const sectionName = button.dataset.childSection;
    const childObject = button.dataset.childObject;
    const childId = button.dataset.childId;
    const position = Number(button.dataset.childPosition);
    if (
      sectionName === undefined ||
      childObject === undefined ||
      childId === undefined ||
      !Number.isInteger(position)
    ) {
      return;
    }

    this.dispatchReorder(sectionName, childObject, childId, position);
  }

  /**
   * The only route a reorder takes. The child record is never written here: the
   * app stages the operation and `ApplicationRuntime.applyStagedChildChanges`
   * plans and commits it, which keeps policy, sync and ordered-collection
   * enforcement in the runtime.
   */
  private dispatchReorder(
    sectionName: string,
    childObject: string,
    childId: string,
    position: number,
  ): void {
    this.dispatchEvent(
      new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
        bubbles: true,
        detail: {
          section: sectionName,
          operation: "reorder",
          childObject,
          childId,
          position,
        },
      }),
    );
  }

  private markDropTarget(row: HTMLElement): void {
    for (const candidate of this.querySelectorAll(".adl-child-row-drop-target")) {
      if (candidate !== row) {
        candidate.classList.remove("adl-child-row-drop-target");
      }
    }
    row.classList.add("adl-child-row-drop-target");
  }

  private clearDragMarkers(): void {
    for (const candidate of this.querySelectorAll(
      ".adl-child-row-drop-target, .adl-child-row-dragging",
    )) {
      candidate.classList.remove("adl-child-row-drop-target");
      candidate.classList.remove("adl-child-row-dragging");
    }
  }

  private renderChildDraft(section: RuntimeEditChildCollectionSection): string {
    // Suppressed when a minting picker exists: choosing a candidate is how a
    // child is added there, so a draft row beside it would be a second way to do
    // the same thing — and one that cannot honour `EXCLUDE_LINKED`, because it
    // offers the field's whole lookup target rather than what is not already
    // held. (Its inputs are no longer the reason: they go through the platform
    // field renderer now, as the row editor's do.)
    if (
      !section.operations.includes("createChild") ||
      section.picker?.candidateField !== undefined
    ) {
      return "";
    }

    return `
      <div class="adl-child-draft" data-child-draft="${escapeHtml(section.name)}">
        ${section.fields
          .filter((field) => field.name !== section.orderField)
          .map(
            (field) => `<adl-field-renderer
                class="adl-child-editor-field"
                data-child-field-slot="${escapeHtml(field.name)}"
                data-child-draft-section="${escapeHtml(section.name)}"
              ></adl-field-renderer>`,
          )
          .join("")}
      </div>
    `;
  }

  private configureFields(fields: ResolvedField[]): void {
    if (this._runtime === undefined || this._object === undefined || this._context === undefined) {
      return;
    }

    for (const field of fields) {
      const renderer = this.querySelector<AdlFieldRendererElement>(
        `adl-field-renderer[data-field-slot="${cssEscape(field.name)}"]`,
      );
      if (renderer === null) {
        continue;
      }

      const presentation = resolveFieldPresentation({
        runtime: this._runtime,
        object: this._object,
        field,
        context: this._context,
        mode: this._mode,
        ...(this._record === undefined ? {} : { record: this._record }),
      });
      renderer.runtime = this._runtime;
      renderer.object = this._object;
      renderer.context = this._context;
      renderer.field = field;
      renderer.mode = this._mode;
      renderer.value = this.getFieldValue(field);
      renderer.presentation = presentation;
      renderer.issues = this._fieldIssues.filter((issue) => issue.field === field.name);
    }
  }

  private configureActions(): void {
    if (this._runtime === undefined || this._object === undefined || this._context === undefined) {
      return;
    }

    const actionBar = this.querySelector<AdlActionBarElement>("adl-action-bar");
    if (actionBar === null) {
      return;
    }

    const actions: ActionBarItem[] = [];
    if (
      this._mode === "create" &&
      canRunCommand(this._runtime, this._object, "create", this._context)
    ) {
      actions.push({
        name: "save",
        label: "Save",
        kind: "command",
        variant: "primary",
        disabled: false,
      });
    }

    if (
      this._mode === "edit" &&
      this._record !== undefined &&
      canRunCommand(this._runtime, this._object, "update", this._context, this._record)
    ) {
      actions.push({
        name: "save",
        label: "Save",
        kind: "command",
        variant: "primary",
        disabled: false,
      });
    }

    if (
      this._mode === "edit" &&
      this._record !== undefined &&
      canRunCommand(this._runtime, this._object, "delete", this._context, this._record)
    ) {
      actions.push({
        name: "delete",
        label: "Delete",
        kind: "command",
        variant: "danger",
        disabled: false,
      });
    }

    actions.push({
      name: "cancel",
      label: "Cancel",
      kind: "command",
      variant: "secondary",
      disabled: false,
    });

    actions.push(
      ...disambiguateLifecycleActionLabels(
        actions,
        getAvailableLifecycleActions(this._runtime, this._object, this._record, this._context),
        this._object,
      ),
    );
    actionBar.actions = actions;
  }

  private async openRelationshipPicker(sectionName: string, text?: string): Promise<void> {
    if (
      this._runtime === undefined ||
      this._object === undefined ||
      this._view === undefined ||
      this._context === undefined
    ) {
      return;
    }

    this.pickerLoadingSection = sectionName;
    this.render();
    this.pickerResult = await this._runtime.evaluateRelationshipPicker({
      objectName: this._object.name,
      viewName: this._view.name,
      sectionName,
      context: this._context,
      ...(this._record === undefined ? {} : { recordId: this._record.meta.guid }),
      stagedChanges: this._editSurface?.stagedChanges ?? [],
      query: text === undefined || text.trim().length === 0 ? {} : { text },
    });
    this.pickerLoadingSection = undefined;
    this.render();
  }

  private handlePickerButtonClick(event: Event, button: HTMLButtonElement): void {
    event.stopPropagation();
    const action = button.dataset.pickerAction;
    if (action === "close") {
      this.pickerResult = undefined;
      this.render();
      return;
    }

    if (action === "search") {
      const sectionName = button.dataset.pickerSection;
      if (sectionName === undefined) {
        return;
      }
      const text =
        this.querySelector<HTMLInputElement>(
          `.adl-relationship-picker input[data-picker-search="${cssEscape(sectionName)}"]`,
        )?.value ?? "";
      void this.openRelationshipPicker(sectionName, text);
      return;
    }

    if (action !== "add" || this.pickerResult === undefined) {
      return;
    }

    const selected = [...this.querySelectorAll<HTMLInputElement>("input[data-picker-candidate]")]
      .filter((input) => input.checked)
      .map((input) => input.value);
    if (selected.length === 0) {
      return;
    }

    const candidateField = this.pickerResult.picker.candidateField;
    // Always the *child* object, never the candidate's. For a minting picker the
    // candidates are records of some other object entirely, so reading the child
    // object off a candidate would have staged the operation against the wrong
    // collection.
    const childObject =
      this.childCollectionSection(this.pickerResult.section)?.childObject ??
      this.pickerResult.candidates[0]?.source.objectName ??
      "";

    this.dispatchEvent(
      new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
        bubbles: true,
        detail: {
          section: this.pickerResult.section,
          operation: candidateField === undefined ? "linkExisting" : "createChild",
          childObject,
          childIds: selected,
          ...(candidateField === undefined ? {} : { candidateField }),
        },
      }),
    );
    this.pickerResult = undefined;
    this.render();
  }

  private renderRelationshipPicker(): string {
    const loadingSection = this.pickerLoadingSection;
    if (loadingSection !== undefined) {
      return `
        <section class="adl-relationship-picker" role="dialog" aria-modal="true">
          <div class="adl-relationship-picker-panel">
            <p>Loading...</p>
          </div>
        </section>
      `;
    }

    const result = this.pickerResult;
    if (result === undefined) {
      return "";
    }

    const inputType = result.picker.selection === "single" ? "radio" : "checkbox";
    return `
      <section class="adl-relationship-picker" role="dialog" aria-modal="true">
        <div class="adl-relationship-picker-panel">
          <header class="adl-relationship-picker-header">
            <h3>${escapeHtml(titleCaseIdentifier(result.picker.name))}</h3>
            <button type="button" data-picker-action="close">Close</button>
          </header>
          <div class="adl-relationship-picker-search">
            <input
              type="search"
              data-picker-search="${escapeHtml(result.section)}"
              placeholder="Search"
            />
            <button
              type="button"
              data-picker-action="search"
              data-picker-section="${escapeHtml(result.section)}"
            >Search</button>
          </div>
          ${
            result.candidates.length === 0
              ? `<div class="adl-empty">${escapeHtml(result.picker.emptyState.text)}</div>`
              : `<div class="adl-relationship-picker-list">
                  ${result.candidates
                    .map(
                      (candidate) => `
                        <label class="adl-relationship-picker-row">
                          <input
                            type="${inputType}"
                            name="adl-picker-${escapeHtml(result.section)}"
                            data-picker-candidate="${escapeHtml(result.section)}"
                            value="${escapeHtml(candidate.id)}"
                          />
                          <span>${escapeHtml(candidate.label)}</span>
                        </label>
                      `,
                    )
                    .join("")}
                </div>`
          }
          <footer class="adl-relationship-picker-footer">
            <button type="button" data-picker-action="add" ${
              result.candidates.length === 0 ? "disabled" : ""
            }>Add</button>
          </footer>
        </div>
      </section>
    `;
  }

  private collectValues(): Record<string, JsonValue> {
    const values: Record<string, JsonValue> = {};

    // Scoped to the parent's own slots. Child row and draft editors are
    // `adl-field-renderer`s too, and an unscoped query folded their values into
    // the parent record's patch.
    for (const renderer of this.querySelectorAll<AdlFieldRendererElement>(
      "adl-field-renderer[data-field-slot]",
    )) {
      const field = renderer.field;
      if (field === undefined) {
        continue;
      }

      const value = renderer.getValue();
      if (value === undefined) {
        continue;
      }

      if (this._mode === "edit" && jsonEquals(this._record?.values[field.name], value)) {
        continue;
      }

      values[field.name] = value;
    }

    return values;
  }

  private collectChildDraftValues(sectionName: string): Record<string, JsonValue> {
    const values: Record<string, JsonValue> = {};
    for (const renderer of this.querySelectorAll<AdlFieldRendererElement>(
      `adl-field-renderer[data-child-draft-section="${cssEscape(sectionName)}"]`,
    )) {
      const field = renderer.field;
      const value = renderer.getValue();
      // An untouched optional field is omitted rather than sent as a blank: the
      // old bare-input path sent `""` for every empty box, which is a value, and
      // a different one from "not supplied". The field renderer reads an empty
      // optional control back as `null`, which is a value too — and one that
      // would overwrite the field's declared `DEFAULT` with nothing on a create.
      // A `false` from an unticked checkbox is not blankness and is kept.
      if (field === undefined || value === undefined || value === null || value === "") {
        continue;
      }
      values[field.name] = value;
    }
    return values;
  }

  private getFieldValue(field: ResolvedField): JsonValue | undefined {
    if (Object.prototype.hasOwnProperty.call(this._draftValues, field.name)) {
      return this._draftValues[field.name];
    }

    if (this._record !== undefined) {
      return this._record.values[field.name];
    }

    if (this._object?.lifecycle?.stateField === field.name) {
      return getInitialLifecycleState(this._object);
    }

    return field.defaultValue;
  }
}

export function defineAdlFormView(): void {
  if (customElements.get("adl-form-view") === undefined) {
    customElements.define("adl-form-view", AdlFormViewElement);
  }
}

function getRecordTitle(object: ResolvedObject, record: StoredObjectRecord | undefined): string {
  if (record === undefined) {
    return titleCaseIdentifier(object.name);
  }

  const displayValue =
    object.displayField === undefined ? undefined : record.values[object.displayField];
  if (typeof displayValue === "string" && displayValue.trim().length > 0) {
    return displayValue;
  }

  return `${titleCaseIdentifier(object.name)} ${record.meta.guid}`;
}

function disambiguateLifecycleActionLabels(
  commandActions: ActionBarItem[],
  lifecycleActions: ActionBarItem[],
  object: ResolvedObject,
): ActionBarItem[] {
  if (lifecycleActions.length === 0) {
    return lifecycleActions;
  }

  const commandLabels = new Set(commandActions.map((action) => normalizeActionLabel(action.label)));
  const lifecycleLabelCounts = new Map<string, number>();
  for (const action of lifecycleActions) {
    const label = normalizeActionLabel(action.label);
    lifecycleLabelCounts.set(label, (lifecycleLabelCounts.get(label) ?? 0) + 1);
  }

  return lifecycleActions.map((action) => {
    const label = normalizeActionLabel(action.label);
    const duplicated = commandLabels.has(label) || (lifecycleLabelCounts.get(label) ?? 0) > 1;
    if (!duplicated) {
      return action;
    }

    return {
      ...action,
      label: `${action.label} ${titleCaseIdentifier(object.name)}`,
    };
  });
}

function normalizeActionLabel(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * What a child-row control is called on screen.
 *
 * Exhaustive over `EditChildOperationKind` on purpose. Title-casing the
 * operation name put "Update Child" on a button — a machine name a person has to
 * translate, beside "Remove", which reads as English only by coincidence of how
 * it was spelled in the enum.
 */
const CHILD_ACTION_LABELS: Record<EditChildOperationKind, string> = {
  createChild: "Add",
  linkExisting: "Link",
  updateChild: "Edit",
  unlink: "Unlink",
  remove: "Remove",
  reorder: "Reorder",
};

function childActionLabel(operation: EditChildOperationKind): string {
  return CHILD_ACTION_LABELS[operation];
}

/**
 * Every surface this element owns whose entry belongs to it rather than to the
 * parent record's draft.
 */
const CHILD_SURFACE_SELECTOR = ".adl-relationship-picker, .adl-child-editor, .adl-child-draft";

/**
 * Whether an `input` or `change` event came from one of those surfaces.
 *
 * The event's own target is asked first and focus only as a fallback. A
 * `<select>` and a checkbox raise `change` from the control that changed, and a
 * click on a checkbox does not move focus to it on every platform — so a guard
 * that consulted `document.activeElement` alone read a toggle inside a child row
 * editor as a parent draft change, which re-rendered the form and wiped the row
 * being edited. The fallback stays for events raised by something other than the
 * control itself.
 */
function isChildSurfaceEvent(event: Event): boolean {
  const target = event.target;
  if (target instanceof HTMLElement && target.closest(CHILD_SURFACE_SELECTOR) !== null) {
    return true;
  }

  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement && activeElement.closest(CHILD_SURFACE_SELECTOR) !== null
  );
}

function childRowKey(sectionName: string, rowId: string): string {
  return `${sectionName}\u0000${rowId}`;
}

function childLookupLabelKey(field: ResolvedField, recordId: string): string {
  return `${field.lookup?.targetObject ?? ""}:${field.lookup?.displayField ?? ""}:${recordId}`;
}

function formatChildValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  // The same rendering `adl-list-view` gives the same field. A child row and the
  // child object's own list are the same model shown twice, so a boolean reading
  // "Yes" in one and "true" in the other would be the component talking about
  // itself rather than about the record.
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function isSectionReorderable(section: RuntimeEditChildCollectionSection): boolean {
  return section.operations.includes("reorder") && section.orderField !== undefined;
}

function childRowLabel(
  section: RuntimeEditChildCollectionSection,
  row: RuntimeEditChildRow,
  orderIndex: number,
): string {
  for (const field of section.fields) {
    const text = formatChildValue(row.values[field.name]).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return `row ${orderIndex + 1}`;
}

function compareOrderValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const leftNumber = typeof left === "number" ? left : Number.NaN;
  const rightNumber = typeof right === "number" ? right : Number.NaN;
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  // A row with no order value yet sorts last rather than jumping to the front.
  if (Number.isNaN(leftNumber) !== Number.isNaN(rightNumber)) {
    return Number.isNaN(leftNumber) ? 1 : -1;
  }
  return formatChildValue(left).localeCompare(formatChildValue(right), "en", { numeric: true });
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

function reorderableRowFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const row = target.closest<HTMLElement>(".adl-child-row[draggable='true']");
  return row;
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape(value) ?? value.replace(/"/g, '\\"');
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
