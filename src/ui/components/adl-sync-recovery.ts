import type { SyncRecoveryChoice, SyncRecoveryItem } from "../../server/sync-client.js";
import {
  ADL_RESOLVE_RECOVERY_EVENT,
  RECOVERY_ACKNOWLEDGE_LABEL,
  RECOVERY_CHOICE_LABELS,
  describeRecoveryItem,
  type ResolveRecoveryDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * How each server verdict reads to a person. `manualResolution` is the model
 * saying it will not pick a winner, so the wording asks rather than reports.
 */
export const RECOVERY_STATUS_LABELS: Record<string, string> = {
  rejected: "Rejected by the server",
  conflict: "Conflicted with the server",
  manualResolution: "Needs your decision",
};

/**
 * Presents the operations the authority has settled against the queue and that
 * still need a person. It decides nothing: the choices come from the item, the
 * resolution is performed by whoever listens to `adl-resolve-recovery`.
 *
 * It renders only `SyncRecoveryItem` fields. A conflict must never disclose a
 * server record the caller could not read through a normal runtime read, so no
 * record or field value reaches this component at all.
 */
export class AdlSyncRecoveryElement extends HTMLElement {
  private _items: SyncRecoveryItem[] = [];
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this._busy) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-recovery-choice]");
    if (button === null) {
      return;
    }

    const queueId = button.dataset.recoveryQueueId;
    const choice = button.dataset.recoveryChoice;
    if (queueId === undefined || choice === undefined) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<ResolveRecoveryDetail>(ADL_RESOLVE_RECOVERY_EVENT, {
        bubbles: true,
        composed: true,
        detail: { queueId, choice: choice as SyncRecoveryChoice },
      }),
    );
  };

  set items(items: SyncRecoveryItem[]) {
    this._items = [...items];
    this.render();
  }

  get items(): SyncRecoveryItem[] {
    return [...this._items];
  }

  set busy(busy: boolean) {
    this._busy = busy;
    this.render();
  }

  get busy(): boolean {
    return this._busy;
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
  }

  private render(): void {
    // Nothing to recover means no chrome at all, not an empty panel.
    if (this._items.length === 0) {
      this.innerHTML = "";
      return;
    }

    this.innerHTML = `
      <section
        class="adl-sync-recovery"
        role="status"
        aria-live="polite"
        aria-busy="${this._busy ? "true" : "false"}"
        data-sync-recovery="true"
      >
        <h2 class="adl-sync-recovery-heading">Changes that need your attention</h2>
        ${this._items.map((item) => this.renderItem(item)).join("")}
      </section>
    `;
  }

  private renderItem(item: SyncRecoveryItem): string {
    const verdict = RECOVERY_STATUS_LABELS[item.status] ?? item.status;
    const strategy =
      item.strategy === undefined
        ? ""
        : `<p class="adl-sync-recovery-strategy" data-recovery-strategy="${escapeHtml(
            item.strategy,
          )}">Declared strategy: ${escapeHtml(item.strategy)}</p>`;
    const message =
      item.message.length === 0
        ? ""
        : `<p class="adl-sync-recovery-message">${escapeHtml(item.message)}</p>`;
    const code =
      item.code.length === 0
        ? ""
        : `<p class="adl-sync-recovery-code" data-recovery-code="${escapeHtml(
            item.code,
          )}">${escapeHtml(item.code)}</p>`;

    return `
      <article
        class="adl-sync-recovery-item"
        data-recovery-queue-id="${escapeHtml(item.queueId)}"
        data-recovery-status="${escapeHtml(item.status)}"
      >
        <h3 class="adl-sync-recovery-title">${escapeHtml(describeRecoveryItem(item))}</h3>
        <p class="adl-sync-recovery-verdict">${escapeHtml(verdict)}</p>
        ${message}
        ${code}
        ${strategy}
        <div class="adl-sync-recovery-choices">
          ${item.choices.map((choice) => this.renderChoice(item, choice)).join("")}
        </div>
      </article>
    `;
  }

  private renderChoice(item: SyncRecoveryItem, choice: SyncRecoveryChoice): string {
    return `
      <button
        class="adl-sync-recovery-choice"
        type="button"
        data-recovery-choice="${escapeHtml(choice)}"
        data-recovery-queue-id="${escapeHtml(item.queueId)}"
        ${this._busy ? "disabled" : ""}
      >${escapeHtml(choiceLabel(item, choice))}</button>
    `;
  }
}

export function defineAdlSyncRecovery(): void {
  if (customElements.get("adl-sync-recovery") === undefined) {
    customElements.define("adl-sync-recovery", AdlSyncRecoveryElement);
  }
}

/**
 * A rejection is terminal. The authority refused the write, so the only move is
 * to acknowledge it; wording it as "keep the server version" would imply a
 * choice between two candidate winners that was never offered.
 */
function choiceLabel(item: SyncRecoveryItem, choice: SyncRecoveryChoice): string {
  if (choice === "keepServer" && item.status === "rejected") {
    return RECOVERY_ACKNOWLEDGE_LABEL;
  }

  return RECOVERY_CHOICE_LABELS[choice] ?? choice;
}
