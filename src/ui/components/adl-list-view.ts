import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
  ResolvedField,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext } from "../../runtime/runtime-types.js";
import { getRecordLifecycleState, resolveFieldPresentation } from "../policy-presentation.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlListViewElement extends HTMLElement {
  private _runtime: ApplicationRuntime | undefined;
  private _object: ResolvedObject | undefined;
  private _view: ResolvedView | undefined;
  private _context: RuntimeContext | undefined;
  private _records: StoredObjectRecord[] = [];
  private _selectedRecordId: string | undefined;
  private _searchText = "";

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

  set records(records: StoredObjectRecord[]) {
    this._records = [...records];
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
            <button type="button" class="adl-primary" data-list-action="new">New</button>
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
        aria-selected="${record.meta.guid === this._selectedRecordId ? "true" : "false"}"
      >
        ${fields.map((field) => this.renderCell(record, field)).join("")}
      </tr>
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

    return `<td>${escapeHtml(formatValue(value))}</td>`;
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
