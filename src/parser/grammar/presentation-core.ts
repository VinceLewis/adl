import type {
  JsonValue,
  PresentationDensity,
  PresentationLegendInclude,
  PresentationLayout,
  PresentationStatusThemeToken,
  PresentationStatePersistence,
  PresentationStateType,
} from "../../model/resolved-model.js";
import type {
  PresentationControlDeclarationAst,
  PresentationIconMapDeclarationAst,
  PresentationIconMapValueDeclarationAst,
  PresentationIconRefDeclarationAst,
  PresentationLegendDeclarationAst,
  PresentationCalendarDeclarationAst,
  PresentationListDeclarationAst,
  PresentationSectionDeclarationAst,
  PresentationStatusDeclarationAst,
  PresentationStatusMapDeclarationAst,
  PresentationStatusMapValueDeclarationAst,
  PresentationStateDeclarationAst,
  PresentationToggleControlDeclarationAst,
} from "../ast.js";
import { PresentationSourceParser } from "./presentation-source.js";

/**
 * Composed presentation surfaces: state, icon maps, statuses, status maps,
 * legends, sections and toggles.
 */
export class PresentationCoreParser extends PresentationSourceParser {
  protected parsePresentationState(): PresentationStateDeclarationAst {
    const startToken = this.expectWord("STATE", "VIEW STATE declaration");
    const name = this.consumeName("presentation state name");
    let type: PresentationStateType | undefined;
    let defaultValue: JsonValue | undefined;
    let persistence: PresentationStatePersistence | undefined;

    if (!this.isLineEnd() && !this.checkWord("DEFAULT") && !this.checkWord("PERSISTENCE")) {
      type = this.parsePresentationStateType();
    }

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultValue = this.consumeModifierValue("presentation state DEFAULT value");
      } else if (this.matchWord("PERSISTENCE")) {
        persistence = this.parsePresentationStatePersistence();
      } else {
        this.failUnexpected("VIEW STATE option DEFAULT, PERSISTENCE, or end of line");
      }
    }

    this.consumeLineEnd("VIEW STATE declaration");
    return {
      kind: "PresentationStateDeclaration",
      name,
      ...(type === undefined ? {} : { type }),
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(persistence === undefined ? {} : { persistence }),
      range: this.rangeFrom(startToken),
    };
  }

  protected parsePresentationIconMap(): PresentationIconMapDeclarationAst {
    const startToken = this.expectUnderscoreOrDottedWord(
      "ICON_MAP block",
      "ICON_MAP",
      "ICON",
      "MAP",
      "ICON_MAP declaration",
    );
    const name = this.consumeName("icon map name");
    this.expectWord("FOR", "ICON_MAP FOR clause");
    const field = this.consumeName("icon map field");
    let defaultIcon: string | undefined;
    const values: PresentationIconMapValueDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultIcon = this.consumeName("icon map default icon");
      } else {
        this.failUnexpected("ICON_MAP header option DEFAULT or end of line");
      }
    }
    this.consumeLineEnd("ICON_MAP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.ICON_MAP", this.current());
      }

      if (this.checkEnd("ICON_MAP")) {
        const end = this.parseEnd("ICON_MAP");
        return {
          kind: "PresentationIconMapDeclaration",
          name,
          field,
          values,
          ...(defaultIcon === undefined ? {} : { defaultIcon }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DEFAULT")) {
        defaultIcon = this.consumeName("icon map default icon");
        this.consumeLineEnd("ICON_MAP DEFAULT directive");
      } else {
        values.push(this.parsePresentationIconMapValue());
      }
    }
  }

  private parsePresentationIconMapValue(): PresentationIconMapValueDeclarationAst {
    const startToken = this.current();
    const value = this.consumePrimitiveLiteral("icon map value");
    this.expectSymbol("-", "ICON_MAP value arrow");
    this.expectSymbol(">", "ICON_MAP value arrow");
    const icon = this.consumeName("icon map icon");
    this.consumeLineEnd("ICON_MAP value directive");

    return {
      kind: "PresentationIconMapValueDeclaration",
      value,
      icon,
      range: this.rangeFrom(startToken),
    };
  }

  protected parsePresentationStatus(): PresentationStatusDeclarationAst {
    const startToken = this.expectWord("STATUS", "STATUS declaration");
    const name = this.consumeName("status name");
    let label: string | undefined;
    let accessibleLabel: string | undefined;
    let icon: PresentationIconRefDeclarationAst | undefined;
    let themeToken: PresentationStatusThemeToken | undefined;
    let precedence: number | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("status label"));
      } else if (
        this.matchUnderscoreOrDottedWord("STATUS ARIA_LABEL", "ARIA_LABEL", "ARIA", "LABEL")
      ) {
        accessibleLabel = String(this.consumeLiteral("status accessible label"));
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
      } else if (this.matchWord("THEME")) {
        themeToken = this.parsePresentationStatusThemeToken();
      } else if (this.matchWord("PRECEDENCE")) {
        precedence = Number(this.consumeLiteral("status precedence"));
      } else {
        this.failUnexpected(
          "STATUS option LABEL, ARIA_LABEL, ICON, THEME, PRECEDENCE, or end of line",
        );
      }
    }

    this.consumeLineEnd("STATUS declaration");
    return {
      kind: "PresentationStatusDeclaration",
      name,
      ...(label === undefined ? {} : { label }),
      ...(accessibleLabel === undefined ? {} : { accessibleLabel }),
      ...(icon === undefined ? {} : { icon }),
      ...(themeToken === undefined ? {} : { themeToken }),
      ...(precedence === undefined ? {} : { precedence }),
      range: this.rangeFrom(startToken),
    };
  }

  protected parsePresentationStatusMap(): PresentationStatusMapDeclarationAst {
    const startToken = this.expectUnderscoreOrDottedWord(
      "STATUS_MAP block",
      "STATUS_MAP",
      "STATUS",
      "MAP",
      "STATUS_MAP declaration",
    );
    const name = this.consumeName("status map name");
    this.expectWord("FOR", "STATUS_MAP FOR clause");
    const field = this.consumeName("status map field");
    let defaultStatus: string | undefined;
    const values: PresentationStatusMapValueDeclarationAst[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("DEFAULT")) {
        defaultStatus = this.consumeName("status map default status");
      } else {
        this.failUnexpected("STATUS_MAP header option DEFAULT or end of line");
      }
    }
    this.consumeLineEnd("STATUS_MAP declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.STATUS_MAP", this.current());
      }

      if (this.checkEnd("STATUS_MAP")) {
        const end = this.parseEnd("STATUS_MAP");
        return {
          kind: "PresentationStatusMapDeclaration",
          name,
          field,
          values,
          ...(defaultStatus === undefined ? {} : { defaultStatus }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("DEFAULT")) {
        defaultStatus = this.consumeName("status map default status");
        this.consumeLineEnd("STATUS_MAP DEFAULT directive");
      } else {
        values.push(this.parsePresentationStatusMapValue());
      }
    }
  }

  private parsePresentationStatusMapValue(): PresentationStatusMapValueDeclarationAst {
    const startToken = this.current();
    const value = this.consumePrimitiveLiteral("status map value");
    this.expectSymbol("-", "STATUS_MAP value arrow");
    this.expectSymbol(">", "STATUS_MAP value arrow");
    const status = this.consumeName("status map status");
    this.consumeLineEnd("STATUS_MAP value directive");

    return {
      kind: "PresentationStatusMapValueDeclaration",
      value,
      status,
      range: this.rangeFrom(startToken),
    };
  }

  protected parsePresentationLegend(): PresentationLegendDeclarationAst {
    const startToken = this.expectWord("LEGEND", "LEGEND declaration");
    const name = this.consumeName("legend name");
    let title: string | undefined;
    let include: PresentationLegendInclude | undefined;
    let statuses: string[] = [];

    while (!this.isLineEnd()) {
      if (this.matchWord("TITLE")) {
        title = String(this.consumeLiteral("legend title"));
      } else if (this.matchWord("INCLUDE")) {
        include = this.parsePresentationLegendInclude();
      } else if (this.matchWord("STATUSES")) {
        statuses = this.consumeNameListUntilLine("legend status list");
        break;
      } else {
        this.failUnexpected("LEGEND option TITLE, INCLUDE, STATUSES, or end of line");
      }
    }

    this.consumeLineEnd("LEGEND declaration");
    return {
      kind: "PresentationLegendDeclaration",
      name,
      ...(title === undefined ? {} : { title }),
      statuses,
      ...(include === undefined ? {} : { include }),
      range: this.rangeFrom(startToken),
    };
  }

  protected parsePresentationSection(): PresentationSectionDeclarationAst {
    const leadingComment = this.takeLeadingComment();
    const startToken = this.expectWord("SECTION", "SECTION declaration");
    const name = this.consumeName("section name");
    let heading: string | undefined;
    let layout: PresentationLayout | undefined;
    let density: PresentationDensity | undefined;
    const controls: PresentationControlDeclarationAst[] = [];
    const lists: PresentationListDeclarationAst[] = [];
    const calendars: PresentationCalendarDeclarationAst[] = [];
    this.consumeLineEnd("SECTION declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.SECTION", this.current());
      }

      if (this.checkEnd("SECTION")) {
        const end = this.parseEnd("SECTION");
        return {
          kind: "PresentationSectionDeclaration",
          name,
          ...(heading === undefined ? {} : { heading }),
          ...(layout === undefined ? {} : { layout }),
          ...(density === undefined ? {} : { density }),
          controls,
          lists,
          calendars,
          ...(leadingComment === undefined ? {} : { leadingComment }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("HEADING")) {
        heading = String(this.consumeLiteral("section heading"));
        this.consumeLineEnd("SECTION HEADING directive");
      } else if (this.matchWord("LAYOUT")) {
        layout = this.parsePresentationLayout();
        this.consumeLineEnd("SECTION LAYOUT directive");
      } else if (this.matchWord("DENSITY")) {
        density = this.parsePresentationDensity();
        this.consumeLineEnd("SECTION DENSITY directive");
      } else if (this.checkWord("TOGGLE")) {
        controls.push(this.parsePresentationToggle());
      } else if (this.checkWord("ACTION")) {
        controls.push(this.parsePresentationAction());
      } else if (this.checkWord("LIST")) {
        lists.push(this.parsePresentationList());
      } else if (this.checkWord("CALENDAR")) {
        calendars.push(this.parsePresentationCalendar());
      } else {
        this.failUnexpected(
          "SECTION directive HEADING, LAYOUT, DENSITY, TOGGLE, ACTION, LIST, CALENDAR, or END.SECTION",
        );
      }
    }
  }

  private parsePresentationToggle(): PresentationToggleControlDeclarationAst {
    const startToken = this.expectWord("TOGGLE", "TOGGLE declaration");
    const name = this.consumeName("toggle name");
    let state = name;
    let label: string | undefined;
    let icon: PresentationIconRefDeclarationAst | undefined;

    while (!this.isLineEnd()) {
      if (this.matchWord("STATE")) {
        state = this.consumeName("toggle state name");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("toggle label"));
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
      } else {
        this.failUnexpected("TOGGLE header option STATE, LABEL, ICON, or end of line");
      }
    }
    this.consumeLineEnd("TOGGLE declaration");

    while (true) {
      this.skipNewlines();

      if (this.isAtEnd()) {
        this.failExpected("END.TOGGLE", this.current());
      }

      if (this.checkEnd("TOGGLE")) {
        const end = this.parseEnd("TOGGLE");
        return {
          kind: "PresentationToggleControlDeclaration",
          name,
          state,
          ...(label === undefined ? {} : { label }),
          ...(icon === undefined ? {} : { icon }),
          end,
          range: { start: startToken.range.start, end: end.range.end },
        };
      }

      if (this.matchWord("STATE")) {
        state = this.consumeName("toggle state name");
        this.consumeLineEnd("TOGGLE STATE directive");
      } else if (this.matchWord("LABEL")) {
        label = String(this.consumeLiteral("toggle label"));
        this.consumeLineEnd("TOGGLE LABEL directive");
      } else if (this.matchWord("ICON")) {
        icon = this.parsePresentationIconRef("value");
        this.consumeLineEnd("TOGGLE ICON directive");
      } else {
        this.failUnexpected("TOGGLE directive STATE, LABEL, ICON, or END.TOGGLE");
      }
    }
  }
}
