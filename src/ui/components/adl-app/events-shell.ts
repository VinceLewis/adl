import { successMessage } from "../../runtime-error-messages.js";
import type { DiscardRefusedRecordDetail } from "../adl-sync-recovery.js";
import type {
  ClaimInviteDetail,
  LoadMoreAdministrationDetail,
  RegisterPasskeyDetail,
  ResolveRecoveryDetail,
  RetryDeliveryDetail,
  RevokeDeviceDetail,
  RevokeMemberSessionsDetail,
  RunReportDetail,
  SignInDetail,
} from "../../authority-bridge.js";
import { AdlAppDataElement } from "./data.js";
import type { InstallPromptEvent } from "./state.js";

export class AdlAppShellEventsElement extends AdlAppDataElement {
  protected readonly handleSignIn = (event: Event): void => {
    const detail = (event as CustomEvent<SignInDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signIn(detail.accountProof));
  };

  protected readonly handleRegisterPasskey = (event: Event): void => {
    const detail = (event as CustomEvent<RegisterPasskeyDetail>).detail;
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.registerPasskey(detail?.inviteToken));
  };

  protected readonly handlePasskeySignIn = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signInWithPasskey());
  };

  protected readonly handleRefreshDevices = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.refreshDevices());
  };

  protected readonly handleRevokeDevice = (event: Event): void => {
    const detail = (event as CustomEvent<RevokeDeviceDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.revokeDevice(detail.sessionId));
  };

  protected readonly handleSignOut = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.signOut());
  };

  protected readonly handleClaimInvite = (event: Event): void => {
    const detail = (event as CustomEvent<ClaimInviteDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.claimInvite(detail.inviteToken));
  };

  protected readonly handleResolveRecovery = (event: Event): void => {
    const detail = (event as CustomEvent<ResolveRecoveryDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.resolveRecovery(detail.queueId, detail.choice));
  };

  protected readonly handleRetryDelivery = (event: Event): void => {
    const detail = (event as CustomEvent<RetryDeliveryDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.retryDelivery(detail.queueId));
  };

  /**
   * Throws away a local row whose own create the authority refused.
   *
   * Deliberately not routed through the bridge: this settles nothing with the
   * authority and sends it nothing. It is a local delete the user asked for, so
   * it goes straight to the runtime like any other local write and never
   * appears alongside `keepServer` and `resubmitMine` as a third way to resolve
   * a verdict.
   */
  protected readonly handleDiscardRefusedRecord = (event: Event): void => {
    const detail = (event as CustomEvent<DiscardRefusedRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      await this.runtime.discardRefusedRecord(detail.objectName, detail.recordId, this.context);
      this.messages = [successMessage(`Discarded the refused local ${detail.objectName} record.`)];
      await this.refreshRecords();
      this.render();
    });
  };

  /*
   * Administration intent, forwarded to the bridge and nowhere else.
   *
   * The shell decides nothing here. It does not check a role, it does not hide a
   * surface because it believes the caller is unauthorised, and it never treats
   * an empty answer as a refusal — the authority derives identity, role and
   * scope for every one of these reads, and a denied row and an absent row come
   * back looking the same on purpose.
   */
  protected readonly handleLoadAdministration = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.loadAdministration());
  };

  protected readonly handleLoadMoreAdministration = (event: Event): void => {
    const detail = (event as CustomEvent<LoadMoreAdministrationDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.loadMoreAdministration(detail.list));
  };

  protected readonly handleRunReport = (event: Event): void => {
    const detail = (event as CustomEvent<RunReportDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.runReport(detail.readModelName));
  };

  protected readonly handleLoadMoreReport = (): void => {
    const bridge = this._authority;
    if (bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.loadMoreReport());
  };

  protected readonly handleExportReport = (event: Event): void => {
    const detail = (event as CustomEvent<RunReportDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.exportReport(detail.readModelName));
  };

  protected readonly handleRevokeMemberSessions = (event: Event): void => {
    const detail = (event as CustomEvent<RevokeMemberSessionsDetail>).detail;
    const bridge = this._authority;
    if (detail === undefined || bridge === undefined) {
      return;
    }

    void this.runAuthorityAction(() => bridge.revokeMemberSessions(detail.userId));
  };

  /** Chromium fires this before offering installation; other engines never do. */
  protected readonly handleInstallPrompt = (event: Event): void => {
    if (this.appInstalled) {
      // Already installed for this device; do not resurrect the control by
      // stashing a prompt event nothing will ever show a button for.
      return;
    }

    event.preventDefault();
    this.installPrompt = event as InstallPromptEvent;
    if (this.initialized) {
      this.render();
    }
  };

  /**
   * Fires once installation completes, however it was triggered — through this
   * shell's own control or the browser's own install affordance. The
   * `beforeinstallprompt` event it may have followed is spent either way, so
   * this also clears any stashed prompt rather than leaving a dangling
   * reference to an event that can no longer be used.
   */
  protected readonly handleAppInstalled = (): void => {
    this.appInstalled = true;
    this.installPrompt = undefined;
    if (this.initialized) {
      this.render();
    }
  };

  /**
   * The `pwaInstall` shell control's click handler. The stashed event is
   * cleared immediately, before the user has answered, because a
   * `beforeinstallprompt` event may only be prompted once regardless of the
   * outcome — a second click while the first is still pending must not call
   * `prompt()` again. `handleAppInstalled` is the source of truth for
   * `appInstalled`; an accepted choice here only re-renders so the control
   * reflects "not available" immediately rather than waiting on the browser's
   * `appinstalled` event, which some engines fire with a perceptible delay.
   */
  protected handleInstallClick(): void {
    const promptEvent = this.installPrompt;
    if (promptEvent === undefined) {
      return;
    }

    this.installPrompt = undefined;
    this.render();
    void this.runInstallPrompt(promptEvent);
  }

  private async runInstallPrompt(promptEvent: InstallPromptEvent): Promise<void> {
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        this.messages = [successMessage("Installing the app.")];
      }
    } catch {
      // A spent or otherwise unusable prompt event is not a runtime error; the
      // control has already returned to "not available" above.
    } finally {
      if (this.initialized) {
        this.render();
      }
    }
  }

  protected readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.dataset.themeSwitch === "true") {
      this.handleThemeSwitch(target.value);
      return;
    }

    if (target.dataset.viewSwitch !== "true") {
      return;
    }

    this.navigateToView(target.value);
  };

  /**
   * The `themeSwitch` shell control's `change` handler. Unlike record data,
   * the active theme is device presentation state, not something a runtime
   * write goes through — it takes effect immediately and is persisted
   * locally, the same way a business-context selection is.
   */
  private handleThemeSwitch(themeName: string): void {
    const theme = this._model.themes.find((candidate) => candidate.name === themeName);
    if (theme === undefined || theme.name === this.resolveActiveTheme().name) {
      return;
    }

    this.activeThemeName = theme.name;
    this.persistThemeSelection(theme.name);
    this.applyThemeTokens();
    this.render();
  }

  protected readonly handleOnlineStateChange = (): void => {
    this.applyBrowserOnlineState(true);
  };
}
