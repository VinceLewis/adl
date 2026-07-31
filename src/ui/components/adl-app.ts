import { ApplicationRuntime } from "../../runtime/application-runtime.js";
import { RuntimeValidationError } from "../../runtime/runtime-types.js";
import { requiresImmediateDelivery } from "../../runtime/sync-policy-service.js";
import type {
  EditContainerMode,
  JsonValue,
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedView,
  ResolvedViewContext,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type {
  RuntimeAvailableContext,
  RuntimeContext,
  RuntimeContextRole,
  RuntimeReadModelRow,
  RuntimeValidationIssue,
} from "../../runtime/runtime-types.js";
import {
  browserDemoContext,
  createBrowserDemoModel,
  createPersistentBrowserDemoRuntime,
  seedBrowserDemoRuntimeIfEmpty,
} from "../demo-fixture.js";
import { infoMessage, messageFromRuntimeError, successMessage } from "../runtime-error-messages.js";
import { applyResolvedTheme, findApplicationTheme } from "../theme/default-theme.js";
import type {
  DraftRecordDetail,
  SaveRecordDetail,
  StageChildOperationDetail,
  TransitionRecordDetail,
  UiMessage,
  UiMode,
} from "../types.js";
import type {
  AdlComposedViewElement,
  PresentationCalendarNavigateDetail,
  PresentationActionDetail,
  PresentationMatrixCellCycleDetail,
  PresentationRecordSelectDetail,
  PresentationStateChangeDetail,
} from "./adl-composed-view.js";
import type { AdlContextSelectorElement, ContextSelectionDetail } from "./adl-context-selector.js";
import type { AdlSessionDevicesElement } from "./adl-session-devices.js";
import type { AdlSessionPanelElement } from "./adl-session-panel.js";
import type { AdlSyncRecoveryElement } from "./adl-sync-recovery.js";
import {
  ADL_CLAIM_INVITE_EVENT,
  ADL_PASSKEY_SIGN_IN_EVENT,
  ADL_REFRESH_DEVICES_EVENT,
  ADL_REGISTER_PASSKEY_EVENT,
  ADL_RESOLVE_RECOVERY_EVENT,
  ADL_RETRY_DELIVERY_EVENT,
  ADL_REVOKE_DEVICE_EVENT,
  ADL_SIGN_IN_EVENT,
  ADL_SIGN_OUT_EVENT,
} from "../authority-bridge.js";
import type {
  AdlAuthorityBridge,
  ClaimInviteDetail,
  RegisterPasskeyDetail,
  ResolveRecoveryDetail,
  RetryDeliveryDetail,
  RevokeDeviceDetail,
  SignInDetail,
} from "../authority-bridge.js";
import { AdlDashboardViewElement } from "./adl-dashboard-view.js";
import { AdlFormViewElement } from "./adl-form-view.js";
import { AdlListViewElement } from "./adl-list-view.js";
import { AdlMessageAreaElement } from "./adl-message-area.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";
import type { RuntimePresentationView } from "../../runtime/presentation-runtime.js";
import type {
  RuntimeEditSurface,
  RuntimeStagedChildOperation,
} from "../../runtime/edit-surface-runtime.js";

/**
 * `beforeinstallprompt` is Chromium-only and absent from the DOM lib, so it is
 * declared here as the narrowest shape this shell actually uses.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

interface ActiveViewContextState {
  context?: RuntimeContext;
  emptyState?: string;
}

export class AdlAppElement extends HTMLElement {
  private _model: ResolvedApplicationModel = createBrowserDemoModel();
  private _runtime: ApplicationRuntime | undefined;
  private _context: RuntimeContext = browserDemoContext;
  private readyPromise: Promise<void> = Promise.resolve();
  private initialized = false;
  private seeded = false;
  private viewName = "";
  private searchText = "";
  private records: StoredObjectRecord[] = [];
  private readModelRows: RuntimeReadModelRow[] = [];
  private presentationView: RuntimePresentationView | undefined;
  private presentationStateByView = new Map<string, Record<string, JsonValue>>();
  private editSurface: RuntimeEditSurface | undefined;
  private stagedChildChanges: RuntimeStagedChildOperation[] = [];
  private selectedRecord: StoredObjectRecord | undefined;
  private editContainerOpen = false;
  private mode: UiMode = "edit";
  private draftValues: SaveRecordDetail["values"] = {};
  private messages: UiMessage[] = [];
  private fieldIssues: RuntimeValidationIssue[] = [];
  private useBrowserOnlineState = this._context.online === undefined;
  private availableContexts = new Map<string, RuntimeAvailableContext[]>();
  private selectedContextIds: Record<string, string> = {};
  private activeRuntimeContext: RuntimeContext | undefined;
  private activeViewEmptyState: string | undefined;
  private editObjectName: string | undefined;
  private editViewName: string | undefined;
  private navDrawerOpen = false;
  private _authority: AdlAuthorityBridge | undefined;
  private authorityBusy = false;
  private deliveringWrites = false;
  private installPrompt: InstallPromptEvent | undefined;

  private readonly handleSignIn = (event: Event): void => {
    const detail = (event as CustomEvent<SignInDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signIn(detail.accountProof));
  };

  private readonly handleRegisterPasskey = (event: Event): void => {
    const detail = (event as CustomEvent<RegisterPasskeyDetail>).detail;
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.registerPasskey(detail?.inviteToken));
  };

  private readonly handlePasskeySignIn = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signInWithPasskey());
  };

  private readonly handleRefreshDevices = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.refreshDevices());
  };

  private readonly handleRevokeDevice = (event: Event): void => {
    const detail = (event as CustomEvent<RevokeDeviceDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.revokeDevice(detail.sessionId));
  };

  private readonly handleSignOut = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signOut());
  };

  private readonly handleClaimInvite = (event: Event): void => {
    const detail = (event as CustomEvent<ClaimInviteDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.claimInvite(detail.inviteToken));
  };

  private readonly handleResolveRecovery = (event: Event): void => {
    const detail = (event as CustomEvent<ResolveRecoveryDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.resolveRecovery(detail.queueId, detail.choice));
  };

  private readonly handleRetryDelivery = (event: Event): void => {
    const detail = (event as CustomEvent<RetryDeliveryDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.retryDelivery(detail.queueId));
  };

  /** Chromium fires this before offering installation; other engines never do. */
  private readonly handleInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.installPrompt = event as InstallPromptEvent;
    if (this.initialized) {
      this.render();
    }
  };

  private readonly handleSearch = (event: Event): void => {
    const detail = (event as CustomEvent<{ text: string }>).detail;
    if (detail === undefined) {
      return;
    }

    this.searchText = detail.text;
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  };

  private readonly handleSelect = (event: Event): void => {
    const detail = (event as CustomEvent<{ recordId: string }>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const record = await this.runtime.read(this.activeObject.name, detail.recordId, context);
      if (record !== null) {
        this.mode = "edit";
        this.setEditTarget(this.activeObject.name);
        this.selectedRecord = record;
        this.editContainerOpen = true;
        this.draftValues = {};
        this.stagedChildChanges = [];
        this.fieldIssues = [];
        await this.refreshEditSurface();
        this.render();
      }
    });
  };

  private readonly handleNew = (): void => {
    this.mode = "create";
    this.setEditTarget(this.activeObject.name);
    this.selectedRecord = undefined;
    this.editContainerOpen = true;
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.fieldIssues = [];
    this.messages = [];
    void this.runCommand(async () => {
      await this.refreshEditSurface();
      this.render();
    });
  };

  private readonly handleDraft = (event: Event): void => {
    const detail = (event as CustomEvent<DraftRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.mode === "edit" && detail.record?.meta.guid !== this.selectedRecord?.meta.guid) {
      return;
    }

    this.draftValues = { ...detail.values };
  };

  private readonly handleSave = (event: Event): void => {
    const detail = (event as CustomEvent<SaveRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      this.draftValues = { ...detail.values };
      if (detail.mode === "create") {
        const created = await this.runtime.create(
          editObject.name,
          this.applySelectedScopeToCreateValues(detail.values, editObject),
          context,
        );
        await this.applyPendingChildChanges(created.meta.guid, context);
        this.messages = [successMessage(`${editObject.name} created.`)];
        this.draftValues = {};
        this.stagedChildChanges = [];
        this.fieldIssues = [];
        await this.refreshRecords(editContainer === "splitPane" ? created.meta.guid : undefined);
        if (editContainer !== "splitPane") {
          this.closeEditContainer(false);
        }
        this.render();
        return;
      }

      if (detail.record === undefined) {
        return;
      }

      if (Object.keys(detail.values).length === 0 && this.stagedChildChanges.length === 0) {
        this.messages = [infoMessage("No changes to save.")];
        this.draftValues = {};
        if (editContainer !== "splitPane") {
          this.closeEditContainer(false);
        }
        this.render();
        return;
      }

      const updated =
        Object.keys(detail.values).length === 0
          ? detail.record
          : await this.runtime.update(
              editObject.name,
              detail.record.meta.guid,
              detail.values,
              context,
            );
      await this.applyPendingChildChanges(updated.meta.guid, context);
      this.messages = [successMessage(`${editObject.name} saved.`)];
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      if (editContainer !== "splitPane") {
        this.closeEditContainer(false);
      }
      this.render();
    });
  };

  private readonly handleDelete = (event: Event): void => {
    const detail = (event as CustomEvent<{ record: StoredObjectRecord }>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      await this.runtime.delete(editObject.name, detail.record.meta.guid, context);
      this.messages = [successMessage(`${editObject.name} deleted.`)];
      this.selectedRecord = undefined;
      this.mode = "create";
      this.editContainerOpen = editContainer === "splitPane";
      this.draftValues = {};
      this.stagedChildChanges = [];
      await this.refreshRecords();
      if (editContainer !== "splitPane") {
        this.clearEditTarget();
      }
      this.render();
    });
  };

  private readonly handleCancel = (): void => {
    this.fieldIssues = [];
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    if (this.activeEditContainer !== "splitPane") {
      this.closeEditContainer(true);
      this.render();
      return;
    }

    this.messages = [];
    this.draftValues = {};
    if (this.records[0] !== undefined) {
      this.mode = "edit";
      this.selectedRecord = this.records[0];
    } else {
      this.mode = "create";
      this.selectedRecord = undefined;
    }
    this.render();
  };

  private readonly handleTransition = (event: Event): void => {
    const detail = (event as CustomEvent<TransitionRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const editObject = this.editObject;
      const editContainer = this.activeEditContainer;
      this.draftValues = { ...detail.values };
      const record =
        Object.keys(detail.values).length === 0
          ? detail.record
          : await this.runtime.update(
              editObject.name,
              detail.record.meta.guid,
              detail.values,
              context,
            );
      const updated = await this.runtime.transition(
        editObject.name,
        record.meta.guid,
        detail.actionName,
        context,
      );
      this.messages = [successMessage(`${titleCaseIdentifier(detail.actionName)} completed.`)];
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      if (editContainer !== "splitPane") {
        this.closeEditContainer(false);
      }
      this.render();
    });
  };

  private readonly handleStageChildOperation = (event: Event): void => {
    const detail = (event as CustomEvent<StageChildOperationDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.operation === "remove" && detail.stagedOperationId !== undefined) {
      this.stagedChildChanges = this.stagedChildChanges.filter(
        (operation) => operation.id !== detail.stagedOperationId,
      );
    } else {
      const childIds =
        detail.childIds ?? (detail.childId === undefined ? [undefined] : [detail.childId]);
      this.stagedChildChanges = [
        ...this.stagedChildChanges,
        ...childIds.map((childId, index) => ({
          id: `child-${Date.now()}-${this.stagedChildChanges.length + index + 1}`,
          section: detail.section,
          operation: detail.operation,
          childObject: detail.childObject,
          ...(childId === undefined ? {} : { childId }),
          ...(detail.values === undefined ? {} : { values: detail.values }),
        })),
      ];
    }

    void this.runCommand(async () => {
      await this.refreshEditSurface();
      this.render();
    });
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.viewSwitch !== "true") {
      return;
    }

    this.navigateToView(target.value);
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const menuButton = target.closest<HTMLButtonElement>("[data-shell-menu='true']");
    if (menuButton !== null) {
      this.navDrawerOpen = !this.navDrawerOpen;
      this.render();
      return;
    }

    if (target.closest("[data-shell-overlay='true']") !== null) {
      this.navDrawerOpen = false;
      this.render();
      return;
    }

    const shellAction =
      target.closest<HTMLButtonElement>("[data-shell-action]")?.dataset.shellAction;
    if (shellAction === "sign-out") {
      this.handleSignOut();
      return;
    }

    if (shellAction === "install") {
      void this.installPrompt?.prompt();
      this.installPrompt = undefined;
      this.render();
      return;
    }

    const navButton = target.closest<HTMLButtonElement>("[data-view-nav]");
    const viewName = navButton?.dataset.viewNav;
    if (viewName !== undefined) {
      this.navigateToView(viewName);
      return;
    }

    if (target.closest("[data-edit-container-close='true']") !== null) {
      this.closeEditContainer(true);
      this.render();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    if (this.navDrawerOpen) {
      this.navDrawerOpen = false;
    } else if (this.editContainerOpen && this.activeEditContainer !== "splitPane") {
      this.closeEditContainer(true);
    } else {
      return;
    }

    this.render();
  };

  private navigateToView(viewName: string): void {
    if (viewName.length === 0 || viewName === this.viewName) {
      this.navDrawerOpen = false;
      this.render();
      return;
    }

    this.viewName = viewName;
    this.searchText = "";
    this.selectedRecord = undefined;
    this.editContainerOpen = false;
    this.clearEditTarget();
    this.mode = "edit";
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    this.messages = [];
    this.fieldIssues = [];
    this.navDrawerOpen = false;
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  }

  private readonly handleContextSelection = (event: Event): void => {
    const detail = (event as CustomEvent<ContextSelectionDetail>).detail;
    if (detail === undefined) {
      return;
    }

    this.setSelectedContextId(detail.contextName, detail.contextId, true);
    this.searchText = "";
    this.selectedRecord = undefined;
    this.editContainerOpen = false;
    this.mode = "edit";
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    this.messages = [];
    this.fieldIssues = [];
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  };

  private readonly handlePresentationStateChange = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationStateChangeDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      await this.refreshPresentationView({ [detail.state]: detail.value });
      this.render();
    });
  };

  private readonly handlePresentationAction = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationActionDetail>).detail;
    if (detail === undefined) {
      return;
    }

    if (detail.create !== undefined) {
      void this.openCreateFromPresentationAction(detail);
      return;
    }

    if (detail.view !== undefined) {
      this.navigateToView(detail.view);
      return;
    }

    if (detail.command === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const result = await this.runtime.executeCommand(
        detail.command ?? "",
        detail.input as Record<string, JsonValue>,
        context,
      );
      this.messages = [
        successMessage(
          `${result.command.label ?? titleCaseIdentifier(result.command.name)} completed.`,
        ),
      ];
      await this.refreshRecords();
      this.render();
    });
  };

  private readonly handlePresentationCalendarNavigate = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationCalendarNavigateDetail>).detail;
    if (detail === undefined || detail.state.length === 0 || detail.value.length === 0) {
      return;
    }

    void this.runCommand(async () => {
      await this.refreshPresentationView({ [detail.state]: `${detail.value}-01` });
      this.render();
    });
  };

  private readonly handlePresentationRecordSelect = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationRecordSelectDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      const record = await this.runtime.read(detail.objectName, detail.recordId, context);
      if (record === null) {
        return;
      }

      this.setEditTarget(detail.objectName);

      this.mode = "edit";
      this.selectedRecord = record;
      this.editContainerOpen = true;
      this.draftValues = {};
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      await this.refreshEditSurface();
      this.render();
    });
  };

  private async openCreateFromPresentationAction(detail: PresentationActionDetail): Promise<void> {
    await this.runCommand(async () => {
      const targetView =
        detail.create?.view === undefined ? undefined : this.findView(detail.create.view)?.view;
      const targetObject =
        detail.create?.object === undefined
          ? undefined
          : this._model.objects.find((object) => object.name === detail.create?.object);
      const targetObjectView =
        targetObject === undefined
          ? undefined
          : (targetObject.views.find((view) => view.kind === "list") ?? targetObject.views[0]);

      if (targetView !== undefined) {
        this.viewName = targetView.name;
      } else if (targetObjectView !== undefined && targetObject?.name !== this.activeObject.name) {
        this.viewName = targetObjectView.name;
      }

      this.mode = "create";
      this.selectedRecord = undefined;
      this.editContainerOpen = true;
      this.draftValues = detail.input as Record<string, JsonValue>;
      this.stagedChildChanges = [];
      this.fieldIssues = [];
      this.messages = [];
      if (this.activeView.presentation === undefined) {
        await this.refreshRecords();
      } else {
        await this.refreshPresentationView();
      }
      await this.refreshEditSurface();
      this.render();
    });
  }

  private readonly handlePresentationMatrixCycle = (event: Event): void => {
    const detail = (event as CustomEvent<PresentationMatrixCellCycleDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      await this.runtime.cyclePresentationMatrixCell({
        objectName: this.activeObject.name,
        viewName: this.activeView.name,
        matrixName: detail.matrix,
        rowKey: detail.rowKey,
        columnKey: detail.columnKey,
        context,
      });
      await this.refreshRecords();
      await this.refreshPresentationView();
      this.render();
    });
  };

  private readonly handleOnlineStateChange = (): void => {
    this.applyBrowserOnlineState(true);
  };

  private applyBrowserOnlineState(renderAfterChange: boolean): void {
    if (!this.useBrowserOnlineState) {
      return;
    }

    const online = getBrowserOnlineState();
    if (online === undefined) {
      return;
    }

    this._context = { ...this._context, online };
    if (renderAfterChange && this.initialized) {
      this.render();
    }
  }

  set model(model: ResolvedApplicationModel) {
    this._model = model;
    this._runtime = undefined;
    this.seeded = false;
    this.presentationView = undefined;
    this.presentationStateByView = new Map();
    this.editSurface = undefined;
    this.stagedChildChanges = [];
    this.editContainerOpen = false;
    this.selectedRecord = undefined;
    this.clearEditTarget();

    if (this.initialized) {
      this.readyPromise = this.initialize();
    } else {
      this.applyThemeTokens();
    }
  }

  get model(): ResolvedApplicationModel {
    return this._model;
  }

  set runtime(runtime: ApplicationRuntime | undefined) {
    this._runtime = runtime;
    this.seeded = runtime !== undefined;
    this.presentationView = undefined;
    this.presentationStateByView = new Map();
    this.editSurface = undefined;
    this.stagedChildChanges = [];
    this.editContainerOpen = false;
    this.selectedRecord = undefined;
    this.clearEditTarget();
  }

  get runtime(): ApplicationRuntime {
    if (this._runtime === undefined) {
      this._runtime = browserPersistenceAvailable()
        ? createPersistentBrowserDemoRuntime(this._model)
        : new ApplicationRuntime(this._model);
    }

    return this._runtime;
  }

  set context(context: RuntimeContext) {
    this._context = context;
    this.useBrowserOnlineState = context.online === undefined;
    this.selectedContextIds = { ...(context.selectedContexts ?? {}) };
  }

  get context(): RuntimeContext {
    return this._context;
  }

  /**
   * The authority connection, when one is configured. With no bridge the shell
   * renders no session, invite or recovery chrome at all: a purely local demo
   * has no identity to present and no server verdict to recover from.
   */
  set authority(authority: AdlAuthorityBridge | undefined) {
    this._authority = authority;
    if (this.initialized) {
      this.render();
    }
  }

  get authority(): AdlAuthorityBridge | undefined {
    return this._authority;
  }

  /** Re-renders session, invite and recovery chrome after the bridge's state changed. */
  refreshAuthorityState(): void {
    if (this.initialized) {
      this.render();
    }
  }

  private async runAuthorityAction(action: () => Promise<void>): Promise<void> {
    this.authorityBusy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
    } finally {
      this.authorityBusy = false;
    }
    // Records may have moved underneath the UI: a claim grants a context, and a
    // resolution rewrites the record the authority holds.
    await this.refreshFromRuntime();
    this.render();
  }

  connectedCallback(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.addEventListener("adl-search", this.handleSearch);
    this.addEventListener("adl-select-record", this.handleSelect);
    this.addEventListener("adl-new-record", this.handleNew);
    this.addEventListener("adl-draft-record", this.handleDraft);
    this.addEventListener("adl-save-record", this.handleSave);
    this.addEventListener("adl-delete-record", this.handleDelete);
    this.addEventListener("adl-cancel-record", this.handleCancel);
    this.addEventListener("adl-transition-record", this.handleTransition);
    this.addEventListener("adl-stage-child-operation", this.handleStageChildOperation);
    this.addEventListener("adl-select-context", this.handleContextSelection);
    this.addEventListener("adl-presentation-state-change", this.handlePresentationStateChange);
    this.addEventListener("adl-presentation-action", this.handlePresentationAction);
    this.addEventListener("adl-presentation-calendar-nav", this.handlePresentationCalendarNavigate);
    this.addEventListener("adl-presentation-record-select", this.handlePresentationRecordSelect);
    this.addEventListener("adl-presentation-matrix-cycle", this.handlePresentationMatrixCycle);
    this.addEventListener("change", this.handleChange);
    this.addEventListener("click", this.handleClick);
    this.addEventListener(ADL_SIGN_IN_EVENT, this.handleSignIn);
    this.addEventListener(ADL_REGISTER_PASSKEY_EVENT, this.handleRegisterPasskey);
    this.addEventListener(ADL_REFRESH_DEVICES_EVENT, this.handleRefreshDevices);
    this.addEventListener(ADL_REVOKE_DEVICE_EVENT, this.handleRevokeDevice);
    this.addEventListener(ADL_PASSKEY_SIGN_IN_EVENT, this.handlePasskeySignIn);
    this.addEventListener(ADL_SIGN_OUT_EVENT, this.handleSignOut);
    this.addEventListener(ADL_CLAIM_INVITE_EVENT, this.handleClaimInvite);
    this.addEventListener(ADL_RESOLVE_RECOVERY_EVENT, this.handleResolveRecovery);
    this.addEventListener(ADL_RETRY_DELIVERY_EVENT, this.handleRetryDelivery);
    document.addEventListener("keydown", this.handleKeyDown);
    globalThis.addEventListener?.("beforeinstallprompt", this.handleInstallPrompt);
    addBrowserOnlineListeners(this.handleOnlineStateChange);
    this.readyPromise = this.initialize();
  }

  disconnectedCallback(): void {
    this.removeEventListener("adl-search", this.handleSearch);
    this.removeEventListener("adl-select-record", this.handleSelect);
    this.removeEventListener("adl-new-record", this.handleNew);
    this.removeEventListener("adl-draft-record", this.handleDraft);
    this.removeEventListener("adl-save-record", this.handleSave);
    this.removeEventListener("adl-delete-record", this.handleDelete);
    this.removeEventListener("adl-cancel-record", this.handleCancel);
    this.removeEventListener("adl-transition-record", this.handleTransition);
    this.removeEventListener("adl-stage-child-operation", this.handleStageChildOperation);
    this.removeEventListener("adl-select-context", this.handleContextSelection);
    this.removeEventListener("adl-presentation-state-change", this.handlePresentationStateChange);
    this.removeEventListener("adl-presentation-action", this.handlePresentationAction);
    this.removeEventListener(
      "adl-presentation-calendar-nav",
      this.handlePresentationCalendarNavigate,
    );
    this.removeEventListener("adl-presentation-record-select", this.handlePresentationRecordSelect);
    this.removeEventListener("adl-presentation-matrix-cycle", this.handlePresentationMatrixCycle);
    this.removeEventListener("change", this.handleChange);
    this.removeEventListener("click", this.handleClick);
    this.removeEventListener(ADL_SIGN_IN_EVENT, this.handleSignIn);
    this.removeEventListener(ADL_REGISTER_PASSKEY_EVENT, this.handleRegisterPasskey);
    this.removeEventListener(ADL_REFRESH_DEVICES_EVENT, this.handleRefreshDevices);
    this.removeEventListener(ADL_REVOKE_DEVICE_EVENT, this.handleRevokeDevice);
    this.removeEventListener(ADL_PASSKEY_SIGN_IN_EVENT, this.handlePasskeySignIn);
    this.removeEventListener(ADL_SIGN_OUT_EVENT, this.handleSignOut);
    this.removeEventListener(ADL_CLAIM_INVITE_EVENT, this.handleClaimInvite);
    this.removeEventListener(ADL_RESOLVE_RECOVERY_EVENT, this.handleResolveRecovery);
    this.removeEventListener(ADL_RETRY_DELIVERY_EVENT, this.handleRetryDelivery);
    document.removeEventListener("keydown", this.handleKeyDown);
    globalThis.removeEventListener?.("beforeinstallprompt", this.handleInstallPrompt);
    removeBrowserOnlineListeners(this.handleOnlineStateChange);
    this.initialized = false;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Re-reads the active view from the runtime after data changed underneath the
   * UI, such as records reconciled by an authority sync. It is a no-op before
   * the element is initialised.
   */
  async refreshFromRuntime(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.runCommand(async () => {
      if (this.activeView.presentation === undefined) {
        await this.refreshRecords();
      } else {
        await this.refreshPresentationView();
      }
      await this.refreshEditSurface();
      this.render();
    });
  }

  private async initialize(): Promise<void> {
    this.viewName = this.findStartView().name;
    this.applyBrowserOnlineState(false);
    this.applyThemeTokens();
    this.renderLoading();

    try {
      if (!this.seeded) {
        await seedBrowserDemoRuntimeIfEmpty(this.runtime, this._model, this._context);
        this.seeded = true;
      }
      await this.refreshAvailableContexts();
      await this.refreshRecords();
      this.render();
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
      this.render();
    }
  }

  private async refreshRecords(preferredRecordId?: string): Promise<void> {
    const object = this.activeObject;
    const view = this.activeView;
    const readModel = this.activeReadModel;
    const viewContext = await this.resolveActiveViewContext(view.context ?? readModel?.context);
    this.activeRuntimeContext = viewContext.context;
    this.activeViewEmptyState = viewContext.emptyState;

    if (viewContext.context === undefined) {
      this.records = [];
      this.readModelRows = [];
      this.presentationView = undefined;
      this.selectedRecord = undefined;
      this.editContainerOpen = false;
      this.mode = "create";
      return;
    }

    if (view.presentation !== undefined) {
      await this.refreshPresentationView();
      this.records = [];
      this.readModelRows = [];
      this.selectedRecord = undefined;
      this.editContainerOpen = false;
      this.mode = "edit";
      return;
    }

    this.presentationView = undefined;

    if (readModel !== undefined) {
      const result = await this.runtime.executeReadModel(readModel.name, viewContext.context, {
        sort: view.sort.length > 0 ? view.sort : readModel.sort,
      });
      this.records = [];
      this.readModelRows = result.rows;
      this.selectedRecord = undefined;
      this.editContainerOpen = false;
      this.mode = "edit";
      return;
    }

    this.readModelRows = [];
    this.records = await this.runtime.search(
      object.name,
      {
        text: this.searchText,
        ...(view.searchFields.length > 0 ? { fields: view.searchFields } : {}),
        ...(view.sort.length > 0 ? { sort: view.sort } : {}),
      },
      viewContext.context,
    );

    if (this.activeEditContainer === "splitPane") {
      const recordIds = new Set(this.records.map((record) => record.meta.guid));
      const currentRecordId = this.selectedRecord?.meta.guid;
      const retainedRecordId =
        currentRecordId !== undefined && recordIds.has(currentRecordId)
          ? currentRecordId
          : undefined;
      const nextRecordId = preferredRecordId ?? retainedRecordId;
      const selected =
        nextRecordId === undefined
          ? this.records[0]
          : ((await this.runtime.read(object.name, nextRecordId, viewContext.context)) ??
            this.records[0]);

      this.selectedRecord = selected;
      this.editContainerOpen = true;
      this.mode = selected === undefined ? "create" : "edit";
      await this.refreshEditSurface();
      return;
    }

    if (preferredRecordId !== undefined) {
      this.selectedRecord =
        (await this.runtime.read(object.name, preferredRecordId, viewContext.context)) ?? undefined;
      this.mode = this.selectedRecord === undefined ? "create" : "edit";
      if (this.editContainerOpen) {
        await this.refreshEditSurface();
      }
      return;
    }

    if (!this.editContainerOpen) {
      this.selectedRecord = undefined;
      this.mode = "edit";
      return;
    }

    if (this.mode === "edit" && this.selectedRecord !== undefined) {
      this.selectedRecord =
        (await this.runtime.read(
          object.name,
          this.selectedRecord.meta.guid,
          viewContext.context,
        )) ?? undefined;
      if (this.selectedRecord === undefined) {
        this.editContainerOpen = false;
      }
      await this.refreshEditSurface();
    }
  }

  private async refreshPresentationView(updates: Record<string, JsonValue> = {}): Promise<void> {
    const context = this.requireActiveRuntimeContext();
    const object = this.activeObject;
    const view = this.activeView;
    const stateKey = this.presentationStateKey(object, view);
    const currentState = this.presentationStateByView.get(stateKey);
    const presentation = await this.runtime.evaluatePresentationView(
      object.name,
      view.name,
      context,
      {
        ...(currentState === undefined ? {} : { state: currentState }),
        ...(Object.keys(updates).length === 0 ? {} : { updates }),
      },
    );

    this.presentationStateByView.set(stateKey, { ...presentation.state });
    this.presentationView = presentation;
  }

  private async refreshEditSurface(): Promise<void> {
    if (!this.editContainerOpen) {
      this.editSurface = undefined;
      return;
    }

    const context = this.requireActiveRuntimeContext();
    const editObject = this.editObject;
    const editFormView = this.editFormView;
    this.editSurface = await this.runtime.evaluateEditSurface(
      editObject.name,
      editFormView.name,
      context,
      {
        mode: this.mode,
        ...(this.selectedRecord === undefined ? {} : { recordId: this.selectedRecord.meta.guid }),
        stagedChanges: this.stagedChildChanges,
      },
    );
  }

  private async applyPendingChildChanges(
    parentRecordId: string,
    context: RuntimeContext,
  ): Promise<void> {
    if (this.stagedChildChanges.length === 0) {
      return;
    }

    await this.runtime.applyStagedChildChanges({
      objectName: this.editObject.name,
      viewName: this.editFormView.name,
      parentRecordId,
      context,
      stagedChanges: this.stagedChildChanges,
    });
  }

  private async runCommand(command: () => Promise<void>): Promise<void> {
    try {
      await command();
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
      this.fieldIssues =
        error instanceof RuntimeValidationError ? [...error.issues] : this.fieldIssues;
      this.render();
      return;
    }

    await this.deliverPendingWrites();
  }

  /**
   * Sends the queued work that may not wait for the next synchronise. Every
   * mutating action runs through `runCommand`, so this is the one place a write
   * of an `onlineRequired` object is followed by the delivery its mode implies —
   * rather than each handler having to remember.
   *
   * It never rethrows: the local write has already been accepted, and a
   * delivery failure is surfaced as an undelivered change rather than as a
   * failed save. The re-entrancy guard matters because the refresh below itself
   * runs through `runCommand`.
   */
  private async deliverPendingWrites(): Promise<void> {
    const bridge = this._authority;
    if (bridge === undefined || this.deliveringWrites) {
      return;
    }

    // Only work that must go now, and has not already failed to. Without this
    // every refresh would call the bridge, and an entry the user has already
    // been shown as undelivered would be retried on each render instead of when
    // they ask or when the app next synchronises.
    const pending = this.runtime.syncQueue
      .getReplayable()
      .some(
        (entry) => entry.delivery === undefined && requiresImmediateDelivery(entry.objectSync.mode),
      );
    if (!pending) {
      return;
    }

    this.deliveringWrites = true;
    try {
      // Only an answered operation changed a record, so nothing is re-read when
      // there was nothing to send.
      if ((await bridge.deliverPending()) > 0) {
        await this.refreshFromRuntime();
      }
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
      this.render();
    } finally {
      this.deliveringWrites = false;
    }
  }

  private get activeEditContainer(): EditContainerMode {
    return this.activeView.editContainer;
  }

  private closeEditContainer(clearMessages: boolean): void {
    this.editContainerOpen = false;
    this.selectedRecord = undefined;
    this.mode = "edit";
    this.draftValues = {};
    this.stagedChildChanges = [];
    this.editSurface = undefined;
    this.clearEditTarget();
    this.fieldIssues = [];
    if (clearMessages) {
      this.messages = [];
    }
  }

  private renderLoading(): void {
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

  private render(): void {
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

    this.applyThemeTokens();
    this.innerHTML = `
      <main class="${shellClass}">
        <header class="${topbarClass}">
          <button
            class="adl-menu-action"
            type="button"
            aria-label="${this.navDrawerOpen ? "Close navigation menu" : "Open navigation menu"}"
            aria-controls="adl-nav-drawer"
            aria-expanded="${this.navDrawerOpen ? "true" : "false"}"
            data-shell-menu="true"
          >
            <span aria-hidden="true"></span>
          </button>
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
                  ? this.renderCrudWorkspace(view)
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
      syncRecovery.busy = this.authorityBusy;
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

  private applyThemeTokens(): void {
    applyResolvedTheme(this, findApplicationTheme(this._model));
  }

  /**
   * Session, invite and recovery chrome exists only when an authority is
   * configured. A purely local demo has no identity to present and no server
   * verdict to recover from, so it renders none of this.
   */
  private renderAuthorityChrome(): string {
    if (this._authority === undefined) {
      return "";
    }

    return `
      <section class="adl-authority-chrome" data-authority-chrome="true">
        <adl-session-panel></adl-session-panel>
        ${
          // Only a signed-in caller has sessions to list, and only the authority
          // can answer for them; signed out there is nothing to show and nothing
          // to revoke.
          this._authority.session.status === "signedIn"
            ? "<adl-session-devices></adl-session-devices>"
            : ""
        }
        <adl-sync-recovery></adl-sync-recovery>
      </section>
    `;
  }

  private renderContextSelectors(): string {
    if (this._model.shell.topBar.contextSelector === "hidden") {
      return "";
    }

    return this.navigableContexts
      .map(
        (context) =>
          `<adl-context-selector data-context-name="${escapeHtml(context.name)}" data-mobile-mode="${escapeHtml(
            this._model.shell.topBar.mobileContextSelector,
          )}"></adl-context-selector>`,
      )
      .join("");
  }

  private renderTopBarControls(): string {
    return this._model.shell.topBar.controls
      .map((controlName) =>
        this._model.shell.controls.find((control) => control.name === controlName),
      )
      .filter((control): control is ResolvedShellControl => control !== undefined)
      .filter((control) => control.placement === "topBar" && this.isShellControlVisible(control))
      .map((control) => this.renderShellControl(control))
      .join("");
  }

  private renderShellControl(control: ResolvedShellControl): string {
    if (control.kind === "contextSelector") {
      return this.renderContextSelectors();
    }

    if (control.kind === "syncStatus") {
      const online = this._context.online ?? true;
      return `
        <span
          class="adl-shell-status ${online ? "adl-shell-status-online" : "adl-shell-status-offline"}"
          data-shell-control="${escapeHtml(control.name)}"
          data-shell-control-kind="syncStatus"
        >${escapeHtml(online ? "Online" : "Offline")}</span>
      `;
    }

    const label = control.label ?? titleCaseIdentifier(control.name);
    // `logout` needs a session to end, and `pwaInstall` needs the user agent to
    // have offered installation. Anything else still has no runtime behind it.
    const action =
      control.kind === "logout"
        ? "sign-out"
        : control.kind === "pwaInstall" && this.installPrompt !== undefined
          ? "install"
          : undefined;
    const available =
      action === undefined
        ? false
        : action === "install" || this._authority?.session.status === "signedIn";
    return `
      <button
        class="adl-shell-control${available ? "" : " adl-shell-control-unavailable"}"
        type="button"
        data-shell-control="${escapeHtml(control.name)}"
        data-shell-control-kind="${escapeHtml(control.kind)}"
        ${available ? `data-shell-action="${escapeHtml(action ?? "")}"` : "disabled"}
        title="${escapeHtml(available ? label : `${label} is not available in this runtime.`)}"
      >
        ${
          control.icon === undefined
            ? ""
            : `<span aria-hidden="true" data-shell-icon="${escapeHtml(control.icon)}">${escapeHtml(
                iconGlyph(control.icon),
              )}</span>`
        }
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  private renderCrudWorkspace(view: ResolvedView): string {
    const editContainer = view.editContainer;

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

  private renderNavigationDrawer(activeView: ResolvedView): string {
    const activeViewName = activeView.name;
    const navGroups = groupNavItems(this.visibleNavItems);
    return `
      <button
        class="adl-nav-overlay ${this.navDrawerOpen ? "active" : ""}"
        type="button"
        aria-label="Close navigation menu"
        data-shell-overlay="true"
      ></button>
      <nav
        id="adl-nav-drawer"
        class="adl-nav-drawer ${this.navDrawerOpen ? "active" : ""}"
        aria-label="Application navigation"
      >
        <div class="adl-nav-drawer-header">
          <span>${escapeHtml(this._model.app.name)}</span>
        </div>
        <div class="adl-nav-list">
          ${navGroups
            .map(
              (group) => `
                ${
                  group.name === undefined
                    ? ""
                    : `<div class="adl-nav-group" data-nav-group="${escapeHtml(group.name)}">${escapeHtml(
                        group.name,
                      )}</div>`
                }
                ${group.items
                  .map((item) => {
                    const active = item.activeWhen.includes(activeViewName);
                    const owner = this.findView(item.view)?.object.name;
                    return `
                      <button
                        class="adl-nav-item ${active ? "active" : ""}"
                        type="button"
                        data-view-nav="${escapeHtml(item.view)}"
                        data-nav-item="${escapeHtml(item.name)}"
                        ${active ? 'aria-current="page"' : ""}
                      >
                        ${
                          item.icon === undefined
                            ? ""
                            : `<span class="adl-nav-icon" aria-hidden="true" data-shell-icon="${escapeHtml(
                                item.icon,
                              )}">${escapeHtml(iconGlyph(item.icon))}</span>`
                        }
                        <span>${escapeHtml(item.label)}</span>
                        <small>${escapeHtml(
                          owner === undefined ? item.view : titleCaseIdentifier(owner),
                        )}</small>
                      </button>
                    `;
                  })
                  .join("")}
              `,
            )
            .join("")}
        </div>
      </nav>
    `;
  }

  private async refreshAvailableContexts(): Promise<void> {
    const nextAvailableContexts = new Map<string, RuntimeAvailableContext[]>();

    for (const contextModel of this.navigableContexts) {
      const available = await this.runtime.listAvailableContexts(contextModel.name, this._context);
      nextAvailableContexts.set(contextModel.name, available);
      const requested = this.resolveRequestedContextId(contextModel);

      if (requested !== undefined) {
        if (available.some((candidate) => candidate.id === requested)) {
          this.setSelectedContextId(contextModel.name, requested, true);
          continue;
        }

        this.setSelectedContextId(contextModel.name, undefined, true);
        this.messages = [
          infoMessage(`${titleCaseIdentifier(contextModel.name)} selection was cleared.`, [
            `Context '${requested}' is no longer available to this user.`,
          ]),
        ];
      }

      if (
        this.selectedContextIds[contextModel.name] === undefined &&
        contextModel.selection.autoSelect &&
        available.length === 1
      ) {
        this.setSelectedContextId(contextModel.name, available[0]?.id, true);
      }
    }

    this.availableContexts = nextAvailableContexts;
  }

  private resolveRequestedContextId(contextModel: ResolvedBusinessContext): string | undefined {
    const routeContextId =
      contextModel.selection.source === "route" ? this.readRouteContextId(contextModel) : undefined;
    return (
      routeContextId ??
      this.selectedContextIds[contextModel.name] ??
      this.readPersistedContextId(contextModel)
    );
  }

  private async resolveActiveViewContext(
    viewContext: ResolvedViewContext | undefined,
  ): Promise<ActiveViewContextState> {
    if (viewContext === undefined || viewContext.mode === "none") {
      return { context: this.baseRuntimeContext() };
    }

    const contextName = viewContext.context;
    if (contextName === undefined) {
      return { context: this.baseRuntimeContext() };
    }

    const contextModel = this._model.contexts?.find((candidate) => candidate.name === contextName);
    const available = this.availableContexts.get(contextName) ?? [];

    if (viewContext.mode === "all") {
      if (available.length === 0) {
        return {
          emptyState: `No ${titleCaseIdentifier(contextName)} contexts are available for this view.`,
        };
      }

      const contextRoles = await this.runtime.contextService.resolveContextRoles(
        contextName,
        this.baseRuntimeContextWithoutSelected(contextName),
      );
      return {
        context: this.withContextRoles(
          this.baseRuntimeContextWithoutSelected(contextName),
          contextName,
          contextRoles,
        ),
      };
    }

    const selectedContextId = this.selectedContextIds[contextName];
    if (selectedContextId === undefined) {
      if (viewContext.mode === "required") {
        return {
          emptyState:
            available.length === 0
              ? `No ${titleCaseIdentifier(contextName)} contexts are available for this view.`
              : `Choose a ${titleCaseIdentifier(contextName)} context to open this view.`,
        };
      }

      return { context: this.baseRuntimeContext() };
    }

    if (contextModel === undefined) {
      return { context: this.baseRuntimeContext() };
    }

    return {
      context: await this.runtime.withSelectedContext(
        contextModel.name,
        selectedContextId,
        this.baseRuntimeContextWithoutSelected(contextModel.name),
      ),
    };
  }

  private setSelectedContextId(
    contextName: string,
    contextId: string | undefined,
    persist: boolean,
  ): void {
    this.selectedContextIds = {
      ...this.selectedContextIds,
      ...(contextId === undefined ? {} : { [contextName]: contextId }),
    };

    if (contextId === undefined) {
      delete this.selectedContextIds[contextName];
    }

    if (!persist) {
      return;
    }

    const contextModel = this._model.contexts?.find((context) => context.name === contextName);
    if (contextModel !== undefined) {
      this.persistContextSelection(contextModel, contextId);
    }
  }

  private persistContextSelection(
    contextModel: ResolvedBusinessContext,
    contextId: string | undefined,
  ): void {
    const key = this.contextStorageKey(contextModel.name);
    if (contextModel.selection.persistence === "session") {
      writeStorageValue(globalThis.sessionStorage, key, contextId);
      return;
    }

    if (contextModel.selection.persistence === "local") {
      writeStorageValue(globalThis.localStorage, key, contextId);
      return;
    }

    writeStorageValue(globalThis.sessionStorage, key, undefined);
    writeStorageValue(globalThis.localStorage, key, undefined);
  }

  private readPersistedContextId(contextModel: ResolvedBusinessContext): string | undefined {
    const key = this.contextStorageKey(contextModel.name);
    const storage =
      contextModel.selection.persistence === "session"
        ? globalThis.sessionStorage
        : contextModel.selection.persistence === "local"
          ? globalThis.localStorage
          : undefined;

    const value = readStorageValue(storage, key);
    return value === null || value.length === 0 ? undefined : value;
  }

  private readRouteContextId(contextModel: ResolvedBusinessContext): string | undefined {
    const search = globalThis.location?.search;
    if (search === undefined || search.length === 0) {
      return undefined;
    }

    const routeParam = contextModel.selection.routeParam ?? contextModel.name;
    const value = new URLSearchParams(search).get(routeParam);
    return value === null || value.length === 0 ? undefined : value;
  }

  private contextStorageKey(contextName: string): string {
    return `adl:${this._model.app.name}:context:${contextName}`;
  }

  private requireActiveRuntimeContext(): RuntimeContext {
    if (this.activeRuntimeContext === undefined) {
      throw new Error("The active view does not have a runtime context.");
    }

    return this.activeRuntimeContext;
  }

  private applySelectedScopeToCreateValues(
    values: SaveRecordDetail["values"],
    object: ResolvedObject = this.editObject,
  ): SaveRecordDetail["values"] {
    if (object.scope === undefined) {
      return values;
    }

    const selectedContextId = this.selectedContextIds[object.scope.context];
    if (selectedContextId === undefined || values[object.scope.field] !== undefined) {
      return values;
    }

    return {
      ...values,
      [object.scope.field]: selectedContextId,
    };
  }

  private setEditTarget(objectName: string, viewName?: string): void {
    this.editObjectName = objectName;
    this.editViewName = viewName;
  }

  private clearEditTarget(): void {
    this.editObjectName = undefined;
    this.editViewName = undefined;
  }

  private baseRuntimeContext(): RuntimeContext {
    return {
      ...this._context,
      roles: [...this._context.roles],
      selectedContexts: { ...this.selectedContextIds },
      ...(this._context.contextRoles === undefined
        ? {}
        : { contextRoles: this._context.contextRoles.map((role) => ({ ...role })) }),
      ...(this._context.groups === undefined ? {} : { groups: cloneGroups(this._context.groups) }),
    };
  }

  private baseRuntimeContextWithoutSelected(contextName: string): RuntimeContext {
    const context = this.baseRuntimeContext();
    const selectedContexts = { ...(context.selectedContexts ?? {}) };
    delete selectedContexts[contextName];

    return {
      ...context,
      selectedContexts,
      contextRoles: (context.contextRoles ?? []).filter((role) => role.context !== contextName),
    };
  }

  private withContextRoles(
    context: RuntimeContext,
    contextName: string,
    contextRoles: RuntimeContextRole[],
  ): RuntimeContext {
    return {
      ...context,
      contextRoles: [
        ...(context.contextRoles ?? []).filter((role) => role.context !== contextName),
        ...contextRoles.map((role) => ({ ...role })),
      ],
    };
  }

  private findStartView(): ResolvedView {
    const startView = this._model.app.startView;
    return this.findView(startView)?.view ?? this.allViews[0]?.view ?? failNoViews("application");
  }

  private get activeObject(): ResolvedObject {
    return this.findView(this.activeView.name)?.object ?? failNoObjects();
  }

  private get activeView(): ResolvedView {
    return this.findView(this.viewName)?.view ?? this.findStartView();
  }

  private get activeReadModel(): ResolvedReadModel | undefined {
    const readModelName = this.activeView.readModel;
    return readModelName === undefined ? undefined : this.findReadModel(readModelName);
  }

  private get editObject(): ResolvedObject {
    if (this.editObjectName !== undefined) {
      return (
        this._model.objects.find((object) => object.name === this.editObjectName) ??
        this.activeObject
      );
    }

    return this.activeObject;
  }

  private get editFormView(): ResolvedView {
    const editObject = this.editObject;
    const explicitView =
      this.editViewName === undefined ? undefined : this.findView(this.editViewName);
    if (explicitView !== undefined && explicitView.object.name === editObject.name) {
      return explicitView.view;
    }

    return (
      editObject.views.find((view) => view.kind === "form" || view.kind === "detail") ??
      editObject.views[0] ??
      failNoViews(editObject.name)
    );
  }

  private get allViews(): { object: ResolvedObject; view: ResolvedView }[] {
    return this._model.objects.flatMap((object) =>
      object.views.map((view) => ({
        object,
        view,
      })),
    );
  }

  private get visibleNavItems(): ResolvedShellNavItem[] {
    return this._model.shell.nav.items.filter((item) =>
      this.isShellVisibilityVisible(item.visibility),
    );
  }

  private isShellControlVisible(control: ResolvedShellControl): boolean {
    if (!this.isShellVisibilityVisible(control.visibility)) {
      return false;
    }

    if (control.kind === "contextSelector") {
      return this._model.shell.topBar.contextSelector === control.placement;
    }

    return true;
  }

  private isShellVisibilityVisible(visibility: ResolvedShellNavItem["visibility"]): boolean {
    if (visibility.kind === "always") {
      return true;
    }

    if (visibility.kind === "online") {
      return this._context.online !== false;
    }

    if (visibility.kind === "offline") {
      return this._context.online === false;
    }

    const contextName = visibility.context;
    if (contextName === undefined) {
      return false;
    }

    if (visibility.kind === "contextAvailable") {
      return (this.availableContexts.get(contextName) ?? []).length > 0;
    }

    return this.selectedContextIds[contextName] !== undefined;
  }

  private get navigableContexts(): ResolvedBusinessContext[] {
    const contextNames = new Set(
      [
        ...this.allViews.map(({ view }) => view.context),
        ...(this._model.readModels ?? []).map((readModel) => readModel.context),
      ]
        .filter(
          (context): context is NonNullable<ResolvedView["context"]> =>
            context !== undefined && context.mode !== "none" && context.context !== undefined,
        )
        .map((context) => context.context),
    );

    return (this._model.contexts ?? []).filter((context) => contextNames.has(context.name));
  }

  private findView(viewName: string): { object: ResolvedObject; view: ResolvedView } | undefined {
    return this.allViews.find(({ view }) => view.name === viewName);
  }

  private findReadModel(readModelName: string): ResolvedReadModel | undefined {
    return this._model.readModels?.find((readModel) => readModel.name === readModelName);
  }

  private presentationStateKey(object: ResolvedObject, view: ResolvedView): string {
    return `${object.name}:${view.name}`;
  }
}

export function defineAdlApp(): void {
  if (customElements.get("adl-app") === undefined) {
    customElements.define("adl-app", AdlAppElement);
  }
}

function failNoObjects(): never {
  throw new Error("Resolved model does not contain any objects.");
}

function failNoViews(objectName: string): never {
  throw new Error(`Object '${objectName}' does not contain any views.`);
}

function browserPersistenceAvailable(): boolean {
  return globalThis.indexedDB !== undefined;
}

function getBrowserOnlineState(): boolean | undefined {
  return globalThis.navigator?.onLine;
}

function addBrowserOnlineListeners(listener: () => void): void {
  globalThis.addEventListener?.("online", listener);
  globalThis.addEventListener?.("offline", listener);
}

function removeBrowserOnlineListeners(listener: () => void): void {
  globalThis.removeEventListener?.("online", listener);
  globalThis.removeEventListener?.("offline", listener);
}

function groupNavItems(
  items: ResolvedShellNavItem[],
): { name: string | undefined; items: ResolvedShellNavItem[] }[] {
  const groups = new Map<string, ResolvedShellNavItem[]>();

  for (const item of items) {
    const groupName = item.group ?? "";
    groups.set(groupName, [...(groups.get(groupName) ?? []), item]);
  }

  return [...groups.entries()].map(([name, groupItems]) => ({
    name: name.length === 0 ? undefined : name,
    items: groupItems,
  }));
}

function iconGlyph(icon: string): string {
  switch (icon) {
    case "home":
      return "H";
    case "music":
      return "M";
    case "calendar":
      return "C";
    case "mic":
    case "microphone":
      return "R";
    case "list":
      return "L";
    case "users":
      return "U";
    case "sync":
      return "S";
    case "log-out":
    case "logout":
      return "O";
    default:
      return "";
  }
}

function readStorageValue(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageValue(
  storage: Storage | undefined,
  key: string,
  value: string | undefined,
): void {
  try {
    if (value === undefined) {
      storage?.removeItem(key);
      return;
    }

    storage?.setItem(key, value);
  } catch {
    return;
  }
}

function cloneGroups(groups: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(groups).map(([group, roles]) => [group, [...roles]]));
}
