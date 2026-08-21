import { ApplicationRuntime } from "../../../runtime/application-runtime.js";
import type { RecordSyncStateSummary, RefusedLocalRecord } from "../../../runtime/object-store.js";
import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedObject,
  ResolvedView,
  StoredObjectRecord,
} from "../../../model/resolved-model.js";
import type {
  RuntimeAvailableContext,
  RuntimeContext,
  RuntimeContextRole,
  RuntimeReadModelRow,
  RuntimeValidationIssue,
} from "../../../runtime/runtime-types.js";
import {
  browserDemoContext,
  createBrowserDemoModel,
  createPersistentBrowserDemoRuntime,
} from "../../demo-fixture.js";
import type { SaveRecordDetail, UiMessage, UiMode } from "../../types.js";
import type { AdlAuthorityBridge } from "../../authority-bridge.js";
import type { RuntimePresentationView } from "../../../runtime/presentation-runtime.js";
import type {
  RuntimeEditSurface,
  RuntimeStagedChildOperation,
} from "../../../runtime/edit-surface-runtime.js";

/**
 * `beforeinstallprompt` is Chromium-only and absent from the DOM lib, so it is
 * declared here as the narrowest shape this shell actually uses. The event can
 * only be acted on once: a second `prompt()` call on the same event rejects, so
 * every caller must stash it, act on it at most once, and discard it
 * afterwards regardless of which way `userChoice` resolves.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export class AdlAppStateElement extends HTMLElement {
  protected _model: ResolvedApplicationModel = createBrowserDemoModel();
  protected _runtime: ApplicationRuntime | undefined;
  protected _context: RuntimeContext = browserDemoContext;
  protected readyPromise: Promise<void> = Promise.resolve();
  protected initialized = false;
  protected seeded = false;
  protected viewName = "";
  protected searchText = "";
  protected records: StoredObjectRecord[] = [];
  protected readModelRows: RuntimeReadModelRow[] = [];
  protected presentationView: RuntimePresentationView | undefined;
  protected presentationStateByView = new Map<string, Record<string, JsonValue>>();
  protected editSurface: RuntimeEditSurface | undefined;
  protected stagedChildChanges: RuntimeStagedChildOperation[] = [];
  /**
   * Monotonic, because collapsing removes entries: deriving the suffix from the
   * current list length would reissue an id a retained operation still holds.
   */
  private stagedChildSequence = 0;
  protected selectedRecord: StoredObjectRecord | undefined;
  protected editContainerOpen = false;
  protected mode: UiMode = "edit";
  protected draftValues: SaveRecordDetail["values"] = {};
  protected messages: UiMessage[] = [];
  protected fieldIssues: RuntimeValidationIssue[] = [];
  protected useBrowserOnlineState = this._context.online === undefined;
  protected availableContexts = new Map<string, RuntimeAvailableContext[]>();
  protected selectedContextIds: Record<string, string> = {};
  protected activeRuntimeContext: RuntimeContext | undefined;
  protected activeViewEmptyState: string | undefined;
  /** The context an empty state is *about*, so it can offer the way into it. */
  protected activeViewEmptyStateContext: string | undefined;
  protected editObjectName: string | undefined;
  protected editViewName: string | undefined;
  protected navDrawerOpen = false;
  /**
   * The `commandAction` shell control whose form is open, by control name, and
   * the state of the attempt. Shell state rather than a component property
   * because the form is opened from chrome and closed by a runtime outcome:
   * `<adl-command-form>` collects values and decides nothing.
   */
  protected commandFormControl: string | undefined;
  protected commandFormBusy = false;
  protected commandFormError: string | undefined;
  /**
   * What was last submitted, re-seeded into the form after a refusal. The
   * shell rewrites its whole `innerHTML` on every render, so the form element
   * is recreated rather than updated and cannot keep anything itself — the
   * same reason record drafts live here as `draftValues`.
   */
  protected commandFormValues: Record<string, JsonValue> | undefined;
  protected _authority: AdlAuthorityBridge | undefined;
  protected authorityBusy = false;
  protected deliveringWrites = false;
  protected installPrompt: InstallPromptEvent | undefined;
  /**
   * True once this device is known to be running the app installed, whether
   * that was learned from the browser's `appinstalled` event fired during this
   * session or from the display mode already being `standalone` (or iOS
   * Safari's `navigator.standalone`) when the shell first connected. A record
   * of this never needs to un-set itself: browsers do not fire an "uninstalled"
   * event, and an install performed outside this control (e.g. the browser's
   * own omnibox affordance) must be reflected here too, not only an install
   * that went through the `pwaInstall` shell control.
   */
  protected appInstalled = false;
  /**
   * The device's record sync state, read once per refresh and cached here.
   *
   * `renderShellControl` and the refused-record surface are render methods, so
   * they must not await the runtime; the read happens in the refresh path that
   * already precedes every render.
   */
  protected recordSyncSummary: RecordSyncStateSummary | undefined;
  protected refusedRecords: RefusedLocalRecord[] = [];
  /**
   * A device-local override of `model.app.theme`, chosen through the
   * `themeSwitch` shell control and read back from `localStorage` on the next
   * `set model`. `undefined` means "no override on this device": the model's
   * declared `app.theme` still governs, exactly as it did before this control
   * existed. It is never cleared to `undefined` once a person has chosen a
   * theme; a stored name that no longer matches a declared theme (a model
   * changed the app runs under) is treated the same as no override, which
   * `resolveActiveTheme` falls back on.
   */
  protected activeThemeName: string | undefined;

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

  /**
   * The context the app is currently operating in, including whichever business
   * contexts are selected.
   *
   * The selection lives in `selectedContextIds` rather than on `_context`, so
   * returning the raw base handed every outside consumer — the authority bridge
   * above all — a context that claimed nothing was selected. Sync sent no
   * selection with its bootstrap, and the administration surface could not tell
   * which context it was meant to administer, even with one plainly chosen in
   * the top bar. This is the same shape `baseRuntimeContext` gives the runtime,
   * so the shell and everything reading from it now agree.
   */
  get context(): RuntimeContext {
    return this.baseRuntimeContext();
  }

  protected nextStagedChildSequence(): number {
    this.stagedChildSequence += 1;
    return this.stagedChildSequence;
  }

  protected closeEditContainer(clearMessages: boolean): void {
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

  /**
   * What the `syncStatus` control says about this device's records.
   *
   * Ordered by what needs a person soonest: a refusal is terminal and its rows
   * are stranded here, a conflict is waiting on a decision, and pending work is
   * merely unsent. Only the most urgent is named, because the control is one
   * badge and a person reading it needs the worst thing first.
   *
   * A summary that has not been read yet reads the same as an empty device,
   * which is what "Synced" means here: nothing outstanding.
   */
  protected recordSyncState(): { status: string; label: string; title: string } {
    const summary = this.recordSyncSummary;
    if (summary !== undefined && summary.rejected > 0) {
      return {
        status: "rejected",
        label: `${summary.rejected} refused`,
        title: "The server refused these records. They are still saved on this device.",
      };
    }

    if (summary !== undefined && summary.conflict > 0) {
      return {
        status: "conflict",
        label: `${summary.conflict} in conflict`,
        title: "These records conflict with the server and need a decision.",
      };
    }

    if (summary !== undefined && summary.pending > 0) {
      return {
        status: "pending",
        label: `${summary.pending} pending`,
        title: "These records are saved here and have not been accepted by the server yet.",
      };
    }

    return {
      status: "synced",
      label: "Synced",
      title: "No records on this device are waiting on the server.",
    };
  }

  protected resolveRequestedContextId(contextModel: ResolvedBusinessContext): string | undefined {
    const routeContextId =
      contextModel.selection.source === "route" ? this.readRouteContextId(contextModel) : undefined;
    return (
      routeContextId ??
      this.selectedContextIds[contextModel.name] ??
      this.readPersistedContextId(contextModel)
    );
  }

  protected setSelectedContextId(
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

  /**
   * The active theme is a platform-level device preference, not application
   * data: every ADL app gets it from declaring a `themeSwitch` control, with
   * no object or field of its own to declare. `localStorage`, keyed by app
   * name the same way `contextStorageKey` scopes context selection, is the
   * existing device-local mechanism for exactly this shape of state, so the
   * theme override reuses it rather than adding a second storage path.
   */
  private themeStorageKey(appName: string): string {
    return `adl:${appName}:theme`;
  }

  protected readPersistedThemeName(model: ResolvedApplicationModel): string | undefined {
    const value = readStorageValue(globalThis.localStorage, this.themeStorageKey(model.app.name));
    if (value === null || value.length === 0) {
      return undefined;
    }

    return model.themes.some((theme) => theme.name === value) ? value : undefined;
  }

  protected persistThemeSelection(themeName: string): void {
    writeStorageValue(
      globalThis.localStorage,
      this.themeStorageKey(this._model.app.name),
      themeName,
    );
  }

  protected requireActiveRuntimeContext(): RuntimeContext {
    if (this.activeRuntimeContext === undefined) {
      throw new Error("The active view does not have a runtime context.");
    }

    return this.activeRuntimeContext;
  }

  protected setEditTarget(objectName: string, viewName?: string): void {
    this.editObjectName = objectName;
    this.editViewName = viewName;
  }

  protected clearEditTarget(): void {
    this.editObjectName = undefined;
    this.editViewName = undefined;
  }

  protected baseRuntimeContext(): RuntimeContext {
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

  protected baseRuntimeContextWithoutSelected(contextName: string): RuntimeContext {
    const context = this.baseRuntimeContext();
    const selectedContexts = { ...(context.selectedContexts ?? {}) };
    delete selectedContexts[contextName];

    return {
      ...context,
      selectedContexts,
      contextRoles: (context.contextRoles ?? []).filter((role) => role.context !== contextName),
    };
  }

  protected withContextRoles(
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

  protected presentationStateKey(object: ResolvedObject, view: ResolvedView): string {
    return `${object.name}:${view.name}`;
  }
}

function browserPersistenceAvailable(): boolean {
  return globalThis.indexedDB !== undefined;
}

function cloneGroups(groups: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(groups).map(([group, roles]) => [group, [...roles]]));
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
