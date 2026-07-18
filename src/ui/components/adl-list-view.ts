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

    const row = target.closest<HTMLTableRowElement>("tr[data-record-id]");
    if (row?.dataset.recordId !== undefined) {
      this.selectRecord(row.dataset.recordId);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest("button, input, select, textarea") !== null
    ) {
      return;
    }

    const row = target.closest<HTMLTableRowElement>("tr[data-record-id]");
    if (row?.dataset.recordId !== undefined) {
      event.preventDefault();
      this.selectRecord(row.dataset.recordId);
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
    this.addEventListener("keydown", this.handleKeyDown);
    this.queueLookupLabelLoads();
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
    this.removeEventListener("input", this.handleInput);
    this.removeEventListener("keydown", this.handleKeyDown);
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

    this.innerHTML = `
      <section class="adl-panel adl-list-panel">
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
        ${this.renderRows(fields)}
      </section>
    `;
  }

  private renderRows(fields: ResolvedField[]): string {
    if (this._records.length === 0) {
      return `<div class="adl-empty">No records found.</div>`;
    }

    return `
      <div class="adl-table-wrap">
        <table class="adl-table">
          <thead>
            <tr>
              ${fields.map((field) => `<th>${escapeHtml(titleCaseIdentifier(field.name))}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${this._records.map((record) => this.renderRow(record, fields)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderRow(record: StoredObjectRecord, fields: ResolvedField[]): string {
    return `
      <tr
        data-record-id="${escapeHtml(record.meta.guid)}"
        tabindex="0"
        aria-label="Open ${escapeHtml(this.recordLabel(record, fields))}"
        aria-selected="${record.meta.guid === this._selectedRecordId ? "true" : "false"}"
      >
        ${fields.map((field) => this.renderCell(record, field)).join("")}
      </tr>
    `;
  }

  private renderCell(record: StoredObjectRecord, field: ResolvedField): string {
    const label = titleCaseIdentifier(field.name);
    if (this._runtime === undefined || this._object === undefined || this._context === undefined) {
      return `<td data-label="${escapeHtml(label)}"></td>`;
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
      return `<td data-label="${escapeHtml(label)}"></td>`;
    }

    if (presentation.masked) {
      return `<td data-label="${escapeHtml(label)}" aria-label="${escapeHtml(field.name)} masked">••••••</td>`;
    }

    const value = record.values[field.name];
    if (this._object.lifecycle?.stateField === field.name) {
      return `<td data-label="${escapeHtml(label)}"><span class="adl-state-pill">${escapeHtml(
        getRecordLifecycleState(this._object, record) ?? value ?? "",
      )}</span></td>`;
    }

    return `<td data-label="${escapeHtml(label)}">${escapeHtml(this.formatCellValue(field, value))}</td>`;
  }

  private selectRecord(recordId: string): void {
    this.dispatchEvent(
      new CustomEvent<{ recordId: string }>("adl-select-record", {
        bubbles: true,
        detail: { recordId },
      }),
    );
  }

  private recordLabel(record: StoredObjectRecord, fields: ResolvedField[]): string {
    const displayField =
      fields.find((field) => field.name === this._object?.displayField) ?? fields[0];
    if (displayField === undefined) {
      return "record";
    }

    const value = this.formatCellValue(displayField, record.values[displayField.name]);
    return value.length === 0 ? "record" : value;
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
