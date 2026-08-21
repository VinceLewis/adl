import type {
  EditContainerMode,
  ResolvedBusinessContext,
  ResolvedCommand,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedTheme,
  ResolvedView,
  ShellControlPlacement,
} from "../../../model/resolved-model.js";
import { applyResolvedTheme, findApplicationTheme } from "../../theme/default-theme.js";
import type { SaveRecordDetail } from "../../types.js";
import { AdlAppStateElement } from "./state.js";

export class AdlAppModelLookupElement extends AdlAppStateElement {
  /*
   * The container belongs to the form that opens, not to whichever view is
   * active. Reading it from `activeView` made `EDIT_CONTAINER` on a `FORM` view
   * inert unless that form view was itself navigated to, so a list that opened
   * the form governed how the form was presented.
   */
  protected get activeEditContainer(): EditContainerMode {
    return this.editFormView.editContainer;
  }

  protected applyThemeTokens(): void {
    applyResolvedTheme(this, this.resolveActiveTheme());
  }

  /**
   * `model.app.theme` is the app's declared default; `activeThemeName` is this
   * device's override, chosen through the `themeSwitch` control on some
   * earlier visit. A name that no longer names a declared theme — a model
   * change dropped or renamed it since the override was stored — falls back
   * to the declared default rather than an unresolved theme.
   */
  protected resolveActiveTheme(): ResolvedTheme {
    if (this.activeThemeName !== undefined) {
      const overridden = this._model.themes.find((theme) => theme.name === this.activeThemeName);
      if (overridden !== undefined) {
        return overridden;
      }
    }

    return findApplicationTheme(this._model);
  }

  /**
   * The read models a report may be run against: every one the model declares.
   * The name is all that is ever sent — the authority resolves it, applies read
   * policy and shapes the rows — so offering the full list widens nothing, and
   * one the caller may not run comes back empty rather than refused.
   */
  protected get reportableReadModels(): string[] {
    return (this._model.readModels ?? []).map((readModel) => readModel.name);
  }

  /**
   * The declared controls a surface should render: named by that surface's own
   * list, resolved against the shell's controls, and kept only when the control
   * asked for this placement and is currently visible.
   *
   * Both the top bar and the drawer go through here so a control can never be
   * rendered twice, and so a name in one list that a control placed elsewhere
   * does not silently appear on the wrong surface.
   */
  protected placedShellControls(
    controlNames: string[],
    placement: ShellControlPlacement,
  ): ResolvedShellControl[] {
    return controlNames
      .map((controlName) =>
        this._model.shell.controls.find((control) => control.name === controlName),
      )
      .filter((control): control is ResolvedShellControl => control !== undefined)
      .filter((control) => control.placement === placement && this.isShellControlVisible(control));
  }

  /**
   * The `commandAction` controls a view's own empty state offers.
   *
   * Ordered by declaration rather than by a region control list, because
   * unlike the top bar and the drawer this is not shared chrome whose ordering
   * is a layout decision — it is one message with, in practice, one way out of
   * it. A control that names no context in its visibility renders in every
   * empty state; one that names a context renders only in that context's.
   */
  protected emptyStateShellControls(contextName: string | undefined): ResolvedShellControl[] {
    return this._model.shell.controls.filter(
      (control) =>
        control.placement === "emptyState" &&
        this.isShellControlVisible(control) &&
        (control.visibility.context === undefined || control.visibility.context === contextName),
    );
  }

  /** The command a `commandAction` control runs, resolved from the model. */
  protected shellControlCommand(controlName: string | undefined): ResolvedCommand | undefined {
    if (controlName === undefined) {
      return undefined;
    }
    const control = this._model.shell.controls.find((entry) => entry.name === controlName);
    if (control?.kind !== "commandAction" || control.command === undefined) {
      return undefined;
    }
    return this._model.commands?.find((command) => command.name === control.command);
  }

  protected applySelectedScopeToCreateValues(
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

  protected findStartView(): ResolvedView {
    const startView = this._model.app.startView;
    return this.findView(startView)?.view ?? this.allViews[0]?.view ?? failNoViews("application");
  }

  protected get activeObject(): ResolvedObject {
    return this.findView(this.activeView.name)?.object ?? failNoObjects();
  }

  protected get activeView(): ResolvedView {
    return this.findView(this.viewName)?.view ?? this.findStartView();
  }

  protected get activeReadModel(): ResolvedReadModel | undefined {
    const readModelName = this.activeView.readModel;
    return readModelName === undefined ? undefined : this.findReadModel(readModelName);
  }

  protected get editObject(): ResolvedObject {
    if (this.editObjectName !== undefined) {
      return (
        this._model.objects.find((object) => object.name === this.editObjectName) ??
        this.activeObject
      );
    }

    return this.activeObject;
  }

  protected get editFormView(): ResolvedView {
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

  protected get visibleNavItems(): ResolvedShellNavItem[] {
    return this._model.shell.nav.items.filter((item) =>
      this.isShellVisibilityVisible(item.visibility),
    );
  }

  protected get hasNavigationDrawerContent(): boolean {
    return (
      this.visibleNavItems.length > 0 ||
      this.placedShellControls(this._model.shell.navDrawer.controls, "navDrawer").length > 0
    );
  }

  protected isShellControlVisible(control: ResolvedShellControl): boolean {
    if (!this.isShellVisibilityVisible(control.visibility)) {
      return false;
    }

    if (control.kind === "contextSelector") {
      // `topBar.contextSelector` names where the selector belongs, not whether
      // the top bar shows one, so it decides both placements: a selector placed
      // in the drawer is visible exactly when the model asked for it there, and
      // `hidden` still matches neither placement.
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

    if (visibility.kind === "contextUnavailable") {
      // The mirror image, and the state the onboarding surface exists for: a
      // person holding an identity and no membership can reach no instance of
      // this context, so every view scoped to it renders its empty state.
      return (this.availableContexts.get(contextName) ?? []).length === 0;
    }

    return this.selectedContextIds[contextName] !== undefined;
  }

  protected get navigableContexts(): ResolvedBusinessContext[] {
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

  protected findView(viewName: string): { object: ResolvedObject; view: ResolvedView } | undefined {
    return this.allViews.find(({ view }) => view.name === viewName);
  }

  private findReadModel(readModelName: string): ResolvedReadModel | undefined {
    return this._model.readModels?.find((readModel) => readModel.name === readModelName);
  }
}

function failNoObjects(): never {
  throw new Error("Resolved model does not contain any objects.");
}

function failNoViews(objectName: string): never {
  throw new Error(`Object '${objectName}' does not contain any views.`);
}
