export type ShellControlKind =
  | "contextSelector"
  | "themeSwitch"
  | "logout"
  | "pwaInstall"
  | "syncStatus"
  | "connectivity"
  /**
   * Runs a declared `COMMAND`, prompting for the command's own declared inputs.
   *
   * The only shell control that is *about* the application rather than about
   * the device or the session, and the only one that opens a form. It exists
   * because a presentation `ACTION`'s `input` is a set of expressions
   * evaluated against a row, so nothing in the language could ask a person for
   * a value a command needs — which left a person holding an identity and no
   * membership with no affordance at all, since every context-scoped view
   * renders its empty state instead. See Phase 99.
   *
   * It is general: it names a command, and the form is generated from that
   * command's `INPUTS`. Nothing about it is specific to creating a context.
   */
  | "commandAction";
export type ShellControlPlacement =
  | "topBar"
  | "navDrawer"
  /**
   * Rendered inside the message a context-scoped view shows when the caller
   * can reach no instance of its context — turning the dead end
   * "No Band contexts are available for this view." into the way out of it.
   *
   * Unlike `topBar`/`navDrawer` there is no region control list to be named
   * in: order is declaration order. A region list exists for those two because
   * they are *shared* chrome whose ordering is a layout decision; the empty
   * state is a single message with, in practice, one way out.
   */
  | "emptyState";
export type ShellContextSelectorPlacement = "topBar" | "navDrawer" | "hidden";
export type ShellMobileContextSelectorMode = "dropdown" | "sheet";
export type ShellNavigationMode = "explicitOnly" | "includeUnlistedViews";
export type ShellVisibilityKind =
  | "always"
  | "contextAvailable"
  /** The mirror of {@link ShellVisibilityKind}'s `contextAvailable`: the caller can reach no instance of the named context. */
  | "contextUnavailable"
  | "contextSelected"
  | "online"
  | "offline";
export interface ResolvedShell {
  nav: ResolvedShellNavigation;
  topBar: ResolvedShellTopBar;
  navDrawer: ResolvedShellNavDrawer;
  controls: ResolvedShellControl[];
}
export interface ResolvedShellNavigation {
  mode: ShellNavigationMode;
  items: ResolvedShellNavItem[];
}
export interface ResolvedShellNavItem {
  name: string;
  view: string;
  label: string;
  icon?: string;
  group?: string;
  order: number;
  activeWhen: string[];
  visibility: ResolvedShellVisibility;
}
export interface ResolvedShellVisibility {
  kind: ShellVisibilityKind;
  context?: string;
}
export interface ResolvedShellTopBar {
  contextSelector: ShellContextSelectorPlacement;
  mobileContextSelector: ShellMobileContextSelectorMode;
  controls: string[];
}
/**
 * The navigation drawer's own chrome, symmetrical with {@link ResolvedShellTopBar}.
 *
 * `navDrawer` was already a legal {@link ShellControlPlacement}, so a control
 * could be placed in the drawer and then never rendered anywhere: the drawer had
 * no declared control list for a renderer to consume. This is that list.
 */
export interface ResolvedShellNavDrawer {
  /** Drawer heading. Undeclared means the renderer falls back to the app name. */
  title?: string;
  /** Ordered control names rendered inside the drawer. */
  controls: string[];
}
export interface ResolvedShellControl {
  name: string;
  kind: ShellControlKind;
  label?: string;
  icon?: string;
  placement: ShellControlPlacement;
  visibility: ResolvedShellVisibility;
  context?: string;
  /**
   * The `COMMAND` a `commandAction` control runs. Required for that kind and
   * meaningless for every other, which the validator enforces both ways.
   */
  command?: string;
}
export interface PartialShellModel {
  nav?: PartialShellNavigationModel;
  topBar?: PartialShellTopBarModel;
  navDrawer?: PartialShellNavDrawerModel;
  controls?: PartialShellControlModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialShellNavDrawerModel {
  title?: string;
  controls?: string[];
}
export interface PartialShellNavigationModel {
  mode?: ShellNavigationMode;
  items?: PartialShellNavItemModel[];
}
export interface PartialShellNavItemModel {
  name?: string;
  view: string;
  label?: string;
  icon?: string;
  group?: string;
  order?: number;
  activeWhen?: string[];
  visibility?: PartialShellVisibilityModel;
}
export interface PartialShellVisibilityModel {
  kind?: ShellVisibilityKind;
  context?: string;
}
export interface PartialShellTopBarModel {
  contextSelector?: ShellContextSelectorPlacement;
  mobileContextSelector?: ShellMobileContextSelectorMode;
  controls?: string[];
}
export interface PartialShellControlModel {
  name: string;
  kind: ShellControlKind;
  label?: string;
  icon?: string;
  placement?: ShellControlPlacement;
  visibility?: PartialShellVisibilityModel;
  context?: string;
  /** See {@link ResolvedShellControl.command}. */
  command?: string;
}
