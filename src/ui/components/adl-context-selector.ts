import type { ResolvedBusinessContext } from "../../model/resolved-model.js";
import type { RuntimeAvailableContext } from "../../runtime/runtime-types.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export interface ContextSelectionDetail {
  contextName: string;
  contextId?: string;
}

export class AdlContextSelectorElement extends HTMLElement {
  private _contextModel: ResolvedBusinessContext | undefined;
  private _availableContexts: RuntimeAvailableContext[] = [];
  private _selectedContextId: string | undefined;

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || this._contextModel === undefined) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<ContextSelectionDetail>("adl-select-context", {
        bubbles: true,
        detail: {
          contextName: this._contextModel.name,
          ...(target.value.length === 0 ? {} : { contextId: target.value }),
        },
      }),
    );
  };

  set contextModel(contextModel: ResolvedBusinessContext | undefined) {
    this._contextModel = contextModel;
    this.render();
  }

  set availableContexts(availableContexts: RuntimeAvailableContext[]) {
    this._availableContexts = [...availableContexts];
    this.render();
  }

  set selectedContextId(selectedContextId: string | undefined) {
    this._selectedContextId = selectedContextId;
    this.render();
  }

  connectedCallback(): void {
    this.addEventListener("change", this.handleChange);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("change", this.handleChange);
  }

  private render(): void {
    if (this._contextModel === undefined) {
      this.innerHTML = "";
      return;
    }

    const label = titleCaseIdentifier(this._contextModel.name);

    this.innerHTML = `
      <label class="adl-context-selector" data-context-name="${escapeHtml(this._contextModel.name)}">
        <span>${escapeHtml(label)}</span>
        ${this.renderControl(label)}
      </label>
    `;
  }

  private renderControl(label: string): string {
    if (this._availableContexts.length === 0) {
      return `<span class="adl-context-empty" data-context-empty="true">No ${escapeHtml(label)} contexts</span>`;
    }

    if (this._availableContexts.length === 1 && this._selectedContextId !== undefined) {
      const selected = this._availableContexts[0];
      return `
        <span class="adl-context-single" data-selected-context-id="${escapeHtml(selected?.id ?? "")}">
          ${escapeHtml(selected?.label ?? "")}
        </span>
      `;
    }

    return `
      <select data-context-select="${escapeHtml(this._contextModel?.name ?? "")}">
        <option value="">Choose ${escapeHtml(label)}</option>
        ${this._availableContexts
          .map(
            (candidate) => `
              <option value="${escapeHtml(candidate.id)}" ${
                candidate.id === this._selectedContextId ? "selected" : ""
              }>
                ${escapeHtml(candidate.label)}
              </option>
            `,
          )
          .join("")}
      </select>
    `;
  }
}

export function defineAdlContextSelector(): void {
  if (customElements.get("adl-context-selector") === undefined) {
    customElements.define("adl-context-selector", AdlContextSelectorElement);
  }
}
