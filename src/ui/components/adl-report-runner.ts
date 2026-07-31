import {
  ADL_EXPORT_REPORT_EVENT,
  ADL_LOAD_MORE_REPORT_EVENT,
  ADL_RUN_REPORT_EVENT,
  type AdlAdministrationState,
  type RunReportDetail,
} from "../authority-bridge.js";
import { escapeHtml } from "./html.js";

/**
 * Runs one of the application's declared read models as a report, pages it, and
 * exports it as CSV.
 *
 * Four rules are load-bearing:
 *
 * 1. This component makes no network call and no authorization decision. It
 *    renders what the bridge gives it and dispatches intent upward; the server
 *    derives identity, role and scope for every read and shapes every row
 *    through the runtime's read policy before it is serialised.
 * 2. A refused report and an empty one look identical. There is no "you are not
 *    permitted" wording anywhere here, because a denied row and an absent row
 *    must stay indistinguishable — otherwise this surface becomes an oracle for
 *    which reports exist and who may run them.
 * 3. Nothing rendered here is a credential, and every interpolated value —
 *    field names, cell values, the server's own message — is escaped. Report
 *    rows are application data the caller could already read; they are not
 *    trusted markup.
 * 4. The report is passed through, never derived from. No total, count or
 *    aggregate is computed in the browser: the server decided what this caller
 *    may see, and a locally derived number could disclose more than it returned.
 */

const EXPLAINER_TEXT =
  "Reports run one of this application's declared read models. Rows are limited " +
  "to what you can already read, and the server decides that every time.";

const EMPTY_REPORTS_TEXT =
  "No reports are declared for this application, so there is nothing to run here.";

const NO_ROWS_TEXT = "This report returned no rows.";

const TRUNCATED_TEXT = "This report reached the server's row limit, so it is not the whole result.";

const DEFAULT_STATE: AdlAdministrationState = {
  status: "unavailable",
  accessAudit: { entries: [] },
  runtimeAudit: { entries: [] },
  memberships: { entries: [] },
  invites: { entries: [] },
};

export class AdlReportRunnerElement extends HTMLElement {
  private _reports: string[] = [];
  private _state: AdlAdministrationState = cloneState(DEFAULT_STATE);
  private _busy = false;

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || this.disabled) {
      return;
    }

    if (target.closest("[data-report-run='true']") !== null) {
      this.dispatchReport(ADL_RUN_REPORT_EVENT);
      return;
    }

    if (target.closest("[data-report-export='true']") !== null) {
      this.dispatchReport(ADL_EXPORT_REPORT_EVENT);
      return;
    }

    if (target.closest("[data-report-more='true']") !== null) {
      this.dispatchEvent(
        new CustomEvent(ADL_LOAD_MORE_REPORT_EVENT, { bubbles: true, composed: true }),
      );
    }
  };

  set reports(reports: string[]) {
    this._reports = [...reports];
    this.render();
  }

  get reports(): string[] {
    return [...this._reports];
  }

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

  private get reportStatus(): string {
    return this._state.reportStatus ?? "idle";
  }

  private get disabled(): boolean {
    return this._busy || this.reportStatus === "running" || this.reportStatus === "exporting";
  }

  /**
   * The selected read-model name is read from the control at click time rather
   * than tracked in a field, so what the person sees selected is exactly what is
   * asked for. An unknown name is the server's decision to refuse, not this
   * component's to pre-empt.
   */
  private dispatchReport(eventName: string): void {
    const select = this.querySelector<HTMLSelectElement>("[data-report-select='true']");
    const readModelName = select?.value ?? "";
    if (readModelName.length === 0) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<RunReportDetail>(eventName, {
        bubbles: true,
        composed: true,
        detail: { readModelName },
      }),
    );
  }

  private render(): void {
    // Mirrored on the host as well as the rendered root so shell chrome can
    // style or observe the status without reaching inside the component.
    this.setAttribute("data-report-status", this.reportStatus);
    this.innerHTML = `
      <section
        class="adl-report-runner"
        data-report-status="${escapeHtml(this.reportStatus)}"
        aria-label="Reports"
      >
        <h2 class="adl-administration-heading">Reports</h2>
        <p class="adl-administration-hint">${escapeHtml(EXPLAINER_TEXT)}</p>
        ${this.renderControls()}
        ${this.renderMessage()}
        ${this.renderReport()}
      </section>
    `;
  }

  private renderControls(): string {
    if (this._reports.length === 0) {
      return `<p class="adl-administration-empty" data-report-empty="true">${escapeHtml(
        EMPTY_REPORTS_TEXT,
      )}</p>`;
    }

    const disabled = this.disabled ? "disabled" : "";
    const selected = this._state.reportName;
    return `
      <div class="adl-report-controls">
        <label class="adl-report-label" for="adl-report-select">Report</label>
        <select
          class="adl-report-select"
          id="adl-report-select"
          data-report-select="true"
          ${disabled}
        >
          ${this._reports
            .map(
              (name) =>
                `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(
                  name,
                )}</option>`,
            )
            .join("")}
        </select>
        <button class="adl-report-run" type="button" data-report-run="true" ${disabled}>
          Run report
        </button>
        <button class="adl-report-export" type="button" data-report-export="true" ${disabled}>
          Export CSV
        </button>
      </div>
    `;
  }

  private renderMessage(): string {
    const message = this._state.message;
    if (message === undefined || message.length === 0) {
      return "";
    }

    return `
      <p
        class="adl-administration-message"
        data-report-message="true"
        role="${this.reportStatus === "error" ? "alert" : "status"}"
      >${escapeHtml(message)}</p>
    `;
  }

  private renderReport(): string {
    const report = this._state.report;
    if (report === undefined) {
      return "";
    }

    const disabled = this.disabled ? "disabled" : "";
    return `
      ${
        report.rows.length === 0
          ? `<p class="adl-administration-empty" data-report-rows-empty="true">${escapeHtml(
              NO_ROWS_TEXT,
            )}</p>`
          : `<div class="adl-report-table-wrap">
        <table class="adl-report-table" data-report-table="true">
          <thead>
            <tr>${report.fields.map((field) => `<th scope="col">${escapeHtml(field)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${report.rows.map((row) => this.renderRow(report.fields, row)).join("")}
          </tbody>
        </table>
      </div>`
      }
      ${
        report.truncated
          ? `<p class="adl-administration-note" data-report-truncated="true">${escapeHtml(
              TRUNCATED_TEXT,
            )}</p>`
          : ""
      }
      ${
        report.nextCursor === undefined
          ? ""
          : `<button class="adl-report-more" type="button" data-report-more="true" ${disabled}>
        Show more rows
      </button>`
      }
    `;
  }

  private renderRow(fields: string[], row: Record<string, unknown>): string {
    return `
      <tr>
        ${fields
          .map(
            (field) =>
              `<td data-label="${escapeHtml(field)}">${escapeHtml(formatCell(row[field]))}</td>`,
          )
          .join("")}
      </tr>
    `;
  }
}

export function defineAdlReportRunner(): void {
  if (customElements.get("adl-report-runner") === undefined) {
    customElements.define("adl-report-runner", AdlReportRunnerElement);
  }
}

/** Values arrive as `unknown`: stringify without inventing a format for them. */
function formatCell(value: unknown): string {
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
    ...(state.report === undefined
      ? {}
      : {
          report: {
            ...state.report,
            fields: [...state.report.fields],
            rows: state.report.rows.map((row) => ({ ...row })),
          },
        }),
  };
}
