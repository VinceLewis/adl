import type { JsonValue, ResolvedField } from "../../model/resolved-model.js";
import type { RuntimeValidationIssue } from "../../runtime/runtime-types.js";
import type { FieldPresentation, UiMode } from "../types.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlFieldRendererElement extends HTMLElement {
  private _field: ResolvedField | undefined;
  private _value: JsonValue | undefined;
  private _mode: UiMode = "edit";
  private _presentation: FieldPresentation | undefined;
  private _issues: RuntimeValidationIssue[] = [];

  set field(field: ResolvedField | undefined) {
    this._field = field;
    this.render();
  }

  get field(): ResolvedField | undefined {
    return this._field;
  }

  set value(value: JsonValue | undefined) {
    this._value = value;
    this.render();
  }

  get value(): JsonValue | undefined {
    return this._value;
  }

  set mode(mode: UiMode) {
    this._mode = mode;
    this.render();
  }

  set presentation(presentation: FieldPresentation | undefined) {
    this._presentation = presentation;
    this.render();
  }

  set issues(issues: RuntimeValidationIssue[]) {
    this._issues = [...issues];
    this.render();
  }

  connectedCallback(): void {
    this.render();
  }

  getValue(): JsonValue | undefined {
    if (this._field === undefined || this._presentation === undefined) {
      return undefined;
    }

    if (this._presentation.hidden || this._presentation.masked || this._presentation.readonly) {
      return undefined;
    }

    const input = this.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field-input]");
    if (input === null) {
      return undefined;
    }

    switch (this._field.type) {
      case "boolean":
        return input instanceof HTMLInputElement && input.checked;
      case "number": {
        const raw = input.value.trim();
        if (raw.length === 0) {
          return this._field.required ? "" : null;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
      }
      case "attachment":
      case "date":
      case "datetime":
      case "text":
      case "time": {
        const raw = input.value;
        return raw.trim().length === 0 && !this._field.required ? null : raw;
      }
    }
  }

  private render(): void {
    const field = this._field;
    const presentation = this._presentation;
    if (field === undefined || presentation === undefined) {
      this.innerHTML = "";
      return;
    }

    this.dataset.fieldName = field.name;
    this.dataset.fieldEffect = presentation.effect;

    if (presentation.hidden) {
      this.innerHTML = "";
      return;
    }

    const inputId = `${field.name}-${this._mode}-${Math.random().toString(36).slice(2)}`;
    const badge = renderBadge(field, presentation);
    const input = renderInput(field, this._value, inputId, presentation);
    const issues = renderIssues(this._issues);

    this.innerHTML = `
      <div class="adl-field">
        <div class="adl-field-label-row">
          <label class="adl-field-label" for="${escapeHtml(inputId)}">${escapeHtml(
            titleCaseIdentifier(field.name),
          )}</label>
          ${badge}
        </div>
        ${input}
        ${issues}
      </div>
    `;
  }
}

export function defineAdlFieldRenderer(): void {
  if (customElements.get("adl-field-renderer") === undefined) {
    customElements.define("adl-field-renderer", AdlFieldRendererElement);
  }
}

function renderBadge(field: ResolvedField, presentation: FieldPresentation): string {
  const labels: string[] = [];
  if (field.required) {
    labels.push("Required");
  }
  if (presentation.masked) {
    labels.push("Masked");
  } else if (presentation.readonly) {
    labels.push("Readonly");
  }

  if (labels.length === 0) {
    return "";
  }

  return `<span class="adl-field-badge">${labels.map(escapeHtml).join(" · ")}</span>`;
}

function renderInput(
  field: ResolvedField,
  value: JsonValue | undefined,
  inputId: string,
  presentation: FieldPresentation,
): string {
  const disabled = presentation.masked || field.type === "attachment";
  const readonly = presentation.readonly && !disabled;
  const common = `
    id="${escapeHtml(inputId)}"
    name="${escapeHtml(field.name)}"
    data-field-input
    class="adl-field-control"
    ${disabled ? "disabled" : ""}
    ${readonly ? "readonly" : ""}
  `;

  if (presentation.masked) {
    return `<input ${common} type="text" value="••••••" />`;
  }

  if (field.lookup !== undefined) {
    return `<input ${common} type="text" value="${escapeHtml(toInputValue(value))}" placeholder="Lookup" />`;
  }

  switch (field.type) {
    case "boolean":
      return `
        <label class="adl-checkbox-row">
          <input
            id="${escapeHtml(inputId)}"
            name="${escapeHtml(field.name)}"
            data-field-input
            type="checkbox"
            ${value === true ? "checked" : ""}
            ${presentation.readonly ? "disabled" : ""}
          />
          <span>${value === true ? "Yes" : "No"}</span>
        </label>
      `;
    case "number":
      return `<input ${common} type="number" value="${escapeHtml(toInputValue(value))}" />`;
    case "date":
      return `<input ${common} type="date" value="${escapeHtml(toInputValue(value))}" />`;
    case "datetime":
      return `<input ${common} type="datetime-local" value="${escapeHtml(
        toDateTimeLocalValue(value),
      )}" />`;
    case "time":
      return `<input ${common} type="time" value="${escapeHtml(toInputValue(value))}" />`;
    case "attachment":
      return `<input ${common} type="text" value="${escapeHtml(
        toInputValue(value),
      )}" placeholder="Attachment upload is not available in this runtime slice" />`;
    case "text":
      return `<input ${common} type="${hasEmailValidator(field) ? "email" : "text"}" value="${escapeHtml(
        toInputValue(value),
      )}" />`;
  }
}

function renderIssues(issues: RuntimeValidationIssue[]): string {
  if (issues.length === 0) {
    return "";
  }

  return `
    <div class="adl-field-errors">
      ${issues.map((issue) => `<span>${escapeHtml(issue.message)}</span>`).join("")}
    </div>
  `;
}

function toInputValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function toDateTimeLocalValue(value: JsonValue | undefined): string {
  const input = toInputValue(value);
  return input.endsWith("Z") ? input.slice(0, 16) : input;
}

function hasEmailValidator(field: ResolvedField): boolean {
  return field.validators.some((validator) => validator.kind === "email");
}
