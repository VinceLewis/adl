import type { EditContainerMode } from "../../../model/resolved-model.js";
import type { AdlComposedViewElement } from "../adl-composed-view.js";
import type { AdlAccessReviewElement } from "../adl-access-review.js";
import type { AdlAuditReviewElement } from "../adl-audit-review.js";
import type { AdlContextSelectorElement } from "../adl-context-selector.js";
import type { AdlReportRunnerElement } from "../adl-report-runner.js";
import type { AdlSessionDevicesElement } from "../adl-session-devices.js";
import type { AdlSessionPanelElement } from "../adl-session-panel.js";
import type { AdlSyncRecoveryElement } from "../adl-sync-recovery.js";
import { AdlDashboardViewElement } from "../adl-dashboard-view.js";
import { AdlFormViewElement } from "../adl-form-view.js";
import { AdlListViewElement } from "../adl-list-view.js";
import { AdlMessageAreaElement } from "../adl-message-area.js";
import { escapeHtml, titleCaseIdentifier } from "../html.js";
import { AdlAppChromeElement } from "./render-chrome.js";

export class AdlAppRenderElement extends AdlAppChromeElement {
  protected renderLoading(): void {
    this.innerHTML = `
      <main class="adl-shell">
        <header class="adl-topbar">
          <div class="adl-brand">
            <h1>${escapeHtml(this._model.app.name)}</h1>
            <span>Loading runtime</span>
          </div>
        </header>
      </main>
    `;
  }

  protected render(): void {
    const object = this.activeObject;
    const view = this.activeView;
    const readModel = this.activeReadModel;
    const editObject = this.editObject;
    const editFormView = this.editFormView;
    const isComposedView = view.presentation !== undefined;
    const shellClass = "adl-shell adl-shell-app";
    const topbarClass = "adl-topbar adl-topbar-app";
    const showWorkspace =
      this.activeRuntimeContext !== undefined && this.activeViewEmptyState === undefined;
    const hasNavigationDrawerContent = this.hasNavigationDrawerContent;
    if (!hasNavigationDrawerContent) {
      this.navDrawerOpen = false;
    }

    this.applyThemeTokens();
    this.innerHTML = `
      <main class="${shellClass}">
        <header class="${topbarClass}">
          ${
            hasNavigationDrawerContent
              ? `<button
                  class="adl-menu-action"
                  type="button"
                  aria-label="${this.navDrawerOpen ? "Close navigation menu" : "Open navigation menu"}"
                  aria-controls="adl-nav-drawer"
                  aria-expanded="${this.navDrawerOpen ? "true" : "false"}"
                  data-shell-menu="true"
                >
                  <span aria-hidden="true"></span>
                </button>`
              : '<span class="adl-menu-placeholder" aria-hidden="true"></span>'
          }
          <div class="adl-brand">
            <h1>${escapeHtml(this._model.app.name)}</h1>
          </div>
          <div class="adl-topbar-tools">
            ${this.renderTopBarControls()}
          </div>
        </header>
        ${this.renderNavigationDrawer(view)}
        <div class="adl-scroll-region">
          <adl-message-area></adl-message-area>
          ${this.renderAuthorityChrome()}
          ${
            showWorkspace
              ? isComposedView
                ? `
                  <div class="adl-composed-workspace">
                    <adl-composed-view></adl-composed-view>
                    ${
                      this.editContainerOpen &&
                      this.activeEditContainer !== "page" &&
                      this.activeEditContainer !== "splitPane"
                        ? this.renderEditContainer(this.activeEditContainer)
                        : ""
                    }
                  </div>
                `
                : readModel === undefined
                  ? this.renderCrudWorkspace()
                  : `
                  <div class="adl-dashboard-workspace">
                    <adl-dashboard-view></adl-dashboard-view>
                  </div>
                `
              : `<section class="adl-empty-state">${escapeHtml(this.activeViewEmptyState ?? "No runtime context is available for this view.")}</section>`
          }
        </div>
      </main>
    `;

    const messageArea = this.querySelector<AdlMessageAreaElement>("adl-message-area");
    if (messageArea !== null) {
      messageArea.messages = this.messages;
    }

    const bridge = this._authority;
    const sessionPanel = this.querySelector<AdlSessionPanelElement>("adl-session-panel");
    if (sessionPanel !== null && bridge !== undefined) {
      sessionPanel.session = this.authorityBusy
        ? { ...bridge.session, busy: true }
        : bridge.session;
      sessionPanel.invite = bridge.invite;
      sessionPanel.online = this._context.online ?? true;
    }

    const sessionDevices = this.querySelector<AdlSessionDevicesElement>("adl-session-devices");
    if (sessionDevices !== null && bridge !== undefined) {
      sessionDevices.devices = bridge.devices;
      sessionDevices.busy = this.authorityBusy;
    }

    const syncRecovery = this.querySelector<AdlSyncRecoveryElement>("adl-sync-recovery");
    if (syncRecovery !== null && bridge !== undefined) {
      syncRecovery.items = bridge.recovery;
      syncRecovery.undelivered = bridge.undelivered;
      // Refused records come from the runtime, not the bridge: the verdict that
      // produced them lives on the record and outlives the queue entry, so this
      // list is still there after the entry has been dismissed and after a
      // reload.
      syncRecovery.refused = this.refusedRecords;
      syncRecovery.busy = this.authorityBusy;
    }

    const auditReview = this.querySelector<AdlAuditReviewElement>("adl-audit-review");
    if (auditReview !== null && bridge !== undefined) {
      auditReview.state = bridge.administration;
      auditReview.busy = this.authorityBusy;
    }

    const accessReview = this.querySelector<AdlAccessReviewElement>("adl-access-review");
    if (accessReview !== null && bridge !== undefined) {
      accessReview.state = bridge.administration;
      accessReview.busy = this.authorityBusy;
    }

    const reportRunner = this.querySelector<AdlReportRunnerElement>("adl-report-runner");
    if (reportRunner !== null && bridge !== undefined) {
      reportRunner.reports = this.reportableReadModels;
      reportRunner.state = bridge.administration;
      reportRunner.busy = this.authorityBusy;
    }

    const list = this.querySelector<AdlListViewElement>("adl-list-view");
    if (list !== null && this.activeRuntimeContext !== undefined) {
      list.runtime = this.runtime;
      list.object = object;
      list.view = view;
      list.context = this.activeRuntimeContext;
      list.records = this.records;
      list.selectedRecordId = this.selectedRecord?.meta.guid;
      list.searchText = this.searchText;
    }

    const form = this.querySelector<AdlFormViewElement>("adl-form-view");
    if (form !== null && this.activeRuntimeContext !== undefined) {
      form.runtime = this.runtime;
      form.object = editObject;
      form.view = editFormView;
      form.context = this.activeRuntimeContext;
      form.record = this.selectedRecord;
      form.mode = this.mode;
      form.draftValues = this.draftValues;
      form.fieldIssues = this.fieldIssues;
      form.editSurface = this.editSurface;
    }

    const dashboard = this.querySelector<AdlDashboardViewElement>("adl-dashboard-view");
    if (dashboard !== null) {
      dashboard.readModel = readModel;
      dashboard.rows = this.readModelRows;
    }

    const composed = this.querySelector<AdlComposedViewElement>("adl-composed-view");
    if (composed !== null) {
      composed.presentation = this.presentationView;
    }

    for (const selector of this.querySelectorAll<AdlContextSelectorElement>(
      "adl-context-selector",
    )) {
      const contextName = selector.dataset.contextName;
      const contextModel = this._model.contexts?.find((context) => context.name === contextName);
      if (contextModel === undefined) {
        continue;
      }

      selector.contextModel = contextModel;
      selector.availableContexts = this.availableContexts.get(contextModel.name) ?? [];
      selector.selectedContextId = this.selectedContextIds[contextModel.name];
    }
  }

  private renderCrudWorkspace(): string {
    // Rendering and behaviour must agree about which container is in force, so
    // both read it from the form that opens rather than from the active view.
    const editContainer = this.activeEditContainer;

    if (editContainer === "splitPane") {
      return `
        <div class="adl-workspace adl-workspace-split-pane" data-edit-container="splitPane">
          <adl-list-view></adl-list-view>
          <adl-form-view></adl-form-view>
        </div>
      `;
    }

    if (editContainer === "page") {
      if (this.editContainerOpen) {
        return `
          <div class="adl-workspace adl-workspace-page" data-edit-container="page">
            ${this.renderContainerCloseButton("Back to list", "Back to list")}
            <adl-form-view></adl-form-view>
          </div>
        `;
      }

      return `
        <div class="adl-workspace adl-workspace-list-first" data-edit-container="page">
          <adl-list-view></adl-list-view>
        </div>
      `;
    }

    return `
      <div class="adl-workspace adl-workspace-list-first" data-edit-container="${escapeHtml(
        editContainer,
      )}">
        <adl-list-view></adl-list-view>
        ${this.editContainerOpen ? this.renderEditContainer(editContainer) : ""}
      </div>
    `;
  }

  private renderEditContainer(
    editContainer: Exclude<EditContainerMode, "page" | "splitPane">,
  ): string {
    const title =
      this.mode === "create" ? `New ${titleCaseIdentifier(this.editObject.name)}` : "Edit record";

    return `
      <div class="adl-edit-scrim" data-edit-container-close="true"></div>
      <aside
        class="adl-edit-container adl-edit-container-${editContainer}"
        role="dialog"
        aria-modal="true"
        aria-label="${escapeHtml(title)}"
      >
        ${this.renderContainerCloseButton("Close form", "x")}
        <adl-form-view></adl-form-view>
      </aside>
    `;
  }

  private renderContainerCloseButton(ariaLabel: string, label: string): string {
    return `
      <button
        class="adl-edit-close"
        type="button"
        aria-label="${escapeHtml(ariaLabel)}"
        data-edit-container-close="true"
      >${escapeHtml(label)}</button>
    `;
  }
}
