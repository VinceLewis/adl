import type { ActionBarItem } from "../types.js";
import { escapeHtml } from "./html.js";

interface ActionEventDetail {
  name: string;
  kind: ActionBarItem["kind"];
}

export class AdlActionBarElement extends HTMLElement {
  private _actions: ActionBarItem[] = [];
  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const name = target.dataset.actionName;
    const kind = target.dataset.actionKind as ActionBarItem["kind"] | undefined;
    if (name === undefined || kind === undefined) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<ActionEventDetail>("adl-action", {
        bubbles: true,
        detail: { name, kind },
      }),
    );
  };

  set actions(actions: ActionBarItem[]) {
    this._actions = [...actions];
    this.render();
  }

  get actions(): ActionBarItem[] {
    return [...this._actions];
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
  }

  private render(): void {
    if (this._actions.length === 0) {
      this.innerHTML = "";
      return;
    }

    this.innerHTML = `
      <div class="adl-action-bar">
        ${this._actions.map(renderAction).join("")}
      </div>
    `;
  }
}

export function defineAdlActionBar(): void {
  if (customElements.get("adl-action-bar") === undefined) {
    customElements.define("adl-action-bar", AdlActionBarElement);
  }
}

function renderAction(action: ActionBarItem): string {
  const className =
    action.variant === "primary" ? "adl-primary" : action.variant === "danger" ? "adl-danger" : "";

  return `
    <button
      type="button"
      class="${className}"
      data-action-name="${escapeHtml(action.name)}"
      data-action-kind="${escapeHtml(action.kind)}"
      ${action.disabled ? "disabled" : ""}
    >
      ${escapeHtml(action.label)}
    </button>
  `;
}
