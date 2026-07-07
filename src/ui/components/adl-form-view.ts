import type { ApplicationRuntime } from "../../runtime/application-runtime.js";
import type {
  JsonValue,
  ResolvedField,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext, RuntimeValidationIssue } from "../../runtime/runtime-types.js";
import {
  canRunCommand,
  getAvailableLifecycleActions,
  getInitialLifecycleState,
  resolveFieldPresentation,
} from "../policy-presentation.js";
import type { ActionBarItem, SaveRecordDetail, TransitionRecordDetail, UiMode } from "../types.js";
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
          detail: { actionName: detail.name, record: this._record },
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

  connectedCallback(): void {
    this.addEventListener("adl-action", this.handleAction);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("adl-action", this.handleAction);
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
      .filter((field): field is ResolvedField => field !== undefined);
    const title =
      this._mode === "create"
        ? `New ${titleCaseIdentifier(this._object.name)}`
        : getRecordTitle(this._object, this._record);

    this.innerHTML = `
      <section class="adl-panel">
        <header class="adl-panel-header">
          <h2 class="adl-panel-title">${escapeHtml(title)}</h2>
          <adl-action-bar></adl-action-bar>
        </header>
        <div class="adl-form-body">
          ${fields
            .map(
              (field) =>
                `<adl-field-renderer data-field-slot="${escapeHtml(field.name)}"></adl-field-renderer>`,
            )
            .join("")}
        </div>
      </section>
    `;

    this.configureFields(fields);
    this.configureActions();
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
      ...getAvailableLifecycleActions(this._runtime, this._object, this._record, this._context),
    );
    actionBar.actions = actions;
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

  private getFieldValue(field: ResolvedField): JsonValue | undefined {
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

function cssEscape(value: string): string {
  return globalThis.CSS?.escape(value) ?? value.replace(/"/g, '\\"');
}

function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
