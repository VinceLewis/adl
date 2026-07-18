import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
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

  private readonly handleFormInput = (): void => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest(".adl-relationship-picker") !== null
    ) {
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
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("adl-action", this.handleAction);
    this.removeEventListener("click", this.handleChildClick);
    this.removeEventListener("input", this.handleFormInput);
    this.removeEventListener("change", this.handleFormInput);
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
    this.configureActions();
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
    return `
      <section class="adl-edit-section adl-child-section" data-child-section="${escapeHtml(section.name)}">
        <header class="adl-child-section-header">
          <h3>${escapeHtml(section.heading ?? titleCaseIdentifier(section.name))}</h3>
          <div class="adl-child-section-actions">
            ${
              linkAction === undefined || section.picker === undefined
                ? ""
                : `<button
                    type="button"
                    data-child-action="linkExisting"
                    data-child-section="${escapeHtml(section.name)}"
                    data-child-object="${escapeHtml(section.childObject)}"
                    ${linkAction.enabled ? "" : "disabled"}
                  >Link</button>`
            }
            ${
              addAction === undefined
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

  private renderChildRows(section: RuntimeEditChildCollectionSection): string {
    if (section.rows.length === 0) {
      return `<div class="adl-empty">${escapeHtml(section.emptyState.text || "No child records.")}</div>`;
    }

    return `
      <div class="adl-child-rows">
        ${section.rows
          .map(
            (row) => `
              <div class="adl-child-row" data-child-row="${escapeHtml(row.id)}">
                <div class="adl-child-row-values">
                  ${section.fields
                    .map(
                      (field) =>
                        `<span>${escapeHtml(formatChildValue(row.values[field.name]))}</span>`,
                    )
                    .join("")}
                </div>
                <div class="adl-child-row-actions">
                  ${row.actions
                    .filter((action) => action.visible)
                    .map(
                      (action) => `
                        <button
                          type="button"
                          data-child-action="${escapeHtml(action.operation)}"
                          data-child-section="${escapeHtml(section.name)}"
                          data-child-object="${escapeHtml(section.childObject)}"
                          ${
                            row.source === "staged"
                              ? `data-staged-operation-id="${escapeHtml(row.stagedOperationId ?? "")}"`
                              : `data-child-id="${escapeHtml(row.record?.meta.guid ?? row.id)}"`
                          }
                          ${action.enabled ? "" : "disabled"}
                        >${escapeHtml(action.operation === "remove" ? "Remove" : titleCaseIdentifier(action.operation))}</button>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  private renderChildDraft(section: RuntimeEditChildCollectionSection): string {
    if (!section.operations.includes("createChild")) {
      return "";
    }

    return `
      <div class="adl-child-draft" data-child-draft="${escapeHtml(section.name)}">
        ${section.fields
          .map(
            (field) => `
              <label>
                <span>${escapeHtml(titleCaseIdentifier(field.name))}</span>
                <input
                  type="${field.type === "number" ? "number" : "text"}"
                  data-child-draft-field="${escapeHtml(field.name)}"
                  data-child-draft-section="${escapeHtml(section.name)}"
                />
              </label>
            `,
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

    this.dispatchEvent(
      new CustomEvent<StageChildOperationDetail>("adl-stage-child-operation", {
        bubbles: true,
        detail: {
          section: this.pickerResult.section,
          operation: "linkExisting",
          childObject: this.pickerResult.candidates[0]?.source.objectName ?? "",
          childIds: selected,
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

    for (const renderer of this.querySelectorAll<AdlFieldRendererElement>("adl-field-renderer")) {
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
    for (const input of this.querySelectorAll<HTMLInputElement>(
      `input[data-child-draft-section="${cssEscape(sectionName)}"]`,
    )) {
      const fieldName = input.dataset.childDraftField;
      if (fieldName === undefined) {
        continue;
      }
      const field = this._editSurface?.sections
        .find((section) => section.kind === "childCollection" && section.name === sectionName)
        ?.fields.find((candidate) => candidate.name === fieldName);
      values[fieldName] = field?.type === "number" ? Number(input.value) : input.value;
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

function formatChildValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape(value) ?? value.replace(/"/g, '\\"');
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
