import { isIconName } from "../../../model/resolved-model.js";
import type {
  IconName,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedView,
} from "../../../model/resolved-model.js";
import { escapeHtml, titleCaseIdentifier } from "../html.js";
import { AdlAppModelLookupElement } from "./model-lookup.js";

export class AdlAppChromeElement extends AdlAppModelLookupElement {
  /**
   * Session, invite and recovery chrome exists only when an authority is
   * configured. A purely local demo has no identity to present and no server
   * verdict to recover from, so it renders none of this.
   */
  protected renderAuthorityChrome(): string {
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
        ${this.renderAdministrationChrome()}
      </section>
    `;
  }

  /**
   * The operational surfaces, over the authority's existing administration and
   * reporting endpoints.
   *
   * They render for any signed-in caller, not only for one the shell believes is
   * an administrator, and that is deliberate: the browser holds no role and must
   * not become a second place where scope is decided. Every read behind these
   * components is authorised by the server, and a caller who may administer
   * nothing simply sees empty lists — which is indistinguishable, on purpose,
   * from a context that has nothing in it.
   */
  private renderAdministrationChrome(): string {
    if (this._authority?.session.status !== "signedIn") {
      return "";
    }

    return `
      <section class="adl-administration-chrome" data-administration-chrome="true">
        <adl-audit-review></adl-audit-review>
        <adl-access-review></adl-access-review>
        <adl-report-runner></adl-report-runner>
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

  /**
   * A dropdown, not a binary toggle, because a declared theme set is not
   * necessarily two-valued: `model.themes` always carries at least the three
   * built-in base themes (`CorporateLight`, `CorporateDark`, `MinimalLight`),
   * and an app may declare more of its own. With fewer than two themes there
   * is nothing to switch between, so the control renders the same disabled
   * shape `renderShellControl`'s generic branch gives an unavailable control,
   * for the same reason `pwaInstall` does when no host capability backs it.
   * `resolveApplicationModel` cannot produce fewer than three today — it
   * always injects the built-ins for any name not already declared — so this
   * branch is defensive against a resolver that may one day let an app
   * suppress them, not a state reachable through the language as it stands.
   */
  private renderThemeSwitch(control: ResolvedShellControl): string {
    const label = control.label ?? titleCaseIdentifier(control.name);
    const themes = this._model.themes;
    if (themes.length < 2) {
      return `
        <button
          class="adl-shell-control adl-shell-control-unavailable"
          type="button"
          data-shell-control="${escapeHtml(control.name)}"
          data-shell-control-kind="themeSwitch"
          disabled
          title="${escapeHtml(`${label} is not available in this runtime.`)}"
        >
          <span>${escapeHtml(label)}</span>
        </button>
      `;
    }

    const activeThemeName = this.resolveActiveTheme().name;
    return `
      <label
        class="adl-theme-switch"
        data-shell-control="${escapeHtml(control.name)}"
        data-shell-control-kind="themeSwitch"
      >
        <span>${escapeHtml(label)}</span>
        <select data-theme-switch="true" aria-label="${escapeHtml(label)}">
          ${themes
            .map(
              (theme) => `
                <option value="${escapeHtml(theme.name)}"${
                  theme.name === activeThemeName ? " selected" : ""
                }>${escapeHtml(titleCaseIdentifier(theme.name))}</option>
              `,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  protected renderTopBarControls(): string {
    return this.placedShellControls(this._model.shell.topBar.controls, "topBar")
      .map((control) => this.renderShellControl(control))
      .join("");
  }

  private renderShellControl(control: ResolvedShellControl): string {
    if (control.kind === "contextSelector") {
      return this.renderContextSelectors();
    }

    if (control.kind === "themeSwitch") {
      return this.renderThemeSwitch(control);
    }

    /*
     * Connectivity is what `syncStatus` used to render, and it keeps a control
     * of its own because it answers a question no other surface does: whether
     * this device can reach the authority at all. It is deliberately the same
     * markup and the same classes, so the indicator a person already knows is
     * unchanged — only its name now matches what it says.
     */
    if (control.kind === "connectivity") {
      const online = this._context.online ?? true;
      return `
        <span
          class="adl-shell-status ${online ? "adl-shell-status-online" : "adl-shell-status-offline"}"
          data-shell-control="${escapeHtml(control.name)}"
          data-shell-control-kind="connectivity"
        >${escapeHtml(online ? "Online" : "Offline")}</span>
      `;
    }

    if (control.kind === "syncStatus") {
      const state = this.recordSyncState();
      return `
        <span
          class="adl-shell-status"
          data-shell-control="${escapeHtml(control.name)}"
          data-shell-control-kind="syncStatus"
          data-sync-state="${escapeHtml(state.status)}"
          title="${escapeHtml(state.title)}"
        >${escapeHtml(state.label)}</span>
      `;
    }

    /*
     * A `commandAction` is the one control that is about the application
     * rather than the device or the session, and the only one that is always
     * available: the command it names exists in the model, and whether the
     * caller may run it is the runtime's answer, not the shell's. It renders
     * wherever it is placed — top bar, drawer or empty state — so the
     * construct is general rather than an onboarding special case.
     */
    if (control.kind === "commandAction") {
      const commandLabel = control.label ?? titleCaseIdentifier(control.name);
      return `
        <button
          class="adl-shell-control"
          type="button"
          data-shell-control="${escapeHtml(control.name)}"
          data-shell-control-kind="commandAction"
          data-shell-command-control="${escapeHtml(control.name)}"
          title="${escapeHtml(commandLabel)}"
        >
          ${
            control.icon === undefined
              ? ""
              : `<span aria-hidden="true" data-shell-icon="${escapeHtml(control.icon)}">${escapeHtml(
                  iconGlyph(control.icon),
                )}</span>`
          }
          <span>${escapeHtml(commandLabel)}</span>
        </button>
      `;
    }

    const label = control.label ?? titleCaseIdentifier(control.name);
    // `logout` needs a session to end, and `pwaInstall` needs the user agent to
    // have offered installation this session and the device not to be running
    // installed already. Anything else still has no runtime behind it.
    const action =
      control.kind === "logout"
        ? "sign-out"
        : control.kind === "pwaInstall" && this.installPrompt !== undefined && !this.appInstalled
          ? "install"
          : undefined;
    const available =
      action === undefined
        ? false
        : action === "install" || this._authority?.session.status === "signedIn";
    const unavailableTitle =
      control.kind === "pwaInstall" && this.appInstalled
        ? "This app is already installed."
        : `${label} is not available in this runtime.`;
    return `
      <button
        class="adl-shell-control${available ? "" : " adl-shell-control-unavailable"}"
        type="button"
        data-shell-control="${escapeHtml(control.name)}"
        data-shell-control-kind="${escapeHtml(control.kind)}"
        ${available ? `data-shell-action="${escapeHtml(action ?? "")}"` : "disabled"}
        title="${escapeHtml(available ? label : unavailableTitle)}"
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

  /**
   * The drawer's control region, rendered between the heading and the nav list.
   *
   * `navDrawer` was always a legal placement, but nothing rendered it, so a
   * control declared there disappeared. It reuses `renderShellControl`, so a
   * control looks and behaves the same wherever it was placed; only the
   * surrounding layout differs. Nothing is emitted when no control is placed
   * here, which keeps the drawer of an app that declares none unchanged.
   */
  private renderNavDrawerControls(): string {
    const controls = this.placedShellControls(this._model.shell.navDrawer.controls, "navDrawer");
    if (controls.length === 0) {
      return "";
    }

    return `
      <div class="adl-nav-drawer-tools" data-shell-drawer-tools="true">
        ${controls.map((control) => this.renderShellControl(control)).join("")}
      </div>
    `;
  }

  protected renderNavigationDrawer(activeView: ResolvedView): string {
    if (!this.hasNavigationDrawerContent) {
      return "";
    }

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
          <span data-shell-drawer-title="true">${escapeHtml(
            this._model.shell.navDrawer.title ?? this._model.app.name,
          )}</span>
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
                        class="adl-nav-item ${item.icon === undefined ? "" : "has-icon"} ${active ? "active" : ""}"
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
        ${this.renderNavDrawerControls()}
      </nav>
    `;
  }
}

/**
 * The shell's rendering of the icon vocabulary: one glyph per name in
 * {@link ICON_NAMES}.
 *
 * Text chrome, so a single character rather than presentation's inline SVG.
 * That difference is fine; the *set* must not differ, which is why this is a
 * `Record<IconName, string>` — a name added to the vocabulary and not given a
 * glyph here stops compiling. Before Phase 99 this switch and
 * `adl-composed-view`'s `iconSvg` each knew names the other did not, and each
 * rendered a blank space for the rest.
 *
 * Initial letters where one is free; `menu`, `check` and `dot` take a
 * pictographic character instead, because `M` is already `music` and neither
 * `check` nor `dot` reads as a letter at all.
 */
const SHELL_ICON_GLYPHS: Record<IconName, string> = {
  calendar: "C",
  check: "\u2713",
  close: "X",
  dot: "\u2022",
  home: "H",
  list: "L",
  "log-out": "O",
  logout: "O",
  menu: "\u2261",
  mic: "R",
  microphone: "R",
  music: "M",
  sync: "S",
  users: "U",
  x: "X",
};

function iconGlyph(icon: string): string {
  // Unreachable through a compiled model: `ADL_ICON_NAME_UNKNOWN` rejects any
  // name outside `ICON_NAMES` before it can reach a renderer. Kept so a
  // hand-built shell model degrades to no glyph rather than throwing.
  return isIconName(icon) ? SHELL_ICON_GLYPHS[icon] : "";
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
