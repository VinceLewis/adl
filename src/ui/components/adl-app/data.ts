import { RuntimeValidationError } from "../../../runtime/runtime-types.js";
import { requiresImmediateDelivery } from "../../../runtime/sync-policy-service.js";
import type { JsonValue, ResolvedViewContext } from "../../../model/resolved-model.js";
import type { RuntimeAvailableContext, RuntimeContext } from "../../../runtime/runtime-types.js";
import { seedBrowserDemoRuntimeIfEmpty } from "../../demo-fixture.js";
import {
  infoMessage,
  messageFromRuntimeError,
  successMessage,
} from "../../runtime-error-messages.js";
import { titleCaseIdentifier } from "../html.js";
import { AdlAppRenderElement } from "./render.js";

interface ActiveViewContextState {
  context?: RuntimeContext;
  emptyState?: string;
  /** Which context the view could not reach, so the empty state can offer the way into it. */
  emptyStateContext?: string;
}

export class AdlAppDataElement extends AdlAppRenderElement {
  protected navigateToView(viewName: string): void {
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

  protected applyBrowserOnlineState(renderAfterChange: boolean): void {
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

  protected async runAuthorityAction(action: () => Promise<void>): Promise<void> {
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

  /**
   * Re-reads the active view from the runtime after data changed underneath the
   * UI, such as records reconciled by an authority sync. It is a no-op before
   * the element is initialised.
   */
  /**
   * Re-reads everything the shell derives from the runtime.
   *
   * Available contexts are re-resolved here, not only at startup. They are a
   * function of the accepted membership records this device holds *and* of who
   * the app is currently running as, and both change after startup: signing in
   * replaces the identity, and the bootstrap that follows brings down the
   * memberships that identity actually has. Resolving them once at
   * `initialize()` meant a person signed in and their contexts stayed empty
   * until they reloaded the page — with nothing on screen to suggest a reload
   * was what was needed. Claiming an invitation had the same shape.
   *
   * The re-resolve preserves an existing selection: `resolveRequestedContextId`
   * keeps the currently selected id when it is still available, and clears it
   * with a message only when it genuinely is not.
   */
  async refreshFromRuntime(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.runCommand(async () => {
      await this.refreshRecordSyncState();
      await this.refreshAvailableContexts();
      /*
       * Always through `refreshRecords`, which resolves the active view's
       * context first and dispatches to the presentation branch itself.
       * Calling `refreshPresentationView` directly skipped that resolution and
       * went straight to `requireActiveRuntimeContext()`, so a signed-in person
       * who is a member of no context — the exact state self-service
       * registration creates — got `The active view does not have a runtime
       * context.` as an error banner instead of the view's empty state.
       */
      await this.refreshRecords();
      await this.refreshEditSurface();
      this.render();
    });
  }

  protected async initialize(): Promise<void> {
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

  /**
   * Re-reads the device's record sync state. Every mutating path already goes
   * through `refreshRecords`, and `refreshFromRuntime` covers the presentation
   * views that do not, so the shell's sync control and the refused-record
   * surface are never a render behind the records they describe.
   */
  private async refreshRecordSyncState(): Promise<void> {
    this.recordSyncSummary = await this.runtime.summariseRecordSyncState();
    this.refusedRecords = await this.runtime.listRefusedRecords();
  }

  protected async refreshRecords(preferredRecordId?: string): Promise<void> {
    await this.refreshRecordSyncState();
    const object = this.activeObject;
    const view = this.activeView;
    const readModel = this.activeReadModel;
    const viewContext = await this.resolveActiveViewContext(view.context ?? readModel?.context);
    this.activeRuntimeContext = viewContext.context;
    this.activeViewEmptyState = viewContext.emptyState;
    this.activeViewEmptyStateContext = viewContext.emptyStateContext;

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

  protected async refreshPresentationView(updates: Record<string, JsonValue> = {}): Promise<void> {
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

  protected async refreshEditSurface(): Promise<void> {
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

  protected async applyPendingChildChanges(
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

  protected async runCommand(command: () => Promise<void>): Promise<void> {
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

  /**
   * Runs a `commandAction` shell control's command with the values a person
   * supplied, then puts them where the command just put them.
   *
   * The second half is the whole point of the first. `CreateBand` establishes
   * its context transaction-locally and writes the founder membership in the
   * same transaction, so as soon as it commits the caller *is* a member — but
   * the shell's `availableContexts` were read before that was true, so without
   * re-reading them and selecting the new instance the person would land back
   * on the same empty state that offered them the control. That is the "no
   * reload" requirement, and it is met by re-reading rather than by reloading.
   *
   * Nothing here authorises anything. `executeCommand` runs the command's own
   * preconditions and every step's policy check; a refusal surfaces as the
   * form's error and no context is selected.
   */
  protected async runShellCommand(
    controlName: string,
    input: Record<string, JsonValue>,
  ): Promise<void> {
    const control = this._model.shell.controls.find((entry) => entry.name === controlName);
    const command = this.shellControlCommand(controlName);
    if (control === undefined || command === undefined) {
      return;
    }

    this.commandFormBusy = true;
    this.commandFormError = undefined;
    this.render();

    let result;
    try {
      result = await this.runtime.executeCommand(command.name, input, this.baseRuntimeContext());
    } catch (error) {
      // Stated on the form, beside the values that produced it, rather than in
      // the shell's message area where a person who is mid-form would not look.
      this.commandFormBusy = false;
      const message = messageFromRuntimeError(error);
      this.commandFormError = [message.title, ...message.details].join(" ");
      this.render();
      return;
    }

    this.commandFormBusy = false;
    this.commandFormControl = undefined;
    this.commandFormValues = undefined;
    this.messages = [
      successMessage(
        `${result.command.label ?? titleCaseIdentifier(result.command.name)} completed.`,
      ),
    ];

    /*
     * Which record became the new context instance is stated by the command,
     * not guessed: the step that declares `ESTABLISHES CONTEXT` is the one
     * whose record is that context's instance.
     */
    const establishing = command.steps.find(
      (step) => step.action === "create" && step.establishesContext !== undefined,
    );
    const establishedContext =
      establishing?.action === "create" ? establishing.establishesContext : undefined;
    const created = result.steps.find((step) => step.step === establishing?.name);

    await this.deliverPendingWrites();
    await this.refreshAvailableContexts();
    if (establishedContext !== undefined && created !== undefined) {
      const available = this.availableContexts.get(establishedContext) ?? [];
      if (available.some((candidate) => candidate.id === created.recordId)) {
        this.setSelectedContextId(establishedContext, created.recordId, true);
      }
    }
    await this.refreshRecords();
    this.render();
  }

  protected async refreshAvailableContexts(): Promise<void> {
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
          infoMessage(`You must select a ${titleCaseIdentifier(contextModel.name)} to work with.`),
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
          emptyStateContext: contextName,
        };
      }

      /*
       * One base context for both resolutions, so roles and grants cannot
       * disagree about which selection was dropped.
       */
      const baseContext = this.baseRuntimeContextWithoutSelected(contextName);
      const contextRoles = await this.runtime.contextService.resolveContextRoles(
        contextName,
        baseContext,
      );
      /*
       * Grants are resolved alongside roles for the same reason roles are:
       * dropping the selection also dropped everything derived from it. This is
       * the same answer `ReadModelService.resolveExecutionContext` gives to the
       * same question for the same `mode: "all"` — see its own comment. While
       * the two disagreed, a `CONTEXT ALL` screen rendered rows reached through
       * a `CONTEXT_GRANT` (the read path resolved grants) and then refused every
       * command run against them (the shell did not), which is what made
       * Jointly Care's shipped `Accept` button dead on arrival.
       *
       * This widens nothing. `resolveContextGrants` returns exactly what
       * `listAvailableContexts` already returned to build the context selector
       * the person is looking at, and a grant confers no role:
       * `runtimeContextHasScopedRole` reads `contextRoles` and never
       * `contextGrants`.
       */
      const contextGrants = await this.runtime.contextService.resolveContextGrants(
        contextName,
        baseContext,
      );
      return {
        context: this.withContextGrants(
          this.withContextRoles(baseContext, contextName, contextRoles),
          contextName,
          contextGrants,
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
          emptyStateContext: contextName,
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
}

function getBrowserOnlineState(): boolean | undefined {
  return globalThis.navigator?.onLine;
}
