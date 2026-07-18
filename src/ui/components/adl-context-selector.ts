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
  private sheetOpen = false;

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || this._contextModel === undefined) {
      return;
    }

    this.selectContext(target.value);
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this._contextModel === undefined) {
      return;
    }

    if (target.closest("[data-context-sheet-close='true']") !== null) {
      this.sheetOpen = false;
      this.render();
      return;
    }

    if (target.closest("[data-context-compact='true']") !== null) {
      this.sheetOpen = true;
      this.render();
      return;
    }

    const option = target.closest<HTMLButtonElement>("[data-context-sheet-option]");
    if (option !== null) {
      this.selectContext(option.dataset.contextSheetOption ?? "");
    }
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
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("change", this.handleChange);
    this.removeEventListener("click", this.handleClick);
  }

  private selectContext(contextId: string): void {
    if (this._contextModel === undefined) {
      return;
    }

    this.sheetOpen = false;
    this.dispatchEvent(
      new CustomEvent<ContextSelectionDetail>("adl-select-context", {
        bubbles: true,
        detail: {
          contextName: this._contextModel.name,
          ...(contextId.length === 0 ? {} : { contextId }),
        },
      }),
    );
  }

  private render(): void {
    if (this._contextModel === undefined) {
      this.innerHTML = "";
      return;
    }

    const label = titleCaseIdentifier(this._contextModel.name);

    this.innerHTML = `
      <div class="adl-context-selector" data-context-name="${escapeHtml(this._contextModel.name)}">
        <span>${escapeHtml(label)}</span>
        ${this.renderControl(label)}
      </div>
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

    const selected = this._availableContexts.find(
      (candidate) => candidate.id === this._selectedContextId,
    );
    const compactLabel = selected?.label ?? `Choose ${label}`;

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
      <button
        class="adl-context-compact"
        type="button"
        data-context-compact="true"
        aria-haspopup="dialog"
        aria-expanded="${this.sheetOpen ? "true" : "false"}"
      >
        <span>${escapeHtml(compactLabel)}</span>
      </button>
      ${this.renderSheet(label)}
    `;
  }

  private renderSheet(label: string): string {
    if (!this.sheetOpen || this.dataset.mobileMode !== "sheet") {
      return "";
    }

    return `
      <button
        class="adl-context-sheet-scrim"
        type="button"
        aria-label="Close ${escapeHtml(label)} selector"
        data-context-sheet-close="true"
      ></button>
      <div class="adl-context-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(
        label,
      )} selector">
        <div class="adl-context-sheet-header">
          <strong>${escapeHtml(label)}</strong>
          <button type="button" aria-label="Close ${escapeHtml(
            label,
          )} selector" data-context-sheet-close="true">x</button>
        </div>
        <div class="adl-context-sheet-options">
          <button
            type="button"
            data-context-sheet-option=""
            ${this._selectedContextId === undefined ? 'aria-current="true"' : ""}
          >Choose ${escapeHtml(label)}</button>
          ${this._availableContexts
            .map(
              (candidate) => `
                <button
                  type="button"
                  data-context-sheet-option="${escapeHtml(candidate.id)}"
                  ${candidate.id === this._selectedContextId ? 'aria-current="true"' : ""}
                >${escapeHtml(candidate.label)}</button>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }
}

export function defineAdlContextSelector(): void {
  if (customElements.get("adl-context-selector") === undefined) {
    customElements.define("adl-context-selector", AdlContextSelectorElement);
  }
}
