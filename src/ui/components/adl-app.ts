import { ApplicationRuntime } from "../../runtime/application-runtime.js";
import { RuntimeValidationError } from "../../runtime/runtime-types.js";
import type {
  ResolvedApplicationModel,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type { RuntimeContext, RuntimeValidationIssue } from "../../runtime/runtime-types.js";
import {
  browserDemoContext,
  createBrowserDemoModel,
  createPersistentBrowserDemoRuntime,
  seedBrowserDemoRuntimeIfEmpty,
} from "../demo-fixture.js";
import { infoMessage, messageFromRuntimeError, successMessage } from "../runtime-error-messages.js";
import { applyResolvedTheme, findApplicationTheme } from "../theme/default-theme.js";
import type { SaveRecordDetail, TransitionRecordDetail, UiMessage, UiMode } from "../types.js";
import { AdlFormViewElement } from "./adl-form-view.js";
import { AdlListViewElement } from "./adl-list-view.js";
import { AdlMessageAreaElement } from "./adl-message-area.js";
import { escapeHtml, titleCaseIdentifier } from "./html.js";

export class AdlAppElement extends HTMLElement {
  private _model: ResolvedApplicationModel = createBrowserDemoModel();
  private _runtime: ApplicationRuntime | undefined;
  private _context: RuntimeContext = browserDemoContext;
  private readyPromise: Promise<void> = Promise.resolve();
  private initialized = false;
  private seeded = false;
  private objectName = "";
  private searchText = "";
  private records: StoredObjectRecord[] = [];
  private selectedRecord: StoredObjectRecord | undefined;
  private mode: UiMode = "edit";
  private messages: UiMessage[] = [];
  private fieldIssues: RuntimeValidationIssue[] = [];
  private useBrowserOnlineState = this._context.online === undefined;

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
      const record = await this.runtime.read(this.objectName, detail.recordId, this._context);
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
      if (detail.mode === "create") {
        const created = await this.runtime.create(this.objectName, detail.values, this._context);
        this.messages = [successMessage(`${this.objectName} created.`)];
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
        this.objectName,
        detail.record.meta.guid,
        detail.values,
        this._context,
      );
      this.messages = [successMessage(`${this.objectName} saved.`)];
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
      await this.runtime.delete(this.objectName, detail.record.meta.guid, this._context);
      this.messages = [successMessage(`${this.objectName} deleted.`)];
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
      const updated = await this.runtime.transition(
        this.objectName,
        detail.record.meta.guid,
        detail.actionName,
        this._context,
      );
      this.messages = [successMessage(`${titleCaseIdentifier(detail.actionName)} completed.`)];
      this.fieldIssues = [];
      await this.refreshRecords(updated.meta.guid);
      this.render();
    });
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.objectSwitch !== "true") {
      return;
    }

    this.objectName = target.value;
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
    this.removeEventListener("change", this.handleChange);
    removeBrowserOnlineListeners(this.handleOnlineStateChange);
    this.initialized = false;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    this.objectName = this.findStartObject().name;
    this.applyBrowserOnlineState(false);
    this.applyThemeTokens();
    this.renderLoading();

    try {
      if (!this.seeded) {
        await seedBrowserDemoRuntimeIfEmpty(this.runtime, this._model, this._context);
        this.seeded = true;
      }
      await this.refreshRecords();
      this.render();
    } catch (error) {
      this.messages = [messageFromRuntimeError(error)];
      this.render();
    }
  }

  private async refreshRecords(preferredRecordId?: string): Promise<void> {
    const object = this.activeObject;
    const listView = this.listView;
    this.records = await this.runtime.search(
      object.name,
      {
        text: this.searchText,
        ...(listView.searchFields.length > 0 ? { fields: listView.searchFields } : {}),
      },
      this._context,
    );

    const recordIds = new Set(this.records.map((record) => record.meta.guid));
    const currentRecordId = this.selectedRecord?.meta.guid;
    const retainedRecordId =
      currentRecordId !== undefined && recordIds.has(currentRecordId) ? currentRecordId : undefined;
    const nextRecordId = preferredRecordId ?? retainedRecordId;
    const selected =
      nextRecordId === undefined
        ? this.records[0]
        : ((await this.runtime.read(object.name, nextRecordId, this._context)) ?? this.records[0]);

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
    const listView = this.listView;
    const formView = this.formView;

    this.applyThemeTokens();
    this.innerHTML = `
      <main class="adl-shell">
        <header class="adl-topbar">
          <div class="adl-brand">
            <h1>${escapeHtml(this._model.app.name)}</h1>
            <span>Model-driven browser runtime</span>
          </div>
          <label class="adl-object-switch">
            <span>Object</span>
            <select data-object-switch="true">
              ${this._model.objects
                .map(
                  (candidate) => `
                    <option value="${escapeHtml(candidate.name)}" ${
                      candidate.name === object.name ? "selected" : ""
                    }>
                      ${escapeHtml(titleCaseIdentifier(candidate.name))}
                    </option>
                  `,
                )
                .join("")}
            </select>
          </label>
        </header>
        <adl-message-area></adl-message-area>
        <div class="adl-workspace">
          <adl-list-view></adl-list-view>
          <adl-form-view></adl-form-view>
        </div>
      </main>
    `;

    const messageArea = this.querySelector<AdlMessageAreaElement>("adl-message-area");
    if (messageArea !== null) {
      messageArea.messages = this.messages;
    }

    const list = this.querySelector<AdlListViewElement>("adl-list-view");
    if (list !== null) {
      list.runtime = this.runtime;
      list.object = object;
      list.view = listView;
      list.context = this._context;
      list.records = this.records;
      list.selectedRecordId = this.selectedRecord?.meta.guid;
      list.searchText = this.searchText;
    }

    const form = this.querySelector<AdlFormViewElement>("adl-form-view");
    if (form !== null) {
      form.runtime = this.runtime;
      form.object = object;
      form.view = formView;
      form.context = this._context;
      form.record = this.selectedRecord;
      form.mode = this.mode;
      form.fieldIssues = this.fieldIssues;
    }
  }

  private applyThemeTokens(): void {
    applyResolvedTheme(this, findApplicationTheme(this._model));
  }

  private findStartObject(): ResolvedObject {
    const startView = this._model.app.startView;
    return (
      this._model.objects.find((object) => object.views.some((view) => view.name === startView)) ??
      this._model.objects[0] ??
      failNoObjects()
    );
  }

  private get activeObject(): ResolvedObject {
    return (
      this._model.objects.find((object) => object.name === this.objectName) ??
      this.findStartObject()
    );
  }

  private get listView(): ResolvedView {
    return (
      this.activeObject.views.find((view) => view.kind === "list" || view.kind === "grid") ??
      this.activeObject.views[0] ??
      failNoViews(this.activeObject.name)
    );
  }

  private get formView(): ResolvedView {
    return (
      this.activeObject.views.find((view) => view.kind === "form" || view.kind === "detail") ??
      this.activeObject.views[0] ??
      failNoViews(this.activeObject.name)
    );
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
