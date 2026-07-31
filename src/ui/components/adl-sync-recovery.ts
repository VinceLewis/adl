import type {
  SyncDeliveryItem,
  SyncRecoveryChoice,
  SyncRecoveryItem,
} from "../../server/sync-client.js";
import {
  ADL_RESOLVE_RECOVERY_EVENT,
  ADL_RETRY_DELIVERY_EVENT,
  DELIVERY_RETRY_LABEL,
  DELIVERY_UNDELIVERED_LABEL,
  RECOVERY_ACKNOWLEDGE_LABEL,
  RECOVERY_CHOICE_LABELS,
  describeDeliveryItem,
  describeRecoveryItem,
  type ResolveRecoveryDetail,
  type RetryDeliveryDetail,
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
 * Presents the work that has not landed on the authority: the operations it has
 * settled against the queue and that still need a person, and the accepted
 * writes that never reached it at all. It decides nothing — the choices come
 * from the item, and whoever listens to `adl-resolve-recovery` or
 * `adl-retry-delivery` performs the action.
 *
 * The two are shown together and labelled apart. Both answer "what happened to
 * my change?", so splitting them across surfaces would make a person check two
 * places to learn that nothing had gone wrong yet; but an undelivered change is
 * not a verdict, so it never offers a verdict's choices.
 *
 * It renders only `SyncRecoveryItem` and `SyncDeliveryItem` fields. A conflict
 * must never disclose a server record the caller could not read through a
 * normal runtime read, so no record or field value reaches this component.
 */
export class AdlSyncRecoveryElement extends HTMLElement {
  private _items: SyncRecoveryItem[] = [];
  private _undelivered: SyncDeliveryItem[] = [];
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this._busy) {
      return;
    }

    const retry = target.closest<HTMLButtonElement>("[data-delivery-retry]");
    if (retry !== null) {
      const retryQueueId = retry.dataset.deliveryQueueId;
      if (retryQueueId !== undefined) {
        this.dispatchEvent(
          new CustomEvent<RetryDeliveryDetail>(ADL_RETRY_DELIVERY_EVENT, {
            bubbles: true,
            composed: true,
            detail: { queueId: retryQueueId },
          }),
        );
      }
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

  set undelivered(items: SyncDeliveryItem[]) {
    this._undelivered = [...items];
    this.render();
  }

  get undelivered(): SyncDeliveryItem[] {
    return [...this._undelivered];
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
    // Nothing outstanding means no chrome at all, not an empty panel.
    if (this._items.length === 0 && this._undelivered.length === 0) {
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
        ${this._undelivered.map((item) => this.renderUndelivered(item)).join("")}
        ${this._items.map((item) => this.renderItem(item)).join("")}
      </section>
    `;
  }

  /**
   * An undelivered write offers one action and no choice. There is no server
   * version to keep and no verdict to dismiss: the change is saved here, the
   * authority has not seen it, and the only move is to try again.
   */
  private renderUndelivered(item: SyncDeliveryItem): string {
    const message =
      item.message.length === 0
        ? ""
        : `<p class="adl-sync-recovery-message">${escapeHtml(item.message)}</p>`;

    return `
      <article
        class="adl-sync-recovery-item adl-sync-recovery-item-undelivered"
        data-recovery-queue-id="${escapeHtml(item.queueId)}"
        data-recovery-status="undelivered"
        data-delivery-item="true"
        ${commandAttributes(item)}
      >
        <h3 class="adl-sync-recovery-title">${escapeHtml(describeDeliveryItem(item))}</h3>
        <p class="adl-sync-recovery-verdict">${escapeHtml(DELIVERY_UNDELIVERED_LABEL)}</p>
        ${message}
        <div class="adl-sync-recovery-choices">
          <button
            class="adl-sync-recovery-choice"
            type="button"
            data-delivery-retry="true"
            data-delivery-queue-id="${escapeHtml(item.queueId)}"
            ${this._busy ? "disabled" : ""}
          >${escapeHtml(DELIVERY_RETRY_LABEL)}</button>
        </div>
      </article>
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
        ${commandAttributes(item)}
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
 * Marks the article as one command rather than one record operation, so a test
 * and the visual suite can assert that a refused command is a single change on
 * screen instead of one row per record it wrote. The record count is exposed
 * alongside it because that is the whole claim being made: one entry, one
 * verdict, that many records.
 *
 * The command's *input* stays off the surface, as every other value does. This
 * panel has no read policy behind it, and an input carries the values the
 * command was asked to write.
 */
function commandAttributes(item: SyncRecoveryItem | SyncDeliveryItem): string {
  if (item.operation !== "command") {
    return "";
  }

  return [
    `data-recovery-command="${escapeHtml(item.commandName ?? "")}"`,
    `data-recovery-record-count="${escapeHtml(item.recordCount ?? 0)}"`,
  ].join("\n        ");
}

/**
 * A rejection is terminal. The authority refused the write, so the only move is
 * to acknowledge it; wording it as "keep the server version" would imply a
 * choice between two candidate winners that was never offered.
 *
 * A refused command is terminal on exactly the same terms, and needs no new
 * primitive: `keepServer` abandons the local operation and the authority's state
 * stands. What that means locally is that every record the command's steps wrote
 * here stays where it is. The authority refused the whole transaction, so none
 * of it exists server-side and no later bootstrap can remove rows the server
 * never had — the same standing residue a rejected create leaves today. This
 * phase keeps that deliberately rather than inventing a local rollback: undoing
 * a command's writes is itself a multi-record write, and it would need its own
 * policy check, its own transaction and its own queue entry.
 */
function choiceLabel(item: SyncRecoveryItem, choice: SyncRecoveryChoice): string {
  if (choice === "keepServer" && item.status === "rejected") {
    return RECOVERY_ACKNOWLEDGE_LABEL;
  }

  return RECOVERY_CHOICE_LABELS[choice] ?? choice;
}
