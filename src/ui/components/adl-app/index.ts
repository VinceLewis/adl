import type { ResolvedApplicationModel } from "../../../model/resolved-model.js";
import {
  ADL_CLAIM_INVITE_EVENT,
  ADL_DISCARD_REFUSED_RECORD_EVENT,
  ADL_EXPORT_REPORT_EVENT,
  ADL_LOAD_ADMINISTRATION_EVENT,
  ADL_LOAD_MORE_ADMINISTRATION_EVENT,
  ADL_LOAD_MORE_REPORT_EVENT,
  ADL_PASSKEY_SIGN_IN_EVENT,
  ADL_REFRESH_DEVICES_EVENT,
  ADL_REGISTER_PASSKEY_EVENT,
  ADL_RESOLVE_RECOVERY_EVENT,
  ADL_RETRY_DELIVERY_EVENT,
  ADL_REVOKE_DEVICE_EVENT,
  ADL_REVOKE_MEMBER_SESSIONS_EVENT,
  ADL_RUN_REPORT_EVENT,
  ADL_SIGN_IN_EVENT,
  ADL_SIGN_OUT_EVENT,
} from "../../authority-bridge.js";
import type { AdlAuthorityBridge } from "../../authority-bridge.js";
import {
  ADL_COMMAND_FORM_CANCEL_EVENT,
  ADL_COMMAND_FORM_SUBMIT_EVENT,
} from "../adl-command-form.js";
import { AdlAppRecordEventsElement } from "./events-record.js";

export class AdlAppElement extends AdlAppRecordEventsElement {
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
    this.activeThemeName = this.readPersistedThemeName(model);

    if (this.initialized) {
      this.readyPromise = this.initialize();
    } else {
      this.applyThemeTokens();
    }
  }

  get model(): ResolvedApplicationModel {
    return this._model;
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

  connectedCallback(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.appInstalled = this.appInstalled || isRunningAsInstalledPwa();
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
    this.addEventListener(ADL_COMMAND_FORM_SUBMIT_EVENT, this.handleCommandFormSubmit);
    this.addEventListener(ADL_COMMAND_FORM_CANCEL_EVENT, this.handleCommandFormCancel);
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
    this.addEventListener(ADL_DISCARD_REFUSED_RECORD_EVENT, this.handleDiscardRefusedRecord);
    this.addEventListener(ADL_LOAD_ADMINISTRATION_EVENT, this.handleLoadAdministration);
    this.addEventListener(ADL_LOAD_MORE_ADMINISTRATION_EVENT, this.handleLoadMoreAdministration);
    this.addEventListener(ADL_RUN_REPORT_EVENT, this.handleRunReport);
    this.addEventListener(ADL_LOAD_MORE_REPORT_EVENT, this.handleLoadMoreReport);
    this.addEventListener(ADL_EXPORT_REPORT_EVENT, this.handleExportReport);
    this.addEventListener(ADL_REVOKE_MEMBER_SESSIONS_EVENT, this.handleRevokeMemberSessions);
    document.addEventListener("keydown", this.handleKeyDown);
    globalThis.addEventListener?.("beforeinstallprompt", this.handleInstallPrompt);
    globalThis.addEventListener?.("appinstalled", this.handleAppInstalled);
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
    this.removeEventListener(ADL_COMMAND_FORM_SUBMIT_EVENT, this.handleCommandFormSubmit);
    this.removeEventListener(ADL_COMMAND_FORM_CANCEL_EVENT, this.handleCommandFormCancel);
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
    this.removeEventListener(ADL_DISCARD_REFUSED_RECORD_EVENT, this.handleDiscardRefusedRecord);
    this.removeEventListener(ADL_LOAD_ADMINISTRATION_EVENT, this.handleLoadAdministration);
    this.removeEventListener(ADL_LOAD_MORE_ADMINISTRATION_EVENT, this.handleLoadMoreAdministration);
    this.removeEventListener(ADL_RUN_REPORT_EVENT, this.handleRunReport);
    this.removeEventListener(ADL_LOAD_MORE_REPORT_EVENT, this.handleLoadMoreReport);
    this.removeEventListener(ADL_EXPORT_REPORT_EVENT, this.handleExportReport);
    this.removeEventListener(ADL_REVOKE_MEMBER_SESSIONS_EVENT, this.handleRevokeMemberSessions);
    document.removeEventListener("keydown", this.handleKeyDown);
    globalThis.removeEventListener?.("beforeinstallprompt", this.handleInstallPrompt);
    globalThis.removeEventListener?.("appinstalled", this.handleAppInstalled);
    removeBrowserOnlineListeners(this.handleOnlineStateChange);
    this.initialized = false;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}

/**
 * True when this device is already running the app installed, learned by a
 * means other than an `appinstalled` event fired during this session — the
 * case a returning user who installed on a previous visit hits on every load.
 * `display-mode: standalone` covers engines that support the manifest's
 * `display` field; `navigator.standalone` is Safari's older, iOS-only signal
 * for the same fact. Both are read defensively because neither exists in every
 * test or browser environment.
 */
function isRunningAsInstalledPwa(): boolean {
  const standaloneDisplayMode =
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true;
  const iosStandalone =
    (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true;

  return standaloneDisplayMode || iosStandalone;
}

function addBrowserOnlineListeners(listener: () => void): void {
  globalThis.addEventListener?.("online", listener);
  globalThis.addEventListener?.("offline", listener);
}

function removeBrowserOnlineListeners(listener: () => void): void {
  globalThis.removeEventListener?.("online", listener);
  globalThis.removeEventListener?.("offline", listener);
}
