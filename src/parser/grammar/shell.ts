import type {
  ShellContextSelectorPlacement,
  ShellControlKind,
  ShellControlPlacement,
  ShellMobileContextSelectorMode,
  ShellNavigationMode,
} from "../../model/resolved-model.js";
import type {
  ShellControlDeclarationAst,
  ShellDeclarationAst,
  ShellNavDrawerDeclarationAst,
  ShellNavItemDeclarationAst,
  ShellTopBarDeclarationAst,
  ShellVisibilityDeclarationAst,
} from "../ast.js";
import { normaliseKeyword } from "./text.js";
import { ContextParser } from "./context.js";

/**
 * `SHELL` declarations: nav items, controls, top bar, drawer and visibility.
 */
export class ShellParser extends ContextParser {
  protected parseShell(): ShellDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("SHELL", "SHELL declaration");
    let navMode: ShellNavigationMode | undefined;
    const navItems: ShellNavItemDeclarationAst[] = [];
    const controls: ShellControlDeclarationAst[] = [];
    let topBar: ShellTopBarDeclarationAst | undefined;
    let navDrawer: ShellNavDrawerDeclarationAst | undefined;
    this.consumeLineEnd("SHELL declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.SHELL", this.current());
      }

      if (this.checkEnd("SHELL")) {
        const end = this.parseEnd("SHELL");
        return {
          kind: "ShellDeclaration",
          ...(navMode === undefined ? {} : { navMode }),
          navItems,
          controls,
          ...(topBar === undefined ? {} : { topBar }),
          ...(navDrawer === undefined ? {} : { navDrawer }),
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      // `NAV_MODE` and `NAV_DRAWER` are tested before `NAV` because they start
      // with the same word as a navigation item.
      if (this.checkWord("NAV_MODE")) {
        this.expectWord("NAV_MODE", "SHELL NAV_MODE declaration");
        navMode = this.parseShellNavigationMode();
        this.consumeLineEnd("SHELL NAV_MODE declaration");
      } else if (this.checkWord("NAV_DRAWER") || this.checkDottedWord("NAV", "DRAWER")) {
        navDrawer = this.parseShellNavDrawer();
      } else if (this.checkWord("NAV")) {
        navItems.push(this.parseShellNavItem());
      } else if (this.checkWord("CONTROL")) {
        controls.push(this.parseShellControl());
      } else if (this.checkWord("TOP_BAR") || this.checkDottedWord("TOP", "BAR")) {
        topBar = this.parseShellTopBar();
      } else {
        this.failUnexpected(
          "SHELL directive NAV_MODE, NAV, NAV_DRAWER, CONTROL, TOP_BAR, or END.SHELL",
        );
      }
    }
  }

  private parseShellNavItem(): ShellNavItemDeclarationAst {
    const startToken = this.expectWord("NAV", "SHELL NAV declaration");
    const view = this.consumeName("shell navigation view name");
    let name: string | undefined;
    let label: string | undefined;
    let icon: string | undefined;
    let group: string | undefined;
    let order: number | undefined;
    let activeWhen: string[] = [];
    let visibility: ShellVisibilityDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("AS")) {
        name = this.consumeName("shell navigation item name");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("shell navigation label"));
      } else if (this.matchWord("ICON")) {
        icon = this.consumeName("shell navigation icon");
      } else if (this.matchWord("GROUP")) {
        group = this.consumeName("shell navigation group");
      } else if (this.matchWord("ORDER")) {
        order = this.consumeNumber("shell navigation order");
      } else if (
        this.matchUnderscoreOrDottedWord("SHELL NAV ACTIVE_WHEN", "ACTIVE_WHEN", "ACTIVE", "WHEN")
      ) {
        activeWhen = this.consumeNameListUntilLine("shell navigation active views");
        break;
      } else if (this.matchWord("VISIBLE")) {
        visibility = this.parseShellVisibility();
      } else {
        this.failUnexpected(
          "SHELL NAV option AS, LABEL, ICON, GROUP, ORDER, ACTIVE_WHEN, VISIBLE, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL NAV declaration");

    return {
      kind: "ShellNavItemDeclaration",
      ...(name === undefined ? {} : { name }),
      view,
      ...(label === undefined ? {} : { label }),
      ...(icon === undefined ? {} : { icon }),
      ...(group === undefined ? {} : { group }),
      ...(order === undefined ? {} : { order }),
      activeWhen,
      ...(visibility === undefined ? {} : { visibility }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellControl(): ShellControlDeclarationAst {
    const startToken = this.expectWord("CONTROL", "SHELL CONTROL declaration");
    const name = this.consumeName("shell control name");
    let controlKind: ShellControlKind | undefined;
    let label: string | undefined;
    let icon: string | undefined;
    let placement: ShellControlPlacement | undefined;
    let visibility: ShellVisibilityDeclarationAst | undefined;
    let context: string | undefined;
    let command: string | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("KIND")) {
        controlKind = this.parseShellControlKind();
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("shell control label"));
      } else if (this.matchWord("ICON")) {
        icon = this.consumeName("shell control icon");
      } else if (this.matchWord("PLACEMENT")) {
        placement = this.parseShellControlPlacement();
      } else if (this.matchWord("VISIBLE")) {
        visibility = this.parseShellVisibility();
      } else if (this.matchWord("COMMAND")) {
        command = this.consumeName("shell control command name");
      } else if (this.matchWord("CONTEXT")) {
        context = this.consumeName("shell control context");
      } else {
        this.failUnexpected(
          "SHELL CONTROL option KIND, LABEL, ICON, PLACEMENT, VISIBLE, COMMAND, CONTEXT, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL CONTROL declaration");

    return {
      kind: "ShellControlDeclaration",
      name,
      controlKind: controlKind ?? "syncStatus",
      ...(label === undefined ? {} : { label }),
      ...(icon === undefined ? {} : { icon }),
      ...(placement === undefined ? {} : { placement }),
      ...(visibility === undefined ? {} : { visibility }),
      ...(context === undefined ? {} : { context }),
      ...(command === undefined ? {} : { command }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellTopBar(): ShellTopBarDeclarationAst {
    const startToken = this.expectUnderscoreOrDottedWord(
      "SHELL TOP_BAR block",
      "TOP_BAR",
      "TOP",
      "BAR",
      "SHELL TOP_BAR declaration",
    );
    let contextSelector: ShellContextSelectorPlacement | undefined;
    let mobileContextSelector: ShellMobileContextSelectorMode | undefined;
    // Left undeclared rather than defaulted to empty: an empty list means
    // "render no controls", which is not what omitting the clause asks for.
    // Resolution falls back to the controls that declared `PLACEMENT topBar`.
    let controls: string[] | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("CONTEXT_SELECTOR")) {
        contextSelector = this.parseShellContextSelectorPlacement();
      } else if (this.matchWord("MOBILE_CONTEXT_SELECTOR")) {
        mobileContextSelector = this.parseShellMobileContextSelectorMode();
      } else if (this.matchWord("CONTROLS")) {
        controls = this.consumeNameListUntilLine("SHELL TOP_BAR controls");
        break;
      } else {
        this.failUnexpected(
          "SHELL TOP_BAR option CONTEXT_SELECTOR, MOBILE_CONTEXT_SELECTOR, CONTROLS, or end of line",
        );
      }
    }
    this.consumeLineEnd("SHELL TOP_BAR declaration");

    return {
      kind: "ShellTopBarDeclaration",
      ...(contextSelector === undefined ? {} : { contextSelector }),
      ...(mobileContextSelector === undefined ? {} : { mobileContextSelector }),
      ...(controls === undefined ? {} : { controls }),
      range: this.rangeFrom(startToken),
    };
  }

  /**
   * ```text
   * NAV_DRAWER TITLE 'Giggle Band' CONTROLS themeSwitch logout
   * ```
   *
   * Both clauses are optional. An omitted `CONTROLS` leaves `controls`
   * undefined rather than empty so resolution can still fall back to whichever
   * controls declared `PLACEMENT navDrawer`.
   */
  private parseShellNavDrawer(): ShellNavDrawerDeclarationAst {
    const startToken = this.expectUnderscoreOrDottedWord(
      "SHELL NAV_DRAWER block",
      "NAV_DRAWER",
      "NAV",
      "DRAWER",
      "SHELL NAV_DRAWER declaration",
    );
    let title: string | undefined;
    let controls: string[] | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("TITLE")) {
        title = String(this.consumeLiteral("SHELL NAV_DRAWER title"));
      } else if (this.matchWord("CONTROLS")) {
        controls = this.consumeNameListUntilLine("SHELL NAV_DRAWER controls");
        break;
      } else {
        this.failUnexpected("SHELL NAV_DRAWER option TITLE, CONTROLS, or end of line");
      }
    }
    this.consumeLineEnd("SHELL NAV_DRAWER declaration");

    return {
      kind: "ShellNavDrawerDeclaration",
      ...(title === undefined ? {} : { title }),
      ...(controls === undefined ? {} : { controls }),
      range: this.rangeFrom(startToken),
    };
  }

  private parseShellVisibility(): ShellVisibilityDeclarationAst {
    if (this.matchWord("ALWAYS")) {
      return { kind: "always" };
    }

    if (this.matchWord("ONLINE")) {
      return { kind: "online" };
    }

    if (this.matchWord("OFFLINE")) {
      return { kind: "offline" };
    }

    this.expectWord("WHEN", "SHELL visibility WHEN clause");
    if (this.matchWord("CONTEXT")) {
      const context = this.consumeName("SHELL visibility context");
      if (this.matchWord("AVAILABLE")) {
        return { kind: "contextAvailable", context };
      }
      if (this.matchWord("UNAVAILABLE")) {
        return { kind: "contextUnavailable", context };
      }
      if (this.matchWord("SELECTED")) {
        return { kind: "contextSelected", context };
      }
      this.failUnexpected("SHELL visibility CONTEXT condition AVAILABLE, UNAVAILABLE, or SELECTED");
    }

    this.failUnexpected("SHELL visibility condition CONTEXT, ONLINE, OFFLINE, or ALWAYS");
  }

  private parseShellControlKind(): ShellControlKind {
    const token = this.consumeWordToken("shell control kind");

    switch (normaliseKeyword(token.lexeme)) {
      case "contextselector":
      case "context_selector":
        return "contextSelector";
      case "themeswitch":
      case "theme_switch":
        return "themeSwitch";
      case "logout":
        return "logout";
      case "pwainstall":
      case "pwa_install":
        return "pwaInstall";
      case "syncstatus":
      case "sync_status":
        return "syncStatus";
      case "connectivity":
        return "connectivity";
      case "commandaction":
      case "command_action":
        return "commandAction";
      default:
        this.failExpected(
          "shell control kind CONTEXT_SELECTOR, THEME_SWITCH, LOGOUT, PWA_INSTALL, SYNC_STATUS, CONNECTIVITY, or COMMAND_ACTION",
          token,
        );
    }
  }

  private parseShellControlPlacement(): ShellControlPlacement {
    const token = this.consumeWordToken("shell control placement");

    switch (normaliseKeyword(token.lexeme)) {
      case "topbar":
      case "top_bar":
        return "topBar";
      case "navdrawer":
      case "nav_drawer":
        return "navDrawer";
      case "emptystate":
      case "empty_state":
        return "emptyState";
      default:
        this.failExpected("shell control placement TOP_BAR, NAV_DRAWER, or EMPTY_STATE", token);
    }
  }

  private parseShellContextSelectorPlacement(): ShellContextSelectorPlacement {
    const token = this.consumeWordToken("shell context selector placement");

    switch (normaliseKeyword(token.lexeme)) {
      case "topbar":
      case "top_bar":
        return "topBar";
      case "navdrawer":
      case "nav_drawer":
        return "navDrawer";
      case "hidden":
        return "hidden";
      default:
        this.failExpected("shell context selector placement TOP_BAR, NAV_DRAWER, or HIDDEN", token);
    }
  }

  private parseShellMobileContextSelectorMode(): ShellMobileContextSelectorMode {
    const token = this.consumeWordToken("shell mobile context selector mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "dropdown":
        return "dropdown";
      case "sheet":
        return "sheet";
      default:
        this.failExpected("shell mobile context selector mode DROPDOWN or SHEET", token);
    }
  }

  private parseShellNavigationMode(): ShellNavigationMode {
    const token = this.consumeWordToken("shell navigation mode");

    switch (normaliseKeyword(token.lexeme)) {
      case "explicitonly":
      case "explicit_only":
        return "explicitOnly";
      case "includeunlistedviews":
      case "include_unlisted_views":
        return "includeUnlistedViews";
      default:
        this.failExpected("shell navigation mode EXPLICIT_ONLY or INCLUDE_UNLISTED_VIEWS", token);
    }
  }
}
