import { RuntimeStartupError } from "../../runtime/runtime-types.js";
import { deleteAppLocalDatabases } from "../../runtime/local-data-reset.js";
import { escapeHtml } from "./html.js";

/**
 * The one fallback surface for a browser app that failed to start at all --
 * see `src/ui/main.ts`'s catch around `mountDemo()`. Rendered directly into
 * `document.body`, never through `<adl-app>`: the failure this element
 * exists for can happen before `<adl-app>` has a model or runtime, or before
 * it is even attached to the document, so it is not a safe surface to render
 * error UI through (docs/phases/phase-84-startup-failure-recovery-ui.md).
 *
 * Two tiers, one actionable:
 *
 * - `RuntimeStartupError` (persisted local data the current model cannot
 *   read, and no migration reaches): a specific message plus a "Reset local
 *   data and reload" action -- the one thing known to fix this exact
 *   failure, and what a developer already does by hand in DevTools today.
 * - Anything else (a compile failure, a network failure connecting to an
 *   authority, an unexpected exception): a generic message, the raw error
 *   visible (this is a browser app with no other error-reporting channel),
 *   and a plain "Reload" -- never a reset action, since clearing IndexedDB
 *   does nothing for a compile or network failure.
 */
export class AdlStartupErrorElement extends HTMLElement {
  private _error: unknown;
  private _databaseName: string | undefined;
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this._busy) {
      return;
    }

    if (target.closest("[data-startup-error-reload]") !== null) {
      globalThis.location?.reload();
      return;
    }

    const resetButton = target.closest<HTMLButtonElement>("[data-startup-error-reset]");
    if (resetButton !== null && this._databaseName !== undefined) {
      void this.handleReset(this._databaseName);
    }
  };

  /** The caught startup error. Setting this (re-)renders the element. */
  set error(error: unknown) {
    this._error = error;
    this.render();
  }

  get error(): unknown {
    return this._error;
  }

  /**
   * The failing app's IndexedDB database name, when one was resolved before
   * the failure (`ReferenceDemoDefinition.databaseName`). `undefined` means
   * there is no app-specific local data to offer resetting -- only the
   * generic fallback with a plain reload renders in that case, regardless of
   * error kind.
   */
  set databaseName(databaseName: string | undefined) {
    this._databaseName = databaseName;
    this.render();
  }

  get databaseName(): string | undefined {
    return this._databaseName;
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
  }

  private async handleReset(databaseName: string): Promise<void> {
    this._busy = true;
    this.render();
    try {
      await deleteAppLocalDatabases(databaseName);
    } finally {
      // Reload either way: a best-effort delete that hit `onblocked` still
      // completes once this page's own connections close on navigation, and
      // a reload is the only recovery this element offers regardless.
      globalThis.location?.reload();
    }
  }

  private render(): void {
    const isStartupError = this._error instanceof RuntimeStartupError;
    const canReset = isStartupError && this._databaseName !== undefined;

    this.innerHTML = `
      <section
        class="adl-startup-error"
        role="alert"
        aria-busy="${this._busy ? "true" : "false"}"
        data-startup-error="true"
        data-startup-error-kind="${canReset ? "runtime-startup" : "generic"}"
      >
        <div class="adl-startup-error-panel">
          <h1 class="adl-startup-error-heading">${
            canReset
              ? "This app can't read its saved data"
              : "Something went wrong starting the app"
          }</h1>
          <p class="adl-startup-error-message">${
            canReset
              ? escapeHtml(
                  "This app's locally saved data doesn't match the version currently running and can't be automatically updated.",
                )
              : escapeHtml(
                  "The app hit an unexpected error before it could start. Reloading may help; if it keeps happening, the details below may explain why.",
                )
          }</p>
          ${canReset ? "" : this.renderDetail()}
          <div class="adl-startup-error-actions">
            ${
              canReset
                ? `<button
                    type="button"
                    class="adl-startup-error-button adl-startup-error-button-primary"
                    data-startup-error-reset="true"
                    ${this._busy ? "disabled" : ""}
                  >${this._busy ? "Resetting…" : "Reset local data and reload"}</button>`
                : ""
            }
            <button
              type="button"
              class="adl-startup-error-button adl-startup-error-button-secondary"
              data-startup-error-reload="true"
              ${this._busy ? "disabled" : ""}
            >Reload</button>
          </div>
        </div>
      </section>
    `;
  }

  private renderDetail(): string {
    const detail = describeError(this._error);
    return `
      <details class="adl-startup-error-detail">
        <summary class="adl-startup-error-detail-summary">Error details</summary>
        <pre class="adl-startup-error-detail-body">${escapeHtml(detail)}</pre>
      </details>
    `;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack !== undefined && error.stack.length > 0
      ? error.stack
      : `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function defineAdlStartupError(): void {
  if (customElements.get("adl-startup-error") === undefined) {
    customElements.define("adl-startup-error", AdlStartupErrorElement);
  }
}
