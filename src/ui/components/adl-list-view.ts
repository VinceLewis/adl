import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
  ResolvedField,
  ResolvedObject,
  ResolvedView,
  JsonValue,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext } from "../../runtime/runtime-types.js";
import {
  canRunCommand,
  getRecordLifecycleState,
  resolveFieldPresentation,
} from "../policy-presentation.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlListViewElement extends HTMLElement {
  private _runtime: ApplicationRuntime | undefined;
  private _object: ResolvedObject | undefined;
  private _view: ResolvedView | undefined;
  private _context: RuntimeContext | undefined;
  private _records: StoredObjectRecord[] = [];
  private _selectedRecordId: string | undefined;
  private _searchText = "";
  private lookupLabels = new Map<string, string>();
  private pendingLookupLabels = new Set<string>();

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-list-action='new']") !== null) {
      this.dispatchEvent(new CustomEvent("adl-new-record", { bubbles: true }));
      return;
    }

    const rowAction = target.closest<HTMLButtonElement>("button[data-row-action]");
    if (rowAction?.dataset.recordId !== undefined) {
      const record = this._records.find(
        (candidate) => candidate.meta.guid === rowAction.dataset.recordId,
      );
      if (rowAction.dataset.rowAction === "edit") {
        this.dispatchEvent(
          new CustomEvent<{ recordId: string }>("adl-select-record", {
            bubbles: true,
            detail: { recordId: rowAction.dataset.recordId },
          }),
        );
        return;
      }

      if (rowAction.dataset.rowAction === "delete" && record !== undefined) {
        this.dispatchEvent(
          new CustomEvent<{ record: StoredObjectRecord }>("adl-delete-record", {
            bubbles: true,
            detail: { record },
          }),
        );
        return;
      }
    }

    const row = target.closest<HTMLTableRowElement>("tr[data-record-id]");
    if (row?.dataset.recordId !== undefined) {
      this.dispatchEvent(
        new CustomEvent<{ recordId: string }>("adl-select-record", {
          bubbles: true,
          detail: { recordId: row.dataset.recordId },
        }),
      );
    }
  };

  private readonly handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.listSearch !== "true") {
      return;
    }

    this._searchText = target.value;
    this.dispatchEvent(
      new CustomEvent<{ text: string }>("adl-search", {
        bubbles: true,
        detail: { text: this._searchText },
      }),
    );
  };

  set runtime(runtime: ApplicationRuntime | undefined) {
    this._runtime = runtime;
    this.queueLookupLabelLoads();
    this.render();
  }

  set object(object: ResolvedObject | undefined) {
    this._object = object;
    this.queueLookupLabelLoads();
    this.render();
  }

  set view(view: ResolvedView | undefined) {
    this._view = view;
    this.queueLookupLabelLoads();
    this.render();
  }

  set context(context: RuntimeContext | undefined) {
    this._context = context;
    this.queueLookupLabelLoads();
    this.render();
  }

  set records(records: StoredObjectRecord[]) {
    this._records = [...records];
    this.queueLookupLabelLoads();
    this.render();
  }

  set selectedRecordId(selectedRecordId: string | undefined) {
    this._selectedRecordId = selectedRecordId;
    this.render();
  }

  set searchText(searchText: string) {
    this._searchText = searchText;
    this.render();
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.addEventListener("input", this.handleInput);
    this.queueLookupLabelLoads();
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
    this.removeEventListener("input", this.handleInput);
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

    const fields = this._view.fields
      .map((fieldName) => this._object?.fields.find((field) => field.name === fieldName))
      .filter((field): field is ResolvedField => field !== undefined && !field.hidden);
    const canCreate =
      this._view.actions.includes("create") &&
      canRunCommand(this._runtime, this._object, "create", this._context);
    const hasRowActions =
      this._view.actions.includes("update") || this._view.actions.includes("delete");

    this.innerHTML = `
      <section class="adl-panel">
        <header class="adl-panel-header">
          <h2 class="adl-panel-title">${escapeHtml(titleCaseIdentifier(this._object.name))}</h2>
          <div class="adl-list-tools">
            <input
              class="adl-search-input"
              type="search"
              data-list-search="true"
              value="${escapeHtml(this._searchText)}"
              placeholder="Search"
            />
            ${
              canCreate
                ? '<button type="button" class="adl-primary" data-list-action="new">New</button>'
                : ""
            }
          </div>
        </header>
        ${this.renderRows(fields, hasRowActions)}
      </section>
    `;
  }

  private renderRows(fields: ResolvedField[], hasRowActions: boolean): string {
    if (this._records.length === 0) {
      return `<div class="adl-empty">No records found.</div>`;
    }

    return `
      <div class="adl-table-wrap">
        <table class="adl-table">
          <thead>
            <tr>
              ${fields.map((field) => `<th>${escapeHtml(titleCaseIdentifier(field.name))}</th>`).join("")}
              ${hasRowActions ? '<th aria-label="Row actions"></th>' : ""}
            </tr>
          </thead>
          <tbody>
            ${this._records.map((record) => this.renderRow(record, fields, hasRowActions)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderRow(
    record: StoredObjectRecord,
    fields: ResolvedField[],
    hasRowActions: boolean,
  ): string {
    return `
      <tr
        data-record-id="${escapeHtml(record.meta.guid)}"
        aria-selected="${record.meta.guid === this._selectedRecordId ? "true" : "false"}"
      >
        ${fields.map((field) => this.renderCell(record, field)).join("")}
        ${hasRowActions ? this.renderRowActions(record) : ""}
      </tr>
    `;
  }

  private renderRowActions(record: StoredObjectRecord): string {
    if (
      this._runtime === undefined ||
      this._object === undefined ||
      this._context === undefined ||
      this._view === undefined
    ) {
      return "<td></td>";
    }

    const canEdit =
      this._view.actions.includes("update") &&
      canRunCommand(this._runtime, this._object, "update", this._context, record);
    const canDelete =
      this._view.actions.includes("delete") &&
      canRunCommand(this._runtime, this._object, "delete", this._context, record);

    if (!canEdit && !canDelete) {
      return "<td></td>";
    }

    return `
      <td class="adl-row-actions">
        ${
          canEdit
            ? `<button type="button" data-row-action="edit" data-record-id="${escapeHtml(
                record.meta.guid,
              )}">Edit</button>`
            : ""
        }
        ${
          canDelete
            ? `<button type="button" data-row-action="delete" data-record-id="${escapeHtml(
                record.meta.guid,
              )}">Delete</button>`
            : ""
        }
      </td>
    `;
  }

  private renderCell(record: StoredObjectRecord, field: ResolvedField): string {
    if (this._runtime === undefined || this._object === undefined || this._context === undefined) {
      return "<td></td>";
    }

    const presentation = resolveFieldPresentation({
      runtime: this._runtime,
      object: this._object,
      field,
      context: this._context,
      mode: "edit",
      record,
    });

    if (presentation.hidden) {
      return "<td></td>";
    }

    if (presentation.masked) {
      return `<td aria-label="${escapeHtml(field.name)} masked">••••••</td>`;
    }

    const value = record.values[field.name];
    if (this._object.lifecycle?.stateField === field.name) {
      return `<td><span class="adl-state-pill">${escapeHtml(
        getRecordLifecycleState(this._object, record) ?? value ?? "",
      )}</span></td>`;
    }

    return `<td>${escapeHtml(this.formatCellValue(field, value))}</td>`;
  }

  private formatCellValue(field: ResolvedField, value: JsonValue | undefined): string {
    if (field.lookup === undefined || typeof value !== "string" || value.length === 0) {
      return formatValue(value);
    }

    return this.lookupLabels.get(lookupLabelKey(field, value)) ?? value;
  }

  private queueLookupLabelLoads(): void {
    if (
      !this.isConnected ||
      this._runtime === undefined ||
      this._object === undefined ||
      this._view === undefined ||
      this._context === undefined
    ) {
      return;
    }

    const lookupFields = this._view.fields
      .map((fieldName) => this._object?.fields.find((field) => field.name === fieldName))
      .filter((field): field is ResolvedField => field !== undefined && field.lookup !== undefined);

    for (const field of lookupFields) {
      for (const record of this._records) {
        const value = record.values[field.name];
        if (typeof value !== "string" || value.length === 0) {
          continue;
        }

        const key = lookupLabelKey(field, value);
        if (this.lookupLabels.has(key) || this.pendingLookupLabels.has(key)) {
          continue;
        }

        this.pendingLookupLabels.add(key);
        void this.loadLookupLabel(field, value, key);
      }
    }
  }

  private async loadLookupLabel(
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
      this.lookupLabels.set(key, recordId);
    } finally {
      this.pendingLookupLabels.delete(key);
      this.render();
    }
  }
}

export function defineAdlListView(): void {
  if (customElements.get("adl-list-view") === undefined) {
    customElements.define("adl-list-view", AdlListViewElement);
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function lookupLabelKey(field: ResolvedField, recordId: string): string {
  return `${field.lookup?.targetObject ?? ""}:${field.lookup?.displayField ?? ""}:${recordId}`;
}
