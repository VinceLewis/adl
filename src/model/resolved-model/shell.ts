export type ShellControlKind =
  | "contextSelector"
  | "themeSwitch"
  | "logout"
  | "pwaInstall"
  | "syncStatus"
  | "connectivity";
export type ShellControlPlacement = "topBar" | "navDrawer";
export type ShellContextSelectorPlacement = "topBar" | "navDrawer" | "hidden";
export type ShellMobileContextSelectorMode = "dropdown" | "sheet";
export type ShellNavigationMode = "explicitOnly" | "includeUnlistedViews";
export type ShellVisibilityKind =
  | "always"
  | "contextAvailable"
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
}
