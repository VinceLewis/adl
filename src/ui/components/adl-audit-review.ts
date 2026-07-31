import {
  ADL_LOAD_ADMINISTRATION_EVENT,
  ADL_LOAD_MORE_ADMINISTRATION_EVENT,
  type AdlAdministrationList,
  type AdlAdministrationListName,
  type AdlAdministrationState,
  type LoadMoreAdministrationDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * Access-audit and runtime-audit review for the business context currently
 * selected.
 *
 * Four rules are load-bearing:
 *
 * 1. This component makes no network call and no authorization decision. It
 *    renders the pages the bridge holds and dispatches intent upward; the server
 *    derives identity, role and scope for every read, and the browser never
 *    becomes a second policy implementation.
 * 2. A refused read and an empty one look identical. Nothing here says "you are
 *    not permitted", and no wording distinguishes a denied row from an absent
 *    one — `unavailable` means no context is selected to administer, never that
 *    the caller lacks permission.
 * 3. Nothing rendered here is a credential. Entries are the server's own
 *    metadata summaries: raw audit payloads, record values and verifiers never
 *    leave it. Every interpolated key and value is escaped, because an entry is
 *    data rather than markup.
 * 4. Entries are passed through, never derived from. No count, total or
 *    aggregate is computed here; the page is exactly what the authority
 *    returned, and paging replays its own opaque cursor.
 */

const UNAVAILABLE_TEXT =
  "Select a business context to review its audit history. There is nothing to " +
  "administer until one is selected.";

const EXPLAINER_TEXT =
  "Audit review is bounded to the selected context and to what the server lets " +
  "you read. It shows recorded activity, never the contents of a record.";

const EMPTY_TEXT = "Nothing has been recorded here.";

const SECTION_LABELS: Record<"accessAudit" | "runtimeAudit", string> = {
  accessAudit: "Access audit",
  runtimeAudit: "Runtime audit",
};

const DEFAULT_STATE: AdlAdministrationState = {
  status: "unavailable",
  accessAudit: { entries: [] },
  runtimeAudit: { entries: [] },
  memberships: { entries: [] },
  invites: { entries: [] },
};

export class AdlAuditReviewElement extends HTMLElement {
  private _state: AdlAdministrationState = cloneState(DEFAULT_STATE);
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this.disabled) {
      return;
    }

    if (target.closest("[data-administration-refresh='true']") !== null) {
      this.dispatchEvent(
        new CustomEvent(ADL_LOAD_ADMINISTRATION_EVENT, { bubbles: true, composed: true }),
      );
      return;
    }

    const more = target.closest<HTMLElement>("[data-audit-more]");
    const list = more?.dataset.auditMore;
    if (list === undefined || list.length === 0) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<LoadMoreAdministrationDetail>(ADL_LOAD_MORE_ADMINISTRATION_EVENT, {
        bubbles: true,
        composed: true,
        detail: { list: list as AdlAdministrationListName },
      }),
    );
  };

  set state(state: AdlAdministrationState) {
    this._state = cloneState(state);
    this.render();
  }

  get state(): AdlAdministrationState {
    return cloneState(this._state);
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

  private get disabled(): boolean {
    return this._busy || this._state.status === "loading";
  }

  private render(): void {
    // Mirrored on the host as well as the rendered root so shell chrome can
    // style or observe the status without reaching inside the component.
    this.setAttribute("data-administration-status", this._state.status);

    const disabled = this.disabled ? "disabled" : "";

    /*
     * With no context selected there are no lists to show, but there is still a
     * refresh: someone reaches this state, chooses a context in the top bar, and
     * then needs a way to load it. Rendering nothing but the explanation was a
     * dead end — the only control that could leave the state was the one the
     * state removed.
     */
    if (this._state.status === "unavailable") {
      this.innerHTML = `
        <section
          class="adl-audit-review"
          data-administration-status="${escapeHtml(this._state.status)}"
          aria-label="Audit review"
        >
          <h2 class="adl-administration-heading">Audit review</h2>
          <p class="adl-administration-empty" data-administration-unavailable="true">${escapeHtml(
            UNAVAILABLE_TEXT,
          )}</p>
          <button
            class="adl-administration-refresh"
            type="button"
            data-administration-refresh="true"
            ${disabled}
          >
            Refresh
          </button>
        </section>
      `;
      return;
    }

    this.innerHTML = `
      <section
        class="adl-audit-review"
        data-administration-status="${escapeHtml(this._state.status)}"
        aria-label="Audit review"
      >
        <h2 class="adl-administration-heading">Audit review</h2>
        <p class="adl-administration-hint">${escapeHtml(EXPLAINER_TEXT)}</p>
        <button
          class="adl-administration-refresh"
          type="button"
          data-administration-refresh="true"
          ${disabled}
        >
          ${this._state.status === "loading" ? "Loading" : "Refresh"}
        </button>
        ${this.renderMessage()}
        ${this.renderList("accessAudit", this._state.accessAudit, disabled)}
        ${this.renderList("runtimeAudit", this._state.runtimeAudit, disabled)}
      </section>
    `;
  }

  private renderMessage(): string {
    const message = this._state.message;
    if (message === undefined || message.length === 0) {
      return "";
    }

    const alerting = this._state.status === "error" || this._state.status === "offline";
    return `
      <p
        class="adl-administration-message"
        data-administration-message="true"
        role="${alerting ? "alert" : "status"}"
      >${escapeHtml(message)}</p>
    `;
  }

  private renderList(
    name: "accessAudit" | "runtimeAudit",
    list: AdlAdministrationList,
    disabled: string,
  ): string {
    const moreDisabled = disabled.length > 0 || list.loadingMore === true ? "disabled" : "";
    return `
      <section class="adl-administration-section" data-audit-list="${escapeHtml(name)}">
        <h3 class="adl-administration-subheading">${escapeHtml(SECTION_LABELS[name])}</h3>
        ${
          list.entries.length === 0
            ? `<p class="adl-administration-empty" data-audit-empty="${escapeHtml(name)}">${escapeHtml(
                EMPTY_TEXT,
              )}</p>`
            : `<ul class="adl-administration-entries">
          ${list.entries.map((entry) => renderEntry(entry)).join("")}
        </ul>`
        }
        ${
          list.nextCursor === undefined
            ? ""
            : `<button
          class="adl-administration-more"
          type="button"
          data-audit-more="${escapeHtml(name)}"
          ${moreDisabled}
        >Show more</button>`
        }
      </section>
    `;
  }
}

export function defineAdlAuditReview(): void {
  if (customElements.get("adl-audit-review") === undefined) {
    customElements.define("adl-audit-review", AdlAuditReviewElement);
  }
}

/**
 * An entry is rendered from its own keys rather than a fixed field list. The
 * server owns the shape of these summaries, so a hardcoded list here would
 * silently drop whatever it added; a key it stops sending simply stops
 * appearing.
 */
function renderEntry(entry: Record<string, unknown>): string {
  return `
    <li class="adl-administration-entry">
      <dl class="adl-administration-pairs">
        ${Object.entries(entry)
          .map(
            ([key, value]) =>
              `<dt class="adl-administration-key">${escapeHtml(key)}</dt><dd class="adl-administration-value">${escapeHtml(
                formatValue(value),
              )}</dd>`,
          )
          .join("")}
      </dl>
    </li>
  `;
}

/** Values arrive as `unknown`: stringify without inventing a format for them. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function cloneState(state: AdlAdministrationState): AdlAdministrationState {
  return {
    ...state,
    accessAudit: { ...state.accessAudit, entries: [...state.accessAudit.entries] },
    runtimeAudit: { ...state.runtimeAudit, entries: [...state.runtimeAudit.entries] },
    memberships: { ...state.memberships, entries: [...state.memberships.entries] },
    invites: { ...state.invites, entries: [...state.invites.entries] },
  };
}
