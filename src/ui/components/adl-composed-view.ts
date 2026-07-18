import type {
  RuntimePresentationActionControl,
  RuntimePresentationCalendar,
  RuntimePresentationCalendarCell,
  RuntimePresentationCalendarItem,
  RuntimePresentationControl,
  RuntimePresentationFragment,
  RuntimePresentationIcon,
  RuntimePresentationList,
  RuntimePresentationMatrix,
  RuntimePresentationMatrixCell,
  RuntimePresentationSection,
  RuntimePresentationStatus,
  RuntimePresentationView,
} from "../../runtime/presentation-runtime.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export interface PresentationStateChangeDetail {
  state: string;
  value: boolean;
}

export interface PresentationActionDetail {
  name: string;
  command?: string;
  view?: string;
  create?: {
    object?: string;
    view?: string;
  };
  input: Record<string, unknown>;
}

export interface PresentationCalendarNavigateDetail {
  calendar: string;
  state: string;
  value: string;
}

export interface PresentationRecordSelectDetail {
  objectName: string;
  recordId: string;
}

export interface PresentationMatrixCellCycleDetail {
  matrix: string;
  rowKey: string;
  columnKey: string;
}

export class AdlComposedViewElement extends HTMLElement {
  private _presentation: RuntimePresentationView | undefined;
  private readonly selectedCalendarDates = new Map<string, string>();

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const toggle = target.closest<HTMLButtonElement>("button[data-presentation-toggle='true']");
    if (toggle !== null && toggle.dataset.state !== undefined) {
      this.dispatchEvent(
        new CustomEvent<PresentationStateChangeDetail>("adl-presentation-state-change", {
          bubbles: true,
          detail: {
            state: toggle.dataset.state,
            value: toggle.getAttribute("aria-checked") !== "true",
          },
        }),
      );
      return;
    }

    const action = target.closest<HTMLButtonElement>("button[data-presentation-action='true']");
    if (action !== null) {
      if (action.disabled) {
        return;
      }

      this.dispatchEvent(
        new CustomEvent<PresentationActionDetail>("adl-presentation-action", {
          bubbles: true,
          detail: {
            name: action.dataset.actionName ?? "",
            ...(action.dataset.command === undefined ? {} : { command: action.dataset.command }),
            ...(action.dataset.view === undefined ? {} : { view: action.dataset.view }),
            ...(action.dataset.createObject === undefined && action.dataset.createView === undefined
              ? {}
              : {
                  create: {
                    ...(action.dataset.createObject === undefined
                      ? {}
                      : { object: action.dataset.createObject }),
                    ...(action.dataset.createView === undefined
                      ? {}
                      : { view: action.dataset.createView }),
                  },
                }),
            input: JSON.parse(action.dataset.input ?? "{}") as Record<string, unknown>,
          },
        }),
      );
      return;
    }

    const calendarItem = target.closest<HTMLButtonElement>(
      "button[data-presentation-calendar-item='true']",
    );
    if (calendarItem !== null) {
      const objectName = calendarItem.dataset.objectName;
      const recordId = calendarItem.dataset.recordId;
      if (objectName !== undefined && recordId !== undefined) {
        this.dispatchEvent(
          new CustomEvent<PresentationRecordSelectDetail>("adl-presentation-record-select", {
            bubbles: true,
            detail: { objectName, recordId },
          }),
        );
      }
      return;
    }

    const calendarNav = target.closest<HTMLButtonElement>(
      "button[data-presentation-calendar-nav='true']",
    );
    if (calendarNav !== null && !calendarNav.disabled) {
      this.dispatchEvent(
        new CustomEvent<PresentationCalendarNavigateDetail>("adl-presentation-calendar-nav", {
          bubbles: true,
          detail: {
            calendar: calendarNav.dataset.calendarName ?? "",
            state: calendarNav.dataset.state ?? "",
            value: calendarNav.dataset.value ?? "",
          },
        }),
      );
      return;
    }

    const calendarCell = target.closest<HTMLElement>("[data-calendar-cell]");
    if (calendarCell !== null) {
      const calendarName = calendarCell.dataset.calendarName;
      const date = calendarCell.dataset.calendarCell;
      if (calendarName !== undefined && date !== undefined) {
        this.selectedCalendarDates.set(calendarName, date);
        this.render();
      }
      return;
    }

    const cell = target.closest<HTMLButtonElement>("button[data-presentation-matrix-cell='true']");
    if (cell === null || cell.disabled) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<PresentationMatrixCellCycleDetail>("adl-presentation-matrix-cycle", {
        bubbles: true,
        detail: {
          matrix: cell.dataset.matrixName ?? "",
          rowKey: cell.dataset.rowKey ?? "",
          columnKey: cell.dataset.columnKey ?? "",
        },
      }),
    );
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const calendarCell = target.closest<HTMLElement>("[data-calendar-cell]");
    if (calendarCell === null || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    const calendarName = calendarCell.dataset.calendarName;
    const date = calendarCell.dataset.calendarCell;
    if (calendarName === undefined || date === undefined) {
      return;
    }

    this.selectedCalendarDates.set(calendarName, date);
    this.render();
  };

  set presentation(presentation: RuntimePresentationView | undefined) {
    this._presentation = presentation;
    this.render();
  }

  connectedCallback(): void {
    this.addEventListener("click", this.handleClick);
    this.addEventListener("keydown", this.handleKeyDown);
    this.render();
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this.handleClick);
    this.removeEventListener("keydown", this.handleKeyDown);
  }

  private render(): void {
    if (this._presentation === undefined) {
      this.innerHTML = "";
      return;
    }

    const hasCalendar = this._presentation.sections.some((section) => section.calendars.length > 0);
    this.innerHTML = `
      <div
        class="adl-composed-view adl-composed-${escapeHtml(this._presentation.layout)} adl-density-${escapeHtml(
          this._presentation.density,
        )} ${hasCalendar ? "adl-composed-has-calendar" : ""}"
        data-presentation-view="${escapeHtml(this._presentation.view)}"
      >
        ${this.renderDiagnostics()}
        ${this.renderLegends()}
        ${this._presentation.sections.map((section) => this.renderSection(section)).join("")}
      </div>
    `;
  }

  private renderLegends(): string {
    const legends = this._presentation?.legends ?? [];
    if (legends.length === 0) {
      return "";
    }

    return legends
      .map(
        (legend) => `
          <div
            class="adl-presentation-legend"
            data-presentation-legend="${escapeHtml(legend.name)}"
            role="list"
            aria-label="${escapeHtml(legend.title ?? `${legend.name} legend`)}"
          >
            ${
              legend.title === undefined
                ? ""
                : `<div class="adl-presentation-legend-title">${escapeHtml(legend.title)}</div>`
            }
            ${legend.items
              .map(
                (item) => `
                  <div
                    class="adl-presentation-legend-item"
                    data-status="${escapeHtml(item.status.name)}"
                    role="listitem"
                  >
                    ${this.renderStatusIndicator(item.status)}
                    <span>${escapeHtml(item.status.label)}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        `,
      )
      .join("");
  }

  private renderDiagnostics(): string {
    const diagnostics = this._presentation?.diagnostics ?? [];
    if (diagnostics.length === 0) {
      return "";
    }

    return `
      <div class="adl-presentation-diagnostics" role="status">
        ${diagnostics
          .map(
            (diagnostic) => `
              <div class="adl-presentation-diagnostic" data-severity="${escapeHtml(
                diagnostic.severity,
              )}">
                ${escapeHtml(diagnostic.message)}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  private renderSection(section: RuntimePresentationSection): string {
    return `
      <section
        class="adl-composed-section adl-layout-${escapeHtml(section.layout)} adl-density-${escapeHtml(
          section.density,
        )}"
        data-presentation-section="${escapeHtml(section.name)}"
      >
        ${
          section.heading === undefined
            ? ""
            : `<h2 class="adl-composed-heading">${escapeHtml(section.heading)}</h2>`
        }
        ${this.renderControls(section)}
        ${section.lists.map((list) => this.renderList(list)).join("")}
        ${section.matrices.map((matrix) => this.renderMatrix(matrix)).join("")}
        ${section.calendars.map((calendar) => this.renderCalendar(calendar)).join("")}
      </section>
    `;
  }

  private renderControls(section: RuntimePresentationSection): string {
    if (section.controls.length === 0) {
      return "";
    }

    return `
      <div class="adl-composed-controls" data-presentation-controls="${escapeHtml(section.name)}">
        ${section.controls.map((control) => this.renderControl(control)).join("")}
      </div>
    `;
  }

  private renderControl(control: RuntimePresentationControl): string {
    switch (control.kind) {
      case "toggle":
        return `
          <button
            type="button"
            class="adl-presentation-toggle"
            data-presentation-toggle="true"
            data-control-name="${escapeHtml(control.name)}"
            data-state="${escapeHtml(control.state)}"
            aria-checked="${control.value ? "true" : "false"}"
            role="switch"
          >
            ${this.renderIcon(control.icon, control.label)}
            <span>${escapeHtml(control.label ?? titleCaseIdentifier(control.state))}</span>
          </button>
        `;
      case "select":
        return `
          <label class="adl-presentation-select">
            <span>${escapeHtml(control.label ?? titleCaseIdentifier(control.name))}</span>
            <select data-control-name="${escapeHtml(control.name)}" disabled>
              ${control.options
                .map(
                  (option) => `
                    <option value="${escapeHtml(option.value)}" ${
                      option.value === control.value ? "selected" : ""
                    }>
                      ${escapeHtml(option.label)}
                    </option>
                  `,
                )
                .join("")}
            </select>
          </label>
        `;
      case "action":
        if (!control.visible) {
          return "";
        }
        return `
          <button
            type="button"
            class="adl-presentation-action adl-presentation-action-${escapeHtml(control.placement)}"
            data-presentation-action="true"
            data-control-name="${escapeHtml(control.name)}"
            data-action-name="${escapeHtml(control.name)}"
            ${control.command === undefined ? "" : `data-command="${escapeHtml(control.command)}"`}
            ${control.view === undefined ? "" : `data-view="${escapeHtml(control.view)}"`}
            ${
              control.create?.object === undefined
                ? ""
                : `data-create-object="${escapeHtml(control.create.object)}"`
            }
            ${
              control.create?.view === undefined
                ? ""
                : `data-create-view="${escapeHtml(control.create.view)}"`
            }
            data-input="${escapeHtml(JSON.stringify(control.input))}"
            ${control.enabled ? "" : "disabled"}
            ${control.reasons.length === 0 ? "" : `title="${escapeHtml(control.reasons.join(" "))}"`}
          >
            ${this.renderIcon(control.icon, control.label)}
            <span>${escapeHtml(control.label ?? titleCaseIdentifier(control.name))}</span>
          </button>
        `;
      case "contextSelector":
        return `
          <div class="adl-presentation-context-control" data-control-name="${escapeHtml(
            control.name,
          )}">
            ${this.renderIcon(control.icon, control.label)}
            <span>${escapeHtml(control.label ?? titleCaseIdentifier(control.context ?? control.name))}</span>
          </div>
        `;
    }
  }

  private renderList(list: RuntimePresentationList): string {
    const className = `adl-presentation-list adl-presentation-list-${list.renderAs} adl-density-${list.density}`;
    return `
      <div
        class="${escapeHtml(className)}"
        data-presentation-list="${escapeHtml(list.name)}"
        data-source-kind="${escapeHtml(list.sourceKind)}"
        data-source="${escapeHtml(list.source)}"
      >
        ${
          list.rows.length === 0
            ? this.renderEmptyState(list)
            : `
              <ol>
                ${list.rows
                  .map(
                    (row) => `
                      <li
                        class="adl-presentation-row adl-row-${escapeHtml(row.layout)} adl-density-${escapeHtml(
                          row.density,
                        )}"
                        data-presentation-row="${escapeHtml(row.id)}"
                        ${row.status === undefined ? "" : `data-status="${escapeHtml(row.status.name)}"`}
                        ${
                          row.status === undefined
                            ? ""
                            : `style="${escapeHtml(this.statusStyle(row.status))}"`
                        }
                      >
                        ${this.renderStatusIndicator(row.status)}
                        ${row.fragments.map((fragment) => this.renderFragment(fragment)).join("")}
                        ${this.renderRowActions(row.actions)}
                      </li>
                    `,
                  )
                  .join("")}
              </ol>
            `
        }
      </div>
    `;
  }

  private renderRowActions(actions: RuntimePresentationActionControl[]): string {
    const visibleActions = actions.filter((action) => action.visible);
    if (visibleActions.length === 0) {
      return "";
    }

    return `
      <div class="adl-presentation-row-actions">
        ${visibleActions.map((action) => this.renderControl(action)).join("")}
      </div>
    `;
  }

  private renderEmptyState(list: RuntimePresentationList): string {
    const emptyState = list.emptyState;
    if (emptyState === undefined) {
      return "";
    }

    return `
      <div class="adl-presentation-empty" data-presentation-empty="${escapeHtml(list.name)}">
        ${this.renderIcon(emptyState.icon, emptyState.text)}
        <span>${escapeHtml(emptyState.text)}</span>
      </div>
    `;
  }

  private renderCalendar(calendar: RuntimePresentationCalendar): string {
    const selectedCell = this.selectedCalendarCell(calendar);
    return `
      <div
        class="adl-presentation-calendar adl-density-${escapeHtml(calendar.density)}"
        data-presentation-calendar="${escapeHtml(calendar.name)}"
      >
        <div class="adl-calendar-toolbar">
          <button
            type="button"
            class="adl-calendar-nav"
            data-presentation-calendar-nav="true"
            data-calendar-name="${escapeHtml(calendar.name)}"
            data-state="${escapeHtml(calendar.month.state ?? "")}"
            data-value="${escapeHtml(calendar.month.previous ?? "")}"
            aria-label="Previous month"
            ${calendar.month.state === undefined || !calendar.month.canNavigatePrevious ? "disabled" : ""}
          >‹</button>
          <h3>${escapeHtml(calendar.month.label)}</h3>
          <button
            type="button"
            class="adl-calendar-nav"
            data-presentation-calendar-nav="true"
            data-calendar-name="${escapeHtml(calendar.name)}"
            data-state="${escapeHtml(calendar.month.state ?? "")}"
            data-value="${escapeHtml(calendar.month.next ?? "")}"
            aria-label="Next month"
            ${calendar.month.state === undefined || !calendar.month.canNavigateNext ? "disabled" : ""}
          >›</button>
        </div>
        ${
          calendar.emptyState === undefined
            ? ""
            : `<div class="adl-presentation-empty" data-presentation-empty="${escapeHtml(
                calendar.name,
              )}">${this.renderIcon(calendar.emptyState.icon, calendar.emptyState.text)}<span>${escapeHtml(
                calendar.emptyState.text,
              )}</span></div>`
        }
        <div class="adl-calendar-grid" role="grid" aria-label="${escapeHtml(calendar.month.label)}">
          ${calendar.weekdays
            .map(
              (weekday) => `
                <div class="adl-calendar-weekday" role="columnheader">${escapeHtml(
                  weekday.label,
                )}</div>
              `,
            )
            .join("")}
          ${calendar.cells
            .map((cell) => this.renderCalendarCell(calendar, cell, cell.date === selectedCell.date))
            .join("")}
        </div>
        ${this.renderCalendarSelectedDay(selectedCell)}
        <div class="adl-calendar-agenda">
          ${calendar.cells
            .filter((cell) => cell.inMonth && (cell.eventCount > 0 || cell.actions.length > 0))
            .map((cell) => this.renderCalendarAgendaCell(cell))
            .join("")}
        </div>
      </div>
    `;
  }

  private renderCalendarCell(
    calendar: RuntimePresentationCalendar,
    cell: RuntimePresentationCalendarCell,
    selected: boolean,
  ): string {
    const style =
      cell.status === undefined ? "" : `style="${escapeHtml(this.statusStyle(cell.status))}"`;
    return `
      <div
        class="adl-calendar-cell ${cell.inMonth ? "in-month" : "out-month"} ${
          cell.isToday ? "today" : ""
        } ${selected ? "selected" : ""}"
        role="gridcell"
        tabindex="0"
        aria-selected="${selected ? "true" : "false"}"
        data-calendar-name="${escapeHtml(calendar.name)}"
        data-calendar-cell="${escapeHtml(cell.date)}"
        data-status="${escapeHtml(cell.status?.name ?? "unset")}"
        aria-label="${escapeHtml(cell.accessibleLabel)}"
        ${style}
      >
        <div class="adl-calendar-cell-head">
          <span class="adl-calendar-day">${escapeHtml(cell.day)}</span>
          ${this.renderStatusIndicator(cell.status)}
          ${
            cell.eventCount === 0
              ? ""
              : `<span class="adl-calendar-count" aria-label="${escapeHtml(
                  `${cell.eventCount} events`,
                )}">${escapeHtml(cell.eventCount)}</span>`
          }
        </div>
        <div class="adl-calendar-items">
          ${cell.items
            .slice(0, 2)
            .map((item) => this.renderCalendarItem(item))
            .join("")}
          ${
            cell.items.length <= 2
              ? ""
              : `<details class="adl-calendar-more"><summary>${escapeHtml(
                  `${cell.items.length - 2} more`,
                )}</summary>${cell.items
                  .slice(2)
                  .map((item) => this.renderCalendarItem(item))
                  .join("")}</details>`
          }
        </div>
        ${this.renderCalendarActions(cell.actions, "cell", cell.eventCount)}
      </div>
    `;
  }

  private renderCalendarSelectedDay(cell: RuntimePresentationCalendarCell): string {
    return `
      <aside class="adl-calendar-selected-day" data-calendar-selected-date="${escapeHtml(
        cell.date,
      )}">
        <div class="adl-calendar-selected-day-header">
          <div>
            <span class="adl-calendar-selected-day-kicker">Selected date</span>
            <strong>${escapeHtml(this.formatCalendarDateLabel(cell.date))}</strong>
          </div>
          <span>${escapeHtml(`${cell.eventCount} event${cell.eventCount === 1 ? "" : "s"}`)}</span>
        </div>
        ${
          cell.items.length === 0
            ? `<div class="adl-calendar-selected-empty">No events scheduled.</div>`
            : `<div class="adl-calendar-selected-items">${cell.items
                .map((item) => this.renderCalendarItem(item))
                .join("")}</div>`
        }
        ${this.renderCalendarActions(cell.actions, "details", cell.eventCount)}
      </aside>
    `;
  }

  private renderCalendarAgendaCell(cell: RuntimePresentationCalendarCell): string {
    const empty = cell.eventCount === 0;
    return `
      <section
        class="adl-calendar-agenda-day ${empty ? "empty" : ""}"
        data-calendar-agenda-day="${escapeHtml(cell.date)}"
      >
        <div class="adl-calendar-agenda-date">
          <time datetime="${escapeHtml(cell.date)}">${escapeHtml(this.formatCalendarDateLabel(cell.date))}</time>
          <span>${escapeHtml(`${cell.eventCount} event${cell.eventCount === 1 ? "" : "s"}`)}</span>
        </div>
        ${cell.items.map((item) => this.renderCalendarItem(item)).join("")}
        ${this.renderCalendarActions(cell.actions, "agenda", cell.eventCount)}
      </section>
    `;
  }

  private renderCalendarItem(item: RuntimePresentationCalendarItem): string {
    const source = item.sources[0];
    const status = item.status;
    const content = `
      ${this.renderStatusIndicator(status)}
      <span class="adl-calendar-item-title">${escapeHtml(item.title)}</span>
      ${
        item.summary.length === 0
          ? ""
          : `<span class="adl-calendar-item-summary">${escapeHtml(item.summary)}</span>`
      }
    `;

    if (source === undefined) {
      return `
        <div class="adl-calendar-item" ${
          status === undefined ? "" : `data-status="${escapeHtml(status.name)}"`
        }>
          ${content}
        </div>
      `;
    }

    return `
      <button
        type="button"
        class="adl-calendar-item adl-calendar-item-button"
        data-presentation-calendar-item="true"
        data-object-name="${escapeHtml(source.objectName)}"
        data-record-id="${escapeHtml(source.recordId)}"
        ${status === undefined ? "" : `data-status="${escapeHtml(status.name)}"`}
      >
        ${content}
      </button>
    `;
  }

  private renderCalendarActions(
    actions: RuntimePresentationActionControl[],
    mode: "agenda" | "cell" | "details",
    eventCount: number,
  ): string {
    const visibleActions = actions.filter((action) => action.visible);
    if (visibleActions.length === 0) {
      return "";
    }
    const classes = [
      "adl-calendar-actions",
      `adl-calendar-actions-${mode}`,
      eventCount === 0 ? "adl-calendar-actions-empty" : "adl-calendar-actions-has-events",
    ];
    return `
      <div class="${escapeHtml(classes.join(" "))}">
        ${visibleActions.map((action) => this.renderControl(action)).join("")}
      </div>
    `;
  }

  private selectedCalendarCell(
    calendar: RuntimePresentationCalendar,
  ): RuntimePresentationCalendarCell {
    const selectedDate = this.selectedCalendarDates.get(calendar.name);
    const selectedCell = calendar.cells.find((cell) => cell.date === selectedDate);
    if (selectedCell !== undefined && selectedCell.inMonth) {
      return selectedCell;
    }

    return (
      calendar.cells.find((cell) => cell.inMonth && cell.eventCount > 0) ??
      calendar.cells.find((cell) => cell.inMonth) ??
      calendar.cells[0]!
    );
  }

  private formatCalendarDateLabel(date: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (match === null) {
      return date;
    }

    const day = Number(match[3]);
    const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, day));
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${weekdays[value.getUTCDay()]} ${day} ${months[value.getUTCMonth()]}`;
  }

  private renderMatrix(matrix: RuntimePresentationMatrix): string {
    return `
      <div
        class="adl-presentation-matrix adl-density-${escapeHtml(matrix.density)}"
        data-presentation-matrix="${escapeHtml(matrix.name)}"
      >
        <table>
          <thead>
            <tr>
              <th scope="col"></th>
              ${matrix.columns
                .map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`)
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${matrix.rows
              .map(
                (row) => `
                  <tr data-matrix-row="${escapeHtml(row.key)}">
                    <th scope="row">${escapeHtml(row.label)}</th>
                    ${row.cells.map((cell) => this.renderMatrixCell(matrix, cell)).join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderMatrixCell(
    matrix: RuntimePresentationMatrix,
    cell: RuntimePresentationMatrixCell,
  ): string {
    const content = `${this.renderStatusIndicator(cell.status)}<span class="adl-matrix-cell-label">${escapeHtml(
      cell.status?.label ?? "Unset",
    )}</span>`;
    const style =
      cell.status === undefined ? "" : `style="${escapeHtml(this.statusStyle(cell.status))}"`;
    const dataset = `
      data-presentation-matrix-cell="true"
      data-matrix-name="${escapeHtml(matrix.name)}"
      data-row-key="${escapeHtml(cell.rowKey)}"
      data-column-key="${escapeHtml(cell.columnKey)}"
    `;
    return `
      <td
        data-status="${escapeHtml(cell.status?.name ?? "unset")}"
        ${style}
      >
        ${
          cell.edit === undefined
            ? `<div class="adl-matrix-cell" aria-label="${escapeHtml(cell.accessibleLabel)}">${content}</div>`
            : `<button
                type="button"
                class="adl-matrix-cell adl-matrix-cell-button"
                ${dataset}
                aria-label="${escapeHtml(cell.accessibleLabel)}"
                title="${escapeHtml(cell.edit.reasons.join(" "))}"
                ${cell.edit.enabled ? "" : "disabled"}
              >${content}</button>`
        }
      </td>
    `;
  }

  private renderFragment(fragment: RuntimePresentationFragment): string {
    if (fragment.kind === "icon") {
      return this.renderIcon(fragment.icon, fragment.label);
    }

    if (fragment.style === "bold") {
      return `<strong>${escapeHtml(fragment.text)}</strong>`;
    }

    return `<span class="adl-fragment-${escapeHtml(fragment.style)}">${escapeHtml(
      fragment.text,
    )}</span>`;
  }

  private renderStatusIndicator(status: RuntimePresentationStatus | undefined): string {
    if (status === undefined) {
      return "";
    }

    return `
      <span
        class="adl-presentation-status"
        data-status="${escapeHtml(status.name)}"
        aria-label="${escapeHtml(status.accessibleLabel)}"
        title="${escapeHtml(status.accessibleLabel)}"
        style="${escapeHtml(this.statusStyle(status))}"
      >
        <span class="adl-presentation-status-swatch" aria-hidden="true"></span>
        ${this.renderIcon(status.icon, undefined)}
      </span>
    `;
  }

  private statusStyle(status: RuntimePresentationStatus): string {
    return `--adl-status-color: var(${statusThemeCssVariable(status.themeToken)}, var(--adl-color-info));`;
  }

  private renderIcon(icon: RuntimePresentationIcon | undefined, label: string | undefined): string {
    if (icon === undefined) {
      return "";
    }

    const svg = iconSvg(icon.name);
    return `
      <span
        class="adl-presentation-icon"
        data-icon="${escapeHtml(icon.name)}"
        ${label === undefined ? 'aria-hidden="true"' : `aria-label="${escapeHtml(label)}"`}
      >
        ${svg}
      </span>
    `;
  }
}

export function defineAdlComposedView(): void {
  if (customElements.get("adl-composed-view") === undefined) {
    customElements.define("adl-composed-view", AdlComposedViewElement);
  }
}

function iconSvg(name: string): string {
  switch (name) {
    case "music":
      return svgPath(
        "M9 18V5l10-2v13M9 9l10-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
      );
    case "microphone":
      return svgPath(
        "M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm7-3a7 7 0 0 1-14 0m7 7v4m-4 0h8",
      );
    case "calendar":
      return svgPath(
        "M7 2v4m10-4v4M4 9h16M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
      );
    case "x":
    case "close":
      return svgPath("M18 6 6 18M6 6l12 12");
    case "menu":
      return svgPath("M4 6h16M4 12h16M4 18h16");
    default:
      return `<span class="adl-presentation-icon-fallback">${escapeHtml(
        titleCaseIdentifier(name).slice(0, 1) || "?",
      )}</span>`;
  }
}

function svgPath(path: string): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="${path}"></path>
    </svg>
  `;
}

function statusThemeCssVariable(themeToken: RuntimePresentationStatus["themeToken"]): string {
  switch (themeToken) {
    case "colorStatusEvent":
      return "--adl-color-status-event";
    case "colorStatusRehearsal":
      return "--adl-color-status-rehearsal";
    case "colorStatusAvailable":
      return "--adl-color-status-available";
    case "colorStatusUnavailable":
      return "--adl-color-status-unavailable";
    case "colorStatusBusyElsewhere":
      return "--adl-color-status-busy-elsewhere";
    case "colorStatusConflict":
      return "--adl-color-status-conflict";
    case "colorStatusUnset":
      return "--adl-color-status-unset";
    case "colorInfo":
      return "--adl-color-info";
  }
}
