import type { ThemeDensity, ThemeNav, ThemeRadius } from "../../model/resolved-model.js";
import type { ThemeDeclarationAst, ThemeTokenDeclarationAst, ThemeTokenName } from "../ast.js";
import { normaliseKeyword, lowerCamel } from "./text.js";
import { ExpressionParser } from "./expression.js";

/**
 * `THEME` declarations and their token overrides.
 */
export class ThemeParser extends ExpressionParser {
  protected parseTheme(): ThemeDeclarationAst {
    const startToken = this.expectWord("THEME", "THEME declaration");
    const name = this.consumeName("theme name");
    let base: string | undefined;
    const tokens: ThemeTokenDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("BASE")) {
        base = this.consumeName("base theme name");
      } else {
        this.failUnexpected("THEME header option BASE or end of line");
      }
    }
    this.consumeLineEnd("THEME declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.THEME", this.current());
      }

      if (this.checkEnd("THEME")) {
        const end = this.parseEnd("THEME");
        return {
          kind: "ThemeDeclaration",
          name,
          ...(base === undefined ? {} : { base }),
          tokens,
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      tokens.push(this.parseThemeToken());
    }
  }

  private parseThemeToken(): ThemeTokenDeclarationAst {
    const startToken = this.current();
    let token: ThemeTokenName;

    if (this.matchWord("TOKEN")) {
      token = this.parseThemeTokenName(this.consumeName("theme token name"));
    } else {
      token = this.parseThemeTokenName(this.consumeWordLexeme("theme token name"));
    }

    const value = this.parseThemeTokenValue(token);
    this.consumeLineEnd("THEME token directive");
    return {
      kind: "ThemeTokenDeclaration",
      token,
      value,
      range: this.rangeFrom(startToken),
    };
  }

  private parseThemeTokenName(raw: string): ThemeTokenName {
    switch (normaliseKeyword(raw)) {
      case "primary":
      case "colorprimary":
        return "colorPrimary";
      case "accent":
      case "coloraccent":
        return "colorAccent";
      case "background":
      case "colorbackground":
        return "colorBackground";
      case "surface":
      case "colorsurface":
        return "colorSurface";
      case "surfacealt":
      case "colorsurfacealt":
        return "colorSurfaceAlt";
      case "text":
      case "colortext":
        return "colorText";
      case "textmuted":
      case "colortextmuted":
        return "colorTextMuted";
      case "textinverted":
      case "colortextinverted":
        return "colorTextInverted";
      case "border":
      case "colorborder":
        return "colorBorder";
      case "danger":
      case "colordanger":
        return "colorDanger";
      case "success":
      case "colorsuccess":
        return "colorSuccess";
      case "info":
      case "colorinfo":
        return "colorInfo";
      case "statusevent":
      case "colorstatusevent":
        return "colorStatusEvent";
      case "statusalternate":
      case "colorstatusalternate":
        return "colorStatusAlternate";
      case "statusavailable":
      case "colorstatusavailable":
        return "colorStatusAvailable";
      case "statusunavailable":
      case "colorstatusunavailable":
        return "colorStatusUnavailable";
      case "statusbusyelsewhere":
      case "colorstatusbusyelsewhere":
        return "colorStatusBusyElsewhere";
      case "statusconflict":
      case "colorstatusconflict":
        return "colorStatusConflict";
      case "statusunset":
      case "colorstatusunset":
        return "colorStatusUnset";
      case "radius":
        return "radius";
      case "density":
        return "density";
      case "nav":
      case "navigation":
        return "nav";
      case "font":
      case "fontfamily":
        return "fontFamily";
      case "logo":
      case "logourl":
        return "logoUrl";
      default:
        this.failExpected("known theme token name", this.previous());
    }
  }

  private parseThemeTokenValue(
    token: ThemeTokenName,
  ): string | ThemeRadius | ThemeDensity | ThemeNav {
    const value = String(this.consumeLiteral("theme token value"));

    switch (token) {
      case "radius":
        return normaliseThemeRadius(value);
      case "density":
        return normaliseThemeDensity(value);
      case "nav":
        return normaliseThemeNav(value);
      default:
        return value;
    }
  }
}

function normaliseThemeRadius(value: string): ThemeRadius {
  return lowerCamel(value) as ThemeRadius;
}

function normaliseThemeDensity(value: string): ThemeDensity {
  return lowerCamel(value) as ThemeDensity;
}

function normaliseThemeNav(value: string): ThemeNav {
  return lowerCamel(value) as ThemeNav;
}
