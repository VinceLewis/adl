import type { ResolvedReadModel, ResolvedReadModelField } from "../../model/resolved-model.js";
import type { RuntimeReadModelRow } from "../../runtime/runtime-types.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlDashboardViewElement extends HTMLElement {
  private _readModel: ResolvedReadModel | undefined;
  private _rows: RuntimeReadModelRow[] = [];

  set readModel(readModel: ResolvedReadModel | undefined) {
    this._readModel = readModel;
    this.render();
  }

  set rows(rows: RuntimeReadModelRow[]) {
    this._rows = [...rows];
    this.render();
  }

  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    if (this._readModel === undefined) {
      this.innerHTML = "";
      return;
    }

    this.innerHTML = `
      <section class="adl-panel adl-dashboard" data-read-model="${escapeHtml(this._readModel.name)}">
        <header class="adl-panel-header">
          <h2 class="adl-panel-title">${escapeHtml(titleCaseIdentifier(this._readModel.name))}</h2>
        </header>
        ${this.renderRows()}
      </section>
    `;
  }

  private renderRows(): string {
    if (this._readModel === undefined) {
      return "";
    }

    if (this._rows.length === 0) {
      return `<div class="adl-empty">No dashboard records found.</div>`;
    }

    const dateField = findDateField(this._readModel.fields);
    const titleField =
      this._readModel.fields.find((field) => field.name !== dateField?.name) ??
      this._readModel.fields[0];

    return `
      <ol class="adl-event-list">
        ${this._rows.map((row) => this.renderRow(row, dateField, titleField)).join("")}
      </ol>
    `;
  }

  private renderRow(
    row: RuntimeReadModelRow,
    dateField: ResolvedReadModelField | undefined,
    titleField: ResolvedReadModelField | undefined,
  ): string {
    const visibleFields =
      this._readModel?.fields.filter(
        (field) => field.name !== dateField?.name && field.name !== titleField?.name,
      ) ?? [];

    return `
      <li class="adl-event-row" data-read-model-row="${escapeHtml(row.id)}">
        <time class="adl-event-date">${escapeHtml(formatValue(readValue(row, dateField)))}</time>
        <div class="adl-event-main">
          <strong>${escapeHtml(formatValue(readValue(row, titleField)))}</strong>
          ${
            visibleFields.length === 0
              ? ""
              : `<dl>${visibleFields.map((field) => this.renderField(row, field)).join("")}</dl>`
          }
        </div>
      </li>
    `;
  }

  private renderField(row: RuntimeReadModelRow, field: ResolvedReadModelField): string {
    if (!Object.prototype.hasOwnProperty.call(row.values, field.name)) {
      return "";
    }

    return `
      <div>
        <dt>${escapeHtml(titleCaseIdentifier(field.name))}</dt>
        <dd>${escapeHtml(formatValue(readValue(row, field)))}</dd>
      </div>
    `;
  }
}

export function defineAdlDashboardView(): void {
  if (customElements.get("adl-dashboard-view") === undefined) {
    customElements.define("adl-dashboard-view", AdlDashboardViewElement);
  }
}

function findDateField(fields: ResolvedReadModelField[]): ResolvedReadModelField | undefined {
  return (
    fields.find((field) => field.type === "date" || field.type === "datetime") ??
    fields.find((field) => field.name.toLowerCase().includes("date"))
  );
}

/**
 * A projected `LOOKUP` field's resolved display label if the runtime produced
 * one, else the stored value. Absent means the target could not be read, and
 * the id the caller already holds is the honest fallback.
 */
function readValue(row: RuntimeReadModelRow, field: ResolvedReadModelField | undefined): unknown {
  if (field === undefined) {
    return undefined;
  }

  return row.display?.[field.name] ?? row.values[field.name];
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
