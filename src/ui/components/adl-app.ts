import { ApplicationRuntime } from "../../runtime/application-runtime.js";
import { RuntimeValidationError } from "../../runtime/runtime-types.js";
import type {
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type {
  RuntimeAvailableContext,
  RuntimeContext,
  RuntimeContextRole,
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
import type { SaveRecordDetail, TransitionRecordDetail, UiMessage, UiMode } from "../types.js";
import type { AdlContextSelectorElement, ContextSelectionDetail } from "./adl-context-selector.js";
import { AdlFormViewElement } from "./adl-form-view.js";
import { AdlListViewElement } from "./adl-list-view.js";
import { AdlMessageAreaElement } from "./adl-message-area.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

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
  private selectedRecord: StoredObjectRecord | undefined;
  private mode: UiMode = "edit";
  private messages: UiMessage[] = [];
  private fieldIssues: RuntimeValidationIssue[] = [];
  private useBrowserOnlineState = this._context.online === undefined;
  private availableContexts = new Map<string, RuntimeAvailableContext[]>();
  private selectedContextIds: Record<string, string> = {};
  private activeRuntimeContext: RuntimeContext | undefined;
  private activeViewEmptyState: string | undefined;

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
        this.selectedRecord = record;
        this.fieldIssues = [];
        this.render();
      }
    });
  };

  private readonly handleNew = (): void => {
    this.mode = "create";
    this.selectedRecord = undefined;
    this.fieldIssues = [];
    this.messages = [];
    this.render();
  };

  private readonly handleSave = (event: Event): void => {
    const detail = (event as CustomEvent<SaveRecordDetail>).detail;
    if (detail === undefined) {
      return;
    }

    void this.runCommand(async () => {
      const context = this.requireActiveRuntimeContext();
      if (detail.mode === "create") {
        const created = await this.runtime.create(
          this.activeObject.name,
          this.applySelectedScopeToCreateValues(detail.values),
          context,
        );
        this.messages = [successMessage(`${this.activeObject.name} created.`)];
        this.fieldIssues = [];
        await this.refreshRecords(created.meta.guid);
        this.render();
        return;
      }

      if (detail.record === undefined) {
        return;
      }

      if (Object.keys(detail.values).length === 0) {
        this.messages = [infoMessage("No changes to save.")];
        this.render();
        return;
      }

      const updated = await this.runtime.update(
        this.activeObject.name,
        detail.record.meta.guid,
        detail.values,
        context,
      );
      this.messages = [successMessage(`${this.activeObject.name} saved.`)];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
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
      await this.runtime.delete(this.activeObject.name, detail.record.meta.guid, context);
      this.messages = [successMessage(`${this.activeObject.name} deleted.`)];
      this.selectedRecord = undefined;
      this.mode = "create";
      await this.refreshRecords();
      this.render();
    });
  };

  private readonly handleCancel = (): void => {
    this.fieldIssues = [];
    this.messages = [];
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
      const updated = await this.runtime.transition(
        this.activeObject.name,
        detail.record.meta.guid,
        detail.actionName,
        context,
      );
      this.messages = [successMessage(`${titleCaseIdentifier(detail.actionName)} completed.`)];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      this.render();
    });
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.viewSwitch !== "true") {
      return;
    }

    this.viewName = target.value;
    this.searchText = "";
    this.selectedRecord = undefined;
    this.mode = "edit";
    this.messages = [];
    this.fieldIssues = [];
    void this.runCommand(async () => {
      await this.refreshRecords();
      this.render();
    });
  };

  private readonly handleContextSelection = (event: Event): void => {
    const detail = (event as CustomEvent<ContextSelectionDetail>).detail;
    if (detail === undefined) {
      return;
    }

    this.setSelectedContextId(detail.contextName, detail.contextId, true);
    this.searchText = "";
    this.selectedRecord = undefined;
    this.mode = "edit";
    this.messages = [];
    this.fieldIssues = [];
    void this.runCommand(async () => {
      await this.refreshRecords();
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

  connectedCallback(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.addEventListener("adl-search", this.handleSearch);
    this.addEventListener("adl-select-record", this.handleSelect);
    this.addEventListener("adl-new-record", this.handleNew);
    this.addEventListener("adl-save-record", this.handleSave);
    this.addEventListener("adl-delete-record", this.handleDelete);
    this.addEventListener("adl-cancel-record", this.handleCancel);
    this.addEventListener("adl-transition-record", this.handleTransition);
    this.addEventListener("adl-select-context", this.handleContextSelection);
    this.addEventListener("change", this.handleChange);
    addBrowserOnlineListeners(this.handleOnlineStateChange);
    this.readyPromise = this.initialize();
  }

  disconnectedCallback(): void {
    this.removeEventListener("adl-search", this.handleSearch);
    this.removeEventListener("adl-select-record", this.handleSelect);
    this.removeEventListener("adl-new-record", this.handleNew);
    this.removeEventListener("adl-save-record", this.handleSave);
    this.removeEventListener("adl-delete-record", this.handleDelete);
    this.removeEventListener("adl-cancel-record", this.handleCancel);
    this.removeEventListener("adl-transition-record", this.handleTransition);
    this.removeEventListener("adl-select-context", this.handleContextSelection);
    this.removeEventListener("change", this.handleChange);
    removeBrowserOnlineListeners(this.handleOnlineStateChange);
    this.initialized = false;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
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
    const viewContext = await this.resolveActiveViewContext(view);
    this.activeRuntimeContext = viewContext.context;
    this.activeViewEmptyState = viewContext.emptyState;

    if (viewContext.context === undefined) {
      this.records = [];
      this.selectedRecord = undefined;
      this.mode = "create";
      return;
    }

    this.records = await this.runtime.search(
      object.name,
      {
        text: this.searchText,
        ...(view.searchFields.length > 0 ? { fields: view.searchFields } : {}),
      },
      viewContext.context,
    );

    const recordIds = new Set(this.records.map((record) => record.meta.guid));
    const currentRecordId = this.selectedRecord?.meta.guid;
    const retainedRecordId =
      currentRecordId !== undefined && recordIds.has(currentRecordId) ? currentRecordId : undefined;
    const nextRecordId = preferredRecordId ?? retainedRecordId;
    const selected =
      nextRecordId === undefined
        ? this.records[0]
        : ((await this.runtime.read(object.name, nextRecordId, viewContext.context)) ??
          this.records[0]);

    this.selectedRecord = selected;
    this.mode = selected === undefined ? "create" : "edit";
  }

  private async runCommand(command: () => Promise<void>): Promise<void> {
    try {
      await command();
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
      this.fieldIssues =
        error instanceof RuntimeValidationError ? [...error.issues] : this.fieldIssues;
      this.render();
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
    const formView = this.formView;
    const showWorkspace =
      this.activeRuntimeContext !== undefined && this.activeViewEmptyState === undefined;

    this.applyThemeTokens();
    this.innerHTML = `
      <main class="adl-shell">
        <header class="adl-topbar">
          <div class="adl-brand">
            <h1>${escapeHtml(this._model.app.name)}</h1>
            <span>Model-driven browser runtime</span>
          </div>
          <div class="adl-topbar-tools">
            ${this.renderContextSelectors()}
            <label class="adl-view-switch">
              <span>View</span>
              <select data-view-switch="true">
                ${this.allViews
                  .map(
                    ({ object: candidateObject, view: candidateView }) => `
                      <option value="${escapeHtml(candidateView.name)}" ${
                        candidateView.name === view.name ? "selected" : ""
                      }>
                        ${escapeHtml(
                          `${titleCaseIdentifier(candidateObject.name)} / ${titleCaseIdentifier(
                            candidateView.name,
                          )}`,
                        )}
                      </option>
                  `,
                  )
                  .join("")}
              </select>
            </label>
          </div>
        </header>
        <adl-message-area></adl-message-area>
        ${
          showWorkspace
            ? `
              <div class="adl-workspace">
                <adl-list-view></adl-list-view>
                <adl-form-view></adl-form-view>
              </div>
            `
            : `<section class="adl-empty-state">${escapeHtml(this.activeViewEmptyState ?? "No runtime context is available for this view.")}</section>`
        }
      </main>
    `;

    const messageArea = this.querySelector<AdlMessageAreaElement>("adl-message-area");
    if (messageArea !== null) {
      messageArea.messages = this.messages;
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
      form.object = object;
      form.view = formView;
      form.context = this.activeRuntimeContext;
      form.record = this.selectedRecord;
      form.mode = this.mode;
      form.fieldIssues = this.fieldIssues;
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

  private renderContextSelectors(): string {
    return this.navigableContexts
      .map(
        (context) =>
          `<adl-context-selector data-context-name="${escapeHtml(context.name)}"></adl-context-selector>`,
      )
      .join("");
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

  private async resolveActiveViewContext(view: ResolvedView): Promise<ActiveViewContextState> {
    const viewContext = view.context;
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
  ): SaveRecordDetail["values"] {
    const object = this.activeObject;
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

  private get formView(): ResolvedView {
    return (
      this.activeObject.views.find((view) => view.kind === "form" || view.kind === "detail") ??
      this.activeObject.views[0] ??
      failNoViews(this.activeObject.name)
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

  private get navigableContexts(): ResolvedBusinessContext[] {
    const contextNames = new Set(
      this.allViews
        .map(({ view }) => view.context)
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
