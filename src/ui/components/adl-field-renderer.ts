import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
  JsonValue,
  ResolvedField,
  ResolvedObject,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext, RuntimeValidationIssue } from "../../runtime/runtime-types.js";
import type { FieldPresentation, UiMode } from "../types.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlFieldRendererElement extends HTMLElement {
  private _runtime: ApplicationRuntime | undefined;
  private _object: ResolvedObject | undefined;
  private _context: RuntimeContext | undefined;
  private _field: ResolvedField | undefined;
  private _value: JsonValue | undefined;
  private _mode: UiMode = "edit";
  private _presentation: FieldPresentation | undefined;
  private _issues: RuntimeValidationIssue[] = [];
  private lookupOptions: StoredObjectRecord[] = [];
  private lookupLoadKey = "";
  private lookupLoading = false;

  set runtime(runtime: ApplicationRuntime | undefined) {
    this._runtime = runtime;
    this.queueLookupLoad();
    this.render();
  }

  set object(object: ResolvedObject | undefined) {
    this._object = object;
    this.queueLookupLoad();
    this.render();
  }

  set context(context: RuntimeContext | undefined) {
    this._context = context;
    this.queueLookupLoad();
    this.render();
  }

  set field(field: ResolvedField | undefined) {
    this._field = field;
    this.queueLookupLoad();
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
    this.queueLookupLoad();
    this.render();
  }

  set issues(issues: RuntimeValidationIssue[]) {
    this._issues = [...issues];
    this.render();
  }

  connectedCallback(): void {
    this.queueLookupLoad();
    this.render();
  }

  getValue(): JsonValue | undefined {
    if (this._field === undefined || this._presentation === undefined) {
      return undefined;
    }

    if (this._presentation.hidden || this._presentation.masked || this._presentation.readonly) {
      return undefined;
    }

    const input = this.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "[data-field-input]",
    );
    if (input === null) {
      return undefined;
    }

    if (this._field.lookup !== undefined) {
      return input.value.trim().length === 0 && !this._field.required ? null : input.value;
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
    const input = renderInput(
      field,
      this._value,
      inputId,
      presentation,
      this.lookupOptions,
      this.lookupLoading,
    );
    const issues = renderIssues(this._issues);

    this.innerHTML = `
      <div class="adl-field">
        <div class="adl-field-label-row">
          <label class="adl-field-label" for="${escapeHtml(inputId)}">${escapeHtml(
            titleCaseIdentifier(field.name),
          )}${shouldRenderRequiredMarker(field) ? '<span class="adl-required-marker" aria-hidden="true"> *</span>' : ""}</label>
          ${badge}
        </div>
        ${input}
        ${issues}
      </div>
    `;
    this.syncRenderedInputValue(field, this._value);
    this.bindBooleanLabel(field);
  }

  /**
   * The word beside a checkbox has to say what the box says.
   *
   * It is rendered once from the value the element was given, so a person who
   * ticked the box sat looking at a ticked box labelled "No" until something
   * else re-rendered the element — a control contradicting its own state. The
   * listener is attached after every render and cannot accumulate, because
   * rendering replaces the input it was attached to.
   */
  private bindBooleanLabel(field: ResolvedField): void {
    if (field.type !== "boolean") {
      return;
    }

    const input = this.querySelector<HTMLInputElement>("input[data-field-input]");
    const label = this.querySelector<HTMLElement>(".adl-checkbox-row > span");
    if (input === null || label === null) {
      return;
    }

    input.addEventListener("change", () => {
      label.textContent = input.checked ? "Yes" : "No";
    });
  }

  private syncRenderedInputValue(field: ResolvedField, value: JsonValue | undefined): void {
    const input = this.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "[data-field-input]",
    );
    if (input === null) {
      return;
    }

    if (field.type === "boolean" && input instanceof HTMLInputElement) {
      input.checked = value === true;
      const label = this.querySelector<HTMLElement>(".adl-checkbox-row > span");
      if (label !== null) {
        label.textContent = input.checked ? "Yes" : "No";
      }
      return;
    }

    input.value = field.type === "datetime" ? toDateTimeLocalValue(value) : toInputValue(value);
  }

  private queueLookupLoad(): void {
    if (
      !this.isConnected ||
      this._field?.lookup === undefined ||
      this._presentation === undefined
    ) {
      return;
    }

    if (this._presentation.hidden || this._runtime === undefined || this._context === undefined) {
      return;
    }

    const lookup = this._field.lookup;
    const key = [
      lookup.targetObject,
      lookup.displayField,
      this._context.userId,
      JSON.stringify(this._context.roles),
      JSON.stringify(this._context.selectedContexts ?? {}),
      JSON.stringify(this._context.contextRoles ?? []),
    ].join("|");

    if (key === this.lookupLoadKey || this.lookupLoading) {
      return;
    }

    this.lookupLoadKey = key;
    this.lookupLoading = true;
    void this.loadLookupOptions(key);
  }

  private async loadLookupOptions(key: string): Promise<void> {
    if (
      this._runtime === undefined ||
      this._field?.lookup === undefined ||
      this._context === undefined
    ) {
      this.lookupLoading = false;
      return;
    }

    try {
      this.lookupOptions = await this._runtime.search(
        this._field.lookup.targetObject,
        { limit: 100 },
        this._context,
      );
    } catch {
      this.lookupOptions = [];
    } finally {
      this.lookupLoading = false;
      if (this.lookupLoadKey === key) {
        this.render();
      }
    }
  }
}

export function defineAdlFieldRenderer(): void {
  if (customElements.get("adl-field-renderer") === undefined) {
    customElements.define("adl-field-renderer", AdlFieldRendererElement);
  }
}

function renderBadge(field: ResolvedField, presentation: FieldPresentation): string {
  const labels: string[] = [];
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

function shouldRenderRequiredMarker(field: ResolvedField): boolean {
  return field.required && getSelectOptionValues(field) === undefined;
}

function renderInput(
  field: ResolvedField,
  value: JsonValue | undefined,
  inputId: string,
  presentation: FieldPresentation,
  lookupOptions: StoredObjectRecord[],
  lookupLoading: boolean,
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
    const selectedValue = toInputValue(value);
    const selectedKnown =
      selectedValue.length === 0 ||
      lookupOptions.some((option) => lookupOptionValue(field, option) === selectedValue);
    return `
      <select ${common} ${presentation.readonly ? "disabled" : ""}>
        <option value="">${escapeHtml(lookupLoading ? "Loading..." : `Choose ${titleCaseIdentifier(field.name)}`)}</option>
        ${
          selectedKnown
            ? ""
            : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`
        }
        ${lookupOptions
          .map((option) => {
            const optionValue = lookupOptionValue(field, option);
            return `
              <option value="${escapeHtml(optionValue)}" ${
                optionValue === selectedValue ? "selected" : ""
              }>
                ${escapeHtml(lookupLabel(field, option))}
              </option>
            `;
          })
          .join("")}
      </select>
    `;
  }

  const optionValues = getSelectOptionValues(field);
  if (optionValues !== undefined) {
    const selectedValue = toInputValue(value);
    const selectedKnown =
      selectedValue.length === 0 || optionValues.some((option) => String(option) === selectedValue);
    return `
      <select ${common} ${presentation.readonly ? "disabled" : ""}>
        <option value="">${escapeHtml(`Choose ${titleCaseIdentifier(field.name)}`)}</option>
        ${
          selectedKnown
            ? ""
            : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`
        }
        ${optionValues
          .map(
            (option) => `
              <option value="${escapeHtml(String(option))}" ${
                String(option) === selectedValue ? "selected" : ""
              }>
                ${escapeHtml(formatOptionLabel(option))}
              </option>
            `,
          )
          .join("")}
      </select>
    `;
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

function getSelectOptionValues(field: ResolvedField): (string | number | boolean)[] | undefined {
  const inValidator = field.validators.find(isInValidator);
  if (inValidator?.value === undefined || !Array.isArray(inValidator.value)) {
    return undefined;
  }

  const values = inValidator.value.filter(
    (value): value is string | number | boolean =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );

  return values.length === inValidator.value.length && values.length > 0 ? values : undefined;
}

function isInValidator(
  validator: ResolvedField["validators"][number],
): validator is ResolvedField["validators"][number] & { kind: "in"; value: unknown[] } {
  return validator.kind === "in" && "value" in validator && Array.isArray(validator.value);
}

function formatOptionLabel(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function lookupLabel(field: ResolvedField, record: StoredObjectRecord): string {
  const display = record.values[field.lookup?.displayField ?? ""];
  if (display !== undefined && display !== null) {
    return String(display);
  }

  return record.meta.guid;
}

/**
 * A candidate `<option>`'s `value` — and therefore what gets written back to
 * the field on save — is the identity match every `LOOKUP` used before
 * Phase 68: the candidate record's own id. A `TARGET_FIELD` lookup stores a
 * natural key instead, so an option's value must be that field's value on
 * the candidate, not the candidate's id — using the id here would silently
 * write the wrong kind of value into the field on every save, the same
 * defect `read-model-service.ts`'s `recordMatchesCurrentUser` had on the read
 * side before Phase 75. Falls back to the record's own id if the declared
 * `targetField` is unset on this particular candidate, matching
 * `lookupLabel`'s fallback for the same situation on `displayField`.
 */
function lookupOptionValue(field: ResolvedField, record: StoredObjectRecord): string {
  const targetField = field.lookup?.targetField;
  if (targetField === undefined) {
    return record.meta.guid;
  }

  const value = record.values[targetField];
  return value !== undefined && value !== null ? String(value) : record.meta.guid;
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
