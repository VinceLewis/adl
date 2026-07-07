import type { UiMessage } from "../types.js";
import { escapeHtml } from "./html.js";

export class AdlMessageAreaElement extends HTMLElement {
  private _messages: UiMessage[] = [];

  set messages(messages: UiMessage[]) {
    this._messages = [...messages];
    this.render();
  }

  get messages(): UiMessage[] {
    return [...this._messages];
  }

  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    if (this._messages.length === 0) {
      this.innerHTML = "";
      return;
    }

    this.innerHTML = `
      <section class="adl-message-area" aria-live="polite">
        ${this._messages.map(renderMessage).join("")}
      </section>
    `;
  }
}

export function defineAdlMessageArea(): void {
  if (customElements.get("adl-message-area") === undefined) {
    customElements.define("adl-message-area", AdlMessageAreaElement);
  }
}

function renderMessage(message: UiMessage): string {
  const details =
    message.details.length === 0
      ? ""
      : `<ul>${message.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`;
  const code = message.code === undefined ? "" : ` <span>${escapeHtml(message.code)}</span>`;

  return `
    <article class="adl-message adl-message-${escapeHtml(message.kind)}" data-message-kind="${escapeHtml(
      message.kind,
    )}">
      <strong>${escapeHtml(message.title)}${code}</strong>
      ${details}
    </article>
  `;
}
