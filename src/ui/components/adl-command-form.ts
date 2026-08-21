import type {
  JsonValue,
  ResolvedCommand,
  ResolvedCommandInput,
} from "../../model/resolved-model.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

/** The values a person supplied for a command's declared inputs. */
export interface CommandFormSubmitDetail {
  commandName: string;
  input: Record<string, JsonValue>;
}

export const ADL_COMMAND_FORM_SUBMIT_EVENT = "adl-command-form-submit";
export const ADL_COMMAND_FORM_CANCEL_EVENT = "adl-command-form-cancel";

/**
 * A form for a **command's own declared inputs**.
 *
 * This is the general construct Phase 99 was missing. A presentation `ACTION`
 * carries `input: Record<string, ResolvedExpression>`, evaluated against a row
 * — which can only restate values that already exist somewhere. Nothing in the
 * language could ask a person for a value, so a command with a required
 * free-text input (`CreateBand`'s `Name`) was unreachable from a browser, and
 * a person holding an identity and no membership had no affordance at all.
 *
 * It is deliberately generic: it is handed a `ResolvedCommand` and renders one
 * control per `INPUT`, typed from the input's own declared `FieldType`. It
 * knows nothing about bands, circles, contexts or registration.
 *
 * What it does **not** do is decide anything. It collects values and
 * dispatches them; the runtime executes the command, and the runtime's policy
 * and preconditions remain the only enforcement point. Nothing here is a
 * second place where a write is authorised.
 */
export class AdlCommandFormElement extends HTMLElement {
  private _command: ResolvedCommand | undefined;
  private _busy = false;
  private _error: string | undefined;
  /** What the person has typed, seeded from {@link values} after a refusal. */
  private typed: Record<string, string> = {};

  private readonly handleSubmit = (event: Event): void => {
    event.preventDefault();
    const command = this._command;
    if (command === undefined || this._busy) {
      return;
    }

    this.captureValues();
    const missing = command.inputs
      .filter((input) => input.required && isBlank(this.typed[input.name]))
      .map((input) => inputLabel(input));
    if (missing.length > 0) {
      this._error = `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} required.`;
      this.render();
      return;
    }

    this._error = undefined;
    this.dispatchEvent(
      new CustomEvent<CommandFormSubmitDetail>(ADL_COMMAND_FORM_SUBMIT_EVENT, {
        bubbles: true,
        composed: true,
        detail: { commandName: command.name, input: this.collectInput(command) },
      }),
    );
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-command-form-cancel='true']") !== null) {
      this.dispatchEvent(
        new CustomEvent(ADL_COMMAND_FORM_CANCEL_EVENT, { bubbles: true, composed: true }),
      );
    }
  };

  set command(command: ResolvedCommand | undefined) {
    if (command?.name !== this._command?.name) {
      // A different command is a different form; keeping the old values would
      // carry one command's answers into another's inputs.
      this.typed = {};
      this._error = undefined;
    }
    this._command = command;
    this.render();
  }

  get command(): ResolvedCommand | undefined {
    return this._command;
  }

  /**
   * Values to seed the controls with.
   *
   * The shell rewrites its whole `innerHTML` on every render, so this element
   * is recreated rather than updated and cannot keep anything across one — the
   * same reason `adl-form-view` is handed its draft values. Without this, a
   * refusal would come back with the person's answers wiped, which is the
   * worst moment to lose them.
   */
  set values(values: Record<string, JsonValue> | undefined) {
    if (values === undefined) {
      return;
    }
    this.typed = {};
    for (const [name, value] of Object.entries(values)) {
      this.typed[name] = typeof value === "boolean" ? String(value) : String(value ?? "");
    }
    this.render();
  }

  set busy(busy: boolean) {
    if (busy === this._busy) {
      return;
    }
    // Values live in the DOM until captured, and `render()` rewrites the DOM.
    this.captureValues();
    this._busy = busy;
    this.render();
  }

  set error(error: string | undefined) {
    if (error === this._error) {
      return;
    }
    this.captureValues();
    this._error = error;
    this.render();
  }

  connectedCallback(): void {
    this.addEventListener("submit", this.handleSubmit);
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("submit", this.handleSubmit);
    this.removeEventListener("click", this.handleClick);
  }

  private captureValues(): void {
    for (const element of this.querySelectorAll<HTMLInputElement>("[data-command-input]")) {
      const name = element.dataset.commandInput;
      if (name === undefined) {
        continue;
      }
      this.typed[name] = element.type === "checkbox" ? String(element.checked) : element.value;
    }
  }

  private collectInput(command: ResolvedCommand): Record<string, JsonValue> {
    const input: Record<string, JsonValue> = {};
    for (const declared of command.inputs) {
      const raw = this.typed[declared.name];
      if (declared.type === "boolean") {
        input[declared.name] = raw === "true";
        continue;
      }
      if (isBlank(raw)) {
        // An optional input left blank is *absent*, not empty: the command's
        // own `DEFAULT` (or the object's) must be what fills it in.
        continue;
      }
      input[declared.name] = declared.type === "number" ? Number(raw) : (raw as string);
    }
    return input;
  }

  private render(): void {
    const command = this._command;
    if (command === undefined) {
      this.innerHTML = "";
      return;
    }

    const disabled = this._busy ? "disabled" : "";
    this.innerHTML = `
      <form class="adl-command-form" data-command-form="${escapeHtml(command.name)}">
        <h2 class="adl-command-form-heading">${escapeHtml(
          command.label ?? titleCaseIdentifier(command.name),
        )}</h2>
        ${
          this._error === undefined
            ? ""
            : `<p class="adl-command-form-error" data-command-form-error="true" role="alert">${escapeHtml(
                this._error,
              )}</p>`
        }
        ${command.inputs.map((input) => this.renderInput(input, disabled)).join("")}
        <div class="adl-command-form-actions">
          <button class="adl-command-form-submit" type="submit" ${disabled}>
            ${escapeHtml(this._busy ? "Working…" : (command.label ?? titleCaseIdentifier(command.name)))}
          </button>
          <button
            class="adl-command-form-cancel"
            type="button"
            data-command-form-cancel="true"
            ${disabled}
          >Cancel</button>
        </div>
      </form>
    `;
  }

  private renderInput(input: ResolvedCommandInput, disabled: string): string {
    const label = inputLabel(input);
    const value = this.typed[input.name] ?? defaultValueText(input);
    if (input.type === "boolean") {
      return `
        <label class="adl-command-form-check">
          <input
            type="checkbox"
            data-command-input="${escapeHtml(input.name)}"
            ${value === "true" ? "checked" : ""}
            ${disabled}
          />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    }

    return `
      <label class="adl-command-form-label">
        <span>${escapeHtml(label)}${input.required ? "" : " (optional)"}</span>
        <input
          class="adl-command-form-input"
          type="${htmlInputType(input.type)}"
          data-command-input="${escapeHtml(input.name)}"
          value="${escapeHtml(value)}"
          ${input.required ? "required" : ""}
          autocomplete="off"
          ${disabled}
        />
      </label>
    `;
  }
}

export function defineAdlCommandForm(): void {
  if (customElements.get("adl-command-form") === undefined) {
    customElements.define("adl-command-form", AdlCommandFormElement);
  }
}

function inputLabel(input: ResolvedCommandInput): string {
  return titleCaseIdentifier(input.name);
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function defaultValueText(input: ResolvedCommandInput): string {
  if (input.defaultValue === undefined || input.defaultValue === null) {
    return "";
  }
  return typeof input.defaultValue === "boolean"
    ? String(input.defaultValue)
    : String(input.defaultValue as string | number);
}

/**
 * `attachment` and `repeated` inputs are absent here on purpose: the compiler
 * refuses a `commandAction` control whose command declares one
 * (`ADL_SHELL_CONTROL_COMMAND_INPUT_UNSUPPORTED`), so an unpromptable command
 * is a model error rather than a form that silently drops a value.
 */
function htmlInputType(type: ResolvedCommandInput["type"]): string {
  switch (type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "time":
      return "time";
    default:
      return "text";
  }
}
