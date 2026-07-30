import {
  ADL_REFRESH_DEVICES_EVENT,
  ADL_REVOKE_DEVICE_EVENT,
  type AdlDeviceState,
  type RevokeDeviceDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * The signed-in person's own active sessions, with a per-session revoke.
 *
 * This is the compensating control for an offline grace measured in weeks: a
 * device that is lost keeps its ability to sync until the grace runs out or its
 * session is revoked, and the owner must be able to end it themselves rather
 * than waiting on an administrator.
 *
 * Three rules are load-bearing:
 *
 * 1. The list is **always** the authority's answer. Nothing is cached, nothing
 *    is removed locally after a revoke, and the surface reloads from the server
 *    instead — someone must never believe they revoked a device that is still
 *    live.
 * 2. The component makes no network call and no authorization decision. It
 *    renders what the bridge gives it and dispatches intent upward; the
 *    authority scopes the list to the caller and refuses anyone else's session.
 * 3. Nothing here is a credential. A session id names a row to revoke; the
 *    token that authenticates it never leaves the server.
 */

const EMPTY_TEXT = "No other devices are signed in.";

const EXPLAINER_TEXT =
  "Each signed-in device keeps its own session. Revoking one stops it syncing the " +
  "next time it reaches the server, whatever offline period it has left. Data " +
  "already on that device is not removed.";

const DEFAULT_DEVICES: AdlDeviceState = { status: "idle", devices: [] };

export class AdlSessionDevicesElement extends HTMLElement {
  private _devices: AdlDeviceState = { ...DEFAULT_DEVICES };
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this.disabled) {
      return;
    }

    if (target.closest("[data-devices-refresh='true']") !== null) {
      this.dispatchEvent(
        new CustomEvent(ADL_REFRESH_DEVICES_EVENT, { bubbles: true, composed: true }),
      );
      return;
    }

    const revoke = target.closest<HTMLElement>("[data-devices-revoke]");
    const sessionId = revoke?.dataset.devicesRevoke;
    if (sessionId === undefined || sessionId.length === 0) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<RevokeDeviceDetail>(ADL_REVOKE_DEVICE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { sessionId },
      }),
    );
  };

  set devices(devices: AdlDeviceState) {
    this._devices = { ...devices, devices: [...devices.devices] };
    this.render();
  }

  get devices(): AdlDeviceState {
    return { ...this._devices, devices: [...this._devices.devices] };
  }

  set busy(busy: boolean) {
    if (this._busy === busy) {
      return;
    }

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

  private get disabled(): boolean {
    return this._busy || this._devices.status === "loading";
  }

  private render(): void {
    const disabled = this.disabled ? "disabled" : "";

    this.innerHTML = `
      <section class="adl-session-devices" data-devices-status="${escapeHtml(this._devices.status)}" aria-label="Signed-in devices">
        <h2 class="adl-session-heading">Your devices</h2>
        <p class="adl-session-hint">${escapeHtml(EXPLAINER_TEXT)}</p>
        <button class="adl-session-submit" type="button" data-devices-refresh="true" ${disabled}>
          ${this._devices.status === "loading" ? "Loading devices" : "Show my devices"}
        </button>
        ${this.renderMessage()}
        ${this.renderList(disabled)}
      </section>
    `;
  }

  private renderMessage(): string {
    const message = this._devices.message;
    if (message === undefined || message.length === 0) {
      return "";
    }

    const alerting = this._devices.status === "error" || this._devices.status === "offline";
    return `
      <p
        class="adl-session-devices-message"
        data-devices-message="true"
        role="${alerting ? "alert" : "status"}"
      >${escapeHtml(message)}</p>
    `;
  }

  /**
   * The caller's own device is always listed, even when it is the only one.
   * "No other devices are signed in" on its own would leave a person unsure
   * whether the list had loaded at all — and this list is what they check
   * before deciding whether a lost device can still sync.
   */
  private renderList(disabled: string): string {
    if (this._devices.status !== "loaded" && this._devices.devices.length === 0) {
      return "";
    }

    const others = this._devices.devices.filter((device) => !device.current);
    return `
      ${
        this._devices.devices.length === 0
          ? ""
          : `<ul class="adl-session-device-list">
        ${this._devices.devices.map((device) => this.renderDevice(device, disabled)).join("")}
      </ul>`
      }
      ${
        others.length === 0
          ? `<p class="adl-session-devices-empty" data-devices-empty="true">${escapeHtml(EMPTY_TEXT)}</p>`
          : ""
      }
    `;
  }

  private renderDevice(device: AdlDeviceState["devices"][number], disabled: string): string {
    return `
      <li class="adl-session-device" data-device-session-id="${escapeHtml(device.sessionId)}">
        <span class="adl-session-device-name">${device.current ? "This device" : "Another device"}</span>
        <span class="adl-session-device-detail">
          Signed in ${escapeHtml(formatDay(device.issuedAt))}, offline period ends ${escapeHtml(
            formatDay(device.expiresAt),
          )}
        </span>
        ${
          device.current
            ? ""
            : `<button
          class="adl-session-device-revoke"
          type="button"
          data-devices-revoke="${escapeHtml(device.sessionId)}"
          ${disabled}
        >
          Revoke
        </button>`
        }
      </li>
    `;
  }
}

export function defineAdlSessionDevices(): void {
  if (customElements.get("adl-session-devices") === undefined) {
    customElements.define("adl-session-devices", AdlSessionDevicesElement);
  }
}

/** Date only: the exact minute a session was issued is noise here. */
function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "an unknown date" : date.toISOString().slice(0, 10);
}
